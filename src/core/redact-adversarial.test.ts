/**
 * Adversarial tests for redaction — D-028, D-033.
 *
 * The question these ask is not "does redaction work". It is **"can something strange,
 * hostile, or merely unlucky get a secret into an immutable ledger, or get real evidence
 * thrown out of one?"**
 *
 * Both directions are failures. A leak is unrecoverable because the store is append-only.
 * A false positive silently destroys the evidence the product exists to preserve. So the
 * suite is deliberately split down that line.
 */

import { describe, it, expect } from 'vitest'
import { redactText, redactDeep, isSensitivePath } from './redact.js'

describe('adversarial — secrets must not slip through', () => {
  it('redacts a secret buried deep inside a nested payload', () => {
    // The backstop's whole purpose: a future recorder inventing its own payload shape.
    const payload = {
      recorder: 'future',
      detail: { attempts: [{ env: 'GITHUB_TOKEN=ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }] },
    }
    const { value, count } = redactDeep(payload)
    expect(JSON.stringify(value)).not.toContain('ghp_AAAA')
    expect(count).toBeGreaterThan(0)
  })

  it('redacts secrets in object VALUES without touching KEYS', () => {
    // Keys are schema. Redacting one would corrupt the event's shape, not protect data.
    const { value } = redactDeep({ GITHUB_TOKEN: 'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })
    expect(Object.keys(value)).toEqual(['GITHUB_TOKEN'])
  })

  it('is not defeated by a secret split across array elements it can see whole', () => {
    const { value } = redactDeep(['--token', 'sk-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'])
    expect(JSON.stringify(value)).not.toContain('sk-AAAA')
  })

  it('survives a deeply nested payload without stack overflow', () => {
    // Bounded by MAX_REDACT_DEPTH. An unbounded walk would be a denial of service on the
    // recorder, reachable from payload data.
    let deep: Record<string, unknown> = { leaf: 'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }
    for (let i = 0; i < 500; i++) deep = { nested: deep }
    expect(() => redactDeep(deep)).not.toThrow()
  })

  it('handles cyclic-looking but finite structures without hanging', () => {
    const shared = { token: 'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }
    const payload = { a: shared, b: shared, c: [shared, shared] }
    const { value } = redactDeep(payload)
    expect(JSON.stringify(value)).not.toContain('ghp_AAAA')
  })

  it('redacts a secret adjacent to hostile unicode', () => {
    // Hostile filenames already round-trip through the chain; secrets beside them must
    // still be caught rather than the regex silently failing to anchor.
    const { value } = redactText('日本語 ‮evil‬ GITHUB_TOKEN=ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    expect(value).not.toContain('ghp_AAAA')
    expect(value).toContain('日本語')
  })

  it('redacts every secret in a very long string, not just the first', () => {
    const secret = 'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const long = Array.from({ length: 200 }, (_, i) => `line ${i} ${secret}`).join('\n')
    const { value } = redactText(long)
    expect(value).not.toContain(secret)
  })

  it('does not leave a secret behind when it appears twice on one line', () => {
    const { value } = redactText('a=sk-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA b=sk-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB')
    expect(value).not.toContain('sk-AAAA')
    expect(value).not.toContain('sk-BBBB')
  })
})

describe('adversarial — evidence must not be destroyed', () => {
  it('does not touch non-string payload types', () => {
    // Collapsing a number to a string, or a null to "", would corrupt the record while
    // looking like it worked.
    const payload = { exitCode: 0, signal: null, durationMs: 42, binary: false }
    expect(redactDeep(payload).value).toEqual(payload)
  })

  it('preserves an explicit null rather than collapsing it', () => {
    // "Unknown must remain unknown" — exitCode null means signal-killed, not success.
    const { value } = redactDeep({ exitCode: null })
    expect(value.exitCode).toBeNull()
  })

  it('leaves a full session of ordinary commands byte-identical', () => {
    const session = [
      'npm test',
      'git commit -m "fix: handle empty input"',
      'docker run -p 8080:80 nginx',
      'mkdir -p src/components',
      'node --version',
      'pytest tests/ -k "not slow"',
    ]
    const { value, count } = redactDeep(session)
    expect(value).toEqual(session)
    expect(count).toBe(0)
  })

  it('does not eat a commit sha, uuid, or integrity hash', () => {
    const evidence = {
      sha: '3f2a1b9c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f90',
      uuid: '550e8400-e29b-41d4-a716-446655440000',
      blob: 'a'.repeat(64),
    }
    expect(redactDeep(evidence).value).toEqual(evidence)
  })
})

describe('adversarial — sensitive file paths', () => {
  it.each([
    '.env',
    '.env.local',
    '.env.production',
    'config/.env',
    'id_rsa',
    'server.pem',
    'private.key',
    '.npmrc',
    '.netrc',
    '.git-credentials',
    'secrets.json',
    'secrets.yaml',
    'service-account-prod.json',
    'cert.p12',
  ])('withholds content for %s', (p) => {
    expect(isSensitivePath(p)).toBe(true)
  })

  it.each([
    '.env.example',
    '.env.sample',
    '.env.template',
    'id_rsa.pub',
    'src/auth.ts',
    'README.md',
    'package.json',
    'environment.ts',
    'keyboard.ts',
  ])('keeps content for %s', (p) => {
    // False positives here cost only a diff, but `environment.ts` and `keyboard.ts` are
    // ordinary source files and losing their diffs for a substring match would be a real
    // regression in the product's core output.
    expect(isSensitivePath(p)).toBe(false)
  })

  it('matches on the basename, not on a parent directory name', () => {
    expect(isSensitivePath('/home/u/.env.d/notes.md')).toBe(false)
  })

  it('is case-insensitive, because Windows is', () => {
    expect(isSensitivePath('C:\\proj\\.ENV')).toBe(true)
    expect(isSensitivePath('C:\\proj\\ID_RSA')).toBe(true)
  })
})
