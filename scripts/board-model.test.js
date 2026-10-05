#!/usr/bin/env node
// Self-check for hooks/board-model.mjs — run with: node scripts/board-model.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');

// The pane's view, read the way a person reads it: the commands it offers, and everything it says.
function startActions(v) {
  const out = [];
  const walk = (x) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== 'object') return;
    if (x.action && x.action.command) out.push(x.action);
    Object.values(x).forEach(walk);
  };
  walk(v);
  return out;
}
const shown = (v) => JSON.stringify(v);

(async () => {
  const m = await import(pathToFileURL(path.join(ROOT, 'hooks', 'board-model.mjs')).href);

  // 1. Roadmap parse. Rows copied from real roadmaps (vs-ruprechtshofen; immo-wert's older
  //    column set without Tier, its free-text status cell; a retired row). Columns are found
  //    by header name because real roadmaps order and omit them differently.
  {
    const current = [
      '# Ristretto Roadmap',
      '<!-- ristretto-format: 0.17 -->',
      '',
      '| Flight | Feature | Title | Tier | Status | Plan | Updated | Files touched | Commit |',
      '|--------|---------|-------|------|--------|------|---------|---------------|--------|',
      '| vs-ruprechtshofen | pw-foundation | ProcessWire dev stack, vendored core, deploy layout | normal | needs-review | [plans/archived/pw-foundation.md](plans/archived/pw-foundation.md) | 2026-09-02 | `.gitignore` | `713a2d6` |',
      '| vs-ruprechtshofen | nb-anmeldung | Public Nachmittagsbetreuung sign-up | normal | done | [plans/archived/nb-anmeldung.md](plans/archived/nb-anmeldung.md) | 2026-09-03 | | |',
      '| — | pw-galerie | Galerie \\| Alben | easy | planned | [plans/pw-galerie.md](plans/pw-galerie.md) | 2026-10-01 | | |',
      '| — | pw-kalender | Termine aus dem Ferienplan | normal | blocked — no source for Ferienplan | [plans/pw-kalender.md](plans/pw-kalender.md) | 2026-10-01 | | |',
    ].join('\n');
    const r = m.parseRoadmap(current);
    assert.strictEqual(r.error, null);
    assert.strictEqual(r.format, '0.17');
    assert.deepStrictEqual(r.rows.map((x) => x.id), ['pw-foundation', 'nb-anmeldung', 'pw-galerie', 'pw-kalender']);
    assert.deepStrictEqual(r.rows.map((x) => x.status), ['needs-review', 'done', 'planned', 'blocked']);
    assert.strictEqual(r.rows[0].flight, 'vs-ruprechtshofen');
    assert.strictEqual(r.rows[2].flight, '', 'a — flight is no flight');
    assert.strictEqual(r.rows[2].tier, 'easy');
    assert.strictEqual(r.rows[2].title, 'Galerie | Alben', 'an escaped pipe stays in the title');
    assert.strictEqual(r.rows[3].reason, 'no source for Ferienplan');
    assert.deepStrictEqual(r.rows.map((x) => x.commit), ['713a2d6', '', '', ''], 'the Commit column, backticks dropped');

    // CRLF must parse exactly like LF — Windows checkouts write it.
    assert.deepStrictEqual(m.parseRoadmap(current.replace(/\n/g, '\r\n')), r, 'CRLF parses like LF');

    const older = [
      '| Flight | Feature | Title | Status | Plan | Updated |',
      '| — | fork-ecolaw-base | Fork into immo-wert | needs-human — compose + browser check pending, see manual-checks.md | x | 2026-08-25 |',
      '| — | old-thing | Retired | done—**retired** | x | 2026-08-01 |',
      '| — | odd | Odd | parked | x | 2026-08-01 |',
    ].join('\n');
    const o = m.parseRoadmap(older);
    assert.strictEqual(o.format, null, 'an unstamped roadmap has no format');
    assert.deepStrictEqual(o.rows.map((x) => x.status), ['needs-human', 'done', 'unknown']);
    assert.strictEqual(o.rows[0].tier, 'normal', 'no Tier column reads as normal');
    assert.strictEqual(o.rows[0].reason, 'compose + browser check pending, see manual-checks.md');
    assert.strictEqual(o.rows[2].reason, 'parked', 'an unknown status keeps its raw text');

    assert.strictEqual(m.parseRoadmap('# Ristretto Roadmap\n\nnothing yet\n').error, 'no-table');
  }

  // 2. Brief prefixes are read out of the command files themselves, so rewording a brief
  //    turns this red instead of silently blanking the pane's phase.
  {
    const briefs = [];
    for (const file of ['brew.md', 'pull.md', 'shot.md']) {
      for (const line of fs.readFileSync(path.join(ROOT, 'commands', file), 'utf8').split(/\r?\n/)) {
        if (/^\s*>\s*(PLANNER|IMPLEMENTER|REVIEWER|CLOSER) for ristretto feature/.test(line)) {
          briefs.push({ file, line: line.replace(/<FEATURE-ID>/g, 'f-1') });
        }
      }
    }
    const roles = new Set();
    for (const { file, line } of briefs) {
      const got = m.parseBrief(line);
      assert.ok(got, `${file}: brief not recognised: ${line}`);
      assert.strictEqual(got.id, 'f-1', `${file}: id not read from: ${line}`);
      roles.add(got.role);
    }
    assert.deepStrictEqual([...roles].sort(), ['closer', 'fixer', 'implementer', 'planner', 'reviewer'],
      'brew.md must still carry a brief for every role the pane shows');
    // The prompt the model sends has no leading "> ".
    assert.deepStrictEqual(m.parseBrief('REVIEWER for ristretto feature **pw-galerie**.\nDiff: x'), { role: 'reviewer', id: 'pw-galerie' });
    assert.strictEqual(m.parseBrief('Explore the repo for ristretto usages'), null);

    // Reviewer verdicts are read out of briefs/reviewer.md for the same reason.
    const verdicts = fs.readFileSync(path.join(ROOT, 'briefs', 'reviewer.md'), 'utf8')
      .split(/\r?\n/).filter((l) => /^- `review: /.test(l)).map((l) => /`([^`]+)`/.exec(l)[1]);
    assert.ok(verdicts.length >= 3, 'briefs/reviewer.md must still list its verdict lines');
    for (const v of verdicts) assert.ok(m.parseReport('reviewer', `findings...\n${v}`), `verdict not recognised: ${v}`);
    assert.strictEqual(m.parseReport('reviewer', 'review: blocking (2)'), 'blocking');
    assert.strictEqual(m.parseReport('reviewer', 'review: notes-only (1 note, 0 lean)'), 'clean');
    assert.strictEqual(m.parseReport('planner', 'planned: .ristretto/build/f-1.md'), 'planned');
    assert.strictEqual(m.parseReport('planner', 'blocked: no source'), 'blocked');
    assert.strictEqual(m.parseReport('closer', 'anything'), 'closed');
    assert.strictEqual(m.parseReport('reviewer', 'still thinking'), null);

    // The report sits in handbackReport when the subagent handed back, else in content.
    assert.strictEqual(m.reportText({ result: { handbackReport: { text: 'review: clean' }, content: [{ type: 'text', text: 'see message' }] } }), 'review: clean');
    assert.strictEqual(m.reportText({ result: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }), 'a\nb');
    assert.strictEqual(m.reportText({ result: { status: 'async_launched' } }), '', 'a background agent has no report yet');
    assert.strictEqual(m.reportText(undefined), '');
  }

  // 3. The fold: what the pane believes about the running feature, one observation at a time.
  {
    const run = (steps, start = null) => steps.reduce((live, [obs, now]) => m.fold(live, obs, now), start);

    // pull, normal tier, red gate, one blocking review, then clean, then disarm.
    let live = run([
      [{ kind: 'command', command: 'pull', args: 'f-1' }, 0],
      [{ kind: 'marker', state: 'mine' }, 1],
      [{ kind: 'brief', role: 'planner', id: 'f-1' }, 2],
    ]);
    assert.deepStrictEqual([live.command, live.id, live.phase, live.armed, live.since], ['pull', 'f-1', 'planning', true, 2]);
    live = run([
      [{ kind: 'report', role: 'planner', verdict: 'planned' }, 10],
      [{ kind: 'gate-start' }, 20],
    ], live);
    assert.strictEqual(live.phase, 'coding', 'pull implements in the main thread after a planned: report');
    assert.deepStrictEqual(live.gate, { since: 20, red: false });
    live = m.fold(live, { kind: 'gate-end', red: true }, 30);
    assert.deepStrictEqual(live.gate, { since: 20, red: true }, 'a red gate stays drawn');
    live = run([
      [{ kind: 'gate-start' }, 40],
      [{ kind: 'gate-end', red: false }, 50],
      [{ kind: 'brief', role: 'reviewer', id: 'f-1' }, 60],
    ], live);
    assert.strictEqual(live.gate, null, 'a green gate clears');
    assert.deepStrictEqual([live.phase, live.round], ['review', 1]);
    live = m.fold(live, { kind: 'report', role: 'reviewer', verdict: 'blocking' }, 70);
    assert.strictEqual(live.phase, 'fixing');
    live = run([
      [{ kind: 'brief', role: 'reviewer', id: 'f-1' }, 80],
      [{ kind: 'report', role: 'reviewer', verdict: 'clean' }, 90],
    ], live);
    assert.deepStrictEqual([live.phase, live.round], ['closing', 2]);
    assert.strictEqual(m.fold(live, { kind: 'marker', state: 'none' }, 99), null, 'disarm ends the run');

    // pull next: the id is learned from the first brief.
    live = run([[{ kind: 'command', command: 'pull', args: 'next' }, 0]]);
    assert.strictEqual(live.id, null);
    assert.strictEqual(m.fold(live, { kind: 'brief', role: 'planner', id: 'f-2' }, 1).id, 'f-2');

    // A command that stops before arming (refusal, format stop) clears at its turn's end.
    live = run([[{ kind: 'command', command: 'shot', args: 'f-3' }, 0]]);
    assert.strictEqual(live.armed, false);
    assert.strictEqual(m.fold(live, { kind: 'marker', state: 'none' }, 1).phase, 'starting', 'not armed yet: an absent marker is not an end');
    assert.strictEqual(m.fold(live, { kind: 'main-turn-end' }, 2), null);

    // brew with background subagents: no reports reach the hook, briefs alone advance it.
    live = run([
      [{ kind: 'command', command: 'brew', args: '' }, 0],
      [{ kind: 'marker', state: 'mine' }, 1],
      [{ kind: 'main-turn-end' }, 2],
      [{ kind: 'brief', role: 'planner', id: 'f-1' }, 3],
      [{ kind: 'brief', role: 'implementer', id: 'f-1' }, 4],
      [{ kind: 'brief', role: 'reviewer', id: 'f-1' }, 5],
      [{ kind: 'brief', role: 'fixer', id: 'f-1' }, 6],
      [{ kind: 'brief', role: 'reviewer', id: 'f-1' }, 7],
    ]);
    assert.ok(live, 'an armed brew survives its orchestrator turn ending');
    assert.deepStrictEqual([live.id, live.phase, live.round], ['f-1', 'review', 2]);
    live = run([
      [{ kind: 'brief', role: 'closer', id: 'f-1' }, 8],
      [{ kind: 'brief', role: 'planner', id: 'f-2' }, 9],
    ], live);
    assert.deepStrictEqual([live.id, live.phase, live.round], ['f-2', 'planning', 0], 'a new feature resets the round');
    live = m.fold(live, { kind: 'report', role: 'closer', verdict: 'closed' }, 10);
    assert.deepStrictEqual([live.id, live.phase], [null, 'starting'], 'between brew features');

    // A run of this session's found armed with nothing seen (a hot reload mid-run).
    live = m.fold(null, { kind: 'marker', state: 'mine' }, 5);
    assert.deepStrictEqual([live.command, live.id, live.phase, live.armed], [null, null, null, true]);
    // Nothing running: gates, reports and turn ends change nothing.
    for (const obs of [{ kind: 'gate-start' }, { kind: 'gate-end', red: true }, { kind: 'main-turn-end' }, { kind: 'marker', state: 'none' }]) {
      assert.strictEqual(m.fold(null, obs, 1), null);
    }
  }

  // 4. The view: only what a red run would mean to a user — the bar's arithmetic, which command
  //    a button starts, that no button can start a second run, and what the run card says.
  {
    assert.deepStrictEqual(m.bar(0, 0, 10), { filled: 0, empty: 10 });
    assert.deepStrictEqual(m.bar(4, 10, 10), { filled: 4, empty: 6 });
    assert.deepStrictEqual(m.bar(1, 3, 10), { filled: 3, empty: 7 }, 'proportional, rounded to the nearest cell');
    assert.deepStrictEqual(m.bar(10, 10, 10), { filled: 10, empty: 0 });
    assert.deepStrictEqual([m.elapsed(45000), m.elapsed(362000), m.elapsed(3780000)], ['45s', '6m02s', '1h03m']);

    const row = (id, tier, status, reason = '') => ({ flight: '', id, title: id, tier, status, reason });
    const board = { name: 'demo', rows: [row('a', 'easy', 'planned'), row('b', 'normal', 'planned'), row('c', 'normal', 'done'), row('k', 'normal', 'blocked', 'no source')], format: { project: '0.17', plugin: '0.17.0' }, error: null };

    assert.deepStrictEqual(startActions(m.view(board, null, 0)), [
      { label: 'brew all', command: 'ristretto:brew', args: '' },
      { label: 'start', command: 'ristretto:shot', args: 'a' },
      { label: 'start', command: 'ristretto:pull', args: 'b' },
    ], 'the tier picks the command');

    const running = m.fold(null, { kind: 'brief', role: 'reviewer', id: 'b' }, 0);
    const v = m.view(board, running, 1000);
    assert.deepStrictEqual(startActions(v), [], 'nothing can be started while a run is active');
    assert.deepStrictEqual([v.now.id, v.now.status, v.now.clock], ['b', 'review r1', '1s'], 'the run card shows phase, round and time');
    assert.deepStrictEqual(v.now.steps.map((x) => x.state), ['done', 'done', 'current', 'todo'], 'plan and code behind it, close ahead');

    const reloaded = m.fold(null, { kind: 'marker', state: 'mine' }, 0);
    assert.deepStrictEqual(startActions(m.view(board, reloaded, 0)), [], 'an armed run with nothing seen yet hides the buttons too');
    assert.ok(/a run is active/.test(shown(m.view(board, reloaded, 0))));

    assert.deepStrictEqual(m.view({ ...board, rows: [], error: 'no-roadmap' }, null, 0), { kind: 'message', text: 'no roadmap here — /ristretto:prep starts one' });

    // Done rows fold into one line until asked for; what needs a person stays in view with its reason.
    const folded = m.view(board, null, 0);
    assert.deepStrictEqual([folded.done.count, folded.done.rows.length, folded.done.more], [1, 1, 0], 'up to five done rows show');
    assert.ok(/no source/.test(shown(folded)), 'a blocked row shows why');
    assert.ok(!folded.sections.some((sec) => sec.groups.some((g) => g.rows.some((r) => r.id === 'c'))), 'done rows are not in the open sections');
  }

  // 5. Final-review findings, each pinned where it was found.
  {
    const row = (id, tier, status) => ({ flight: '', id, title: id, tier, status, reason: '' });
    const board = { name: 'demo', rows: [row('a', 'easy', 'planned'), row('c', 'normal', 'done')], format: { project: '0.17', plugin: '0.17.0' }, error: null };

    // Unasked, the pane opens only where the layout docks it beside the transcript.
    assert.strictEqual(m.docks({ columns: 200, rows: 50, isFullscreen: true }), true);
    assert.strictEqual(m.docks({ columns: 200, rows: 50, isFullscreen: false }), false, 'the main screen would place it inline');
    assert.strictEqual(m.docks({ columns: 200, rows: 50 }), false, 'unknown is not docked');
    assert.strictEqual(m.docks(undefined), false);

    // The marker's owner decides whose run it is; gate.js ages a marker out after 24 h idle.
    const DAY = 24 * 60 * 60 * 1000;
    assert.strictEqual(m.markerState(null, null, 's1'), 'none');
    assert.strictEqual(m.markerState('s1', 1000, 's1'), 'mine');
    assert.strictEqual(m.markerState('', 1000, 's1'), 'unclaimed');
    assert.strictEqual(m.markerState('s2', 1000, 's1'), 'other');
    assert.strictEqual(m.markerState('s2', DAY + 1, 's1'), 'none', 'a stale marker is no run');
    assert.strictEqual(m.markerState('s1', DAY + 1, 's1'), 'none');

    // A pull refused because another session holds the marker: nothing armed here, cleared at turn end.
    let live = m.fold(null, { kind: 'command', command: 'pull', args: 'f-1' }, 0);
    live = m.fold(live, { kind: 'marker', state: 'other' }, 1);
    assert.strictEqual(live.armed, false, "another session's marker never arms this session's run");
    assert.strictEqual(m.fold(live, { kind: 'main-turn-end' }, 2), null);
    // An unclaimed marker arms a run this session started, and nothing else.
    assert.strictEqual(m.fold(live, { kind: 'marker', state: 'unclaimed' }, 1).armed, true);
    assert.strictEqual(m.fold(null, { kind: 'marker', state: 'unclaimed' }, 1), null);
    assert.strictEqual(m.fold(null, { kind: 'marker', state: 'mine' }, 1).armed, true);
    // A mine marker that goes away (disarm, or aged out) ends the run.
    const armed = m.fold(live, { kind: 'marker', state: 'mine' }, 3);
    assert.strictEqual(m.fold(armed, { kind: 'marker', state: 'none' }, 4), null);
    assert.strictEqual(m.fold(armed, { kind: 'marker', state: 'other' }, 4), null);

    // Another session's run: no buttons, one line, and no cup over it.
    const elsewhere = m.view(board, null, 0, true);
    assert.deepStrictEqual(startActions(elsewhere), []);
    assert.ok(/a run is active in another session/.test(shown(elsewhere)));

    // Esc mid-run: the clock stops and the row says so instead of counting for hours.
    const coding = m.fold(armed, { kind: 'brief', role: 'implementer', id: 'f-1' }, 10);
    const stopped = m.fold(coding, { kind: 'main-turn-end', interrupted: true }, 20);
    assert.strictEqual(stopped.phase, 'interrupted');
    const sheet = { ...board, rows: [...board.rows, row('f-1', 'normal', 'planned')] };
    const card = m.view(sheet, stopped, 99999).now;
    assert.deepStrictEqual([card.status, card.clock], ['interrupted', ''], 'no running clock on an interrupted run');
    assert.strictEqual(m.fold(m.fold(live, { kind: 'command', command: 'shot', args: 'x' }, 0), { kind: 'main-turn-end', interrupted: true }, 1), null,
      'interrupted before arming is no run at all');

    // A closer that has not reported (background, error, denied) has not closed anything.
    assert.strictEqual(m.parseReport('closer', ''), null);
    assert.strictEqual(m.parseReport('closer', 'closed done · commit abc123'), 'closed');

    // A red gate belongs to the agent that stopped, not to the next one.
    const red = m.fold(m.fold(coding, { kind: 'gate-start' }, 11), { kind: 'gate-end', red: true }, 12);
    assert.strictEqual(m.fold(red, { kind: 'brief', role: 'reviewer', id: 'f-1' }, 13).gate, null);

    // shot has no planner: arming is where its coding starts.
    let shot = m.fold(null, { kind: 'command', command: 'shot', args: 'a' }, 0);
    shot = m.fold(shot, { kind: 'marker', state: 'mine' }, 5);
    assert.deepStrictEqual([shot.phase, shot.since], ['coding', 5]);
    const pull = m.fold(m.fold(null, { kind: 'command', command: 'pull', args: 'a' }, 0), { kind: 'marker', state: 'mine' }, 5);
    assert.strictEqual(pull.phase, 'starting', 'pull waits for its planner');

    // A roadmap with no table points at prep, like a missing one.
    assert.deepStrictEqual(m.view({ ...board, rows: [], error: 'no-table' }, null, 0), { kind: 'message', text: 'no roadmap here — /ristretto:prep starts one' });

    // Every row done while brew still proves the suite: the run stays visible, the cup waits.
    const allDone = { ...board, rows: [row('c', 'normal', 'done')] };
    assert.strictEqual(m.view(allDone, null, 0).kind, 'cup');
    const proving = m.fold(null, { kind: 'command', command: 'brew', args: '' }, 0);
    assert.strictEqual(m.view(allDone, proving, 0).kind, 'board', 'no cup while a run is active');
    assert.strictEqual(m.view(allDone, null, 0, true).kind, 'board', 'nor while another session runs');
  }

  // 6. Tessera's shape: blocked rows say why, and a long list reads by flight.
  {
    const roadmap = [
      '| Flight | Feature | Title | Tier | Status | Plan | Updated |',
      '|---|---|---|---|---|---|---|',
      '| nodes-sync | nodes-connector | Windmill holt Stammdaten | normal | blocked | [plan](plans/nodes-connector.md) | 2026-10-03 |',
      '| nodes-sync | nodes-invoice-draft | Rechnungsentwurf | normal | blocked | plans/nodes-invoice-draft.md | 2026-10-03 |',
      '| lnw | lnw-core | LNW erfassen | normal | planned | [plan](plans/lnw-core.md) | 2026-10-03 |',
      '| mail | mail-outbound | E-Mail-Versand | normal | planned | [plan](plans/mail-outbound.md) | 2026-10-03 |',
      '| lnw | lnw-checks | LNW-Prüfung | normal | planned | [plan](plans/lnw-checks.md) | 2026-10-03 |',
      '',
      '## Blockiert',
      '',
      '- **nodes-connector** — waiting on Anatol: Nodes API docs, auth, test access',
    ].join('\n');
    const r = m.parseRoadmap(roadmap);
    assert.deepStrictEqual(r.rows.map((x) => x.plan), ['plans/nodes-connector.md', 'plans/nodes-invoice-draft.md', 'plans/lnw-core.md', 'plans/mail-outbound.md', 'plans/lnw-checks.md'],
      'the plan link, written as a markdown link or a bare path');
    assert.strictEqual(r.rows[0].reason, 'waiting on Anatol: Nodes API docs, auth, test access', "the roadmap's own note under the table");
    assert.strictEqual(r.rows[1].reason, '', 'no note: the plan is read for it');

    // The plan's Blockers block: inline, or its first item; a dash is none.
    assert.strictEqual(m.blockerOf('## Contract\n- Blockers:\n  - Notes API documentation → Anatol\n  - second\n\n## Approach'), 'Notes API documentation → Anatol');
    assert.strictEqual(m.blockerOf('- Blockers: write API unknown → Anatol\n'), 'write API unknown → Anatol');
    assert.strictEqual(m.blockerOf('- Blockers: —\n'), null);
    assert.strictEqual(m.blockerOf('no blockers line at all'), null);
    assert.strictEqual(m.blockerOf('- Blockers:\r\n  - CRLF item\r\n'), 'CRLF item');

    // Rows group by flight inside each section, in roadmap order.
    const v = m.view({ name: 'tessera', ...r, format: { project: null, plugin: '' } }, null, 0);
    const next = v.sections.find((sec) => sec.key === 'up-next');
    assert.deepStrictEqual(next.groups.map((g) => [g.flight, g.rows.map((x) => x.id)]), [['lnw', ['lnw-core', 'lnw-checks']], ['mail', ['mail-outbound']]]);
    assert.deepStrictEqual(v.sections.find((sec) => sec.key === 'needs-you').groups.map((g) => g.flight), ['nodes-sync']);
    const loose = m.view({ name: 't', rows: [{ flight: '', id: 'rbac', title: 'x', tier: 'normal', plan: '', status: 'planned', reason: '' }, ...r.rows], format: { project: null, plugin: '' }, error: null }, null, 0);
    assert.deepStrictEqual(loose.sections.find((sec) => sec.key === 'up-next').groups.map((g) => g.flight), ['lnw', 'mail', ''], 'rows without a flight come last, as in /ristretto:status');
  }

  // 7. The overview: what a row waits on, what an open row says, and what happened.
  {
    const row = (id, status, extra = {}) => ({ flight: '', id, title: id, tier: 'normal', plan: `plans/${id}.md`, commit: '', status, reason: '', ...extra });
    const board = { name: 't', format: { project: null, plugin: '' }, error: null, rows: [
      row('core', 'done', { commit: 'abc1234' }), row('old', 'done'), row('mid', 'done'),
      row('a', 'planned'), row('b', 'planned'), row('k', 'blocked', { reason: 'no API' }), row('rv', 'needs-review'),
    ] };
    const plans = {
      a: { acceptance: [{ auto: true, text: 'A works' }], depends: ['core'], blockers: [], evidence: [], review: null, gate: null, findings: [] },
      b: { acceptance: [], depends: ['a', 'ghost'], blockers: [], evidence: [], review: null, gate: null, findings: [] },
      k: { acceptance: [], depends: [], blockers: ['API docs → Anatol', 'write API → Anatol'], evidence: [], review: null, gate: null, findings: [] },
      rv: { acceptance: [], depends: [], blockers: [], evidence: [], review: 'review: needs-review · rounds: 3', gate: null, findings: ['bug · x.php:1 · wrong'] },
      core: { acceptance: [{ auto: true, text: 'boots' }, { auto: false, text: 'cert trusted' }], depends: [], blockers: [], evidence: [{ criteria: [1], proof: 'test_boot' }], review: 'review: clean · rounds: 1', gate: 'exit 0', findings: [] },
    };
    const runs = [
      { id: 'mid', startedAt: 0, endedAt: 100, ms: 100, usd: 1, tokens: { in: 1, out: 1, cache: 0 }, gates: { runs: 1, ms: 60000, red: 0 }, status: 'done' },
      { id: 'core', startedAt: 200, endedAt: 900, ms: 700, usd: 2, tokens: { in: 1, out: 1, cache: 0 }, gates: { runs: 2, ms: 120000, red: 1 }, status: 'done' },
    ];
    const v = m.view(board, null, 0, false, { plans, runs });

    // Waiting: b depends on an unbuilt a and on a name not on the roadmap; a's dependency is done.
    const next = v.sections.find((s) => s.key === 'up-next').groups.flatMap((g) => g.rows);
    const b = next.find((x) => x.id === 'b');
    assert.deepStrictEqual(b.waiting, [{ id: 'a', status: 'planned' }, { id: 'ghost', status: 'missing' }]);
    assert.strictEqual(b.action, undefined, 'a waiting row cannot be started');
    assert.strictEqual(b.tag, 'waits on');
    assert.ok(next.find((x) => x.id === 'a').action, 'a row whose dependencies are built can');

    // Status segments for the summary bar, in a fixed order, empty ones left out.
    assert.deepStrictEqual(v.summary.segments.map((s) => [s.status, s.n]), [['done', 3], ['needs-review', 1], ['blocked', 1], ['planned', 2]]);

    // What happened: newest run first, rows without a record after, in reverse roadmap order.
    assert.deepStrictEqual(v.done.rows.map((x) => x.id), ['core', 'mid', 'old']);
    assert.deepStrictEqual([v.done.rows[0].run.usd, v.done.rows[2].run], [2, null]);
    assert.deepStrictEqual(v.done.trend, [1, 2]);

    // One row open at a time, each saying what its status needs said.
    const opened = (id) => {
      const w = m.view(board, null, 0, false, { plans, runs, open: id });
      return [...w.sections.flatMap((s) => s.groups.flatMap((g) => g.rows)), ...w.done.rows].find((x) => x.id === id);
    };
    assert.strictEqual(next.find((x) => x.id === 'a').details, undefined, 'closed rows carry no details');
    const da = opened('a').details;
    assert.deepStrictEqual([da.deps, da.acceptance[0].proof], [[{ id: 'core', status: 'done', ok: true }], null]);
    const dk = opened('k').details;
    assert.deepStrictEqual([dk.blockers.length, dk.action], [2, { label: 'refine', command: 'ristretto:prep', args: 'k deep' }]);
    const drv = opened('rv').details;
    assert.deepStrictEqual([drv.findings, drv.action.command, drv.action.args], [['bug · x.php:1 · wrong'], 'ristretto:pull', 'rv']);
    const dcore = opened('core').details;
    assert.deepStrictEqual(dcore.acceptance.map((x) => x.proof), ['test_boot', null], 'each criterion with its proof');
    assert.deepStrictEqual([dcore.commit, dcore.run.gates.red, dcore.review], ['abc1234', 1, 'review: clean · rounds: 1']);
    const dold = opened('old').details;
    plans.mid = { ...plans.core, evidence: [], itemised: false };
    assert.strictEqual(opened('mid').details.unitemised, true, 'prose Evidence: said so, not drawn as nothing proved');
    assert.strictEqual(dcore.unitemised, false);
    // immo-wert writes Plan cells repo-relative.
    assert.strictEqual(m.parseRoadmap(['| Feature | Status | Plan |', '|---|---|---|', '| x | planned | [plan](docs/ristretto/plans/x.md) |'].join('\n')).rows[0].plan, 'plans/x.md');
    assert.deepStrictEqual([dold.missing, dold.run], [true, null], 'no plan read: said so, nothing invented');

    // No action from an open row while a run is active.
    const busy = m.view(board, null, 0, true, { plans, runs, open: 'k' });
    assert.strictEqual(busy.sections.flatMap((s) => s.groups.flatMap((g) => g.rows)).find((x) => x.id === 'k').details.action, undefined);
  }

  console.log('board-model.test.js: all checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
