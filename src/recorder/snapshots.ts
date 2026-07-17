/**
 * LODESTAR — content-addressed snapshot store.
 *
 * Every file write saves the prior version, which is what makes before/after diffs
 * possible at V0 and rollback possible in the Fix layer later. Content-addressed, so
 * a file rewritten with identical content costs nothing and an unchanged file is
 * detected by hash rather than by trusting a timestamp.
 *
 * Blobs live in `.lodestar/sessions/blobs/<aa>/<rest>`. Sharding by the first two hex
 * characters keeps directory sizes sane on filesystems that care.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isSensitivePath } from '../core/redact.js'

/**
 * Files larger than this are recorded as metadata only — no content blob.
 *
 * The record is text-shaped by design; storing a 200 MB binary would trade the
 * product's cost model for a diff nobody can read. RF-10 exists to disclose this
 * rather than let the omission look like "nothing changed".
 */
export const DEFAULT_MAX_FILE_BYTES = 1024 * 1024

export interface FileSnapshot {
  /** Blob ref, absent when the file was too large, sensitive, or unreadable. */
  ref?: string
  /**
   * The OS's modification time. Free — `statSync` is called anyway.
   *
   * This is what lets RF-04 compare when things HAPPENED instead of when we NOTICED.
   * See D-044.
   */
  mtimeMs?: number
  bytes: number
  binary: boolean
  /** True when content was skipped because of size. Surfaces as RF-10. */
  oversized: boolean
  /**
   * True when content was skipped because the path is credential-shaped (`.env`,
   * `id_rsa`, `*.pem`). The event is still recorded — only the bytes are withheld.
   * See D-033 and `isSensitivePath`.
   */
  sensitive: boolean
}

/** A null byte in the first 8 KiB is the same heuristic git uses. Good enough, and cheap. */
export function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

export class SnapshotStore {
  private readonly blobDir: string

  constructor(
    dir: string,
    private readonly maxBytes: number = DEFAULT_MAX_FILE_BYTES,
  ) {
    this.blobDir = join(dir, 'blobs')
    mkdirSync(this.blobDir, { recursive: true })
  }

  private pathFor(ref: string): string {
    return join(this.blobDir, ref.slice(0, 2), ref.slice(2))
  }

  /** Store bytes, return their content hash. Idempotent — identical content, identical ref. */
  putContent(buf: Buffer): string {
    const ref = createHash('sha256').update(buf).digest('hex')
    const p = this.pathFor(ref)
    if (!existsSync(p)) {
      mkdirSync(join(this.blobDir, ref.slice(0, 2)), { recursive: true })
      writeFileSync(p, buf)
    }
    return ref
  }

  get(ref: string): Buffer | null {
    const p = this.pathFor(ref)
    return existsSync(p) ? readFileSync(p) : null
  }

  has(ref: string): boolean {
    return existsSync(this.pathFor(ref))
  }

  /**
   * Snapshot a file from disk.
   *
   * Returns null only when the file cannot be read at all (deleted mid-flight, or
   * permissions). A null is a real gap in the record and callers must not silently
   * treat it as "unchanged".
   */
  putFile(path: string): FileSnapshot | null {
    let bytes: number
    let mtimeMs: number
    try {
      const st = statSync(path)
      bytes = st.size
      mtimeMs = st.mtimeMs
    } catch {
      return null
    }

    // ---- credential-shaped files: record the event, never the bytes ----------
    //
    // Checked before the file is opened, so the content never enters this process, let
    // alone the blob store. A `.env` is not text containing a secret — it is entirely
    // secrets, in formats no pattern will reliably match, so `redactText` would produce
    // something that looks scrubbed and is not. Withholding is the only honest option.
    //
    // The caller still emits a `file.write` event: "`.env` changed at 14:32" is real
    // evidence, and the event declares the withheld content rather than hiding the hole.
    // See D-033.
    if (isSensitivePath(path)) {
      return { bytes, mtimeMs, binary: false, oversized: false, sensitive: true }
    }

    if (bytes > this.maxBytes) {
      return { bytes, mtimeMs, binary: false, oversized: true, sensitive: false }
    }

    try {
      const buf = readFileSync(path)
      return {
        ref: this.putContent(buf),
        mtimeMs,
        bytes: buf.length,
        binary: looksBinary(buf),
        oversized: false,
        sensitive: false,
      }
    } catch {
      return null
    }
  }
}
