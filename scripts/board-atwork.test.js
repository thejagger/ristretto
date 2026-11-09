#!/usr/bin/env node
// Self-check for hooks/board-atwork.mjs — run with: node scripts/board-atwork.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const a = await import(pathToFileURL(path.join(__dirname, '..', 'hooks', 'board-atwork.mjs')).href);

  assert.strictEqual(a.HEARTBEAT_MS, 60000);
  assert.strictEqual(a.STALE_MS, 900000);

  // recordOf: what the pulling session leaves for the folder board; nothing without a feature.
  const live = { id: 'web-order-title', command: 'pull', unattended: true, phase: 'coding', round: 0, since: 5, armed: true, gate: null };
  const r = a.recordOf(live, { session: 's1', title: 'Bestelltitel', now: 100 });
  assert.strictEqual(r.v, 1);
  assert.strictEqual(r.id, 'web-order-title');
  assert.strictEqual(r.session, 's1');
  assert.strictEqual(r.unattended, true);
  assert.strictEqual(r.step, 'code');
  assert.strictEqual(r.red, false);
  assert.strictEqual(r.beat, 100);
  assert.strictEqual(r.startedAt, 100);
  assert.strictEqual(r.endedAt, null);
  assert.deepStrictEqual(r.effort.map((p) => p.state), ['done', 'current', 'todo', 'todo']);
  assert.strictEqual(a.recordOf(null, { session: 's1', title: '', now: 1 }), null);
  assert.strictEqual(a.recordOf({ ...live, id: null }, { session: 's1', title: '', now: 1 }), null);
  // The same feature keeps the time it started; another feature starts again.
  assert.strictEqual(a.recordOf({ ...live, phase: 'review' }, { session: 's1', title: '', now: 500, prev: r }).startedAt, 100);
  assert.strictEqual(a.recordOf({ ...live, id: 'other' }, { session: 's1', title: '', now: 500, prev: r }).startedAt, 500);

  // sameShown ignores the heartbeat; needsBeat after a minute.
  assert.ok(a.sameShown(r, { ...r, beat: 999 }));
  assert.ok(!a.sameShown(r, { ...r, step: 'review' }));
  assert.ok(!a.sameShown(r, null));
  assert.ok(!a.needsBeat(r, 100 + a.HEARTBEAT_MS - 1));
  assert.ok(a.needsBeat(r, 100 + a.HEARTBEAT_MS));

  // judge: running while the heartbeat is fresh and the marker is the record's; stopped when it
  // went quiet, the marker is gone or another session owns the pull now; ended once closed.
  assert.strictEqual(a.judge(r, { owner: 's1', markerExists: true, now: 100 + a.STALE_MS - 1 }).state, 'running');
  assert.strictEqual(a.judge(r, { owner: '', markerExists: true, now: 101 }).state, 'running');
  assert.strictEqual(a.judge(r, { owner: 's1', markerExists: true, now: 100 + a.STALE_MS }).state, 'stopped');
  assert.strictEqual(a.judge(r, { owner: null, markerExists: false, now: 101 }).state, 'stopped');
  assert.strictEqual(a.judge(r, { owner: 's2', markerExists: true, now: 101 }).state, 'stopped');
  const ended = a.endedOf(r, 200);
  assert.strictEqual(ended.endedAt, 200);
  assert.strictEqual(a.judge(ended, { owner: null, markerExists: false, now: 300 }).state, 'ended');
  assert.strictEqual(a.judge(null, { owner: null, markerExists: false, now: 1 }).state, 'none');
  assert.strictEqual(a.judge({ v: 2 }, { owner: null, markerExists: false, now: 1 }).state, 'none', 'an unknown record shape is no record');

  console.log('board-atwork.test.js: all checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
