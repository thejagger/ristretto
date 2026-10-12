#!/usr/bin/env node
// Self-check for hooks/board-runs.mjs — run with: node scripts/board-runs.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const r = await import(pathToFileURL(path.join(__dirname, '..', 'hooks', 'board-runs.mjs')).href);
  const live = (id, command = 'brew') => ({ command, id, phase: 'coding', round: 0, since: 0, gate: null, armed: true });

  // A run follows the feature the fold says is running.
  let t = r.track(null, live('f-1'), 100);
  assert.deepStrictEqual([t.run.id, t.run.startedAt, t.ended], ['f-1', 100, null]);
  let run = r.addTokens(t.run, { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 300 });
  run = r.addGate(r.addGate(run, 60000, true), 90000, false);
  assert.deepStrictEqual([run.tokens, run.gates], [{ in: 1300, out: 200, cache: 5000 }, { runs: 2, ms: 150000, red: 1 }]);
  assert.strictEqual(r.track(run, live('f-1'), 200).run, run, 'the same feature keeps its run');

  // The next feature's brief closes the previous run; the end of the run closes it too.
  t = r.track(run, live('f-2'), 400);
  assert.deepStrictEqual([t.ended.id, t.run.id], ['f-1', 'f-2']);
  const rec = r.endRun(t.ended, 400, 'done');
  assert.deepStrictEqual([rec.ms, rec.status, rec.gates.ms, 'usd' in rec], [300, 'done', 150000, false]);
  assert.deepStrictEqual(r.track(t.run, null, 500).ended.id, 'f-2');
  assert.deepStrictEqual(r.track(null, null, 1), { run: null, ended: null });
  assert.strictEqual(r.track(null, { ...live(null), id: null }, 1).run, null, 'no feature known yet: nothing to measure');
  assert.deepStrictEqual([r.count(845), r.count(12400), r.count(1250000)], ['845', '12k', '1.3M']);

  // Records are kept to the last 200; the trend is gate minutes per run, oldest first.
  let recs = [];
  for (let i = 0; i < 205; i++) recs = r.keep(recs, { id: `f-${i}`, gates: { ms: i * 60000 } });
  assert.deepStrictEqual([recs.length, recs[0].id], [200, 'f-5']);
  assert.deepStrictEqual(r.trend(recs, 3), [202, 203, 204]);

  // Where a run's time went, phase by phase, from the fold's phase changes. A fix round is code.
  const ph = (phase, id = 'f-9') => ({ ...live(id), phase });
  const min = 60000;
  let pr = r.track(null, ph('planning'), 0).run;
  pr = r.markPhase(pr, ph('planning'), 0);
  pr = r.markPhase(pr, ph('coding'), 4 * min);
  pr = r.markPhase(pr, ph('coding'), 10 * min);
  pr = r.markPhase(pr, ph('review'), 18 * min);
  pr = r.markPhase(pr, ph('fixing'), 21 * min);
  pr = r.markPhase(pr, ph('review'), 24 * min);
  pr = r.markPhase(pr, ph('closing'), 27 * min);
  const prec = r.endRun(pr, 30 * min, 'done');
  assert.deepStrictEqual(prec.phases, { plan: 4 * min, code: 17 * min, review: 6 * min, close: 3 * min });
  assert.strictEqual(prec.at, undefined, 'the open mark is not kept');
  assert.deepStrictEqual(r.splitOf(prec).map((x) => [x.phase, x.ms / min]), [['plan', 4], ['code', 17], ['review', 6], ['close', 3]]);

  // shot has no plan step; a run recorded before 0.21 has no split.
  assert.deepStrictEqual(r.splitOf({ ms: 7, phases: { plan: 0, code: 5, review: 0, close: 2 } }).map((x) => x.phase), ['code', 'close']);
  assert.strictEqual(r.splitOf({ ms: 1000 }), null);
  assert.strictEqual(r.splitOf({ ms: 1000, phases: { plan: 0, code: 0, review: 0, close: 0 } }), null);

  // An interruption stops the clock of the phase it interrupted; another feature's phase never counts.
  let ir = r.markPhase(r.track(null, ph('coding'), 0).run, ph('coding'), 0);
  ir = r.markPhase(ir, ph('interrupted'), 5 * min);
  ir = r.markPhase(ir, ph('interrupted'), 50 * min);
  assert.strictEqual(ir.phases.code, 5 * min);
  let other = r.markPhase(r.track(null, ph('coding'), 0).run, ph('coding'), 0);
  other = r.markPhase(other, ph('review', 'f-10'), 3 * min);
  assert.strictEqual(other.phases.code, 3 * min);
  assert.strictEqual(other.phases.review, 0);

  console.log('board-runs.test.js: all checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
