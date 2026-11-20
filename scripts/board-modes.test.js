#!/usr/bin/env node
// Self-check for hooks/board-modes.mjs — run with: node scripts/board-modes.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const modes = await import(pathToFileURL(path.join(__dirname, '..', 'hooks', 'board-modes.mjs')).href);

  const live = (over) => ({ command: 'pull', id: 'a', phase: 'coding', round: 0, since: 0, gate: null, armed: true, ...over });
  const story = (over) => ({ view: 'branch', work: [], done: [], blocked: [], checks: [], taken: [], free: [], held: [], boxes: {}, ...over });
  const effort = [{ name: 'plan', state: 'done' }, { name: 'build', state: 'done' }, { name: 'prove', state: 'done' }, { name: 'review', state: 'current', progress: 0.5 }, { name: 'close', state: 'todo' }];
  const work = (id, state = 'running') => ({ key: `work--${id}`, tag: null, id, title: id, step: 'review', red: false, effort, startedAt: 1000, state, label: 'unattended' });
  const rows = (n, p) => Array.from({ length: n }, (_, i) => ({ key: `${p}${i}`, tag: null, id: `${p}${i}`, title: `${p}${i}`, meta: '', checks: 0 }));
  const view = (o) => modes.viewOf({ live: null, story: story(), prep: null, pins: null, started: null, title: '', now: 0, ...o });

  // Which view: the first that fits.
  assert.strictEqual(modes.modeOf({ live: live(), story: story(), prep: { startedAt: 1 } }), 'pull');
  assert.strictEqual(modes.modeOf({ live: live({ unattended: true }), story: story({ work: [work('a')] }), prep: null }), 'brew');
  assert.strictEqual(modes.modeOf({ live: live({ unattended: true }), story: story(), prep: null }), 'brew', 'an unattended run is a brew');
  assert.strictEqual(modes.modeOf({ live: live({ command: 'brew', id: null, phase: 'starting' }), story: story(), prep: null }), 'brew');
  assert.strictEqual(modes.modeOf({ live: null, story: story({ work: [work('a')] }), prep: { startedAt: 1 } }), 'brew');
  assert.strictEqual(modes.modeOf({ live: null, story: story({ work: [work('a', 'stopped')] }), prep: null }), 'rest', 'a stopped run is not a brew');
  assert.strictEqual(modes.modeOf({ live: null, story: story(), prep: { startedAt: 1 } }), 'prep');
  assert.strictEqual(modes.modeOf({ live: null, story: story(), prep: null }), 'rest');

  // Brew: two done, the cards, two next, the rest a count.
  const brew = view({ mode: 'brew', story: story({ done: rows(5, 'd'), work: [work('w')], free: rows(30, 'f'), held: rows(9, 'h') }), now: 5000 });
  assert.deepStrictEqual(brew.done.map((r) => r.id), ['d3', 'd4']);
  assert.deepStrictEqual(brew.next.map((r) => r.id), ['f0', 'f1']);
  assert.strictEqual(brew.more, 37);
  assert.strictEqual(brew.head.big, '6');
  assert.strictEqual(brew.head.small, '/ 45');
  assert.strictEqual(brew.head.since, 1000);
  assert.deepStrictEqual(brew.head.strip, { n: 45, done: 5, live: 'review', red: 0 });
  assert.deepStrictEqual(brew.head.caption, ['5 pulled', '1 in review', '39 to go']);
  assert.strictEqual(brew.cards.length, 1);
  assert.deepStrictEqual([brew.cards[0].word, brew.cards[0].step, brew.cards[0].count], ['REVIEW', 'review', '4 / 5']);
  const two = view({ mode: 'brew', story: story({ work: [work('a'), work('b')] }) });
  assert.strictEqual(two.cards.length, 2, 'one card per running pull');
  assert.strictEqual(two.head.caption[1], '2 running');

  // Pull: the step, the five steps with their times, what was decided, what to test after.
  const pins = { points: [{ topic: 'Rows', question: '', ruling: 'Even' }, { topic: 'Clock', question: 'where?', ruling: null }], found: [], live: 'Clock' };
  const started = { id: 'a', startedAt: 100, steps: { plan: 240000, build: 60000 }, at: { step: 'build', since: 0 } };
  const pull = view({ mode: 'pull', live: live(), story: story({ boxes: { '/a': [{ text: 'look', how: 'open it' }] } }), pins, started, title: 'A', now: 5000 });
  assert.deepStrictEqual([pull.head.big, pull.head.step, pull.head.label, pull.head.since], ['BUILD', 'build', 'STEP 2 / 5', 100]);
  assert.deepStrictEqual(pull.feature, { id: 'a', title: 'A' });
  assert.deepStrictEqual(pull.steps.map((s) => [s.name, s.state, s.ms]), [['plan', 'done', 240000], ['build', 'current', 60000], ['prove', 'todo', null], ['review', 'todo', null], ['close', 'todo', null]]);
  assert.deepStrictEqual(pull.decided, [{ topic: 'Rows', ruling: 'Even' }]);
  assert.deepStrictEqual(pull.checks, [{ text: 'look', how: 'open it' }]);
  const stopped = view({ mode: 'pull', live: live({ phase: 'interrupted' }), started: { id: 'a', startedAt: 0 }, title: 'A', now: 5000 });
  assert.strictEqual(stopped.head.big, 'STOPPED');
  assert.strictEqual(stopped.head.step, null);
  assert.strictEqual(stopped.head.since, null, 'a stopped run has no running clock');
  assert.ok(stopped.steps.every((s) => s.state !== 'current'));

  // Prep: the points settled, open, and the facts.
  const prep = view({ mode: 'prep', prep: { startedAt: 7, id: 'R-33' }, pins: { ...pins, found: ['a fact'] }, title: 'Board' });
  assert.deepStrictEqual([prep.head.big, prep.head.small, prep.head.label, prep.head.since], ['1', '/ 2', 'POINTS SETTLED', 7]);
  assert.deepStrictEqual(prep.head.strip, { n: 2, done: 1, live: 'brass', red: 0 });
  assert.deepStrictEqual(prep.feature, { id: 'R-33', title: 'Board' });
  assert.deepStrictEqual(prep.open, [{ topic: 'Clock', question: 'where?', live: true }]);
  assert.deepStrictEqual(prep.found, ['a fact']);
  assert.strictEqual(view({ mode: 'prep', prep: { startedAt: 7, id: null } }).feature, null);

  // A record an older build wrote names the build step `code`: the card reads it as build.
  const old = view({ mode: 'brew', story: story({ work: [{ ...work('o'), effort: [{ name: 'plan', state: 'done' }, { name: 'code', state: 'current', progress: 0.5 }, { name: 'review', state: 'todo' }, { name: 'close', state: 'todo' }] }] }) });
  assert.deepStrictEqual([old.cards[0].word, old.cards[0].step, old.cards[0].effort[1].name], ['BUILD', 'build', 'build']);

  // A run that went quiet is the owner's to look at: rest lists it with what is blocked.
  const quiet = view({ mode: 'rest', story: story({ work: [{ ...work('q', 'stopped'), step: 'stopped after plan' }] }) });
  assert.deepStrictEqual(quiet.blocked.map((b) => [b.id, b.reason]), [['q', 'stopped after plan']]);
  assert.strictEqual(quiet.head.big, 'YOUR TURN');

  // Rest: whose turn it is.
  const rest = view({ mode: 'rest', story: story({ checks: [{ tag: null, id: 'a', text: 't', how: '' }], done: rows(2, 'd') }) });
  assert.deepStrictEqual([rest.head.big, rest.head.tone], ['YOUR TURN', 'you']);
  assert.strictEqual(view({ mode: 'rest' }).head.big, 'READY');

  // The chip above the prompt, one per view; nothing at all to say, no chip.
  assert.deepStrictEqual([modes.chipOf(brew).label, modes.chipOf(brew).word, modes.chipOf(brew).step], ['BREW 6 / 45 · w', 'REVIEW', 'review']);
  assert.deepStrictEqual([modes.chipOf(pull).label, modes.chipOf(pull).word], ['PULL 2 / 5 · a', 'BUILD']);
  assert.deepStrictEqual([modes.chipOf(prep).label, modes.chipOf(prep).word, modes.chipOf(prep).tone], ['PREP · R-33', '1 / 2 SETTLED', 'brass']);
  assert.deepStrictEqual([modes.chipOf(rest).word, modes.chipOf(rest).tone], ['YOUR TURN · 1', 'you']);
  assert.strictEqual(modes.chipOf(view({ mode: 'rest' })), null);

  console.log('board-modes.test.js: all checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
