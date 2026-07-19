/**
 * LODESTAR — the HTML renderer.
 *
 * ---------------------------------------------------------------------------
 * THIS FILE HAS NO OPINIONS — D-054
 * ---------------------------------------------------------------------------
 *
 * It is the third renderer over `SessionReport`, after the terminal and alongside the
 * static export (which is this same function, written to a file). D-049 fixed the rule and
 * this file is where the rule is most likely to be broken, because HTML invites logic:
 * a `class="ok"` here, a `if (!facts.length) green` there, and within a month the browser
 * and the terminal disagree about whether a session was fine.
 *
 * So the discipline, stated as a test you can apply while reading:
 *
 *   Every judgment word on the page — VERIFIED, DEGRADED, BROKEN, "No divergences
 *   observed", every limitation, every reason a diff is missing — is a STRING FROM THE
 *   MODEL. This file chooses layout, colour, and order. It never decides meaning.
 *
 * The one thing it must get right on its own is **escaping**, and that is not a judgment:
 * see `esc()`.
 *
 * ---------------------------------------------------------------------------
 * SELF-CONTAINED, BECAUSE THE EXPORT IS THE GROWTH LOOP — D-014
 * ---------------------------------------------------------------------------
 *
 * No CDN, no fonts, no fetch, no framework. A teammate who installed nothing must be able
 * to open the file and have it work — offline, from a downloads folder, in five years. A
 * single `<script>` handles tab switching and disclosure. That is all the JS there is, and
 * it computes nothing.
 */

import type {
  DiffView,
  FactStep,
  FileChange,
  SessionIndexRow,
  SessionReport,
} from '../facts/report.js'

/**
 * Escape text for HTML. The one piece of real logic in this file, and it is security, not
 * meaning.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT OPTIONAL AND WHY IT IS TESTED ADVERSARIALLY
 * ---------------------------------------------------------------------------
 *
 * Reality Facts contain **filenames and command strings that the agent chose**. RF-07's
 * statement is a path; the timeline is full of argv. A file named
 * `<img src=x onerror=alert(1)>.ts` is a perfectly legal filename on Linux and macOS, and
 * the stress suite already proves LODESTAR records hostile filenames byte-identically —
 * which means it will faithfully hand them to this renderer.
 *
 * And the export is **designed to be shared** (D-014). So an unescaped report is a stored
 * XSS delivered by a trust tool, to a teammate, in a file they opened *because* they
 * trusted it. The blast radius is the whole point of the feature.
 *
 * Escaping everything, always, at the boundary — not "where it looks risky" — is the only
 * version of this that holds. Every interpolation in this file goes through `esc()`.
 */
export function esc(s: unknown): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface HtmlOptions {
  /**
   * `server` links to other sessions; `export` does not, because a shared file has no
   * server behind it and a dead link in a trust report is a small lie.
   *
   * Presentation only. It must never change a judgment — asserted by a test.
   */
  mode: 'server' | 'export'
  /** Rows for the session explorer. Empty renders the explorer as absent, not as zero. */
  index: SessionIndexRow[]
  /** Resolved lazily so a report can render without a blob store. */
  diff?: (change: FileChange) => DiffView
  generatedAt: string
}

/**
 * Icons, as an inline SVG sprite.
 *
 * Inline because the export must work offline forever (D-014) — an icon font or an SVG
 * fetched from a CDN is a dependency on a server outliving neither the link nor the
 * reader's trust. `currentColor` throughout, so an icon inherits the semantics of the
 * thing it sits in rather than carrying its own.
 */
const ICONS = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="i-check" viewBox="0 0 16 16"><path fill="currentColor" d="M13.78 4.22a.75.75 0 0 1 0 1.06l-6.5 6.5a.75.75 0 0 1-1.06 0l-3.25-3.25a.75.75 0 1 1 1.06-1.06L6.75 10.19l5.97-5.97a.75.75 0 0 1 1.06 0Z"/></symbol>
  <symbol id="i-alert" viewBox="0 0 16 16"><path fill="currentColor" d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368ZM8 5a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5A.75.75 0 0 1 8 5Zm0 7a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></symbol>
  <symbol id="i-x" viewBox="0 0 16 16"><path fill="currentColor" d="M2.343 13.657A8 8 0 1 1 13.658 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.75.75 0 0 0-1.06 1.06L6.94 8 4.97 9.97a.75.75 0 1 0 1.06 1.06L8 9.06l1.97 1.97a.75.75 0 1 0 1.06-1.06L9.06 8l1.97-1.97a.75.75 0 0 0-1.06-1.06L8 6.94Z"/></symbol>
  <symbol id="i-question" viewBox="0 0 16 16"><path fill="currentColor" d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.92 6.085c.081-.16.19-.299.34-.398.145-.097.371-.187.74-.187.28 0 .553.087.738.225A.613.613 0 0 1 9 6.25c0 .177-.04.264-.077.318a.956.956 0 0 1-.277.245c-.076.051-.158.1-.258.161l-.007.004a7.61 7.61 0 0 0-.313.195 2.11 2.11 0 0 0-.692.72A.75.75 0 0 0 8.75 8.75c0-.02.001-.03.007-.048.006-.017.026-.06.107-.145.084-.089.19-.17.315-.253l.008-.005a7.87 7.87 0 0 1 .27-.164c.155-.093.32-.192.463-.298.283-.211.5-.48.5-.887 0-.717-.343-1.294-.85-1.67C9.06 4.906 8.545 4.75 8 4.75c-.63 0-1.15.16-1.573.44a2.07 2.07 0 0 0-.833.982.75.75 0 0 0 1.326.687ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></symbol>
  <symbol id="i-info" viewBox="0 0 16 16"><path fill="currentColor" d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></symbol>
  <symbol id="i-file" viewBox="0 0 16 16"><path fill="currentColor" d="M2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 12.25 16h-8.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 8 4.25V1.5Zm5.75.56v2.19c0 .138.112.25.25.25h2.19Z"/></symbol>
  <symbol id="i-git" viewBox="0 0 16 16"><path fill="currentColor" d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.492 2.492 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM3.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/></symbol>
  <symbol id="i-clock" viewBox="0 0 16 16"><path fill="currentColor" d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm7-3.25v3.5l2.29 1.32a.75.75 0 0 1-.75 1.3l-2.67-1.54A.75.75 0 0 1 7 8.5v-3.75a.75.75 0 0 1 1.5 0Z"/></symbol>
  <symbol id="i-shield" viewBox="0 0 16 16"><path fill="currentColor" d="M7.467.133a1.748 1.748 0 0 1 1.066 0l5.25 1.68A1.75 1.75 0 0 1 15 3.48V7c0 1.566-.32 3.182-1.303 4.682-.983 1.498-2.585 2.813-5.032 3.855a1.7 1.7 0 0 1-1.33 0c-2.447-1.042-4.05-2.357-5.032-3.855C1.32 10.182 1 8.566 1 7V3.48a1.75 1.75 0 0 1 1.217-1.667Zm.61 1.429a.25.25 0 0 0-.153 0l-5.25 1.68a.25.25 0 0 0-.174.238V7c0 1.358.275 2.666 1.057 3.859.784 1.194 2.121 2.34 4.366 3.297a.2.2 0 0 0 .154 0c2.245-.956 3.582-2.104 4.366-3.298C13.225 9.666 13.5 8.36 13.5 7V3.48a.25.25 0 0 0-.174-.237Z"/></symbol>
  <symbol id="i-list" viewBox="0 0 16 16"><path fill="currentColor" d="M2 4a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm3.75-1.5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5ZM2 9a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm3.75-1.5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5ZM2 14a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm3.75-1.5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5Z"/></symbol>
  <symbol id="i-chevron" viewBox="0 0 16 16"><path fill="currentColor" d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"/></symbol>
  <symbol id="i-star" viewBox="0 0 24 24"><path fill="currentColor" d="M12 0c.5 6.6 4.9 11 11.5 11.5C16.9 12 12.5 16.4 12 23c-.5-6.6-4.9-11-11.5-11.5C7.1 11 11.5 6.6 12 0Z"/></symbol>
</svg>`

const CSS = `
/* ===========================================================================
   LODESTAR report — design system.
   One set of token names, two themes. Components never reference a raw colour,
   so light mode is a variable swap, not a second stylesheet drifting out of sync.
   =========================================================================== */
:root {
  color-scheme: dark;
  /* Near-black canvas with a faint cool cast. Structure comes from hairlines, not shadow;
     surfaces are barely-there steps in luminance. The precision-instrument register. */
  --bg: #08090a;
  --bg-2: #0c0d0f;
  --surface: #0f1011;
  --surface-2: #131416;
  --raised: #191a1d;
  --line: #23252a;       /* hairline ≈ rgba(255,255,255,.09) */
  --line-soft: #1a1c1f;  /* the quietest divider */
  --text: #f7f8f8;
  --muted: #9a9ea6;
  --dim: #6a6e76;
  --faint: #43464d;
  /* Semantics, calibrated — saturated enough to signal, never neon. Hue carries meaning. */
  --ok: #4cb782;        --ok-bg: rgba(76,183,130,.13);   --ok-line: rgba(76,183,130,.28);
  --warn: #e6a23c;      --warn-bg: rgba(230,162,60,.13);  --warn-line: rgba(230,162,60,.30);
  --bad: #eb5757;       --bad-bg: rgba(235,87,87,.13);    --bad-line: rgba(235,87,87,.32);
  /* One accent. A single indigo, used for selection, links, and exactly one tick. */
  --accent: #828fff;    --accent-bg: rgba(94,106,210,.16);
  --accent-2: #a3a0ff;
  /* Shadow is reserved for things that truly float — never decoration. Mostly unused. */
  --shadow-sm: 0 1px 2px rgba(0,0,0,.25);
  --shadow: 0 2px 4px rgba(0,0,0,.25), 0 8px 24px -12px rgba(0,0,0,.5);
  --shadow-lg: 0 8px 32px -10px rgba(0,0,0,.6);
  --ring: 0 0 0 1px var(--accent), 0 0 0 4px color-mix(in srgb, var(--accent) 22%, transparent);
  --mono: ui-monospace, "SF Mono", SFMono-Regular, "Cascadia Code", "JetBrains Mono", Menlo, Consolas, monospace;
  --sans: "Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  --r-sm: 6px; --r-md: 8px; --r-lg: 10px; --r-xl: 13px;
}
@media (prefers-color-scheme: light) {
  :root {
    color-scheme: light;
    /* Light mode, same discipline: a soft near-white canvas, pure-white surfaces stepped
       by hairlines, one accent. Clean, not clinical. */
    --bg: #fbfbfc;
    --bg-2: #f5f5f7;
    --surface: #ffffff;
    --surface-2: #fafafb;
    --raised: #f3f3f5;
    --line: #e6e6e9;
    --line-soft: #efeff1;
    --text: #16171a;
    --muted: #63666e;
    --dim: #8a8d95;
    --faint: #c3c5cb;
    /* Semantics weighted for contrast on white. */
    --ok: #2f9e6d;   --ok-bg: rgba(47,158,109,.11);  --ok-line: rgba(47,158,109,.28);
    --warn: #b7791f; --warn-bg: rgba(183,121,31,.13); --warn-line: rgba(183,121,31,.28);
    --bad: #d64545;  --bad-bg: rgba(214,69,69,.10);   --bad-line: rgba(214,69,69,.28);
    /* The one accent — Linear's indigo, at full strength on white. */
    --accent: #5e6ad2; --accent-bg: rgba(94,106,210,.09);
    --accent-2: #7c5cd0;
    --shadow-sm: 0 1px 2px rgba(20,22,30,.05);
    --shadow: 0 1px 2px rgba(20,22,30,.05), 0 8px 24px -14px rgba(20,22,30,.14);
    --shadow-lg: 0 8px 30px -12px rgba(20,22,30,.18);
    --ring: 0 0 0 1px var(--accent), 0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent);
  }
}

* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  font-size: 14px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  font-feature-settings: "kern" 1, "liga" 1, "calt" 1, "cv05" 1, "ss01" 1;
  position: relative;
}
/* Ambient light from the top — the "mission control" glow, static and subtle. */
body::before {
  content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 0;
  background:
    radial-gradient(900px 380px at 50% -160px, color-mix(in srgb, var(--accent) 12%, transparent), transparent 70%),
    radial-gradient(600px 300px at 100% -80px, color-mix(in srgb, var(--accent) 6%, transparent), transparent 70%);
}
.wrap, .topbar { position: relative; z-index: 1; }
a { color: var(--accent); text-decoration: none; transition: color .12s; }
a:hover { text-decoration: underline; }
:focus-visible { outline: none; box-shadow: var(--ring); border-radius: var(--r-sm); }
svg.ic { width: 14px; height: 14px; flex: none; vertical-align: -2px; }
.mono { font-family: var(--mono); font-size: .92em; }
.num { font-variant-numeric: tabular-nums; }
.wrap { max-width: 1080px; margin: 0 auto; padding: 0 24px 120px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }

/* --- top bar: app chrome, sticky ------------------------------------------ */
.topbar {
  position: sticky; top: 0; z-index: 20;
  background: color-mix(in srgb, var(--bg) 72%, transparent);
  backdrop-filter: saturate(150%) blur(16px);
  -webkit-backdrop-filter: saturate(150%) blur(16px);
  border-bottom: 1px solid var(--line-soft);
  margin-bottom: 30px;
}
.topbar .inner {
  max-width: 1080px; margin: 0 auto; padding: 13px 24px;
  display: flex; align-items: center; gap: 12px;
}
.logomark {
  width: 24px; height: 24px; flex: none; display: grid; place-items: center;
  border-radius: 7px; color: #fff;
  background: linear-gradient(145deg, var(--accent), color-mix(in srgb, var(--accent) 55%, #d946ef));
  box-shadow: 0 2px 8px -2px color-mix(in srgb, var(--accent) 60%, transparent), inset 0 1px 0 rgba(255,255,255,.3);
}
.logomark svg { width: 14px; height: 14px; }
.brand { font-weight: 700; letter-spacing: .16em; font-size: 12.5px; }
.topbar-session { color: var(--dim); font-size: 12px; padding-left: 12px; border-left: 1px solid var(--line);
  font-variant-numeric: tabular-nums; }
.tagline { color: var(--dim); font-size: 12px; letter-spacing: .01em; margin-left: auto; }
@media (max-width: 680px) { .topbar-session, .tagline { display: none; } }

/* --- generic ------------------------------------------------------------- */
h1 { font-size: 26px; line-height: 1.2; margin: 0; font-weight: 650; letter-spacing: -.02em; }
h2 { font-size: 11px; margin: 0 0 13px; font-weight: 700; letter-spacing: .11em;
     text-transform: uppercase; color: var(--dim); display: flex; align-items: center; gap: 7px; }
h2 svg { width: 13px; height: 13px; }
.meta { color: var(--muted); font-size: 13px; }
.section { margin-top: 30px; }
.section-title { display: flex; align-items: baseline; gap: 10px; margin: 0 2px 14px; }
.section-title h2 { margin: 0; }
.section-title .n { color: var(--dim); font-size: 12px; font-variant-numeric: tabular-nums; }

.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--surface-2); border: 1px solid var(--line-soft);
  border-radius: 999px; padding: 4px 11px; font-size: 12px; color: var(--muted);
}
.chip b { color: var(--text); font-weight: 600; }
.chip.warn { color: var(--warn); border-color: var(--warn-line); background: var(--warn-bg); }
.mission {
  margin: 16px 0 0; padding: 12px 16px; border-left: 2px solid var(--accent);
  background: var(--accent-bg); border-radius: 0 var(--r-sm) var(--r-sm) 0;
  color: var(--muted); font-size: 13.5px;
}

/* --- status chip ---------------------------------------------------------- */
.status {
  display: inline-flex; align-items: center; gap: 7px;
  border-radius: 999px; padding: 5px 12px;
  font-size: 10.5px; font-weight: 700; letter-spacing: .1em;
  border: 1px solid transparent; white-space: nowrap;
}
.status.VERIFIED { background: var(--ok-bg); color: var(--ok); border-color: var(--ok-line); }
.status.DEGRADED { background: var(--warn-bg); color: var(--warn); border-color: var(--warn-line); }
.status.BROKEN   { background: var(--bad-bg); color: var(--bad); border-color: var(--bad-line); }
.dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor;
       box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 22%, transparent); }

/* --- cards ---------------------------------------------------------------- */
.panel {
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--r-lg); padding: 20px 22px; margin-bottom: 14px;
  box-shadow: var(--shadow);
}

/* --- THE VERDICT: the hero, the 10-second answer -------------------------- */
.verdict-block {
  position: relative; overflow: hidden;
  display: flex; align-items: center; gap: 18px;
  border: 1px solid var(--line); border-radius: var(--r-xl);
  padding: 26px 28px; margin: 4px 0 8px; box-shadow: var(--shadow-lg);
  background: var(--surface);
}
.verdict-block::after {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(520px 200px at 0% 0%, var(--_glow), transparent 72%);
  opacity: .7;
}
.verdict-block.ok   { --_glow: var(--ok-bg);   border-color: var(--ok-line); }
.verdict-block.warn { --_glow: var(--warn-bg); border-color: var(--warn-line); }
.verdict-block.bad  { --_glow: var(--bad-bg);  border-color: var(--bad-line); }
.verdict-badge {
  position: relative; z-index: 1; flex: none;
  width: 46px; height: 46px; border-radius: 13px; display: grid; place-items: center;
  border: 1px solid transparent;
}
.verdict-block.ok   .verdict-badge { background: var(--ok-bg);   border-color: var(--ok-line);   color: var(--ok); }
.verdict-block.warn .verdict-badge { background: var(--warn-bg); border-color: var(--warn-line); color: var(--warn); }
.verdict-block.bad  .verdict-badge { background: var(--bad-bg);  border-color: var(--bad-line);  color: var(--bad); }
.verdict-badge svg { width: 24px; height: 24px; }
.verdict-main { position: relative; z-index: 1; min-width: 0; }
.verdict-finding { font-size: 24px; font-weight: 680; letter-spacing: -.025em; line-height: 1.15; }
.verdict-coverage { font-size: 13.5px; margin-top: 5px; font-weight: 500; display: inline-flex; align-items: center; gap: 7px; }
.verdict-coverage::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.verdict-coverage.ok { color: var(--ok); }
.verdict-coverage.warn { color: var(--warn); }
.verdict-block .status { position: relative; z-index: 1; margin-left: auto; align-self: flex-start; }
@media (max-width: 560px) { .verdict-block { padding: 20px; } .verdict-finding { font-size: 20px; } .verdict-block .status { display: none; } }

/* small verdict row — reused by the clean/broken fact states, git panel ----- */
.verdict { display: flex; align-items: center; gap: 12px; }
.verdict svg { width: 20px; height: 20px; }
.verdict .clean { color: var(--ok); font-weight: 600; font-size: 15px; }
.verdict .broken-facts { color: var(--bad); font-weight: 600; font-size: 15px; }
.panel.broken { border-color: var(--bad-line); background: linear-gradient(180deg, var(--bad-bg), transparent 60%); }

/* --- divergence card ------------------------------------------------------ */
.fact {
  position: relative; background: var(--surface);
  border: 1px solid var(--line); border-left: 3px solid var(--warn);
  border-radius: var(--r-md); padding: 18px 20px; margin-bottom: 12px;
  box-shadow: var(--shadow); transition: border-color .14s, box-shadow .14s, transform .14s;
}
.fact:hover { box-shadow: var(--shadow-lg); border-left-color: color-mix(in srgb, var(--warn) 80%, var(--text)); }
.fact-head { display: flex; align-items: flex-start; gap: 11px; }
.fact-head > svg { color: var(--warn); margin-top: 2px; width: 17px; height: 17px; }
.fact .stmt { font-weight: 620; font-size: 15.5px; letter-spacing: -.015em; }
.fact .id {
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
  color: var(--dim); font-size: 12.5px; margin-top: 4px;
}
.badge {
  font-family: var(--mono); font-size: 10px; font-weight: 700; letter-spacing: .05em;
  background: var(--warn-bg); color: var(--warn); padding: 2px 8px; border-radius: 6px;
  border: 1px solid var(--warn-line);
}

/* observed vs inference — must never share a visual style */
.group { margin: 15px 0 0; }
.group-label {
  font-size: 9.5px; letter-spacing: .12em; text-transform: uppercase; font-weight: 700;
  margin-bottom: 6px; display: flex; align-items: center; gap: 6px;
}
.group-label::before { content: ""; width: 14px; height: 1px; background: currentColor; opacity: .5; }
.group.observed .group-label { color: var(--dim); }
.group.consequence .group-label { color: var(--warn); }
.steps { list-style: none; margin: 0; padding: 0; }
.group.consequence {
  border-left: 2px solid var(--warn-line); background: linear-gradient(90deg, var(--warn-bg), transparent 60%);
  padding: 8px 12px 8px 14px; margin-left: 1px; border-radius: 0 var(--r-sm) var(--r-sm) 0;
}
.step { display: flex; align-items: center; gap: 10px; padding: 5px 0; font-size: 13.5px; }
.step > svg { flex: none; width: 15px; height: 15px; }
.step.observed > svg { color: var(--ok); }
.step.observed .step-text { font-family: var(--mono); font-size: 12.5px; }
.step.consequence > svg { color: var(--warn); }
.step.consequence .step-text { color: var(--warn); font-weight: 600; }
.step-text { flex: 1; min-width: 0; }
.step-time { color: var(--dim); font-size: 11px; font-variant-numeric: tabular-nums;
  font-family: var(--mono); flex: none; }

/* "why LODESTAR believes this" disclosure */
.fact-details { border: 0; background: none; box-shadow: none; margin: 12px 0 0; overflow: visible; }
.fact-details summary { padding: 7px 0 4px; font-size: 12px; font-weight: 500; color: var(--dim);
  list-style: none; display: inline-flex; align-items: center; gap: 7px; }
.fact-details summary:hover { background: none; color: var(--accent); }
.fact-details[open] summary { color: var(--muted); }
.fact-details[open] summary .chev { transform: rotate(90deg); }
.fact-details-body {
  margin-top: 8px; padding: 16px 18px; background: var(--bg-2);
  border: 1px solid var(--line-soft); border-radius: var(--r-md);
}
.why-grid { display: flex; gap: 40px; flex-wrap: wrap; margin-bottom: 16px; }
.why-block { margin-bottom: 14px; }
.why-block:last-child { margin-bottom: 0; }
.why-label { font-size: 9.5px; letter-spacing: .12em; text-transform: uppercase; font-weight: 700;
  color: var(--dim); margin-bottom: 6px; }
.why-val { margin: 0; font-size: 13px; font-weight: 500; text-transform: capitalize; }
.why-val.mono { text-transform: none; }
.why-list { margin: 0; padding-left: 18px; color: var(--muted); font-size: 12.5px; line-height: 1.6; }
.why-list li { padding: 3px 0; }
.why-list li::marker { color: var(--faint); }
.why-none { margin: 0; color: var(--dim); font-size: 12.5px; font-style: italic; }
.ev { margin: 0; padding-left: 14px; border-left: 2px solid var(--line); }
.ev div { font-family: var(--mono); font-size: 11.5px; color: var(--muted);
  padding: 3px 0; display: flex; gap: 9px; align-items: baseline; }
.ev .seq { color: var(--accent); flex: none; font-weight: 600; }

/* --- key/value metadata --------------------------------------------------- */
.kv-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1px; background: var(--line-soft);
  border: 1px solid var(--line-soft); border-radius: var(--r-md); overflow: hidden; }
@media (max-width: 560px) { .kv-grid { grid-template-columns: 1fr; } }
.kv { display: flex; justify-content: space-between; gap: 12px; padding: 11px 14px; background: var(--surface); }
.kv-k { color: var(--dim); font-size: 12px; }
.kv-v { font-size: 12px; color: var(--text); text-align: right; word-break: break-all; }

/* --- notes: limitations + interference ------------------------------------ */
.note { display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line-soft);
  color: var(--muted); font-size: 13px; line-height: 1.6; }
.note:last-child { border-bottom: 0; padding-bottom: 0; }
.note .q { color: var(--warn); flex: none; margin-top: 2px; }
.note .i { color: var(--accent); flex: none; margin-top: 2px; }

/* --- tabs: segmented control ---------------------------------------------- */
.tabs { display: flex; gap: 3px; flex-wrap: wrap;
  background: var(--surface-2); border: 1px solid var(--line-soft);
  border-radius: var(--r-md); padding: 4px; margin: 36px 0 18px; }
.tab { display: inline-flex; align-items: center; gap: 7px; background: none; border: 0;
  border-radius: var(--r-sm); color: var(--dim); font: inherit; font-size: 13px; font-weight: 500;
  padding: 8px 14px; cursor: pointer; transition: background .14s, color .14s, box-shadow .14s; }
.tab:hover { color: var(--text); background: color-mix(in srgb, var(--raised) 60%, transparent); }
.tab svg { opacity: .8; }
.tab[aria-selected="true"] { background: var(--raised); color: var(--text); font-weight: 600;
  box-shadow: var(--shadow-sm); }
.tab[aria-selected="true"] svg { opacity: 1; color: var(--accent); }
.tab .count { font-size: 10.5px; font-variant-numeric: tabular-nums; color: var(--dim);
  background: color-mix(in srgb, var(--muted) 16%, transparent); padding: 1px 7px; border-radius: 999px; }
.pane { animation: fade .18s ease; }
.pane[hidden] { display: none; }
@keyframes fade { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }

/* --- tables --------------------------------------------------------------- */
.card-table { background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--r-lg); overflow: hidden; box-shadow: var(--shadow); }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; color: var(--dim); font-weight: 700; font-size: 10px;
  letter-spacing: .08em; text-transform: uppercase;
  background: var(--surface-2); border-bottom: 1px solid var(--line);
  padding: 10px 15px; white-space: nowrap; }
td { padding: 10px 15px; border-bottom: 1px solid var(--line-soft); vertical-align: top; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr { transition: background .1s; }
tbody tr:hover { background: var(--raised); }
.tl-row.cited { background: var(--warn-bg); box-shadow: inset 2px 0 0 var(--warn); }
.tl-row.cited:hover { background: color-mix(in srgb, var(--warn) 15%, transparent); }
.tl-kind { font-family: var(--mono); font-size: 11px; color: var(--dim); white-space: nowrap; }
.tl-time { color: var(--dim); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.tl-seq { color: var(--faint); font-family: var(--mono); font-size: 11px; }

/* --- pills ---------------------------------------------------------------- */
.pill { display: inline-block; font-size: 9.5px; text-transform: uppercase; letter-spacing: .07em;
  font-weight: 700; padding: 2px 8px; border-radius: 999px;
  border: 1px solid var(--line); color: var(--dim); white-space: nowrap; }
.pill.narration { color: var(--warn); border-color: var(--warn-line); background: var(--warn-bg); }
.pill.cited { color: var(--warn); border-color: var(--warn-line); background: var(--warn-bg); }
.pill.danger { color: var(--bad); border-color: var(--bad-line); background: var(--bad-bg); }

/* --- changes / diffs ------------------------------------------------------ */
details.file { border: 1px solid var(--line); border-radius: var(--r-md); margin-bottom: 8px;
  background: var(--surface); overflow: hidden; box-shadow: var(--shadow-sm); transition: border-color .14s; }
details.file[open] { border-color: color-mix(in srgb, var(--accent) 34%, var(--line)); box-shadow: var(--shadow); }
details.file summary { cursor: pointer; padding: 13px 16px; display: flex; gap: 10px; align-items: center;
  flex-wrap: wrap; list-style: none; user-select: none; transition: background .1s; }
details.file summary::-webkit-details-marker { display: none; }
details.file summary::marker { content: ""; }
details.file summary:hover { background: var(--raised); }
summary .chev { color: var(--dim); transition: transform .16s; }
details[open] summary .chev { transform: rotate(90deg); }
summary .fname { font-family: var(--mono); font-size: 13px; font-weight: 600; }
summary .fpath { color: var(--dim); font-size: 11.5px; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; max-width: 40ch; }
.diff { font-family: var(--mono); font-size: 12px; line-height: 1.7; overflow-x: auto;
  border-top: 1px solid var(--line); background: var(--bg-2); }
.diff pre { margin: 0; padding: 14px 0; white-space: pre; }
.diff span { display: block; padding: 0 16px; position: relative; }
.diff .add { background: var(--ok-bg); color: color-mix(in srgb, var(--ok) 80%, var(--text)); box-shadow: inset 2px 0 0 var(--ok); }
.diff .del { background: var(--bad-bg); color: color-mix(in srgb, var(--bad) 80%, var(--text)); box-shadow: inset 2px 0 0 var(--bad); }
.unavail { padding: 14px 16px; border-top: 1px solid var(--line); color: var(--muted);
  font-size: 12.5px; background: var(--surface-2); display: flex; gap: 10px; }
.unavail svg { color: var(--dim); margin-top: 3px; }

/* --- coverage ------------------------------------------------------------- */
.cov { display: flex; flex-wrap: wrap; gap: 7px; }
.cov span { display: inline-flex; align-items: center; gap: 7px;
  font-family: var(--mono); font-size: 11.5px; padding: 5px 10px;
  border-radius: var(--r-sm); border: 1px solid var(--line); background: var(--surface-2); }
.cov span:before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor;
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 18%, transparent); }
.cov .observed { color: var(--ok); }
.cov .shadowed { color: var(--warn); }
.cov .unknown  { color: var(--bad); }
.cov .absent   { color: var(--dim); }
.legend { color: var(--dim); font-size: 12px; margin-top: 14px; line-height: 1.8; }
.legend b { color: var(--muted); font-family: var(--mono); font-size: 11px; }

.empty { color: var(--dim); font-size: 13px; padding: 36px; text-align: center;
  background: var(--surface); border: 1px dashed var(--line); border-radius: var(--r-lg); }
footer { margin-top: 60px; padding-top: 22px; border-top: 1px solid var(--line-soft);
  color: var(--dim); font-size: 12px; line-height: 1.8; }
.sessions td.n { font-family: var(--mono); color: var(--muted); }
.sessions tr.current { background: var(--accent-bg); box-shadow: inset 2px 0 0 var(--accent), 0 0 20px -10px var(--accent); }

/* ===========================================================================
   THE SYSTEM — 70% Linear · 20% Vercel · 10% terminal-lux.
   Appended last so it re-skins the tokens above without touching any component's
   structure or class name. Pure inline CSS — no web font, no network request, no
   external stylesheet — so the export still opens offline in five years (D-014).
   Semantics untouched: ok green, warn amber, bad red.

   Reading of the three influences:
     · Linear      — layout, density, hairline structure, one accent, the nav.
     · Vercel      — typography: tight, high-contrast, confident weight steps.
     · terminal-lux — reserved for the instrument surfaces (timeline, evidence,
                      coverage, diffs): monospace, aligned columns, quiet register.
   =========================================================================== */

/* ---- Canvas: near-flat. A single whisper of light at the very top, nothing more. */
body { font-size: 13.5px; letter-spacing: -.006em; line-height: 1.55; }
body::before {
  background: radial-gradient(1100px 360px at 50% -220px, color-mix(in srgb, var(--accent) 9%, transparent), transparent 70%);
}
.wrap { max-width: 940px; padding-left: 26px; padding-right: 26px; }
.section { margin-top: 34px; }

/* ---- Chrome (Linear): thin, quiet, a hairline underline and frosted glass. */
.topbar {
  background: color-mix(in srgb, var(--bg) 68%, transparent);
  border-bottom: 1px solid var(--line-soft);
  backdrop-filter: saturate(160%) blur(20px);
  -webkit-backdrop-filter: saturate(160%) blur(20px);
  margin-bottom: 26px;
}
.topbar .inner { padding: 12px 26px; }
.brand { font-weight: 560; letter-spacing: -.005em; font-size: 13px; }
.logomark { border-radius: 6px; background: linear-gradient(160deg, var(--accent), var(--accent-2)); box-shadow: none; }
.topbar-session, .tagline { font-size: 11.5px; }

/* ---- Typography (Vercel): tight, confident, few weights doing clear work. */
h1 { font-size: 22px; font-weight: 560; letter-spacing: -.021em; }
h2 { font-size: 10.5px; font-weight: 560; letter-spacing: .05em; color: var(--dim); }

/* ---- Surfaces (Linear): defined by a hairline, not a shadow. Flat by default. */
.panel, .card-table, details.file, .kv-grid {
  box-shadow: none; border-color: var(--line); background-image: none;
}
.panel { border-radius: var(--r-lg); padding: 20px 22px; }
details.file { border-radius: var(--r-md); }
details.file[open] { border-color: color-mix(in srgb, var(--accent) 28%, var(--line)); box-shadow: none; }

/* ---- The verdict hero: understated authority. Hairline frame, faint tonal wash,
        tight type. The one place a sliver of colour is allowed to bloom. */
.verdict-block {
  padding: 24px 26px; border-radius: var(--r-xl); border-color: var(--line);
  box-shadow: none; background: var(--surface);
}
.verdict-block::after { opacity: .4; }
.verdict-block.ok   { background: linear-gradient(180deg, color-mix(in srgb, var(--ok) 6%, var(--surface)), var(--surface) 60%); }
.verdict-block.warn { background: linear-gradient(180deg, color-mix(in srgb, var(--warn) 6%, var(--surface)), var(--surface) 60%); }
.verdict-block.bad  { background: linear-gradient(180deg, color-mix(in srgb, var(--bad) 7%, var(--surface)), var(--surface) 60%); }
.verdict-badge { border-radius: 9px; width: 42px; height: 42px; }
.verdict-finding { font-size: 21px; font-weight: 560; letter-spacing: -.021em; }
.verdict-coverage { font-size: 13px; }

/* ---- Status (Vercel type on a Linear token): small, precise, bordered, no glow. */
.status { padding: 4px 10px; font-size: 10px; font-weight: 560; letter-spacing: .045em; border-radius: 6px; }
.dot { box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 18%, transparent); }

/* ---- Navigation (Linear): inset segmented control, a single quiet active slab. */
.tabs { padding: 3px; border-radius: 9px; background: var(--surface-2); border-color: var(--line-soft); margin: 30px 0 16px; }
.tab { border-radius: 6px; padding: 7px 12px; font-size: 12.5px; font-weight: 510; }
.tab:hover { background: color-mix(in srgb, var(--raised) 55%, transparent); }
.tab[aria-selected="true"] { background: var(--raised); box-shadow: 0 1px 2px rgba(0,0,0,.14); color: var(--text); }
.tab[aria-selected="true"] svg { color: var(--accent); opacity: 1; }
.tab .count { background: color-mix(in srgb, var(--muted) 13%, transparent); }

/* ---- Divergence card: flat, hairline, a 2px warn rail. The card is evidence,
        so its statement stays sans; its steps go terminal (below). */
.fact { box-shadow: none; border-radius: var(--r-md); border-left-width: 2px; }
.fact:hover { box-shadow: none; border-color: var(--line); border-left-color: var(--warn); }
.fact .stmt { font-size: 15px; font-weight: 560; letter-spacing: -.01em; }
.badge { text-shadow: none; box-shadow: none; }
.mission { box-shadow: inset 2px 0 0 var(--accent); background: var(--accent-bg); border-radius: 0 var(--r-sm) var(--r-sm) 0; }

/* ---- INSTRUMENT SURFACES (terminal-lux): the timeline, evidence, coverage, diffs
        and metadata — the audit record. Monospace, aligned numerals, muted register. */
th { font-size: 10px; letter-spacing: .05em; background: transparent; border-bottom: 1px solid var(--line); color: var(--dim); }
td { border-bottom: 1px solid var(--line-soft); }
tbody tr:hover { background: color-mix(in srgb, var(--raised) 55%, transparent); }
.card-table { border-radius: var(--r-md); }
.tl-row.cited { box-shadow: inset 2px 0 0 var(--warn); background: var(--warn-bg); }
.num, .tl-time, .tl-seq, .kv-v, .cov span, .ev div { font-variant-numeric: tabular-nums; }
.cov span { border-radius: var(--r-sm); background: var(--surface-2); border-color: var(--line); }
.kv-v { font-size: 11.5px; }
.pill { border-radius: var(--r-sm); }

/* ---- Interactions (Linear): subtle, fast, deliberate. Motion you feel, not watch. */
a { color: var(--accent); transition: opacity .14s ease; }
a:hover { text-decoration: none; opacity: .78; }
.sessions tr.current { box-shadow: inset 2px 0 0 var(--accent); }
details.file summary, .tab, tbody tr, .fact { transition: background .14s ease, border-color .14s ease; }
`

const JS = `
// Tabs, and the URL fragment that names one. This is the entire client-side program:
// it shows and hides panes. It computes nothing — every word on this page was decided by
// the report model before the HTML was written. See D-054.
(function () {
  function select(paneId) {
    var found = false;
    document.querySelectorAll('.pane').forEach(function (p) {
      var match = p.id === paneId;
      p.hidden = !match;
      if (match) found = true;
    });
    document.querySelectorAll('.tab').forEach(function (t) {
      t.setAttribute('aria-selected', String(t.dataset.pane === paneId));
    });
    return found;
  }

  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      select(tab.dataset.pane);
      // The pane you are looking at belongs in the URL: a link to "the diff of that
      // session" is worth more than a link to "that session, now go click".
      history.replaceState(null, '', '#' + tab.dataset.pane.replace(/^p-/, ''));
    });
  });

  // A fragment on load wins over the default pane. An unknown fragment is ignored rather
  // than left showing nothing.
  //
  // It also scrolls. A deep link that selects the pane and leaves you at the top of the
  // page has answered a question you did not ask — you followed a link to the diff, so put
  // the diff on screen. Only on load: scrolling on every tab click would be motion the
  // reader did not ask for.
  var wanted = location.hash.replace(/^#/, '');
  if (wanted && select('p-' + wanted)) {
    var tabs = document.querySelector('.tabs');
    if (tabs) tabs.scrollIntoView({ block: 'start' });
  }
})();
`

function when(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

/** `1 event` / `2 events`. Cosmetic; never changes a count. */
function plural(n: number, noun: string): string {
  return `${esc(n)} ${esc(noun)}${n === 1 ? '' : 's'}`
}

function clock(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString()
}

/**
 * The verdict — the dominant, 10-second answer.
 *
 * Two axes, both from the model (D-058): the finding (what diverged) and the coverage (how
 * complete the evidence is). The renderer picks type size and colour; it never decides the
 * words or the tone. It also never adds a recommendation — there is no "safe to merge" to
 * render because the model refuses to compute one.
 */
function renderVerdict(r: SessionReport): string {
  const { finding, coverage } = r.verdict
  const icon =
    finding.tone === 'bad' ? 'i-x' : finding.tone === 'warn' ? 'i-alert' : 'i-check'
  return `<section class="verdict-block ${finding.tone}">
    <span class="verdict-badge"><svg><use href="#${icon}"/></svg></span>
    <div class="verdict-main">
      <div class="verdict-finding">${esc(finding.text)}</div>
      ${
        coverage
          ? `<div class="verdict-coverage ${coverage.tone}">${esc(coverage.text)}</div>`
          : `<div class="verdict-coverage warn">This record was altered after it was written.</div>`
      }
    </div>
    <span class="status ${esc(r.integrity.status)}">
      <span class="dot"></span>${esc(r.integrity.status)}
    </span>
  </section>`
}

/**
 * The facts block.
 *
 * Switches on `factsVerdict`, never on `facts.length` — D-053. An empty list means two
 * opposite things and only the model knows which; a renderer that reads the array length
 * shows a green tick on a forged record.
 */
function renderFacts(r: SessionReport): string {
  if (r.factsVerdict === 'record-untrustworthy') {
    return `<div class="panel broken">
      <div class="verdict">
        <svg class="ic" style="color:var(--bad)"><use href="#i-x"/></svg>
        <span class="broken-facts">No facts can be reported from this record.</span>
      </div>
      <p class="meta" style="margin:10px 0 0">The chain does not verify. Any fact computed
      from these bytes would be a claim about a record that was altered after it was written.</p>
    </div>`
  }

  if (r.factsVerdict === 'none-observed') {
    const caveat =
      r.limitations.length || r.integrity.degraded.length
        ? `<p class="meta" style="margin:10px 0 0">Read the limitations below before treating that as all-clear.</p>`
        : ''
    return `<div class="panel">
      <div class="verdict">
        <svg class="ic" style="color:var(--ok)"><use href="#i-check"/></svg>
        <span class="clean">No divergences observed.</span>
      </div>${caveat}
    </div>`
  }

  // ---------------------------------------------------------------------------
  // OBSERVED AND INFERENCE ARE VISUALLY UNMISTAKABLE — the incident-review rule
  // ---------------------------------------------------------------------------
  //
  // "Facts and interpretations must never appear in the same visual style." So the two
  // groups get explicit labels and distinct treatments: OBSERVED rows are neutral
  // evidence (a green tick or a red cross, monospace fact text); the INFERENCE row is
  // LODESTAR's reading, amber, labelled as ours. A screenshot alone must make clear which
  // line is a measurement and which is a conclusion — a colour difference is not enough
  // for a colour-blind reviewer, so the words OBSERVED and INFERENCE carry it.
  const group = (v: SessionReport['views'][number], state: FactStep['state']): string => {
    const steps = v.steps.filter((s) => s.state === state)
    if (!steps.length) return ''
    const label = state === 'observed' ? 'Observed' : 'LODESTAR’s reading'
    const rows = steps
      .map((s) => {
        const icon =
          state === 'consequence'
            ? 'i-alert'
            : /exited with code [1-9]|terminated by/.test(s.text)
              ? 'i-x'
              : 'i-check'
        return `<li class="step ${state}">
          <svg class="ic"><use href="#${icon}"/></svg>
          <span class="step-text">${esc(s.text)}</span>
          ${s.ts ? `<time class="step-time">${esc(clock(s.ts))}</time>` : ''}
        </li>`
      })
      .join('')
    return `<div class="group ${state}">
      <div class="group-label">${state === 'observed' ? 'Observed facts' : label}</div>
      <ul class="steps">${rows}</ul>
    </div>`
  }

  const why = (v: SessionReport['views'][number]): string => {
    const assumptions = v.assumptions.length
      ? `<div class="why-block">
          <div class="why-label">Assumptions</div>
          <ul class="why-list">${v.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
        </div>`
      : `<div class="why-block">
          <div class="why-label">Assumptions</div>
          <p class="why-none">None beyond the recorded events themselves.</p>
        </div>`

    const evidence = `<div class="why-block">
      <div class="why-label">Evidence</div>
      <div class="ev">${v.fact.evidence
        .map((ev) => {
          const resolved = r.evidence[ev.eventId]
          return resolved
            ? `<div><span class="seq">#${esc(resolved.seq)}</span><span>${esc(resolved.summary)}</span></div>`
            : `<div><span class="seq">#${esc(ev.eventSeq)}</span><span>${esc(ev.source)} (event not found in record)</span></div>`
        })
        .join('')}</div>
    </div>`

    return `<details class="fact-details">
      <summary><svg class="ic chev"><use href="#i-chevron"/></svg>Why LODESTAR believes this</summary>
      <div class="fact-details-body">
        <div class="why-grid">
          <div class="why-block">
            <div class="why-label">Confidence</div>
            <p class="why-val">${esc(v.fact.confidence)}</p>
          </div>
          <div class="why-block">
            <div class="why-label">Catalog id</div>
            <p class="why-val mono">${esc(v.fact.id)}</p>
          </div>
        </div>
        ${assumptions}
        ${evidence}
      </div>
    </details>`
  }

  const facts = r.views
    .map(
      (v) => `<div class="fact">
        <div class="fact-head">
          <svg class="ic"><use href="#i-alert"/></svg>
          <div style="min-width:0">
            <div class="stmt">${esc(v.title)}</div>
            <div class="id"><span>${esc(v.fact.statement)}</span></div>
          </div>
          <span class="badge" style="margin-left:auto">${esc(v.fact.id)}</span>
        </div>
        ${group(v, 'observed')}
        ${group(v, 'consequence')}
        ${why(v)}
      </div>`,
    )
    .join('')

  return `<h2>Divergences (${r.facts.length})</h2>${facts}`
}

/**
 * Limitations and interference.
 *
 * Rendered unconditionally when non-empty, including — especially — when there are no
 * facts. This block is what stops an empty report from implying success, so it is not
 * behind a tab: a limitation the user has to click to find is a limitation they will not
 * read.
 */
function renderNotes(r: SessionReport): string {
  const notes = [...r.limitations, ...r.integrity.degraded]
  let html = ''

  if (notes.length) {
    html += `<div class="panel">
      <h2>Limitations (${notes.length})</h2>
      <p class="meta" style="margin:-6px 0 8px">What LODESTAR could not determine. Not evidence of absence.</p>
      ${notes
        .map(
          (n) => `<div class="note">
            <svg class="ic q"><use href="#i-question"/></svg><span>${esc(n)}</span>
          </div>`,
        )
        .join('')}
    </div>`
  }

  if (r.interference.length) {
    html += `<div class="panel">
      <h2>LODESTAR interference</h2>
      <p class="meta" style="margin:-6px 0 8px">We changed this session. Failures caused by us are not the agent's.</p>
      ${r.interference
        .map(
          (n) => `<div class="note">
            <svg class="ic i"><use href="#i-info"/></svg><span>${esc(n)}</span>
          </div>`,
        )
        .join('')}
    </div>`
  }

  return html
}

function renderTimeline(r: SessionReport): string {
  if (!r.timeline.length) return `<p class="empty">No events recorded.</p>`
  return `<div class="card-table"><table><thead><tr>
      <th style="width:48px">Seq</th><th style="width:96px">Time</th>
      <th style="width:130px">Kind</th><th>What happened</th><th style="width:96px"></th>
    </tr></thead><tbody>
    ${r.timeline
      .map(
        (t) => `<tr class="tl-row ${t.cited ? 'cited' : ''}">
          <td class="tl-seq">${esc(t.seq)}</td>
          <td class="tl-time">${esc(clock(t.ts))}</td>
          <td class="tl-kind">${esc(t.kind)}</td>
          <td>${esc(t.summary)}</td>
          <td>${t.tier === 'narration' ? `<span class="pill narration">narration</span>` : ''}
              ${t.cited ? `<span class="pill cited">evidence</span>` : ''}</td>
        </tr>`,
      )
      .join('')}
  </tbody></table></div>
  <p class="meta" style="margin-top:14px">Rows marked <span class="pill narration">narration</span>
  are the agent's own account. They are recorded, never reasoned over — no Reality Fact is
  derived from them.</p>`
}

/**
 * Lines too many to diff. Beyond this the DP table below is not worth the memory, and a
 * 4,000-line diff is not something anyone reads in a browser anyway.
 */
const MAX_DIFF_LINES = 2000

/**
 * A line diff over the longest common subsequence.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT COMPARE LINE i TO LINE i — IT LOOKED FINE AND IT LIED
 * ---------------------------------------------------------------------------
 *
 * The first version zipped the two files by index. Measured on a real session that
 * inserted ONE line into a 3-line function, it rendered **every line after the insertion
 * as both deleted and added** — a two-line change shown as a rewrite of the file.
 *
 * That is cosmetic in the sense that no judgment is wrong. It is not cosmetic in the sense
 * that matters: a developer looking at a diff that claims they rewrote a function they
 * edited one line of learns that LODESTAR's account of reality is approximate. This
 * product is a claim about accuracy. The diff has to be accurate, or the claim reads as
 * marketing.
 *
 * Classic LCS DP — O(n·m) and bounded by `MAX_DIFF_LINES`. Presentation only: it compares
 * two strings the model handed us and decides nothing about them.
 */
function lineDiff(before: string | null, after: string | null): string {
  const a = before === null ? [] : before.split('\n')
  const b = after === null ? [] : after.split('\n')

  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    // Say why, rather than showing a wrong diff or an empty pane. The content exists; the
    // rendering is what we are declining to do.
    return `<div class="unavail">This file is ${esc(Math.max(a.length, b.length))} lines —
      too large to diff in the browser. The content is in the record; only this view
      declines to render it.</div>`
  }

  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }

  const rows: string[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push(`<span> ${esc(a[i])}</span>`)
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      rows.push(`<span class="del">-${esc(a[i])}</span>`)
      i++
    } else {
      rows.push(`<span class="add">+${esc(b[j])}</span>`)
      j++
    }
  }
  while (i < a.length) rows.push(`<span class="del">-${esc(a[i++])}</span>`)
  while (j < b.length) rows.push(`<span class="add">+${esc(b[j++])}</span>`)

  if (!rows.some((r) => r.includes('class="add"') || r.includes('class="del"'))) {
    // Identical content is a real answer — the file was touched and its bytes did not
    // change. That is not "no diff available", and the two must not share a sentence.
    return `<div class="unavail">The content is identical between the two snapshots.</div>`
  }
  // Joined with nothing, not with '\n'. Each row is a block-level span, so a newline
  // inside the <pre> renders a SECOND line break — every line of every diff came out
  // double-spaced. Cosmetic, and it read as broken.
  return `<div class="diff"><pre>${rows.join('')}</pre></div>`
}

function renderChanges(r: SessionReport, opts: HtmlOptions): string {
  if (!r.changes.length) return `<p class="empty">No file changes were observed.</p>`

  return r.changes
    .map((c) => {
      const view: DiffView = opts.diff
        ? opts.diff(c)
        : { kind: 'unavailable', reason: 'Content was not loaded for this report.' }

      const body =
        view.kind === 'text'
          ? lineDiff(view.before, view.after)
          : // The model's sentence, verbatim. This renderer does not know why a diff is
            // missing and must not guess — six different reasons look identical from here.
            `<div class="unavail">
              <svg class="ic"><use href="#i-info"/></svg><span>${esc(view.reason)}</span>
            </div>`

      // `c.display` is the model's readable form — relative inside the project, absolute
      // outside, where shortening could hide a blast-radius fact. The exact resolved path
      // stays on the `title`: shortened for reading, never for the record.
      return `<details class="file">
        <summary>
          <svg class="ic chev"><use href="#i-chevron"/></svg>
          <svg class="ic" style="color:var(--dim)"><use href="#i-file"/></svg>
          <span class="fname">${esc(c.name)}</span>
          <span class="fpath" title="${esc(c.path)}">${esc(c.display)}</span>
          ${c.deleted ? `<span class="pill danger">deleted</span>` : ''}
          ${!c.inScope ? `<span class="pill narration">outside project</span>` : ''}
          ${c.content !== 'available' ? `<span class="pill">${esc(c.content)}</span>` : ''}
          <span class="meta num" style="margin-left:auto">${plural(c.writes, 'write')}</span>
        </summary>
        ${body}
      </details>`
    })
    .join('')
}

function renderGit(r: SessionReport): string {
  const g = r.git
  if (!g.observed) {
    return `<p class="empty">No git activity was observed — this may not be a repository, or
      git could not be read. That is not the same as "nothing happened".</p>`
  }

  const head = `<div class="chips" style="margin:0 0 16px">
    ${g.branch ? `<span class="chip"><svg class="ic"><use href="#i-git"/></svg>branch <b class="mono">${esc(g.branch)}</b></span>` : ''}
    ${g.head ? `<span class="chip">HEAD <b class="mono">${esc(g.head.slice(0, 10))}</b></span>` : ''}
    <span class="chip">${plural(g.commits.length, 'commit')} this session</span>
  </div>`

  const commits = g.commits.length
    ? `<div class="card-table"><table><thead><tr>
        <th style="width:110px">Commit</th><th style="width:110px">Time</th><th>Branch</th>
      </tr></thead><tbody>
        ${g.commits
          .map(
            (c) => `<tr><td class="mono">${esc(c.sha.slice(0, 8))}</td>
              <td class="tl-time">${esc(clock(c.ts))}</td>
              <td class="mono meta">${esc(c.branch ?? '')}</td></tr>`,
          )
          .join('')}
      </tbody></table></div>`
    : `<p class="empty">No commits were created during this session.</p>`

  // Three states, and the first one is the reason this block exists. `undefined` is not an
  // empty list: "we could not read git" must never render as "your tree was clean" (D-047).
  const dirty =
    g.dirtyAtEnd === undefined
      ? `<div class="panel" style="margin-top:14px"><div class="note">
           <svg class="ic q"><use href="#i-question"/></svg>
           <span>The working tree state could not be read, so LODESTAR cannot say whether
           anything was left uncommitted. This is not a clean tree.</span>
         </div></div>`
      : g.dirtyAtEnd.length
        ? `<div class="panel" style="margin-top:14px">
             <h2>Uncommitted at session end (${g.dirtyAtEnd.length})</h2>
             <div class="cov">${g.dirtyAtEnd.map((f) => `<span class="shadowed">${esc(f)}</span>`).join('')}</div>
           </div>`
        : `<div class="panel" style="margin-top:14px"><div class="verdict">
             <svg class="ic" style="color:var(--ok)"><use href="#i-check"/></svg>
             <span class="meta">Working tree was measured clean at session end.</span>
           </div></div>`

  return head + commits + dirty
}

function renderVerification(r: SessionReport): string {
  const { status, chain, degraded } = r.integrity

  const explain =
    status === 'VERIFIED'
      ? `Evidence consistent. The chain recomputes across ${chain.eventsChecked} events, and
         no gaps were detected in what LODESTAR could observe.`
      : status === 'DEGRADED'
        ? `Some evidence is unavailable. The chain itself recomputes across
           ${chain.eventsChecked} events — the facts above are still true — but the record is
           not complete, and the gaps are listed below.`
        : `Integrity failure detected. ${esc(chain.reason ?? 'The chain does not recompute.')}
           ${chain.brokenAt !== undefined ? `First break at event #${esc(chain.brokenAt)}.` : ''}
           This record was altered after it was written.`

  const gaps = degraded.length
    ? `<div style="margin-top:14px">${degraded
        .map(
          (d) => `<div class="note">
            <svg class="ic q"><use href="#i-question"/></svg><span>${esc(d)}</span>
          </div>`,
        )
        .join('')}</div>`
    : ''

  const cov = r.coverage.length
    ? `<div class="panel" style="margin-top:14px">
       <h2>Command coverage, as measured</h2>
       <p class="meta" style="margin:-6px 0 12px">Measured against the agent's own shell at session start — never assumed.</p>
       <div class="cov">
         ${r.coverage
           .map((c) => `<span class="${esc(c.status)}" title="${esc(c.resolvedTo ?? c.reason ?? '')}">${esc(c.command)} · ${esc(c.status)}</span>`)
           .join('')}
       </div>
       <p class="legend">
         <b>observed</b> — our shim wins PATH resolution; exit codes are ground truth.<br>
         <b>shadowed</b> — the command exists but something else wins; not observed.<br>
         <b>absent</b> — measured: not installed.<br>
         <b>unknown</b> — we could not measure; this says nothing about the command, only about LODESTAR.
       </p></div>`
    : `<p class="empty" style="margin-top:16px">Command coverage was never probed for this session.</p>`

  // Session metadata (report structure item 6) lives here, in the Verification pane —
  // identity is a trust concern (which machine, which model, which commit made this
  // record), read from the chained session.start event, not the mutable table (D-035).
  const meta = [
    ['Runtime', esc(r.session.runtimeId)],
    ['Model', r.identity.model ? esc(r.identity.model) : '—'],
    ['Runtime version', r.identity.runtimeVersion ? esc(r.identity.runtimeVersion) : '—'],
    ['Machine', r.identity.machineId ? esc(r.identity.machineId) : '—'],
    ['Git HEAD at start', r.identity.gitCommit ? esc(r.identity.gitCommit).slice(0, 12) : '—'],
    ['Started', esc(when(r.session.startedAt))],
    ['Session ended', r.closed ? 'yes' : 'no — wrapper died or still running'],
    ['Events · commands · files', `${esc(r.counts.events)} · ${esc(r.counts.commands)} · ${esc(r.counts.filesChanged)}`],
  ]
    .map(([k, v]) => `<div class="kv"><span class="kv-k">${k}</span><span class="kv-v mono">${v}</span></div>`)
    .join('')

  return `<div class="panel">
    <span class="status ${esc(status)}"><span class="dot"></span>${esc(status)}</span>
    <p style="margin:14px 0 0">${explain}</p>
    ${gaps}
  </div>${cov}
  <div class="panel" style="margin-top:14px">
    <h2>Session metadata</h2>
    <div class="kv-grid">${meta}</div>
  </div>
  <div class="panel" style="margin-top:14px">
    <h2><svg class="ic"><use href="#i-shield"/></svg> What this does and does not prove</h2>
    <p class="meta">LODESTAR runs as the same OS user as the agent, so it produces a
    <b style="color:var(--text)">tamper-evident</b> record — not a tamper-proof one. Alteration leaves a mark; it is not
    prevented. Against an agent that confabulates, this evidence is sound. Against a
    determined attacker with your user account, it is not, and V0 does not claim to be.</p>
  </div>`
}

function renderSessions(r: SessionReport, opts: HtmlOptions): string {
  if (!opts.index.length) return `<p class="empty">No other sessions recorded.</p>`

  return `<div class="card-table"><table class="sessions"><thead><tr>
      <th style="width:56px">#</th><th style="width:170px">When</th><th>Runtime</th>
      <th style="width:70px">Facts</th><th style="width:66px">Files</th>
      <th style="width:88px">Commands</th><th style="width:118px">Record</th>
    </tr></thead><tbody>
    ${opts.index
      .map((row) => {
        const current = row.session.id === r.session.id
        const num = String(row.session.number).padStart(3, '0')
        const label =
          opts.mode === 'server' && !current
            ? `<a href="/session/${esc(row.session.number)}">${esc(num)}</a>`
            : esc(num)
        return `<tr class="${current ? 'current' : ''}">
          <td class="n">${label}</td>
          <td class="tl-time">${esc(when(row.session.startedAt))}</td>
          <td class="mono">${esc(row.session.runtimeId)}</td>
          <td class="num">${row.factsVerdict === 'record-untrustworthy' ? '—' : esc(row.factCount)}</td>
          <td class="meta num">${esc(row.filesChanged)}</td>
          <td class="meta num">${esc(row.commands)}</td>
          <td><span class="status ${esc(row.status)}" style="font-size:9.5px;padding:3px 8px">${esc(row.status)}</span></td>
        </tr>`
      })
      .join('')}
  </tbody></table></div>
  ${
    opts.mode === 'export'
      ? `<p class="meta" style="margin-top:14px">This is an exported file, so other sessions
         are listed but not linked — there is no server behind it.</p>`
      : ''
  }`
}

/** The whole page. One function, one model, no state. */
export function renderHtml(r: SessionReport, opts: HtmlOptions): string {
  const num = String(r.session.number).padStart(3, '0')
  const title = `LODESTAR · session #${num}`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${esc(title)}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='6' fill='%235e6ad2'/%3E%3Cpath fill='white' d='M12 4c.35 4.2 3.4 7.25 7.6 7.6-4.2.35-7.25 3.4-7.6 7.6-.35-4.2-3.4-7.25-7.6-7.6C8.6 11.25 11.65 8.2 12 4Z'/%3E%3C/svg%3E">
<style>${CSS}</style>
</head>
<body>
${ICONS}
<div class="topbar"><div class="inner">
  <span class="logomark"><svg><use href="#i-star"/></svg></span>
  <span class="brand">LODESTAR</span>
  <span class="topbar-session mono">session #${esc(num)}</span>
  <span class="tagline">${esc(r.session.runtimeId)}${r.identity.model ? ` · ${esc(r.identity.model)}` : ''} · ${esc(when(r.session.startedAt))}</span>
</div></div>

<div class="wrap">
  <!-- 1. VERDICT — the 10-second answer, visually dominant. -->
  ${renderVerdict(r)}
  ${r.session.mission ? `<p class="mission">${esc(r.session.mission)}</p>` : ''}

  <!-- 3 + 4. DIVERGENCES, each with its observed facts, LODESTAR's reading, and an
       expandable "why" carrying confidence + assumptions + evidence. -->
  <div class="section">${renderFacts(r)}</div>

  <!-- 7. LIMITATIONS & ASSUMPTIONS — always visible, never hidden behind a tab. -->
  ${renderNotes(r)}

  <!-- 2, 5, 6. The reference material an investigator drills into AFTER the answer:
       files (blast radius) first, then the sequence, git, trust, and identity. -->
  <div class="tabs" role="tablist">
    <button class="tab" role="tab" aria-selected="true" data-pane="p-changes">
      <svg class="ic"><use href="#i-file"/></svg>Files affected <span class="count num">${esc(r.changes.length)}</span></button>
    <button class="tab" role="tab" aria-selected="false" data-pane="p-timeline">
      <svg class="ic"><use href="#i-list"/></svg>Timeline <span class="count num">${esc(r.timeline.length)}</span></button>
    <button class="tab" role="tab" aria-selected="false" data-pane="p-git">
      <svg class="ic"><use href="#i-git"/></svg>Git</button>
    <button class="tab" role="tab" aria-selected="false" data-pane="p-verify">
      <svg class="ic"><use href="#i-shield"/></svg>Verification</button>
    <button class="tab" role="tab" aria-selected="false" data-pane="p-sessions">
      <svg class="ic"><use href="#i-clock"/></svg>Sessions <span class="count num">${esc(opts.index.length)}</span></button>
  </div>

  <div class="pane" id="p-changes">${renderChanges(r, opts)}</div>
  <div class="pane" id="p-timeline" hidden>${renderTimeline(r)}</div>
  <div class="pane" id="p-git" hidden>${renderGit(r)}</div>
  <div class="pane" id="p-verify" hidden>${renderVerification(r)}</div>
  <div class="pane" id="p-sessions" hidden>${renderSessions(r, opts)}</div>

  <footer>
    Generated ${esc(when(opts.generatedAt))} by LODESTAR — a tamper-evident execution history.<br>
    Every statement on this page is derived from recorded events; nothing is inferred from
    the agent's narration.
  </footer>
</div>
<script>${JS}</script>
</body>
</html>`
}
