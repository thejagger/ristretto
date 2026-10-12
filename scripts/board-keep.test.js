#!/usr/bin/env node
// Self-check for hooks/board-keep.mjs — run with: node scripts/board-keep.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const { buttonKeeper } = await import(pathToFileURL(path.join(__dirname, '..', 'hooks', 'board-keep.mjs')).href);

  // The engine's own JSX gives a Button a fresh handle each time it is built; a stand-in counts.
  let handles = 0;
  const build = (onPress) => ({ type: 'Button', press: { plugin: '', handle: ++handles }, onPress });

  let clock = 0;
  const k = buttonKeeper(() => clock, 60000);
  const pressed = [];

  // The same button drawn twice is the same element — the engine then keeps its handle.
  const a1 = k.keep('Pane|name-x', 'x', () => pressed.push('first draw'), build);
  const a2 = k.keep('Pane|name-x', 'x', () => pressed.push('second draw'), build);
  assert.strictEqual(a1, a2, 'a redraw hands back the element it built');
  assert.strictEqual(handles, 1);

  // A press on it runs the action of the latest draw, not the one it was built in.
  a1.onPress();
  assert.deepStrictEqual(pressed, ['second draw']);

  // A changed look is a new element (the old handle goes, as it did before).
  const a3 = k.keep('Pane|name-x', 'x bold', () => pressed.push('third'), build);
  assert.notStrictEqual(a3, a1);
  assert.strictEqual(handles, 2);

  // Another key, or the same key in another place, is its own element.
  const b = k.keep('AbovePrompt|name-x', 'x', () => {}, build);
  assert.notStrictEqual(b, a3);

  // A button not drawn for a minute is let go when the next one is built.
  clock = 61000;
  k.keep('Pane|other', 'o', () => {}, build);
  assert.strictEqual(k.size(), 1, 'idle buttons are dropped');

  // Every Button the board draws goes through the keeper.
  const tsx = fs.readFileSync(path.join(__dirname, '..', 'hooks', 'board.tsx'), 'utf8');
  const built = (tsx.match(/<Button\b/g) || []).length;
  const kept = (tsx.match(/onPress => <Button\b/g) || []).length;
  assert.ok(built > 0 && built === kept, `every <Button> is built inside keep() (${kept}/${built})`);

  console.log('board-keep.test.js: all checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
