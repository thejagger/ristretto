#!/usr/bin/env node
// Self-check for hooks/board-effort.mjs — run with: node scripts/board-effort.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const file = path.join(__dirname, '..', 'hooks', 'board-effort.mjs');
  const e = await import(pathToFileURL(file).href);
  const ph = [{ state: 'done' }, { state: 'current', progress: 0.5 }, { state: 'todo' }, { state: 'todo' }];

  // Deterministic: the same input gives the same bytes (a redraw must not restart the animation).
  assert.strictEqual(e.tracker({ width: 300, phases: ph }), e.tracker({ width: 300, phases: ph }));
  assert.ok(/width="300" height="21"/.test(e.tracker({ width: 300, phases: ph })), 'the tracker is 21px high at its width');
  assert.ok(/width="96" height="14"/.test(e.chip({ phases: ph, width: 96 })), "the band's chip is 14px high at its width");
  assert.ok(/width="60" height="14"/.test(e.chip({ phases: ph })), 'a lane chip is 60px by default');
  assert.ok(!/Math\.random|Date/.test(fs.readFileSync(file, 'utf8')), 'no randomness and no clock in the bar');

  // The terminal glyphs come cell by cell, so the band can colour each phase.
  const segs = e.terminalSegments({ cells: 24, phases: ph, red: false, frame: 0 });
  assert.strictEqual(segs.map((s) => s.text).join(''), e.terminal({ cells: 24, phases: ph, red: false, frame: 0 }));
  assert.ok(segs.every((s) => ['done', 'current', 'todo', 'notch'].includes(s.state)), 'every cell has a state');
  assert.ok(segs.some((s) => s.state === 'notch'), 'phases are parted by a notch when there is room');
  assert.deepStrictEqual(e.terminalSegments({ cells: 0, phases: ph }), []);

  // The tracker's width from the pane's columns: never thinner than 120px or wider than 1400px.
  assert.strictEqual(e.trackerWidth(52, 2), 324);
  assert.strictEqual(e.trackerWidth(10, 2), 120);
  assert.strictEqual(e.trackerWidth(400, 0), 1400);
  assert.strictEqual(e.trackerWidth(53, 2) % 2, 0, 'an even width');

  for (const k of Object.keys(e.DEMO)) assert.ok(e.tracker(e.DEMO[k]).length < 131072, 'a bar stays small');
  // v1: a colour per step, by the phase's name; without colours the bytes are as before.
  {
    const colors = { plan: { ink: '#A3A29C', pale: '#D4D3CE' }, build: { ink: '#E0896A', pale: '#F0B49C' }, prove: { ink: '#3FB574', pale: '#B5E6CB' }, review: { ink: '#A58BE8', pale: '#D6C9F7' }, close: { ink: '#8FA1B6', pale: '#CFD9E4' } };
    const phases = [{ name: 'plan', state: 'done' }, { name: 'build', state: 'done' }, { name: 'prove', state: 'done' }, { name: 'review', state: 'current', progress: 0.6 }, { name: 'close', state: 'todo' }];
    const before = e.tracker({ width: 300, phases });
    const svg = e.tracker({ width: 300, phases, colors });
    for (const c of ['#A3A29C', '#E0896A', '#3FB574', '#A58BE8', '#8FA1B6', '#D6C9F7']) assert.ok(svg.includes(c), c);
    assert.ok(!svg.includes('#2E9A5E'), 'the old done green is gone');
    assert.ok(!svg.includes('#CC6A47'), 'the old clay is gone');
    assert.strictEqual(svg, e.tracker({ width: 300, phases, colors }), 'deterministic');
    assert.strictEqual(e.tracker({ width: 300, phases }), before, 'no colors: unchanged');
    assert.ok(e.chip({ phases, colors }).includes('#A58BE8'), 'the chip takes them too');
    // A red gate still wins over the live step's colour.
    assert.ok(e.tracker({ width: 300, phases, colors, red: true }).includes('#E5484D'));
  }

  console.log('board-effort.test.js: all checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
