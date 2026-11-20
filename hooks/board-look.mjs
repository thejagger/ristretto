// The board's images, v1 (spec 2026-11-20): the header, the step word, the meter, the timeline
// rail and the chip above the prompt. What the real desktop pane taught the spike:
// - an image is fluid: `width="100%"`, no viewBox on the root, its height given by the Svg; one
//   unit is one pixel and `x="100%"` is the right edge (the rail alone has its own size);
// - it follows the person's scheme by itself (`prefers-color-scheme`), as text follows the theme;
// - it may name fonts installed on the machine, and its CSS animation runs.
// Pure and deterministic: no $, no Node, no clock; `now` is passed in.

import { escapeXml as esc, svgClock } from './board-svg.mjs';
import { tracker } from './board-effort.mjs';

export const BRASS = '#E8B64A';
export const YOU = '#7DB7FF';
export const RED = '#FF6B5E';

export const STEP_INK = {
  dark: { plan: '#A3A29C', build: '#E0896A', prove: '#3FB574', review: '#A58BE8', close: '#8FA1B6' },
  light: { plan: '#6B6A66', build: '#B4532F', prove: '#1F7A4D', review: '#6B4FC0', close: '#55677C' },
};
// The meter's pixels: each step's ink and the pale of its sparks.
export const STEP_COLORS = {
  plan: { ink: '#A3A29C', pale: '#D4D3CE' },
  build: { ink: '#E0896A', pale: '#F0B49C' },
  prove: { ink: '#3FB574', pale: '#B5E6CB' },
  review: { ink: '#A58BE8', pale: '#D6C9F7' },
  close: { ink: '#8FA1B6', pale: '#CFD9E4' },
};

const DIN = "Bahnschrift, 'DIN Alternate', 'Barlow Semi Condensed', system-ui, sans-serif";
const MONO = "'Cascadia Mono', ui-monospace, Consolas, monospace";
const LINE = '#7A838C';

// Every hue an image names, light then dark: `.f-<hue>` fills, `.k-<hue>` strokes.
const HUES = {
  plan: [STEP_INK.light.plan, STEP_INK.dark.plan],
  build: [STEP_INK.light.build, STEP_INK.dark.build],
  prove: [STEP_INK.light.prove, STEP_INK.dark.prove],
  review: [STEP_INK.light.review, STEP_INK.dark.review],
  close: [STEP_INK.light.close, STEP_INK.dark.close],
  brass: ['#A8740F', BRASS],
  you: ['#2F6FD0', YOU],
  red: ['#D93B30', RED],
};
const hueCss = (i) => Object.entries(HUES).map(([k, v]) => `.f-${k}{fill:${v[i]}}.k-${k}{stroke:${v[i]}}`).join('');
// Ink, dim and track: the track is the ink faint, so it shows on the pane and on the band alike.
const SCHEME = `.i{fill:#1F1E1D}.d{fill:#6B6A66}.t{fill:#1F1E1D;fill-opacity:.2}${hueCss(0)}` +
  `@media (prefers-color-scheme: dark){.i{fill:#ECEEF0}.d{fill:#838C95}.t{fill:#ECEEF0;fill-opacity:.28}${hueCss(1)}}`;
const CALM = '@media (prefers-reduced-motion:reduce){*{animation:none!important}}';
const FLOW = '.fl{animation:fl .9s linear infinite}@keyframes fl{to{stroke-dashoffset:-16}}';
const HALO = '.h{animation:h 2.4s ease-in-out infinite}@keyframes h{0%,100%{opacity:.15}50%{opacity:.45}}';

const n2 = (v) => String(Math.round(v * 100) / 100);
const hueOf = (name) => (HUES[name] ? `f-${name}` : 'i');

const fluid = (h, body, css = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${h}"><style>${SCHEME}${css}${CALM}</style>${body}</svg>`;
const fixed = (w, h, body, css = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><style>${SCHEME}${css}${CALM}</style>${body}</svg>`;

// A running clock pinned to the right edge, `inset` px in, its baseline at `base`.
function clockAt({ since, now, size, base, inset = 0 }) {
  if (typeof since !== 'number') return '';
  const c = svgClock({ ms: Math.max(0, now - since), format: 'dur', color: 'inherit', font: DIN, size, bold: true });
  const top = base - size;
  const inner = c.svg.replace('<svg xmlns="http://www.w3.org/2000/svg" ', `<svg x="${-(c.width + inset)}" y="${n2(top)}" `);
  return `<svg x="100%" overflow="visible"><g class="i">${inner}</g></svg>`;
}

// One segment per feature (or point), capped at 12: done, the live one, blocked, then to go.
function segState(i, s) {
  const done = Math.min(s.done, 12);
  if (i < done) return 'done';
  if (i === done && s.live) return 'live';
  if (i < done + (s.live ? 1 : 0) + (s.red || 0)) return 'red';
  return 'todo';
}
function liveSeg(at, x1, x2, y, live, dash) {
  return `<rect class="f-${live}" fill-opacity=".4" ${at}/>` +
    `<line class="fl k-${live}" x1="${x1}" y1="${y + 3}" x2="${x2}" y2="${y + 3}" stroke-width="6" stroke-dasharray="${dash} ${dash}"/>`;
}
function strip(y, s) {
  const n = Math.min(12, Math.max(1, s.n));
  const w = (100 - (n - 1)) / n;
  let out = '';
  for (let i = 0; i < n; i++) {
    const x = i * (w + 1);
    const at = `x="${n2(x)}%" y="${y}" width="${n2(w)}%" height="6"`;
    const st = segState(i, s);
    if (st === 'done') out += `<rect class="i" ${at}/>`;
    else if (st === 'live') out += liveSeg(at, `${n2(x)}%`, `${n2(x + w)}%`, y, s.live, 8);
    else if (st === 'red') out += `<rect class="f-red" ${at}/>`;
    else out += `<rect class="t" ${at}/>`;
  }
  return out;
}

// The pane's head: the mode row, the big word or numeral, the label and clock right, the strip.
export function header(head) {
  const big = String(head.big ?? '');
  const size = big.length <= 7 ? 80 : 56;
  const bigCls = head.step ? `f-${head.step}` : head.tone === 'you' ? 'f-you' : 'i';
  let body = `<g font-family="${DIN}" font-weight="600">`;
  ['prep', 'pull', 'brew'].forEach((name, i) => {
    const on = name === head.mode;
    body += `<text class="${on ? 'i' : 'd'}" x="${i * 58}" y="14" font-size="13" letter-spacing="2">${name.toUpperCase()}</text>`;
    if (on) body += `<rect class="i" x="${i * 58}" y="21" width="40" height="2"/>`;
  });
  body += `<text x="0" y="110"><tspan class="${bigCls}" font-size="${size}" style="font-stretch:80%">${esc(big)}</tspan>`;
  if (head.small) body += `<tspan class="d" dx="10" font-size="30" font-weight="500">${esc(head.small)}</tspan>`;
  body += '</text>';
  body += `<text class="d" x="100%" y="80" font-size="11" letter-spacing="1.8" text-anchor="end">${esc(head.label ?? '')}</text></g>`;
  body += clockAt({ since: head.since, now: head.now, size: 26, base: 110 });
  let h = 118;
  const s = head.strip;
  if (s) {
    body += strip(126, s);
    h = 134;
    if (head.caption) {
      const [a, b, c] = head.caption.map((x) => esc(x ?? ''));
      body += `<g font-family="${MONO}" font-size="11">` +
        `<text class="d" x="0" y="150">${a}</text>` +
        `<text class="${s.live ? hueOf(s.live) : 'd'}" x="50%" y="150" text-anchor="middle">${b}</text>` +
        `<text class="d" x="100%" y="150" text-anchor="end">${c}</text></g>`;
      h = 156;
    }
  }
  return { src: fluid(h, body, FLOW), h };
}

// The step a feature is at, as a word, with its count right.
export function stepWord({ word, step, count }) {
  const body = `<g font-family="${DIN}">` +
    `<text class="${hueOf(step)}" x="0" y="38" font-size="48" font-weight="600" style="font-stretch:80%">${esc(word ?? '')}</text>` +
    `<text class="d" x="100%" y="38" font-size="18" font-weight="500" text-anchor="end">${esc(count ?? '')}</text></g>`;
  return fluid(44, body);
}

// The pixel meter in step colours, stretched sideways only: its pixels keep their height.
export function meter({ phases, red = false }) {
  return tracker({ width: 400, phases, red, colors: STEP_COLORS })
    .replace('width="400" height="21"', 'width="100%" height="21" preserveAspectRatio="none"');
}

// A row's piece of the timeline, far taller than any row; the row cuts it at its end.
export function rail(stop, step = null) {
  const H = 600;
  const dashed = (from, to) => `<line x1="8" y1="${from}" x2="8" y2="${to}" stroke="${LINE}" stroke-width="2" stroke-dasharray="4 4"/>`;
  const line = stop === 'first' ? `<rect x="7" y="9" width="2" height="${H}" fill="${LINE}"/>`
    : stop === 'done' ? `<rect x="7" y="0" width="2" height="${H}" fill="${LINE}"/>`
      : stop === 'live' ? `<rect x="7" y="0" width="2" height="28" fill="${LINE}"/>${dashed(36, H)}`
        : stop === 'next' ? dashed(0, 4) + dashed(14, H)
          : dashed(0, 6);
  const hue = hueOf(step);
  const node = stop === 'first' || stop === 'done' ? '<circle class="i" cx="8" cy="9" r="5"/>'
    : stop === 'live' ? `<circle class="h ${hue}" cx="8" cy="28" r="8"/><circle class="${hue}" cx="8" cy="28" r="5.5"/>`
      : stop === 'next' ? `<circle cx="8" cy="9" r="4" fill="none" stroke="${LINE}" stroke-width="2"/>`
        : `<circle cx="8" cy="9" r="2" fill="${LINE}"/>`;
  return fixed(16, H, line + node, stop === 'live' ? HALO : '');
}

// The chip above the prompt: a live dot, a small label, the step word; the clock and a small
// strip pinned right.
export function chip(c) {
  const hue = c.step ? `f-${c.step}` : c.tone === 'brass' ? 'f-brass' : c.tone === 'you' ? 'f-you' : 'i';
  let body = '<rect width="100%" height="44" rx="10" fill="#808080" fill-opacity=".12"/>' +
    `<circle class="h ${hue}" cx="18" cy="22" r="10"/><circle class="${hue}" cx="18" cy="22" r="6"/>` +
    `<g font-family="${DIN}" font-weight="600">` +
    `<text class="d" x="38" y="17" font-size="11" letter-spacing="1.6">${esc(c.label ?? '')}</text>` +
    `<text class="${hue}" x="38" y="37" font-size="22" style="font-stretch:80%">${esc(c.word ?? '')}</text></g>`;
  body += clockAt({ since: c.since, now: c.now, size: 15, base: 20, inset: 14 });
  const s = c.strip;
  if (s) {
    const n = Math.min(12, Math.max(1, s.n));
    let segs = '';
    for (let i = 0; i < n; i++) {
      const x = -14 - (n - i) * 17 + 3;
      const at = `x="${x}" y="28" width="14" height="6"`;
      const st = segState(i, s);
      if (st === 'done') segs += `<rect class="i" ${at}/>`;
      else if (st === 'live') segs += liveSeg(at, x, x + 14, 28, s.live, 4);
      else if (st === 'red') segs += `<rect class="f-red" ${at}/>`;
      else segs += `<rect class="t" ${at}/>`;
    }
    body += `<svg x="100%" overflow="visible">${segs}</svg>`;
  }
  return fluid(44, body, HALO + FLOW.replace('-16', '-8'));
}
