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

  // The clock: its digits are wheels a stepped animation rolls; it starts where the time is.
  const c = s.svgClock({ ms: 9 * 60000 + 57000, format: 'clock', color: '#F0EEE6', bold: true });
  assert.ok(/steps\(10\) infinite/.test(c.svg));
  assert.ok(/\.c\d\{animation:k10 10s steps\(10\) infinite;animation-delay:-7s\}/.test(c.svg), '9m57s: the seconds wheel is 7s into its 10s loop');
  assert.ok(/font-weight="600"/.test(c.svg) && /fill="#F0EEE6"/.test(c.svg));
  assert.strictEqual(s.svgClock({ ms: 1000 }).svg, s.svgClock({ ms: 1000 }).svg, 'the same time gives the same bytes');
  // v1: the clock takes a face and a size; everything scales with the size.
  const big = s.svgClock({ ms: 1000, font: 'Bahnschrift, sans-serif', size: 26 });
  assert.ok(big.svg.includes('font-size="26"') && big.svg.includes('font-family="Bahnschrift, sans-serif"'));
  assert.strictEqual(big.height, 36);
  assert.ok(big.width > s.svgClock({ ms: 1000 }).width * 1.9, 'twice the size, twice as wide');
  assert.strictEqual(s.svgClock({ ms: 1000 }).height, 18, 'the default clock is as before');
  assert.strictEqual(s.clockWords(9 * 60000 + 57000, 'clock'), '9m57s');
  assert.strictEqual(s.clockWords(2 * 3600000 + 5 * 60000, 'dur'), '2h05m');

  // Phase lock: the effort bar's delays move with the clock, nothing else does.
  const svg = '<svg><style>.t{animation:et 1.8s infinite}.d0{animation-delay:-1.8s}.h{animation:eb 2.4s infinite}</style></svg>';
  const a = s.phaseLock(svg, 0), b = s.phaseLock(svg, 1000);
  assert.notStrictEqual(a, b);
  assert.strictEqual(a.replace(/animation-delay:-?[\d.]+s/g, ''), b.replace(/animation-delay:-?[\d.]+s/g, ''));
  assert.strictEqual(s.phaseLock('<svg/>', 5), '<svg/>', 'a still image is left alone');

  // The clock's ink per theme.
  assert.strictEqual(s.INK.light.text, '#1F1E1D');

  assert.ok(!/Math\.random|Date/.test(fs.readFileSync(file, 'utf8')), 'no randomness and no clock');
  console.log('board-svg.test.js: all checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
