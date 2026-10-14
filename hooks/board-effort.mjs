// ristretto board: "Effort meter" step tracker.
//
// One bold rounded track (15px). Inside it a contribution-graph field of 3px
// square pixels (2px in the band) that gets denser and brighter from the left toward a white
// pill thumb at the overall progress point. Done phases are steady green
// pixels: GitHub's contribution green and the board's own "done" colour, so
// the finished stretch reads as a lit commit graph. The current phase is clay
// pixels twinkling in a slow wave that rolls into the thumb, with pale-clay and
// white sparks right behind it. Todo is a sparse, faint grey field. Phase
// boundaries are 2px notches cut through the track. Lit pixels bloom.
//
// Pure and deterministic: the same input always yields the same bytes, so a
// redraw never restarts the CSS animation.

const CLAY = '#CC6A47', OK = '#2E9A5E', IDLE = '#858585', ERR = '#E5484D', WHITE = '#FFFFFF', PALE = '#F0B49C';
const REDUCED = '@media (prefers-reduced-motion: reduce){*{animation:none!important}}';
const DONE_OPACITY = [0.34, 0.54, 0.76, 1];   // contribution-graph levels
const LIVE_OPACITY = [0.5, 0.75, 1];

const num = (v) => String(Math.round(v * 100) / 100);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Integer hash -> [0,1). Stable per pixel column/row, so the field never reshuffles.
function mix(x) {
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
  return x ^ (x >>> 16);
}
function hash(a, b, salt) {
  return (mix(mix(mix(salt + 0x9e3779b9) + a) + b) >>> 0) / 4294967296;
}

function norm(phases) {
  const out = (Array.isArray(phases) ? phases : []).map((p) => {
    p = p || {};
    const w = Number(p.weight);
    const pr = Number(p.progress);
    return {
      state: p.state === 'done' || p.state === 'current' ? p.state : 'todo',
      w: Number.isFinite(w) && w > 0 ? w : 1,
      pr: Number.isFinite(pr) ? clamp01(pr) : 0,
    };
  });
  return out.length ? out : [{ state: 'todo', w: 1, pr: 0 }];
}

// Where the thumb sits: inside the first current phase, else at the end of the
// last done phase, else at the very start.
function thumbAt(ph) {
  const cur = ph.findIndex((p) => p.state === 'current');
  if (cur >= 0) return { k: cur, f: ph[cur].pr, live: true };
  let last = -1;
  ph.forEach((p, i) => { if (p.state === 'done') last = i; });
  return last >= 0 ? { k: last, f: 1, live: false } : { k: 0, f: 0, live: false };
}

function segments(ph, x0, x1, gap) {
  const total = ph.reduce((s, p) => s + p.w, 0);
  if (x1 - x0 - gap * (ph.length - 1) < ph.length * 6) gap = 0;
  const avail = x1 - x0 - gap * (ph.length - 1);
  let acc = 0;
  return ph.map((p, i) => {
    const s = Math.round(x0 + (acc / total) * avail + i * gap);
    acc += p.w;
    return [s, Math.round(x0 + (acc / total) * avail + i * gap)];
  });
}

function render(g, phases, red, id) {
  const ph = norm(phases);
  const live = red ? ERR : CLAY;
  const T = red ? 3 : 1.8;          // twinkle loop; a red gate slows down
  const TH = red ? 3 : 2.4;         // halo breath
  const seg = segments(ph, g.x0, g.x1, g.gap);
  const at = thumbAt(ph);
  const half = g.tw / 2 + g.tsw;
  const [ks, ke] = seg[at.k];
  const tx = Math.min(g.x1 - half, Math.max(g.x0 + half, ks + at.f * (ke - ks)));

  // Pixels must sit wholly inside the rounded track: test corners against the end caps.
  const r = g.th / 2, cy = g.ty + r, lim = r - g.cap;
  const fits = (x, y) => {
    for (const cx of [x, x + g.ps]) {
      const dx = cx < g.x0 + r ? cx - (g.x0 + r) : cx > g.x1 - r ? cx - (g.x1 - r) : 0;
      if (!dx) continue;
      for (const yy of [y, y + g.ps]) if (dx * dx + (yy - cy) * (yy - cy) > lim * lim) return false;
    }
    return true;
  };

  // One stroked path per (colour, level, delay) group: "Mx yhP" at stroke-width P is a PxP square.
  const lit = new Map(), faint = new Map();
  const ps = g.ps, pitch = ps + 1;
  const put = (m, key, x, y) => m.set(key, (m.get(key) || '') + `M${x} ${y + ps / 2}h${ps}`);
  const N = Math.floor((g.x1 - g.x0 + 1) / pitch);
  const gx0 = g.x0 + Math.floor((g.x1 - g.x0 - (pitch * N - 1)) / 2);
  const span = Math.max(1, tx - g.x0);
  for (let j = 0; j < N; j++) {
    const x = gx0 + pitch * j;
    const i = seg.findIndex(([s, e]) => x >= s + g.edge && x + ps <= e - g.edge);
    if (i < 0) continue;                                   // notch
    const st = ph[i].state, mid = x + ps / 2;
    const rg = clamp01((mid - g.x0) / span);               // 0 at the left, 1 at the thumb
    g.rows.forEach((y, ri) => {
      if (!fits(x, y)) return;
      const h1 = hash(j, ri, 1), h2 = hash(j, ri, 2), h3 = hash(j, ri, 3);
      if (st === 'done') {
        if (h1 > g.lit + (0.98 - g.lit) * rg) return;     // density ramps toward the thumb
        const v = 0.55 * rg + 0.45 * h2;                   // and so does brightness
        put(lit, 'D' + (v < 0.3 ? 0 : v < 0.5 ? 1 : v < 0.7 ? 2 : 3), x, y);
      } else if (st === 'current' && mid < tx) {
        if (h1 > g.lit + (0.98 - g.lit) * rg) return;
        const dist = tx - mid;
        if (dist <= g.nearW && h3 < 0.6) put(lit, 'W' + Math.floor(h2 * 6), x, y);
        else if (dist <= g.nearP && h3 < 0.45) put(lit, 'P' + Math.floor(h2 * 6), x, y);
        else {
          const v = 0.7 * rg + 0.3 * h2;
          const wave = (Math.floor(j / 2) + (h3 < 0.5 ? 0 : 1)) % 6;   // later columns peak later
          put(lit, 'C' + (v < 0.4 ? 0 : v < 0.7 ? 1 : 2) + wave, x, y);
        }
      } else if (st === 'current') {
        if (h1 < g.sparse + 0.08) put(faint, 'R', x, y);              // the rest of the live phase
      } else if (h1 < g.sparse) put(faint, h2 < 0.6 ? 'Z0' : 'Z1', x, y);
    });
  }

  let dim = '';
  const R = faint.get('R'), Z0 = faint.get('Z0'), Z1 = faint.get('Z1');
  if (Z0) dim += `<path stroke="${IDLE}" opacity=".3" d="${Z0}"/>`;
  if (Z1) dim += `<path stroke="${IDLE}" opacity=".5" d="${Z1}"/>`;
  if (R) dim += `<path stroke="${live}" opacity=".3" d="${R}"/>`;

  let glow = '';
  DONE_OPACITY.forEach((op, l) => {
    const d = lit.get('D' + l);
    if (d) glow += `<path stroke="${OK}" opacity="${op}" d="${d}"/>`;
  });
  LIVE_OPACITY.forEach((op, l) => {
    let inner = '';
    for (let w = 0; w < 6; w++) { const d = lit.get('C' + l + w); if (d) inner += `<path class="t d${w}" d="${d}"/>`; }
    if (inner) glow += `<g stroke="${live}" opacity="${op}">${inner}</g>`;
  });
  [['P', red ? WHITE : PALE, red ? ' opacity=".6"' : ''], ['W', WHITE, '']].forEach(([p, col, extra]) => {
    let inner = '';
    for (let w = 0; w < 6; w++) { const d = lit.get(p + w); if (d) inner += `<path class="s d${w}" d="${d}"/>`; }
    if (inner) glow += `<g stroke="${col}"${extra}>${inner}</g>`;
  });

  let bg = '';
  seg.forEach(([s, e], i) => {
    const st = ph[i].state;
    const [fill, op] = st === 'done' ? [OK, '.2'] : st === 'current' ? [live, '.12'] : [IDLE, '.16'];
    bg += `<rect x="${s}" y="${g.ty}" width="${e - s}" height="${g.th}" fill="${fill}" fill-opacity="${op}"/>`;
    if (st === 'current' && tx > s) {
      bg += `<rect x="${s}" y="${g.ty}" width="${num(Math.min(tx, e) - s)}" height="${g.th}" fill="${live}" fill-opacity=".14"/>`;
    }
  });

  let css = `.t{opacity:.85;animation:${id}t ${T}s cubic-bezier(.45,0,.55,1) infinite}` +
    `.s{opacity:.7;animation:${id}s ${T}s ease-in-out infinite}` +
    `.h{opacity:.6;animation:${id}b ${TH}s ease-in-out infinite}`;
  for (let k = 0; k < 6; k++) css += `.d${k}{animation-delay:${num((k * T) / 6 - T)}s}`;
  css += `@keyframes ${id}t{0%,100%{opacity:.3}50%{opacity:1}}` +
    `@keyframes ${id}s{0%,55%,100%{opacity:.25}78%{opacity:1}}` +
    `@keyframes ${id}b{0%,100%{opacity:.4}50%{opacity:.85}}` + REDUCED;

  const gradient = at.live
    ? `<radialGradient id="${id}h"><stop offset="0" stop-color="${red ? WHITE : PALE}" stop-opacity=".85"/>` +
      `<stop offset=".4" stop-color="${live}" stop-opacity=".35"/><stop offset="1" stop-color="${live}" stop-opacity="0"/></radialGradient>`
    : '';
  const halo = at.live
    ? `<ellipse class="h" cx="${num(tx)}" cy="${num(cy)}" rx="${g.hrx}" ry="${g.hry}" fill="url(#${id}h)"/>`
    : '';
  const ring = at.live ? live : ph.some((p) => p.state === 'done') ? OK : IDLE;
  const thumb = `<rect x="${num(tx - g.tw / 2)}" y="${g.tY}" width="${g.tw}" height="${g.tH}" rx="${g.tw / 2}" ` +
    `fill="${WHITE}" stroke="${ring}" stroke-width="${g.tsw}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${g.W}" height="${g.H}" viewBox="0 0 ${g.W} ${g.H}">` +
    `<style>${css}</style><defs>` +
    `<clipPath id="${id}c"><rect x="${g.x0}" y="${g.ty}" width="${g.x1 - g.x0}" height="${g.th}" rx="${r}"/></clipPath>` +
    `<filter id="${id}g" filterUnits="userSpaceOnUse" x="0" y="0" width="${g.W}" height="${g.H}">` +
    `<feGaussianBlur stdDeviation="${g.blur}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    `${gradient}</defs><g clip-path="url(#${id}c)">${bg}</g>${halo}` +
    `<g fill="none" stroke-width="${g.ps}" shape-rendering="crispEdges">${dim}<g filter="url(#${id}g)">${glow}</g></g>` +
    `${thumb}</svg>`;
}

function tracker({ width, phases, red } = {}) {
  const W = Math.max(60, Math.round(Number(width) || 420));
  return render({
    W, H: 21, x0: 2, x1: W - 2, ty: 3, th: 15, ps: 3, rows: [5, 9, 13], gap: 2, edge: 1, cap: 1.25, lit: 0.58, sparse: 0.22,
    tw: 7, tY: 1.5, tH: 18, tsw: 1.25, hrx: 26, hry: 10.5, blur: 1.3, nearW: 6, nearP: 18,
  }, phases, !!red, 'e');
}

function band({ phases, red } = {}) {
  return render({
    W: 60, H: 10, x0: 1, x1: 59, ty: 1, th: 8, ps: 2, rows: [2, 6], gap: 2, edge: 0, cap: 0.5, lit: 0.85, sparse: 0.34,
    tw: 3, tY: 0.5, tH: 9, tsw: 0.75, hrx: 9, hry: 5, blur: 0.6, nearW: 2, nearP: 6,
  }, phases, !!red, 'f');
}

// Terminal fallback, no colour assumed: done ▓ steady, current ▒ with a ▓ crest
// rolling one cell a second into the thumb █ (every two seconds when red, and
// the thumb breathes ▓/█), rest of the live phase ░, todo ·, a space per notch.
// Cell by cell, each with the state of the phase it sits in (a notch between phases), so a
// surface can colour them; terminal() is these cells joined.
function terminalSegments({ cells, phases, red, frame } = {}) {
  const n0 = Math.max(0, Math.floor(Number(cells) || 0));
  if (!n0) return [];
  const ph = norm(phases);
  const n = ph.length;
  const sep = n0 >= 3 * n ? 1 : 0;
  const avail = n0 - sep * (n - 1);
  const total = ph.reduce((s, p) => s + p.w, 0);
  const raw = ph.map((p) => (p.w / total) * avail);
  const len = raw.map((v) => Math.floor(v));
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let left = avail - len.reduce((a, b) => a + b, 0), k = 0; left > 0; left--, k++) len[order[k % n][1]]++;

  const at = thumbAt(ph);
  const f = Math.floor((Number(frame) || 0) / (red ? 2 : 1));
  const out = [];
  ph.forEach((p, i) => {
    if (i && sep) out.push({ state: 'notch', text: ' ' });
    const L = len[i];
    const own = p.state === 'current' ? Math.round(p.pr * (L - 1)) : -1;
    const ti = i === at.k ? Math.round(at.f * (L - 1)) : -1;
    const state = p.state === 'done' || p.state === 'current' ? p.state : 'todo';
    for (let c = 0; c < L; c++) {
      let text;
      if (c === ti) {
        text = !at.live && at.f === 0 ? '▪' : red && at.live && f % 2 ? '▓' : '█';
      } else if (p.state === 'done') {
        text = '▓';
      } else if (p.state === 'current') {
        if (c < own) text = (((c - f) % 4) + 4) % 4 === 0 || c === own - 1 ? '▓' : '▒';
        else text = c === own ? '▓' : '░';
      } else {
        text = '·';
      }
      out.push({ state, text });
    }
  });
  return out;
}

function terminal(opts = {}) {
  return terminalSegments(opts).map((s) => s.text).join('');
}

// The tracker's width in px from the columns its card has (a cell is about 7.4px), less the
// borders and padding of the cards it sits in; even, so the halves of the field line up.
function trackerWidth(columns, depth) {
  const w = Math.floor((Number(columns) - 4 * (Number(depth) || 0)) * 7.4);
  return Math.max(120, Math.min(1400, w - (w % 2)));
}

const DEMO = [
  { phases: [
    { name: 'plan', state: 'current', progress: 0.25 },
    { name: 'code', state: 'todo' },
    { name: 'review', state: 'todo' },
    { name: 'close', state: 'todo' },
  ], red: false },
  { phases: [
    { name: 'plan', state: 'done' },
    { name: 'code', state: 'current', progress: 0.5 },
    { name: 'review', state: 'todo' },
    { name: 'close', state: 'todo' },
  ], red: false },
  { phases: [
    { name: 'plan', state: 'done' },
    { name: 'code', state: 'done' },
    { name: 'review', state: 'current', progress: 0.4 },
    { name: 'close', state: 'todo' },
  ], red: true },
];

// The band's bar, and a lane row's: a bold 12px track (band() drew an 8px one, too thin beside
// text) holding three rows of fine 2px pixels, so each phase still shows a field of them.
function chip({ phases, red, width = 60 } = {}) {
  const W = Math.max(40, Math.round(Number(width) || 60));
  return render({
    W, H: 14, x0: 2, x1: W - 2, ty: 1, th: 12, ps: 2, rows: [3, 6, 9], gap: 2, edge: 1, cap: 1, lit: 0.7, sparse: 0.26,
    tw: 3, tY: 0.5, tH: 13, tsw: 0.75, hrx: 7, hry: 6, blur: 0.8, nearW: 3, nearP: 8,
  }, phases, !!red, 'g');
}

export { tracker, band, chip, terminal, terminalSegments, trackerWidth, DEMO };
