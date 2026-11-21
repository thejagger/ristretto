#!/usr/bin/env node
// Self-check for hooks/board-look.mjs — run with: node scripts/board-look.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const file = path.join(__dirname, '..', 'hooks', 'board-look.mjs');
  const look = await import(pathToFileURL(file).href);

  // The header: fluid, both schemes, the display face, the strip capped at 12.
  const head = { mode: 'brew', big: '3', step: null, tone: 'ink', small: '/ 7', label: 'RUNNING', since: 1000, now: 61000, strip: { n: 7, done: 2, live: 'review', red: 0 }, caption: ['2 pulled', '1 in review', '4 to go'] };
  const h = look.header(head);
  assert.ok(h.src.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="100%"'));
  assert.ok(!/^<svg[^>]*viewBox/.test(h.src), 'fluid: no viewBox on the root');
  assert.ok(h.src.includes('prefers-color-scheme: dark') && h.src.includes('#1F1E1D') && h.src.includes('#ECEEF0'));
  assert.ok(h.src.includes('Bahnschrift') && h.src.includes('#A58BE8'));
  assert.strictEqual(h.h, 156, 'with a strip and its caption');
  assert.strictEqual(look.header(head).src, h.src, 'deterministic');
  assert.strictEqual((look.header({ ...head, strip: { n: 40, done: 2, live: 'review', red: 0 } }).src.match(/height="6"/g) || []).length, 12, 'the strip stops at 12');
  assert.ok(!look.header({ ...head, since: null }).src.includes('animation-delay'), 'no clock without a start');
  // Final review I4: past 12 features the strip is scaled, not filled: done, the live one and
  // the blocked ones keep their share of the 12 segments.
  const segs = (strip) => look.header({ ...head, strip }).src.match(/<rect class="(i|t|f-red|f-[a-z]+)"[^>]*y="126"/g).map((r) => /class="([^"]+)"/.exec(r)[1]);
  const big = segs({ n: 78, done: 30, live: 'review', red: 2 });
  assert.strictEqual(big.length, 12);
  assert.strictEqual(big.filter((c) => c === 'i').length, 5, '30 of 78 done is 5 of 12');
  assert.strictEqual(big.filter((c) => c === 'f-review').length, 1, 'the live one still shows');
  assert.strictEqual(big.filter((c) => c === 'f-red').length, 1, 'a blocked one still shows');
  assert.strictEqual(segs({ n: 78, done: 12, live: null, red: 0 }).filter((c) => c === 'i').length, 2, '12 of 78 done does not fill the strip');
  assert.ok(h.src.includes('animation-delay'), 'a clock with a start');
  assert.strictEqual(look.header({ ...head, strip: null, caption: null }).h, 118);
  assert.ok(look.header({ ...head, label: 'A<B' }).src.includes('A&lt;B'), 'words are escaped');
  assert.ok(look.header({ ...head, strip: { n: 7, done: 6, live: null, red: 1 } }).src.includes('f-red'), 'a blocked feature is a red segment');
  assert.ok(look.header({ ...head, mode: 'pull', big: 'BUILD', step: 'build' }).src.includes('class="f-build"'), 'the step word takes its hue');
  // The mode is one word, not a row of three that reads as a switch.
  assert.ok(h.src.includes('>BREW</text>') && !h.src.includes('>PREP</text>') && !h.src.includes('>PULL</text>'), 'only the mode it is in');
  assert.ok(!/>(PREP|PULL|BREW)<\/text>/.test(look.header({ ...head, mode: 'rest', strip: null, caption: null }).src), 'rest names no mode');

  // The step word, the meter, the rail, the chip.
  const w = look.stepWord({ word: 'REVIEW', step: 'review', count: '4 / 5' });
  assert.ok(w.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="44"') && w.includes('f-review') && w.includes('4 / 5'));
  assert.ok(look.meter({ phases: [{ name: 'build', state: 'current', progress: 0.5 }] }).includes('preserveAspectRatio="none"'));
  assert.ok(look.meter({ phases: [{ name: 'build', state: 'current', progress: 0.5 }] }).includes('width="100%" height="21"'));
  assert.ok(look.meter({ phases: [{ name: 'build', state: 'current', progress: 0.5 }] }).includes('#E0896A'), 'the meter in step colours');
  assert.ok(look.rail('first').includes('viewBox="0 0 16 600"'));
  for (const stop of ['first', 'done', 'live', 'next', 'last']) assert.ok(look.rail(stop, 'review').startsWith('<svg'), stop);
  assert.ok(look.rail('live', 'review').includes('f-review'), 'the live dot takes its step');
  // The box it hangs in sits one cell up (board.tsx), which overshoots by RAIL_DROP px: the drawing
  // comes down by that much, so a node meets its caption and a line meets the row above.
  assert.strictEqual(look.RAIL_DROP, 4);
  for (const stop of ['first', 'done', 'live', 'next', 'last']) assert.ok(look.rail(stop).includes(`<g transform="translate(0 ${look.RAIL_DROP})">`), `${stop} is lowered`);
  const c = look.chip({ label: 'BREW 3 / 7 · a<b&c', word: 'REVIEW', step: 'review', tone: 'ink', since: null, now: 0, strip: null });
  assert.ok(c.includes('a&lt;b&amp;c'));
  assert.ok(c.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="40"'), 'the chip is two rows high');
  assert.ok(look.chip({ label: 'L', word: 'W', step: null, tone: 'brass', since: 0, now: 60000, strip: { n: 6, done: 4, live: 'brass', red: 0 } }).includes('animation-delay'), 'the chip has a clock');

  // The step inks, as the spec gives them.
  assert.deepStrictEqual(look.STEP_INK.dark, { plan: '#A3A29C', build: '#E0896A', prove: '#3FB574', review: '#A58BE8', close: '#8FA1B6' });
  assert.deepStrictEqual(look.STEP_INK.light, { plan: '#6B6A66', build: '#B4532F', prove: '#1F7A4D', review: '#6B4FC0', close: '#55677C' });
  assert.strictEqual(look.BRASS, '#E8B64A');
  assert.ok(!/Math\.random|Date/.test(fs.readFileSync(file, 'utf8')), 'no randomness and no clock');

  console.log('board-look.test.js: all checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
