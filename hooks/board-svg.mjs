// The board's running clock and the phase lock that keeps an animation where the wall clock has
// it across a redraw (the images themselves are board-look.mjs).
//
// Pure and deterministic: no clock, no randomness, no counters. The same input always yields the
// same bytes.

// The ink a clock takes per theme when none is given.
export const INK = {
  dark: { text: '#F0EEE6', dim: '#A3A29C', claude: '#E0896A' },
  light: { text: '#1F1E1D', dim: '#6B6A66', claude: '#B4532F' },
};
export const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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

// `font` and `size` (v1): the face and its size; the wheels, advances and height scale with it.
export function svgClock({ ms = 0, format = 'clock', color = INK.dark.text, bold = false, font = CLOCK_FONT, size = CLOCK_SIZE } = {}) {
  const { t, wheels } = wheelsOf(ms, format);
  const k = size / CLOCK_SIZE;
  const H = Math.round(CLOCK_H * k);
  const BASE = CLOCK_BASE * k;
  let x = 0;
  let body = '';
  let css = '';
  const weight = bold ? 600 : 400;
  const text = (s, cx, y) => `<text x="${num3(cx)}" y="${num3(y)}" text-anchor="middle">${s === ' ' ? '' : s}</text>`;
  const steps = new Set();
  wheels.forEach((w, i) => {
    if (w.u) {
      const a = ADV[w.u] * k;
      body += text(w.u, x + a / 2, BASE);
      x += a;
      return;
    }
    const a = ADV.d * k;
    const n = w.g.length;
    steps.add(n);
    let col = '';
    w.g.forEach((g, j) => { col += text(g, x + a / 2, BASE + j * H); });
    // The wheel's place in its loop now: how far into its period the time is.
    const delay = -(t % w.p);
    css += `.c${i}{animation:k${n} ${w.p}s steps(${n}) infinite;animation-delay:${num3(delay)}s}`;
    body += `<g class="c${i}">${col}</g>`;
    x += a;
  });
  for (const n of steps) css += `@keyframes k${n}{from{transform:translateY(0)}to{transform:translateY(-${n * H}px)}}`;
  const W = Math.ceil(x);
  return {
    width: W,
    height: H,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
      `<style>${css}</style><defs><clipPath id="v"><rect width="${W}" height="${H}"/></clipPath></defs>` +
      `<g clip-path="url(#v)" fill="${color}" font-family="${font}" font-size="${size}" font-weight="${weight}">${body}</g></svg>`,
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
