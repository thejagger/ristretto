#!/usr/bin/env node
// Self-check for hooks/board-timeline.mjs — run with: node scripts/board-timeline.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const t = await import(pathToFileURL(path.join(__dirname, '..', 'hooks', 'board-timeline.mjs')).href);

  const row = (id, status, more = {}) => ({ flight: 'f', id, title: id.toUpperCase(), tier: 'normal', plan: `plans/${id}.md`, commit: '', status, reason: '', ...more });
  const planned = (id, more) => row(id, 'planned', more);
  const done = (id, more) => row(id, 'done', more);
  const blocked = (id, reason, more) => row(id, 'blocked', { reason, ...more });
  // A repo as board.tsx hands it over. `head` off `base` is a brew branch; `ids` its features.
  const repo = (folder, rows, o = {}) => ({
    folder,
    board: { name: folder || 'pomalo', rows, format: { project: '0.23', plugin: '0.23' }, error: null, plans: o.plans || {}, checks: o.checks || {}, decisions: {} },
    branch: o.head ? { name: o.head, base: o.base === undefined ? 'main' : o.base, ids: o.ids || null, lastBrew: '', onDefault: o.head === (o.base === undefined ? 'main' : o.base) } : null,
    suite: o.suite || { state: 'green', text: 'suite green', failing: '' },
    runs: o.runs || [],
    atWork: o.atWork || { state: 'none', rec: null },
    age: o.age || null,
  });
  const brew = (o) => ({ head: 'feature/brew-2026-10-28', base: 'main', age: '12 days', ...o });
  const rec = (id, o = {}) => ({ v: 1, session: 'other', id, command: 'pull', unattended: true, title: '', startedAt: 10, phase: 'coding', step: 'code', red: false, effort: [{ name: 'plan', state: 'done' }, { name: 'code', state: 'current', progress: 0.5 }, { name: 'review', state: 'todo' }, { name: 'close', state: 'todo' }], beat: 10, endedAt: null, ...o });

  // branchOrBaseView: off the base branch, what the branch built is done here; on it, nothing.
  {
    const b = t.storyOf([repo('api', [done('api-order-title'), done('old')], brew({ ids: ['api-order-title'] }))], { now: 0 });
    assert.strictEqual(b.view, 'branch');
    assert.deepStrictEqual(b.done.map((r) => r.id), ['api-order-title'], 'only what this branch built');
    const m = t.storyOf([repo('api', [done('api-order-title')], { head: 'main', base: 'main' })], { now: 0 });
    assert.deepStrictEqual([m.view, m.done.length], ['base', 0]);
    // No base found: on base.
    assert.strictEqual(t.storyOf([repo('api', [planned('p1')], { head: 'feature/x', base: null })], { now: 0 }).view, 'base');
    // Not a git repo (no branch at all) is never folded into the branch view's done rows.
    const nogit = repo('odd', [done('o')]);
    assert.deepStrictEqual(t.storyOf([repo('api', [planned('a')], brew({ ids: [] })), nogit], { now: 0 }).done, []);
  }

  // done: repo then roadmap order, each with its build time; a single repo has no tags.
  {
    const api = repo('api', [done('a1', { flight: 'bf' }), done('a2', { flight: 'other' })], brew({ ids: ['a1', 'a2'], runs: [{ id: 'a1', command: 'pull', ms: 31 * 60000, endedAt: 5, split: null }] }));
    const web = repo('web', [done('w1', { flight: 'bf' })], brew({ ids: ['w1'] }));
    const st = t.storyOf([api, web], { now: 0 });
    assert.deepStrictEqual(st.done.map((r) => `${r.tag}:${r.id}`), ['api:a1', 'api:a2', 'web:w1']);
    assert.strictEqual(st.done[0].meta, '31m');
    assert.strictEqual(t.storyOf([repo(null, [done('d1')], brew({ ids: ['d1'] }))], { now: 0 }).done[0].tag, null);
  }

  // crossRepoDepends: a done sibling frees the row; an open one holds it; a missing one is never done.
  {
    const api = repo('api', [done('api-order-title'), planned('api-open')]);
    const web = repo('web', [planned('web-order-title'), planned('web-flat'), planned('web-x')], { plans: {
      'web-order-title': { depends: ['api/api-order-title'], blockers: [] },
      'web-flat': { depends: ['api/api-open'], blockers: [] },
      'web-x': { depends: ['nope/y'], blockers: [] },
    } });
    const st = t.storyOf([api, web], { now: 0 });
    assert.deepStrictEqual(st.free.map((r) => [r.tag, r.id]), [['api', 'api-open'], ['web', 'web-order-title']]);
    assert.deepStrictEqual(st.held.map((r) => [r.tag, r.id, r.detail]), [['web', 'web-flat', 'waits for api/api-open'], ['web', 'web-x', 'waits for nope/y (not found)']]);
    // A single repo resolves a sibling through `siblings` (the web session opened alone).
    const alone = t.storyOf([{ ...web, folder: null }], { now: 0, siblings: { api: { 'api-order-title': 'done', 'api-open': 'planned' } } });
    assert.deepStrictEqual([alone.free[0].id, alone.free[0].tag], ['web-order-title', null]);
  }

  // The owner's turn: blocked rows with their reason, and every open check, tagged.
  {
    const api = repo('api', [blocked('b1', 'waiting on Anatol: the API doc'), blocked('b2', 'x'), done('h1')], { checks: { h1: [{ done: false, text: 'a', how: '' }] } });
    const web = repo('web', [blocked('b3', 'held')]);
    const st = t.storyOf([api, web], { now: 0 });
    assert.deepStrictEqual(st.blocked.map((r) => `${r.tag}:${r.id}`), ['api:b1', 'api:b2', 'web:b3']);
    assert.strictEqual(st.blocked[0].reason, 'waits on Anatol');
    assert.deepStrictEqual(st.checks.map((c) => `${c.tag}:${c.id}:${c.text}`), ['api:h1:a']);
  }

  // atWork: another session's record, labelled by its repo; a stopped one says so; this
  // session's own record wins over its own file; an ended run is not at work.
  {
    const web = repo('web', [planned('web-order-title', { title: 'Bestelltitel' }), planned('web-lnw-number')], { ...brew({ head: 'feature/brew-2026-10-29', ids: [] }), plans: { 'web-order-title': { depends: ['api/api-order-title'], blockers: [] } }, atWork: { state: 'running', rec: rec('web-order-title') } });
    const api = repo('api', [done('api-order-title'), blocked('b1', 'x')], { ...brew({ ids: ['api-order-title'] }), atWork: { state: 'ended', rec: rec('api-order-title', { endedAt: 9 }) } });
    const st = t.storyOf([api, web], { now: 0 });
    assert.strictEqual(st.work.length, 1);
    const w = st.work[0];
    assert.deepStrictEqual([w.tag, w.id, w.title, w.step, w.state], ['web', 'web-order-title', 'Bestelltitel', 'code', 'running']);
    assert.strictEqual(w.label, 'unattended');
    assert.strictEqual(w.waited, 'waited on api/api-order-title, done');
    assert.strictEqual(w.startedAt, 10);
    assert.ok(!st.free.some((r) => r.id === 'web-order-title'), 'the feature at work is not also free');
    // Stopped: what it stopped after, and since when.
    const stop = t.storyOf([repo('web', [planned('w')], { atWork: { state: 'stopped', rec: rec('w', { beat: 0 }) } })], { now: 2 * 3600000 });
    assert.deepStrictEqual([stop.work[0].state, stop.work[0].step, stop.work[0].since], ['stopped', 'stopped after plan', 0]);
    // This session's own record replaces what its file says.
    const own = rec('w', { session: 's1', step: 'review' });
    const mine = t.storyOf([repo(null, [planned('w')], { atWork: { state: 'running', rec: rec('w', { session: 's1' }) } })], { now: 0, session: 's1', own: { folder: null, rec: own } });
    assert.deepStrictEqual([mine.work.length, mine.work[0].step], [1, 'review']);
  }

  // messages: no roadmap anywhere, or a single unreadable one.
  {
    assert.ok(t.messageOf([]));
    const bad = repo(null, []);
    bad.board.error = 'no-roadmap';
    assert.ok(t.messageOf([bad]).includes('/ristretto:prep'));
    assert.strictEqual(t.messageOf([repo(null, [planned('a')])]), null);
  }

  // v1 storyOf: the facts every view draws from.
  {
    const checks = { tested: [{ done: false, text: 'open the pane', how: 'during a brew' }, { done: true, text: 'old', how: '' }] };
    const one = repo(null, [done('tested'), done('plain'), blocked('stuck', 'waiting on Anatol'), planned('p1'), planned('p2', { tier: 'easy' })],
      { head: 'feature/brew-x', ids: ['tested', 'plain'], checks, runs: [{ id: 'plain', ms: 120000, endedAt: 5, status: 'done', startedAt: 1, command: 'pull', tokens: { in: 0, out: 0, cache: 0 }, gates: { runs: 0, ms: 0, red: 0 } }] });
    one.board.decisions = { plain: [{ taken: true, text: 'Even rows → time in the strip' }, { taken: false, text: 'still open' }] };
    const st = t.storyOf([one], { now: 0 });
    assert.strictEqual(st.view, 'branch');
    assert.deepStrictEqual(st.done.map((r) => [r.id, r.title, r.checks]), [['tested', 'TESTED', 1], ['plain', 'PLAIN', 0]], 'a done feature with an open check stays done');
    assert.strictEqual(st.done[1].meta, '2m');
    assert.deepStrictEqual(st.checks, [{ tag: null, id: 'tested', text: 'open the pane', how: 'during a brew' }]);
    assert.deepStrictEqual(st.blocked.map((b) => [b.id, b.reason]), [['stuck', 'waiting on Anatol']]);
    assert.deepStrictEqual(st.taken, [{ tag: null, id: 'plain', text: 'Even rows → time in the strip' }]);
    assert.deepStrictEqual(st.free.map((r) => [r.id, r.title]), [['p1', 'P1'], ['p2', 'P2']]);
    assert.strictEqual(st.boxes['/p1'], undefined, 'a plan with no boxes has none');
    assert.deepStrictEqual(st.boxes['/tested'], [{ text: 'open the pane', how: 'during a brew' }]);
    assert.ok(!JSON.stringify(st).includes('"open":{'), 'no page to open');

    // sameIdTwoRepos: two tagged rows, never merged.
    const two = t.storyOf([repo('api', [planned('dup')]), repo('web', [planned('dup')])], { now: 0 });
    assert.deepStrictEqual(two.free.map((r) => [r.tag, r.id]), [['api', 'dup'], ['web', 'dup']]);
    // On the base branch nothing is done here, but an open check still waits for the owner.
    const base = t.storyOf([repo(null, [done('tested')], { head: 'main', checks })], { now: 0 });
    assert.deepStrictEqual([base.view, base.done.length, base.checks.length], ['base', 0, 1]);
  }

  console.log('board-timeline.test.js: all checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
