/**
 * Terminal output neutralizes evidence-controlled escape sequences — release audit.
 *
 * The strings the CLI prints come from evidence (command lines, filenames, link
 * reasons) — all writable by the observed agent. `html.ts` escapes this class for the
 * HTML surface; `ui.ts` must hold the same line for the terminal, or a command named
 * with `ESC[2J`/`\r` can repaint the verdict in `report --terminal` and every
 * `graph query`. These tests pin the non-TTY (piped/CI) behavior, which is the mode
 * vitest runs in and the mode scripts consume.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { out, errOut } from './ui.js'

function captureStdout(fn: () => void): string {
  let buf = ''
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    buf += String(chunk)
    return true
  })
  try {
    fn()
  } finally {
    spy.mockRestore()
  }
  return buf
}

afterEach(() => vi.restoreAllMocks())

describe('terminal output neutralizes control sequences', () => {
  it('strips cursor-movement and clear-screen escapes from evidence strings', () => {
    const hostile = 'npm test \x1b[2J\x1b[H\x1b[32mINTACT forged\x1b[0m done'
    const written = captureStdout(() => out(hostile))
    expect(written).not.toContain('\x1b')
    // The payload is disclosed as text, not executed as a control.
    expect(written).toContain('npm test')
    expect(written).toContain('done')
  })

  it('strips carriage returns — the line-overwrite primitive', () => {
    const written = captureStdout(() => out('BROKEN: chain fails\rINTACT all good'))
    expect(written).not.toContain('\r')
    expect(written).toContain('BROKEN: chain fails')
  })

  it('strips OSC/BEL and C1 introducers', () => {
    const written = captureStdout(() => out('x \x1b]0;evil title\x07 y ' + String.fromCharCode(0x9b) + '31m z'))
    expect(written).not.toContain('\x1b')
    expect(written).not.toContain('\x07')
    expect(written).not.toContain(String.fromCharCode(0x9b))
    expect(written).toContain('x')
    expect(written).toContain('y')
    expect(written).toContain('z')
  })

  it('keeps newlines, tabs, and ordinary unicode untouched', () => {
    const s = 'a\tb\nfile —ναι ✓ 文件.ts -dash-'
    const written = captureStdout(() => out(s))
    expect(written).toBe(s + '\n')
  })

  it('errOut applies the same rule', () => {
    let buf = ''
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      buf += String(chunk)
      return true
    })
    try {
      errOut('warn \x1b[3Amoved')
    } finally {
      spy.mockRestore()
    }
    expect(buf).not.toContain('\x1b')
    expect(buf).toContain('moved')
  })
})
