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

  // Records are kept to the last 200.
  let recs = [];
  for (let i = 0; i < 205; i++) recs = r.keep(recs, { id: `f-${i}`, gates: { ms: i * 60000 } });
  assert.deepStrictEqual([recs.length, recs[0].id], [200, 'f-5']);

  // Where a run's time went, phase by phase, from the fold's phase changes. A fix round is review
  // (spec 0.3 #9: the effort bar keeps fixing inside review, so the split does too).
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
  assert.deepStrictEqual(prec.phases, { plan: 4 * min, code: 14 * min, review: 9 * min, close: 3 * min });
  assert.strictEqual(prec.at, undefined, 'the open mark is not kept');
  assert.deepStrictEqual(r.splitOf(prec).map((x) => [x.phase, x.ms / min]), [['plan', 4], ['code', 14], ['review', 9], ['close', 3]]);

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

  // A feature's runs add up: a check re-run after the manual checks must not replace the build.
  {
    const build = { id: 'cam', command: 'pull', startedAt: 0, endedAt: 960000, ms: 960000, status: 'needs-human',
      tokens: { in: 500000, out: 40000, cache: 9000 }, gates: { runs: 3, ms: 200000, red: 1 },
      phases: { plan: 120000, code: 600000, review: 180000, close: 60000 } };
    const check = { id: 'cam', command: 'pull', startedAt: 5000000, endedAt: 5120000, ms: 120000, status: 'done',
      tokens: { in: 30000, out: 2000, cache: 0 }, gates: { runs: 1, ms: 40000, red: 0 },
      phases: { plan: 0, code: 0, review: 0, close: 120000 } };
    const other = { id: 'x', command: 'shot', startedAt: 100, endedAt: 200, ms: 100, status: 'done', tokens: { in: 1, out: 1, cache: 0 }, gates: { runs: 0, ms: 0, red: 0 } };
    const merged = r.mergeRuns([build, other, check]);
    assert.deepStrictEqual([...merged.keys()], ['x', 'cam'], 'one entry per feature, ordered by its last run');
    const cam = merged.get('cam');
    assert.deepStrictEqual(
      [cam.runs, cam.ms, cam.status, cam.startedAt, cam.endedAt, cam.tokens, cam.gates, cam.phases],
      [2, 1080000, 'done', 0, 5120000, { in: 530000, out: 42000, cache: 9000 }, { runs: 4, ms: 240000, red: 1 }, { plan: 120000, code: 600000, review: 180000, close: 180000 }],
    );
    assert.deepStrictEqual(r.splitOf(cam).map((s) => [s.phase, s.ms]), [['plan', 120000], ['code', 600000], ['review', 180000], ['close', 180000]]);
    assert.strictEqual(merged.get('x').runs, 1);
    assert.strictEqual(merged.get('x').phases, undefined, 'a run recorded before phases existed stays without a split');
    // One unmeasured run among measured ones: the split is of what was measured, the time is all of it.
    const mixed = r.mergeRuns([{ ...other, id: 'cam' }, check]).get('cam');
    assert.deepStrictEqual([mixed.ms, mixed.phases.close], [120100, 120000]);
  }

  assert.strictEqual(r.BUCKET.fixing, 'review', 'a fix round counts as review');

  // Roles: who works on a feature, on which model, for how long. A new role closes the open one.
  let roles = r.addRole({}, { id: 'a', role: 'planner', round: 0 }, 'claude-opus-5-5', 1000);
  roles = r.addRole(roles, { id: 'a', role: 'reviewer', round: 2 }, 'claude-opus-5-5', 5000);
  assert.deepStrictEqual(roles.a.map((x) => [x.role, x.model, x.startedAt, x.endedAt]), [['planner', 'Opus 5.5', 1000, 5000], ['reviewer r2', 'Opus 5.5', 5000, null]]);
  assert.strictEqual(r.addRole({}, { id: 'b', role: 'reviewer', round: 1 }, 'sonnet', 0).b[0].role, 'reviewer', 'round 1 needs no number');
  // A finished agent's own duration corrects the open role's end; it never ends past now.
  roles = r.closeRole(roles, 'a', 2000, 9000);
  assert.strictEqual(roles.a[1].endedAt, 7000);
  assert.strictEqual(r.closeRole(roles, 'zz', 1, 1), roles, 'an unknown feature changes nothing');
  assert.strictEqual(r.closeRole(r.addRole({}, { id: 'c', role: 'closer', round: 0 }, 'haiku', 100), 'c', 99999, 500).c[0].endedAt, 500);
  // Model names a person reads.
  assert.strictEqual(r.modelName('claude-opus-5-5'), 'Opus 5.5');
  assert.strictEqual(r.modelName('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.strictEqual(r.modelName('claude-sonnet-5-5'), 'Sonnet 5.5');
  assert.strictEqual(r.modelName('sonnet[1m]'), 'Sonnet');
  assert.strictEqual(r.modelName('opus'), 'Opus');
  assert.strictEqual(r.modelName('gpt-x'), 'gpt-x');
  assert.strictEqual(r.modelName(''), '—');
  assert.strictEqual(r.modelName(undefined), '—');
  // The model a spawn ran on: the resolved id, else the alias the Agent call named, else nothing
  // (spec 4.8: the role and its time still show, the model as a dash).
  assert.strictEqual(r.spawnModel({ model: 'claude-opus-5-5' }, 'opus'), 'claude-opus-5-5');
  assert.strictEqual(r.spawnModel({}, 'sonnet'), 'sonnet');
  assert.strictEqual(r.spawnModel(undefined, undefined), '');
  assert.strictEqual(r.modelName(r.spawnModel({}, 'haiku')), 'Haiku');

  console.log('board-runs.test.js: all checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
