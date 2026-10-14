#!/usr/bin/env node
// Self-check for hooks/board-svg.mjs — run with: node scripts/board-svg.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const file = path.join(__dirname, '..', 'hooks', 'board-svg.mjs');
  const s = await import(pathToFileURL(file).href);

  // Marks: every kind draws, 14×14, deterministic, small.
  for (const k of ['planned', 'next', 'queued', 'running', 'lane', 'merge-queued', 'gate-red', 'needs-human', 'needs-review', 'blocked', 'done', 'ready', 'facts', 'fact-conflict', 'suite-ok', 'suite-red']) {
    const a = s.mark(k);
    assert.strictEqual(a, s.mark(k), k);
    assert.deepStrictEqual(s.dims(a), { width: 14, height: 14 }, k);
    assert.ok(a.length < 4000, k);
  }
  assert.deepStrictEqual(s.dims(s.chev12('down')), { width: 12, height: 12 });
  assert.notStrictEqual(s.chev12('down'), s.chev12('right'));
  assert.ok(s.square('#199E70').includes('#199E70'));
  assert.deepStrictEqual(s.dims(s.space(8)), { width: 1, height: 8 }, 'a spacer is 1px wide, drawn at its own size');

  // The clock: its digits are wheels a stepped animation rolls; it starts where the time is.
  const c = s.svgClock({ ms: 9 * 60000 + 57000, format: 'clock', color: '#F0EEE6', bold: true });
  assert.ok(/steps\(10\) infinite/.test(c.svg));
  assert.ok(/\.c\d\{animation:k10 10s steps\(10\) infinite;animation-delay:-7s\}/.test(c.svg), '9m57s: the seconds wheel is 7s into its 10s loop');
  assert.ok(/font-weight="600"/.test(c.svg) && /fill="#F0EEE6"/.test(c.svg));
  assert.strictEqual(s.svgClock({ ms: 1000 }).svg, s.svgClock({ ms: 1000 }).svg, 'the same time gives the same bytes');
  assert.strictEqual(s.clockWords(9 * 60000 + 57000, 'clock'), '9m57s');
  assert.strictEqual(s.clockWords(2 * 3600000 + 5 * 60000, 'dur'), '2h05m');

  // Phase lock: the effort bar's delays move with the clock, nothing else does.
  const svg = '<svg><style>.t{animation:et 1.8s infinite}.d0{animation-delay:-1.8s}.h{animation:eb 2.4s infinite}</style></svg>';
  const a = s.phaseLock(svg, 0), b = s.phaseLock(svg, 1000);
  assert.notStrictEqual(a, b);
  assert.strictEqual(a.replace(/animation-delay:-?[\d.]+s/g, ''), b.replace(/animation-delay:-?[\d.]+s/g, ''));
  assert.strictEqual(s.phaseLock('<svg/>', 5), '<svg/>', 'a still image is left alone');

  // The stacked bar fills its width and draws a segment per non-empty part, on the theme's track.
  const bar = s.stacked([{ n: 4, hex: s.LEGEND.done }, { n: 0, hex: s.LEGEND.review }, { n: 1, hex: s.LEGEND.human }], 300, 'dark');
  assert.strictEqual((bar.match(/<rect /g) || []).length, 3, 'track + 2 segments');
  assert.deepStrictEqual(s.dims(bar), { width: 300, height: 4 });
  assert.ok(bar.includes(s.LEGEND.track.dark) && s.stacked([], 100, 'light').includes(s.LEGEND.track.light));

  // Theme colours (Review Focus 5): a hairline and ink per theme.
  assert.deepStrictEqual(s.HAIR, { dark: '#2D2D2D', light: '#E3E1DA' });
  assert.strictEqual(s.INK.light.text, '#1F1E1D');

  assert.ok(!/Math\.random|Date/.test(fs.readFileSync(file, 'utf8')), 'no randomness and no clock');
  console.log('board-svg.test.js: all checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
