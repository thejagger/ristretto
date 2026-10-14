// The board's images: status marks, chevrons, the cup, bars, the SVG clock, and the phase lock
// that keeps an animation where the wall clock has it across a redraw.
//
// SVG cannot read the theme, so every hue here is a mid-tone that holds 3:1 on Claude's dark and
// light grounds; text on the board uses the theme's own keys, never these.
//
// Pure and deterministic: no clock, no randomness, no counters. The same input always yields the
// same bytes. Every function returns a complete <svg> with explicit width, height and viewBox.

// One meaning per hue (the design system's mark-* tokens).
export const HUE = {
  claude: '#CC6A47',      // live: what Claude is doing now
  success: '#2E9A5E',     // done
  warning: '#B98328',     // needs a look
  error: '#E5484D',       // stopped
  permission: '#4E84EA',  // a person must act
  inactive: '#858585',    // not started, context
  white: '#FFFFFF',       // the cut-out inside a filled mark
};

// Time splits are off the status hues on purpose: a phase is not a verdict.
export const PHASE = { plan: '#858585', code: '#CC6A47', review: '#8A6AD4', close: '#6F7F92' };

// Claude's side pane: a hairline card border, the legend's squares and the bar's track, and the
// ink an SVG clock takes per theme (the theme's text, dim and claude colours).
export const HAIR = { dark: '#2D2D2D', light: '#E3E1DA' };
export const LEGEND = { done: '#199E70', review: '#C98500', human: '#3987E5', track: { dark: '#292827', light: '#E8E6DF' } };
export const INK = {
  dark: { text: '#F0EEE6', dim: '#A3A29C', claude: '#E0896A' },
  light: { text: '#1F1E1D', dim: '#6B6A66', claude: '#B4532F' },
};

const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const REDUCED = '@media (prefers-reduced-motion: reduce){*{animation:none!important}}';
const num = (v) => String(Math.round(v * 100) / 100);
export const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A short stable id from the inputs, so two SVGs never share a clip-path id.
function idOf(...parts) {
  let x = 2166136261;
  for (const ch of parts.join('|')) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
  return `k${(x >>> 0).toString(36)}`;
}

const svg = (w, h, vb, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb}">${body}</svg>`;

// ---------------------------------------------------------------------------------------------
// Status marks (assets/Icons), 14×14 by default. Shape and hue always pair.

const BOOK = (c) =>
  `<path d="M7 3.2C5.6 2.2 3.6 1.9 1.6 2.2v8.6c2-.3 4 0 5.4 1 1.4-1 3.4-1.3 5.4-1V2.2c-2-.3-4 0-5.4 1z" fill="none" stroke="${c}" stroke-width="1.2" stroke-linejoin="round"/><path d="M7 3.2v8.6" stroke="${c}" stroke-width="1.2"/>`;
const TICK = (c) =>
  `<circle cx="7" cy="7" r="6" fill="${c}"/><path d="M4.3 7.2l1.9 1.9 3.6-3.9" fill="none" stroke="${HUE.white}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
const CROSS = (c) =>
  `<circle cx="7" cy="7" r="6" fill="${c}"/><path d="M4.8 4.8l4.4 4.4M9.2 4.8l-4.4 4.4" stroke="${HUE.white}" stroke-width="1.6" stroke-linecap="round"/>`;
const RING = (c) => `<circle cx="7" cy="7" r="5" fill="none" stroke="${c}" stroke-width="1.5"/>`;
// The one motion a mark may have: a slow breath of the live halo.
const BREATH = `<style>@keyframes b{0%,100%{opacity:.14}50%{opacity:.36}}.h{animation:b 2.4s ease-in-out infinite}${REDUCED}</style>`;

const SHAPES = {
  planned: () => RING(HUE.inactive),
  next: () => RING(HUE.inactive),
  queued: () => RING(HUE.inactive),
  running: () => `${BREATH}<circle class="h" cx="7" cy="7" r="6.6" fill="${HUE.claude}" opacity=".25"/><circle cx="7" cy="7" r="4" fill="${HUE.claude}"/>`,
  lane: () => `${BREATH}<circle class="h" cx="7" cy="7" r="4.6" fill="${HUE.claude}" opacity=".25"/><circle cx="7" cy="7" r="5.6" fill="none" stroke="${HUE.claude}" stroke-width="1.5"/><circle cx="7" cy="7" r="2.6" fill="${HUE.claude}"/>`,
  'merge-queued': () => `<circle cx="7" cy="7" r="5.6" fill="none" stroke="${HUE.claude}" stroke-width="1.5"/><path d="M7 10V4.4M4.6 6.6L7 4.2l2.4 2.4" fill="none" stroke="${HUE.claude}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  blocked: () => `<path d="M4.6 1h4.8L13 4.6v4.8L9.4 13H4.6L1 9.4V4.6z" fill="${HUE.error}"/><rect x="3.8" y="6.2" width="6.4" height="1.6" rx=".4" fill="${HUE.white}"/>`,
  'needs-review': () => `<path d="M7 1.3l6 11.2H1z" fill="${HUE.warning}" stroke="${HUE.warning}" stroke-width="1" stroke-linejoin="round"/><rect x="6.35" y="4.8" width="1.3" height="4" rx=".5" fill="${HUE.white}"/><circle cx="7" cy="10.4" r=".8" fill="${HUE.white}"/>`,
  'needs-human': () => `<circle cx="7" cy="4.4" r="2.6" fill="${HUE.permission}"/><path d="M1.8 13c0-3 2.3-4.8 5.2-4.8s5.2 1.8 5.2 4.8z" fill="${HUE.permission}"/>`,
  done: () => TICK(HUE.success),
  ready: () => TICK(HUE.success),
  'suite-ok': () => TICK(HUE.success),
  'gate-red': () => CROSS(HUE.error),
  'suite-red': () => CROSS(HUE.error),
  facts: () => BOOK(HUE.inactive),
  'fact-conflict': () => `${BOOK(HUE.warning)}<circle cx="11" cy="3" r="2.6" fill="${HUE.warning}"/><rect x="10.45" y="1.4" width="1.1" height="2" rx=".4" fill="${HUE.white}"/><circle cx="11" cy="4.3" r=".55" fill="${HUE.white}"/>`,
  // A review note, not a blocking finding: a quiet grey bullet.
  note: () => `<circle cx="7" cy="7" r="2.4" fill="${HUE.inactive}"/>`,
  // The branch: a git branch in grey, context only.
  branch: () => `<g fill="none" stroke="${HUE.inactive}" stroke-width="1.3" stroke-linecap="round"><circle cx="4.2" cy="3.2" r="1.6"/><circle cx="4.2" cy="10.8" r="1.6"/><circle cx="10" cy="4.6" r="1.6"/><path d="M4.2 4.8v4.4M10 6.2c0 2.4-5.8 1.4-5.8 3"/></g>`,
  // A feature's plan: a page with lines.
  plan: () => `<g fill="none" stroke="${HUE.inactive}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2.6a1.2 1.2 0 0 1 1.2-1.2h4.2L11 4v7.4a1.2 1.2 0 0 1-1.2 1.2H4.2A1.2 1.2 0 0 1 3 11.4z"/><path d="M5.2 6.4h3.6M5.2 8.6h3.6M5.2 10.6h2"/></g>`,
};
export const MARKS = Object.keys(SHAPES);

export function mark(kind, { size = 14 } = {}) {
  const body = (SHAPES[kind] ?? SHAPES.planned)();
  return svg(size, size, '0 0 14 14', body);
}

// The cup: the board's only brand mark. Clay while a run is live, grey everywhere else.
export function cup({ size = 16, live = false } = {}) {
  const c = live ? HUE.claude : HUE.inactive;
  return svg(size, size, '0 0 20 20',
    `<path d="M6.5 1.8c-.9 1 .9 1.8 0 2.9M9.5 1.8c-.9 1 .9 1.8 0 2.9M12.5 1.8c-.9 1 .9 1.8 0 2.9" fill="none" stroke="${HUE.inactive}" stroke-width="1.2" stroke-linecap="round"/>` +
    `<path d="M3 7h12v5.5a4.5 4.5 0 0 1-4.5 4.5h-3A4.5 4.5 0 0 1 3 12.5z" fill="${c}"/>` +
    `<path d="M15 8.5h1.3a2.2 2.2 0 0 1 0 4.4H15" fill="none" stroke="${c}" stroke-width="1.6"/>` +
    `<rect x="2" y="17.6" width="14" height="1.4" rx=".7" fill="${c}" fill-opacity=".55"/>`);
}

// The row chevron: a smooth vector ›, 20×20, 2px stroke, round caps. `down` is an opened fact.
export function chevron({ color = HUE.inactive, down = false } = {}) {
  const d = down ? 'M4 7.5l6 6 6-6' : 'M7.5 4l6 6-6 6';
  return svg(20, 20, '0 0 20 20', `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`);
}

// Back: ← in the same style.
export function back({ color = HUE.inactive } = {}) {
  return svg(20, 20, '0 0 20 20', `<path d="M15 10H5.5M9.5 5.5L5 10l4.5 4.5" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`);
}

// Claude's side-pane language: the small chevron after a card's title (down while open, right
// while folded), and the legend's coloured square.
export function chev12(dir = 'down') {
  const d = dir === 'down' ? 'M3 4.5l3 3 3-3' : 'M4.5 3l3 3-3 3';
  return svg(12, 12, '0 0 12 12', `<path d="${d}" fill="none" stroke="#9A9893" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`);
}

export function square(hex) {
  return svg(14, 14, '0 0 14 14', `<rect x="1.5" y="1.5" width="11" height="11" rx="2.5" fill="${hex}"/>`);
}

// ---------------------------------------------------------------------------------------------
// Bars.

// The phase names under the effort bar, centred on the bar's own segments: the same arithmetic
// as board-effort.mjs tracker() (x0 2, x1 W-2, a 2px notch, each phase as wide as its weight, 1
// when it has none), so they line up at any width. Done is green, the current one clay and bold
// (red on a red gate), todo grey.
export function effortLabels({ width, phases = [], red = false, step = '' } = {}) {
  const W = Math.max(60, Math.round(Number(width) || 420));
  const H = 14;
  const n = Math.max(1, phases.length);
  const x0 = 2, x1 = W - 2;
  const weight = (p) => {
    const w = Number(p?.weight);
    return Number.isFinite(w) && w > 0 ? w : 1;
  };
  const total = phases.reduce((s, p) => s + weight(p), 0) || 1;
  let gap = 2;
  if (x1 - x0 - gap * (n - 1) < n * 6) gap = 0;
  const avail = x1 - x0 - gap * (n - 1);
  let out = '';
  let acc = 0;
  phases.forEach((p, i) => {
    const s = Math.round(x0 + (acc / total) * avail + i * gap);
    acc += weight(p);
    const e = Math.round(x0 + (acc / total) * avail + i * gap);
    const cur = p.state === 'current';
    const label = cur && step ? step : p.name;
    const fill = p.state === 'done' ? HUE.success : cur ? (red ? HUE.error : HUE.claude) : HUE.inactive;
    out += `<text x="${num((s + e) / 2)}" y="11" text-anchor="middle" fill="${fill}"${cur ? ' font-weight="600"' : ''}>${escapeXml(label)}</text>`;
  });
  return svg(W, H, `0 0 ${W} ${H}`, `<g font-family="${FONT}" font-size="11">${out}</g>`);
}

// One feature's own time split: a thin rounded bar, a segment per phase with a 2px gap, every
// phase at least 1.5px so a short close still shows. Never scaled against another feature.
export function splitBar(phases = [], { width = 64, height = 6 } = {}) {
  const W = Math.max(8, Math.round(width));
  const list = (phases ?? []).filter((p) => p && p.ms > 0);
  const total = list.reduce((s, p) => s + p.ms, 0);
  if (!total) {
    return svg(W, height, `0 0 ${W} ${height}`, `<rect width="${W}" height="${height}" rx="${height / 2}" fill="${HUE.inactive}" fill-opacity=".25"/>`);
  }
  const id = idOf('split', W, height, ...list.map((p) => `${p.phase}:${p.ms}`));
  const gap = list.length > 1 ? 2 : 0;
  const span = W - gap * (list.length - 1);
  let x = 0;
  const rects = list.map((p) => {
    const w = Math.max(1.5, (span * p.ms) / total);
    const r = `<rect x="${num(x)}" width="${num(w)}" height="${height}" fill="${PHASE[p.phase] ?? HUE.inactive}"/>`;
    x += w + gap;
    return r;
  }).join('');
  return svg(W, height, `0 0 ${W} ${height}`,
    `<clipPath id="${id}"><rect width="${W}" height="${height}" rx="${height / 2}"/></clipPath><g clip-path="url(#${id})">${rects}</g>`);
}

// What a split says, for its alt text: `plan 4m · code 14m · review 9m · close 3m`.
export function splitAlt(phases = []) {
  return (phases ?? []).filter((p) => p && p.ms > 0).map((p) => `${p.phase} ${Math.max(1, Math.round(p.ms / 60000))}m`).join(' · ');
}

// The Branch card's bar: this branch's features by state, one rounded segment per non-empty part,
// 4px high on the theme's track, as wide as it is given.
export function stacked(parts = [], width = 300, theme = 'dark') {
  const W = Math.max(8, Math.round(width));
  const total = parts.reduce((a, p) => a + p.n, 0) || 1;
  const live = parts.filter((p) => p.n > 0);
  let x = 0;
  let body = '';
  live.forEach((p, i) => {
    const last = i === live.length - 1;
    const w = last ? W - x : Math.max(3, Math.round((p.n / total) * W));
    body += `<rect x="${x}" y="0" width="${Math.max(1, w - (last ? 0 : 2))}" height="4" rx="2" fill="${p.hex}"/>`;
    x += w;
  });
  return svg(W, 4, `0 0 ${W} 4`, `<rect width="${W}" height="4" rx="2" fill="${LEGEND.track[theme === 'light' ? 'light' : 'dark']}"/>${body}`);
}

// ---------------------------------------------------------------------------------------------
// Layout: an empty 1px-wide strip, for vertical rhythm finer than a text row. The desktop scales
// an Svg given only a height to the row's width, so a wide strip came out a few px tall: this one
// is drawn at its own size. Past about 10px it stops growing inside a card: stack two.

export function space(tall) {
  const h = Math.max(1, Math.round(tall));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="${h}" viewBox="0 0 1 ${h}"></svg>`;
}

// Width and height of an SVG here, for the host Svg's props.
export function dims(src) {
  const m = /^<svg[^>]*?\swidth="([\d.]+)"[^>]*?\sheight="([\d.]+)"/.exec(src);
  return m ? { width: Math.round(Number(m[1])), height: Math.round(Number(m[2])) } : {};
}

// ---------------------------------------------------------------------------------------------
// A running time drawn as an SVG that counts up by itself.
//
// Every digit is a wheel: a column of glyphs, clipped to one line, that a stepped CSS animation
// rolls one glyph further each period (seconds every 1 s, tens of seconds every 10 s, minutes
// every 60 s, ...). A negative animation-delay starts each wheel at the time the board drew, so
// the image shows the right time at once and then keeps counting with no redraw. (A ticking text
// clock made the desktop repaint the whole pane each second: every image and hover started over.)

const CLOCK_H = 18; // the image's height: one line of the pane
const CLOCK_BASE = 13; // text baseline
const CLOCK_SIZE = 13; // font size
const CLOCK_FONT = "-apple-system, 'Segoe UI', system-ui, sans-serif";
// Advance per glyph kind, so the time never jitters as its digits change.
const ADV = { d: 7.4, h: 8, m: 11.4, s: 6.6 };
const num3 = (v) => String(Math.round(v * 1000) / 1000);

// The wheels a time needs. 'clock' is 9m49s or 1h02m03s; 'dur' is 35m or 2h40m. A leading wheel
// shows a blank for 0, so 9m rolls to 10m without a jump in width.
function wheelsOf(ms, format) {
  const t = Math.max(0, ms) / 1000;
  const hours = t >= 3600;
  const digits = '0123456789'.split('');
  const lead = [' ', ...'123456789'.split('')];
  const six = '012345'.split('');
  const out = [];
  if (hours) {
    out.push({ g: lead, p: 360000 }, { g: digits, p: 36000 }, { u: 'h' });
    out.push({ g: six, p: 3600 }, { g: digits, p: 600 }, { u: 'm' });
  } else {
    out.push({ g: lead, p: 6000 }, { g: digits, p: 600 }, { u: 'm' });
  }
  if (format === 'clock') out.push({ g: six, p: 60 }, { g: digits, p: 10 }, { u: 's' });
  // An hours wheel that would only ever show a blank is left out.
  if (hours && t < 36000) out.shift();
  return { t, wheels: out };
}

export function svgClock({ ms = 0, format = 'clock', color = INK.dark.text, bold = false } = {}) {
  const { t, wheels } = wheelsOf(ms, format);
  let x = 0;
  let body = '';
  let css = '';
  const weight = bold ? 600 : 400;
  const text = (s, cx, y) => `<text x="${num3(cx)}" y="${num3(y)}" text-anchor="middle">${s === ' ' ? '' : s}</text>`;
  const steps = new Set();
  wheels.forEach((w, i) => {
    if (w.u) {
      const a = ADV[w.u];
      body += text(w.u, x + a / 2, CLOCK_BASE);
      x += a;
      return;
    }
    const a = ADV.d;
    const n = w.g.length;
    steps.add(n);
    let col = '';
    w.g.forEach((g, k) => { col += text(g, x + a / 2, CLOCK_BASE + k * CLOCK_H); });
    // The wheel's place in its loop now: how far into its period the time is.
    const delay = -(t % w.p);
    css += `.c${i}{animation:k${n} ${w.p}s steps(${n}) infinite;animation-delay:${num3(delay)}s}`;
    body += `<g class="c${i}">${col}</g>`;
    x += a;
  });
  for (const n of steps) css += `@keyframes k${n}{from{transform:translateY(0)}to{transform:translateY(-${n * CLOCK_H}px)}}`;
  const W = Math.ceil(x);
  return {
    width: W,
    height: CLOCK_H,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${CLOCK_H}" viewBox="0 0 ${W} ${CLOCK_H}">` +
      `<style>${css}</style><defs><clipPath id="v"><rect width="${W}" height="${CLOCK_H}"/></clipPath></defs>` +
      `<g clip-path="url(#v)" fill="${color}" font-family="${CLOCK_FONT}" font-size="${CLOCK_SIZE}" font-weight="${weight}">${body}</g></svg>`,
  };
}

// What the clock says right now, for its alt text.
export function clockWords(ms, format = 'clock') {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = hh ? String(m).padStart(2, '0') : String(m);
  return `${hh ? `${hh}h` : ''}${mm}m${format === 'clock' ? `${String(r).padStart(2, '0')}s` : ''}`;
}

// ---------------------------------------------------------------------------------------------
// The desktop rebuilds every image on a redraw, which starts its CSS animation over. The board
// redraws only when something changes, never on a timer, and each drawing starts every animation
// where the wall clock has it in its loop (a negative animation-delay), so even a redraw does not
// show. The time is the drawing's stamp, passed in; LEAD_MS covers drawing to showing.

const LEAD_MS = 50;
export function phaseLock(src, nowMs) {
  if (!src.includes('@keyframes') && !/animation:/.test(src)) return src;
  const t = (nowMs + LEAD_MS) / 1000;
  const period = (cls) => Number(new RegExp(`\\.${cls}\\{[^}]*animation:[\\w-]+ ([\\d.]+)s`).exec(src)?.[1] ?? 0);
  const r = (v) => String(Math.round(v * 1000) / 1000);
  let out = src;
  // The effort bar: twinkle and sparks (.t, .s) share one loop and are staggered by .d0–.d5.
  const T = period('t') || period('s');
  if (T) out = out.replace(/\.d(\d)\{animation-delay:(-?[\d.]+)s\}/g, (_m, k, x) => `.d${k}{animation-delay:${r(Number(x) - (t % T))}s}`);
  // The halo of the bar's thumb and the breath of a live mark (.h), unstaggered.
  const TH = period('h');
  if (TH) out = out.replace('</style>', `.h{animation-delay:${r(-(t % TH))}s}</style>`);
  return out;
}
