/**
 * `node demo/capture.mjs` — landing-page screenshots, from a REAL session.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THIS FILE EXISTS TO ENFORCE
 * ---------------------------------------------------------------------------
 *
 * **Every pixel on the landing page comes from a report LODESTAR actually produced.**
 *
 * No mockups, no Figma, no "representative" screenshot touched up to look better than the
 * product. This is a trust company: the first thing a visitor sees cannot be the first
 * thing we shaded. If a screenshot looks wrong, the fix belongs in `html.ts`, not here.
 *
 * It drives `demo/run.mjs` (a real git repo, a real agent, a real `npm test`, a real
 * record), exports the real HTML report, and photographs regions of it at 2× through the
 * Chrome DevTools Protocol.
 *
 * ---------------------------------------------------------------------------
 * WHY CDP AND NOT `--screenshot`
 * ---------------------------------------------------------------------------
 *
 * `chrome --headless --screenshot` captures the viewport from the top of the layout, and
 * ignores any scrolling the page does — so a shot of the "Changes" pane came out as a
 * photograph of the header with a lot of black underneath. It failed *silently*, which is
 * the failure mode this project keeps re-learning: it produced a file, and the file was
 * wrong.
 *
 * CDP lets us select the pane, measure the element, and clip the capture to it. Node 24
 * ships a global WebSocket, so this costs no dependency.
 *
 * Usage:
 *   npm run build && node demo/run.mjs --keep && node demo/capture.mjs
 */

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WORKSPACE = join(HERE, '.workspace')
const CLI = join(HERE, '..', 'dist', 'cli', 'index.js')
const OUT = join(HERE, '..', 'site', 'assets')
const PORT = 9333

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

const chrome = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!chrome) {
  console.error('No Chrome/Edge found. Screenshots need one; the report itself does not.')
  process.exit(1)
}
if (!existsSync(WORKSPACE)) {
  console.error('No recorded session. Run:  node demo/run.mjs --keep')
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })

// ---- the real report, from the real command --------------------------------
const REPORT = join(OUT, 'report.html')
execFileSync(process.execPath, [CLI, 'report', '--html', REPORT], { cwd: WORKSPACE, stdio: 'pipe' })
const fileUrl = `file:///${REPORT.split('\\').join('/')}`
console.log(`report → site/assets/report.html`)

// ---- a minimal CDP client ---------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function connect() {
  const proc = spawn(
    chrome,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--force-dark-mode',
      '--enable-features=WebContentsForceDark',
      '--window-size=1280,900',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  let target = null
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200)
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      target = list.find((t) => t.type === 'page')
    } catch {
      /* not up yet */
    }
  }
  if (!target) throw new Error('Chrome did not expose a debugging target')

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })

  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    const p = pending.get(msg.id)
    if (p) {
      pending.delete(msg.id)
      msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result)
    }
  })

  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const msgId = ++id
      pending.set(msgId, { res, rej })
      ws.send(JSON.stringify({ id: msgId, method, params }))
    })

  return { send, close: () => (ws.close(), proc.kill()) }
}

const { send, close } = await connect()

await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 1280,
  height: 900,
  // 2× so the landing page stays crisp on a retina display. The page is unchanged; this
  // is the camera, not the subject.
  deviceScaleFactor: 2,
  mobile: false,
})
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-color-scheme', value: 'dark' }],
})

/**
 * Photograph one element.
 *
 * `selector` names the region; `pane` (optional) selects a tab first. The clip is measured
 * from the live layout, so a shot can never quietly become a picture of the wrong thing —
 * the failure that made `--screenshot` unusable here.
 */
async function shot(name, { selector, pane, pad = 24, padBottom = pad, dark = true, expand = false }) {
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }],
  })
  // Always navigate to the bare URL, then click. Navigating to `#changes` on a document
  // that is already loaded is a same-document navigation: the load handler does not run
  // again, the pane stays hidden, and the "screenshot" comes out 48×48 — a file that
  // exists and is wrong. Clicking drives the same code path a user does.
  await send('Page.navigate', { url: fileUrl })
  await sleep(600)
  if (pane) {
    await send('Runtime.evaluate', {
      expression: `document.querySelector('[data-pane="p-${pane}"]').click()`,
    })
    await sleep(200)
  }
  if (expand) {
    // The diff is the thing worth showing, and it lives behind a disclosure. Opening it is
    // what a reader does one second later; a screenshot of the closed state would be a
    // photograph of a summary row.
    await send('Runtime.evaluate', {
      expression: `document.querySelectorAll('details').forEach(function (d) { d.open = true })`,
    })
    await sleep(200)
  }

  const { result } = await send('Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return JSON.stringify({
        x: Math.max(0, r.x - ${pad}),
        y: Math.max(0, r.y + window.scrollY - ${pad}),
        width: r.width + ${pad * 2},
        // Bottom padding is separate: a symmetric pad catches the top edge of whatever
        // follows, and a screenshot with a sliver of the next card in it looks like a
        // crop that got away from us.
        height: r.height + ${pad} + ${padBottom},
      });
    })()`,
    returnByValue: true,
  })
  if (!result.value) throw new Error(`selector not found: ${selector}`)
  const clip = { ...JSON.parse(result.value), scale: 2 }

  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    clip,
    captureBeyondViewport: true,
  })
  const file = join(OUT, `${name}.png`)
  writeFileSync(file, Buffer.from(data, 'base64'))
  const kb = (readFileSync(file).length / 1024).toFixed(0)
  console.log(`  ${name}.png  ${Math.round(clip.width)}×${Math.round(clip.height)}  ${kb} KB`)
}

console.log('capturing:')
// The money shot: the verdict and the two facts, exactly as a developer sees them.
await shot('facts', { selector: '.section', padBottom: 4 })
await shot('facts-light', { selector: '.section', padBottom: 4, dark: false })
await shot('hero', { selector: '.wrap > h1 ~ .chips, .wrap', pad: 0 })
await shot('timeline', { selector: '#p-timeline .card-table', pane: 'timeline' })
await shot('changes', { selector: '#p-changes', pane: 'changes', expand: true })
await shot('verify', { selector: '#p-verify', pane: 'verify' })
await shot('sessions', { selector: '#p-sessions', pane: 'sessions' })

close()

// ---- the terminal, replayed from real output --------------------------------
//
// Captured by running the demo and keeping stdout verbatim, ANSI codes and all. The
// landing page animates this text; it does not retype it. If the CLI's output changes,
// this changes with it — which is the point.
const cast = execFileSync(process.execPath, [join(HERE, 'run.mjs'), '--keep'], {
  encoding: 'utf8',
  env: { ...process.env, FORCE_COLOR: '1' },
})
writeFileSync(join(OUT, 'session.cast.txt'), cast, 'utf8')
console.log(`  session.cast.txt  ${cast.split('\n').length} lines of real output`)

execFileSync(process.execPath, [CLI, 'report', '--html', REPORT], { cwd: WORKSPACE, stdio: 'pipe' })
console.log(`\nDone → site/assets/`)
