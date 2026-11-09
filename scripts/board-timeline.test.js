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

  // branchOrBaseView: off the base branch tells the branch's story; on it, only what is open.
  {
    const b = t.timelineOf([repo('api', [done('api-order-title'), done('old')], brew({ ids: ['api-order-title'] }))], { now: 0 });
    assert.strictEqual(b.view, 'branch');
    assert.deepStrictEqual(b.done.groups.map((g) => [g.flight, g.rows.map((r) => r.id)]), [['f', ['api-order-title']]], 'only what this branch built');
    const m = t.timelineOf([repo('api', [done('api-order-title')], { head: 'main', base: 'main' })], { now: 0 });
    assert.strictEqual(m.view, 'base');
    assert.strictEqual(m.done, null);
    // No base found: on base, and the foot says so.
    const u = t.timelineOf([repo('api', [planned('p1')], { head: 'feature/x', base: null })], { now: 0 });
    assert.strictEqual(u.view, 'base');
  }

  // doneGroupedByFlight: one flight across two repos is one group, in repo then roadmap order.
  {
    const api = repo('api', [done('a1', { flight: 'bf' }), done('a2', { flight: 'other' })], brew({ ids: ['a1', 'a2'], runs: [{ id: 'a1', command: 'pull', ms: 31 * 60000, endedAt: 5, split: null }] }));
    const web = repo('web', [done('w1', { flight: 'bf' })], brew({ ids: ['w1'] }));
    const tl = t.timelineOf([api, web], { now: 0 });
    assert.deepStrictEqual(tl.done.groups.map((g) => [g.flight, g.rows.map((r) => `${r.tag}:${r.id}`)]), [['bf', ['api:a1', 'web:w1']], ['other', ['api:a2']]]);
    assert.strictEqual(tl.done.groups[0].rows[0].meta, '31m');
    assert.strictEqual(tl.done.total, 3);
    // Capped at five rows, the rest counted.
    const many = repo(null, ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'].map((id) => done(id)), brew({ ids: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'] }));
    const capped = t.timelineOf([many], { now: 0 });
    assert.strictEqual(capped.done.groups.flatMap((g) => g.rows).length, 5);
    assert.strictEqual(capped.done.more, 2);
    assert.strictEqual(capped.done.groups[0].rows[0].tag, null, 'a single repo has no tags');
  }

  // sameIdTwoRepos: two rows, two tags, each opening its own repo's plan.
  {
    const two = t.timelineOf([repo('api', [planned('dup')]), repo('web', [planned('dup')])], { now: 0 });
    assert.deepStrictEqual(two.startNow.rows.map((r) => [r.tag, r.id]), [['api', 'dup'], ['web', 'dup']]);
    assert.deepStrictEqual(two.startNow.rows[1].open, { kind: 'feature', id: 'dup', folder: 'web' });
  }

  // crossRepoDepends: a done sibling frees the row; an open one holds it; a missing one is never done.
  {
    const api = repo('api', [done('api-order-title'), planned('api-open')]);
    const web = repo('web', [planned('web-order-title'), planned('web-flat'), planned('web-x')], { plans: {
      'web-order-title': { depends: ['api/api-order-title'], blockers: [] },
      'web-flat': { depends: ['api/api-open'], blockers: [] },
      'web-x': { depends: ['nope/y'], blockers: [] },
    } });
    const tl = t.timelineOf([api, web], { now: 0 });
    assert.deepStrictEqual(tl.startNow.rows.map((r) => [r.id, r.detail]), [['api-open', 'next'], ['web-order-title', 'api half done']]);
    assert.deepStrictEqual(tl.next.rows.map((r) => [r.tag, r.id, r.detail]), [['web', 'web-flat', 'waits for api/api-open'], ['web', 'web-x', 'waits for nope/y (not found)']]);
    // A single repo resolves a sibling through `siblings` (the web session opened alone).
    const alone = t.timelineOf([{ ...web, folder: null }], { now: 0, siblings: { api: { 'api-order-title': 'done', 'api-open': 'planned' } } });
    assert.strictEqual(alone.startNow.rows[0].id, 'web-order-title');
    assert.strictEqual(alone.startNow.rows[0].tag, null);
  }

  // needsYou: blocked rows and done rows with open checks, tagged, three at most.
  {
    const api = repo('api', [blocked('b1', 'waiting on Anatol: the API doc'), blocked('b2', 'x'), done('h1')], { checks: { h1: [{ done: false, text: 'a', how: '' }] } });
    const web = repo('web', [blocked('b3', 'held')]);
    const tl = t.timelineOf([api, web], { now: 0 });
    assert.strictEqual(tl.needs.total, 4);
    assert.deepStrictEqual(tl.needs.rows.map((r) => `${r.tag}:${r.id}`), ['api:b1', 'api:b2', 'api:h1']);
    assert.strictEqual(tl.needs.more, 1);
    assert.strictEqual(tl.needs.rows[0].detail, 'waits on Anatol');
  }

  // atWork: another session's record, labelled by its repo; a stopped one says so; this
  // session's own record wins over its own file; an ended unattended run leaves the idle line.
  {
    const web = repo('web', [planned('web-order-title', { title: 'Bestelltitel' }), planned('web-lnw-number')], { ...brew({ head: 'feature/brew-2026-10-29', ids: [] }), plans: { 'web-order-title': { depends: ['api/api-order-title'], blockers: [] } }, atWork: { state: 'running', rec: rec('web-order-title') } });
    const api = repo('api', [done('api-order-title'), blocked('b1', 'x')], { ...brew({ ids: ['api-order-title'] }), atWork: { state: 'ended', rec: rec('api-order-title', { endedAt: 9 }) } });
    const tl = t.timelineOf([api, web], { now: 0 });
    assert.strictEqual(tl.atWork.length, 1);
    const w = tl.atWork[0];
    assert.deepStrictEqual([w.tag, w.id, w.title, w.step, w.state], ['web', 'web-order-title', 'Bestelltitel', 'code', 'running']);
    assert.strictEqual(w.label, 'session “web: brew” · unattended');
    assert.strictEqual(w.waited, 'waited on api/api-order-title, done');
    assert.strictEqual(w.startedAt, 10);
    assert.ok(!tl.startNow.rows.some((r) => r.id === 'web-order-title'), 'the feature at work is not also free');
    assert.strictEqual(tl.startNow.rows[0].glyph, 'planned', 'no `next` mark while something is at work');
    assert.deepStrictEqual(tl.idle, [{ folder: 'api', needYou: 1 }]);
    // Stopped: no clock, what it stopped after and how long ago.
    const st = t.timelineOf([repo('web', [planned('w')], { atWork: { state: 'stopped', rec: rec('w', { beat: 0 }) } })], { now: 2 * 3600000 });
    assert.strictEqual(st.atWork[0].state, 'stopped');
    assert.strictEqual(st.atWork[0].step, 'stopped after plan · 2h00m ago');
    // This session's own record replaces what its file says.
    const own = rec('w', { session: 's1', step: 'review' });
    const mine = t.timelineOf([repo(null, [planned('w')], { atWork: { state: 'running', rec: rec('w', { session: 's1' }) } })], { now: 0, session: 's1', own: { folder: null, rec: own } });
    assert.strictEqual(mine.atWork.length, 1);
    assert.strictEqual(mine.atWork[0].step, 'review');
  }

  // foot: one line per repo in the branch view; one line after the merge.
  {
    const api = repo('api', [done('a1'), blocked('b', 'x')], brew({ ids: ['a1'] }));
    const web = repo('web', [planned('w')], { ...brew({ head: 'feature/brew-2026-10-29', age: '11 days', ids: [] }), atWork: { state: 'running', rec: rec('w') } });
    const plat = repo('platform', [done('p')], { head: 'main', base: 'main' });
    const odd = repo('odd', [planned('o')], { head: 'feature/x', base: null });
    const tl = t.timelineOf([api, web, plat, odd], { now: 0 });
    assert.deepStrictEqual(tl.foot, [
      { tag: 'api', branch: 'feature/brew-2026-10-28', note: '12 days · suite green' },
      { tag: 'web', branch: 'feature/brew-2026-10-29', note: '11 days · brewing' },
      { tag: 'platform', branch: 'main', note: 'nothing open' },
      { tag: 'odd', branch: 'feature/x', note: 'base unknown' },
    ]);
    const merged = t.timelineOf([repo('api', [planned('a')], { head: 'main', base: 'main' }), repo('web', [], { head: 'main', base: 'main' })], { now: 0 });
    assert.deepStrictEqual(merged.foot, [{ tag: null, branch: 'api, web on their base branch', note: 'nothing brewing' }]);
    const single = t.timelineOf([repo(null, [planned('a')], brew({ head: 'feature/brew-2026-11-09', age: 'today', ids: [] }))], { now: 0 });
    assert.deepStrictEqual(single.foot, [{ tag: null, branch: 'feature/brew-2026-11-09', note: 'today · suite green' }]);
  }

  // messages: no roadmap anywhere, or a single unreadable one.
  {
    assert.strictEqual(t.timelineOf([], { now: 0 }).kind, 'message');
    const bad = repo(null, []);
    bad.board.error = 'no-roadmap';
    assert.strictEqual(t.timelineOf([bad], { now: 0 }).kind, 'message');
  }

  // band: who brews (tagged at a folder), how many need you; a finished brew; idle.
  {
    const web = repo('web', [planned('w'), blocked('b', 'x')], { ...brew({ ids: [] }), atWork: { state: 'running', rec: rec('w') } });
    const api = repo('api', [planned('a')], { ...brew({ ids: [] }), atWork: { state: 'running', rec: rec('a', { step: 'review' }) } });
    assert.deepStrictEqual(t.timelineBandOf([api, web], { now: 0 }).running.parts.map((p) => [p.tag, p.id, p.step]), [['api', 'a', 'review'], ['web', 'w', 'code']]);
    assert.strictEqual(t.timelineBandOf([api, web], { now: 0 }).running.needYou, 1);
    const fin = t.timelineBandOf([repo('api', [done('a1'), done('a2')], brew({ ids: ['a1', 'a2'] })), repo('web', [done('w1')], brew({ ids: ['w1'] }))], { now: 0 });
    assert.deepStrictEqual(fin, { finished: { done: 3, branches: 2, needYou: 0 } });
    const idle = t.timelineBandOf([repo('web', [planned('w1'), planned('w2')], { head: 'main', base: 'main' })], { now: 0 });
    assert.deepStrictEqual(idle, { idle: { next: { tag: 'web', id: 'w1' }, canStart: 2, needYou: 0 } });
    assert.strictEqual(t.timelineBandOf([], { now: 0 }), null);
  }

  // pages: a feature opens from its own repo; +N more opens the queue or the done list.
  {
    const tl = [repo('api', [planned('dup', { title: 'API' })]), repo('web', [planned('dup', { title: 'WEB' })])];
    assert.strictEqual(t.pageOf(tl, { kind: 'feature', id: 'dup', folder: 'web' }, { now: 0 }).title, 'WEB');
    assert.strictEqual(t.pageOf(tl, { kind: 'feature', id: 'gone', folder: 'web' }, { now: 0 }), null);
    assert.strictEqual(t.pageOf(tl, { kind: 'queue' }, { now: 0 }).kind, 'queue');
  }

  console.log('board-timeline.test.js: all checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
