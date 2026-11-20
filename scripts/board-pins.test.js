#!/usr/bin/env node
// Self-check for hooks/board-pins.mjs — run with: node scripts/board-pins.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const file = path.join(__dirname, '..', 'hooks', 'board-pins.mjs');
  const pins = await import(pathToFileURL(file).href);

  // The three markers, at a line's start after an optional list mark or quote; a fenced
  // example and a marker mid-sentence are not pins.
  const text = [
    'Here is where we stand.',
    '',
    'decided: Interaction → Visuals only.',
    '- decided: Modes -> Prep, pull, brew.',
    'open: Init — a mode of its own?',
    '> found: A pane lays out text in cells.',
    '```',
    'decided: Example → not a pin',
    '```',
    'We decided: nothing here, mid-sentence.',
    'Decided: Case → any case counts.',
    'open: Spacing - even rows?',
    'decided: no arrow here',
  ].join('\n');
  const p = pins.pinsOf(text);
  assert.deepStrictEqual(p.decided, [
    { topic: 'Interaction', ruling: 'Visuals only.' },
    { topic: 'Modes', ruling: 'Prep, pull, brew.' },
    { topic: 'Case', ruling: 'any case counts.' },
  ]);
  assert.deepStrictEqual(p.open, [{ topic: 'Init', question: 'a mode of its own?' }, { topic: 'Spacing', question: 'even rows?' }]);
  assert.deepStrictEqual(p.found, ['A pane lays out text in cells.']);
  assert.deepStrictEqual(pins.pinsOf(''), { open: [], decided: [], found: [] });
  assert.deepStrictEqual(pins.pinsOf(undefined), { open: [], decided: [], found: [] });
  assert.deepStrictEqual(pins.pinsOf('decided: A → B\r\nfound: C\r\n').decided, [{ topic: 'A', ruling: 'B' }], 'CRLF answers read');

  // Final review I5: the shapes a model writes the markers in — a code span in a list, bold, a
  // numbered item — all pin.
  const shapes = pins.pinsOf('- `decided: auth → OTP`\n**decided:** b → c\n1. decided: d → e\n> - found: `f`\n- **open**: g — h?');
  assert.deepStrictEqual(shapes.decided, [{ topic: 'auth', ruling: 'OTP' }, { topic: 'b', ruling: 'c' }, { topic: 'd', ruling: 'e' }]);
  assert.deepStrictEqual(shapes.found, ['f']);
  assert.deepStrictEqual(shapes.open, [{ topic: 'g', question: 'h?' }]);

  // Folding: points keyed by topic, case-insensitive; a ruling settles, an open line reopens.
  let s = pins.foldPins(pins.EMPTY_PINS, pins.pinsOf('decided: Interaction → Visuals only.\nopen: Init — a mode of its own?\nfound: A pane lays out text in cells.'));
  assert.strictEqual(s.points.length, 2);
  assert.strictEqual(s.live, 'Init', 'one open point named: that is the one being talked through');
  s = pins.foldPins(s, pins.pinsOf('decided: init → Part of rest.\nfound: A pane lays out text in cells.'));
  assert.deepStrictEqual(s.points.find((x) => x.topic === 'Init'), { topic: 'Init', question: 'a mode of its own?', ruling: 'Part of rest.' }, 'keeps its first spelling');
  assert.strictEqual(s.found.length, 1, 'a fact is held once');
  assert.strictEqual(s.live, null);
  s = pins.foldPins(s, pins.pinsOf('open: Init — after all, its own mode?'));
  assert.deepStrictEqual(s.points.find((x) => x.topic === 'Init'), { topic: 'Init', question: 'after all, its own mode?', ruling: null });
  assert.strictEqual(pins.foldPins(s, pins.pinsOf('open: A — a?\nopen: B — b?')).live, null, 'two open points named: none is singled out');
  assert.strictEqual(pins.foldPins(s, pins.pinsOf('nothing marked')), s, 'nothing marked, nothing changes');
  assert.deepStrictEqual(pins.EMPTY_PINS, { points: [], found: [], live: null });

  console.log('board-pins.test.js: all checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
