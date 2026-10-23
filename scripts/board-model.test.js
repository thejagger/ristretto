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
    // What an action does; its key (one button per key) has its own test in section 8b.
    if (x.action && x.action.command) { const { key, ...does } = x.action; out.push(does); }
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
    assert.deepStrictEqual(r.rows.map((x) => x.status), ['unknown', 'done', 'planned', 'blocked'], 'needs-review is no status since 0.22');
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
      '| — | fork-ecolaw-base | Fork into immo-wert | blocked — compose + browser check pending | x | 2026-08-25 |',
      '| — | old-thing | Retired | done—**retired** | x | 2026-08-01 |',
      '| — | odd | Odd | parked | x | 2026-08-01 |',
    ].join('\n');
    const o = m.parseRoadmap(older);
    assert.strictEqual(o.format, null, 'an unstamped roadmap has no format');
    assert.deepStrictEqual(o.rows.map((x) => x.status), ['blocked', 'done', 'unknown']);
    assert.strictEqual(o.rows[0].tier, 'normal', 'no Tier column reads as normal');
    assert.strictEqual(o.rows[0].reason, 'compose + browser check pending');
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

  // 4. The view: what a red run would mean to a user — the text helpers, the cards in order, no
  //    buttons anywhere, and what a run card says.
  {
    assert.deepStrictEqual([m.elapsed(45000), m.elapsed(362000), m.elapsed(3780000)], ['45s', '6m02s', '1h03m']);
    // A finished span drops the seconds the running clock keeps.
    assert.deepStrictEqual([m.duration(45000), m.duration(2160000), m.duration(3900000)], ['45s', '36m', '1h05m']);
    // Plan Markdown becomes styled segments; a row's one line drops the markers.
    assert.deepStrictEqual(m.inline('**Intake:** opens `x.ts` and **stays'), [{ text: 'Intake:', bold: true }, { text: ' opens ' }, { text: 'x.ts', code: true }, { text: ' and **stays' }]);
    assert.strictEqual(m.plain('waits on `modifiedSince` and **docs**'), 'waits on modifiedSince and docs');
    assert.ok(!('bar' in m), 'the v2 cell bar is gone');

    const row = (id, tier, status, reason = '') => ({ flight: '', id, title: id, tier, status, reason, commit: '', touched: [] });
    const board = { name: 'demo', rows: [row('a', 'easy', 'planned'), row('b', 'normal', 'planned'), row('c', 'normal', 'done'), row('k', 'normal', 'blocked', 'no source')], format: { project: '0.17', plugin: '0.17.0' }, error: null };
    const branch = { name: 'brew/x', base: 'main', ids: ['c'], lastBrew: 'last brew today 13:13' };
    const suite = { state: 'green', text: 'suite green', failing: '' };

    // Idle: Branch, Needs you, Up next, Done; no actions anywhere.
    let v = m.view(board, null, false, { branch, suite });
    assert.deepStrictEqual([v.kind, v.state, v.cards.map((c) => c.kind)], ['board', 'idle', ['branch', 'needs', 'next', 'done']]);
    assert.deepStrictEqual(startActions(v), [], 'the person acts in the chat');
    assert.ok(!/"action"/.test(shown(v)));
    const bc = v.cards[0];
    assert.deepStrictEqual([bc.branch, bc.features, bc.done, bc.ready, bc.footer], ['brew/x', 1, 1, true, 'suite green · last brew today 13:13']);
    assert.ok(!/ahead/.test(shown(v)), 'never "ahead of" anything');
    assert.ok(/no source/.test(shown(v)), 'a blocked row shows why');

    // Running: Brewing first, the Branch card compact, Done on one line.
    const running = m.fold(null, { kind: 'brief', role: 'reviewer', id: 'b' }, 0);
    v = m.view(board, running, false, { branch, suite, drawnAt: 1000 });
    assert.deepStrictEqual([v.state, v.cards.map((c) => c.kind)], ['running', ['brewing', 'branch', 'needs', 'done']]);
    assert.deepStrictEqual([v.cards[1].compact, v.cards[3].compact, v.cards[3].rows], [true, true, []]);
    const w = v.cards[0];
    assert.deepStrictEqual([w.inset.id, w.inset.status, w.inset.effort.phases.map((x) => x.state)], ['b', 'review', ['done', 'done', 'current', 'todo']], 'plan and code behind it, close ahead');

    const reloaded = m.fold(null, { kind: 'marker', state: 'mine' }, 0);
    assert.strictEqual(m.view(board, reloaded, false, {}).cards[0].text, 'starting', 'an armed run with nothing seen yet');

    assert.deepStrictEqual(m.view({ ...board, rows: [], error: 'no-roadmap' }, null, false), { kind: 'message', text: 'no roadmap here — /ristretto:prep starts one' });

    // No base: the card says so, nothing is scoped, every needs-* row needs you, Recently done.
    v = m.view(board, null, false, { branch: { name: 'x', base: null, ids: null, lastBrew: '' }, suite });
    assert.deepStrictEqual([v.cards[0].footer, v.cards[0].scoped, v.cards[0].ready], ['no main branch to compare with', false, false]);
    assert.strictEqual(v.cards.find((c) => c.kind === 'done').recent, true);
    // On the default branch with no remote there is nothing to compare with, and it says so
    // without claiming there is no main branch (final review).
    v = m.view(board, null, false, { branch: { name: 'main', base: null, ids: null, lastBrew: '', onDefault: true }, suite });
    assert.strictEqual(v.cards[0].footer, 'on main · nothing to compare with');
    // Every row done but the full suite red on this code: no cup, the red suite holds the branch.
    const allDone = { ...board, rows: [row('c', 'normal', 'done')] };
    const red = { state: 'red', text: 'full suite · red · test', failing: 'test' };
    v = m.view(allDone, null, false, { branch, suite: red });
    assert.strictEqual(v.kind, 'board', 'a red suite is never hidden by the cup');
    assert.strictEqual(v.cards[0].holds[0].id, 'full suite');
    assert.strictEqual(m.view(allDone, null, false, { branch, suite }).kind, 'cup', 'green: the cup');
    // Not a git repo: no Branch card at all.
    assert.strictEqual(m.view(board, null, false, {}).cards[0].kind, 'needs');
  }

  // 5. Final-review findings, each pinned where it was found.
  {
    const row = (id, tier, status) => ({ flight: '', id, title: id, tier, status, reason: '', commit: '', touched: [] });
    const board = { name: 'demo', rows: [row('a', 'easy', 'planned'), row('c', 'normal', 'done')], format: { project: '0.17', plugin: '0.17.0' }, error: null };

    // The pane never opens unasked: the band above the prompt is the way to it (owner, 2026-10-12).
    const boardTsx = fs.readFileSync(path.join(ROOT, 'hooks', 'board.tsx'), 'utf8');
    assert.ok(!/autoOpen/i.test(boardTsx) && !('docks' in m), 'no automatic opening of the pane');

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

    // Another session's run: one line, and no cup over it.
    const elsewhere = m.view(board, null, true, {});
    assert.ok(/a run is active in another session/.test(shown(elsewhere)));
    assert.strictEqual(elsewhere.cards[0].inset, null);

    // Esc mid-run: the clock stops and the card says so instead of counting for hours.
    const coding = m.fold(armed, { kind: 'brief', role: 'implementer', id: 'f-1' }, 10);
    const stopped = m.fold(coding, { kind: 'main-turn-end', interrupted: true }, 20);
    assert.strictEqual(stopped.phase, 'interrupted');
    const sheet = { ...board, rows: [...board.rows, row('f-1', 'normal', 'planned')] };
    const inset = m.view(sheet, stopped, false, { drawnAt: 99999 }).cards[0].inset;
    assert.deepStrictEqual([inset.status, inset.elapsed.live], ['interrupted', false], 'no running clock on an interrupted run');
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
    assert.deepStrictEqual(m.view({ ...board, rows: [], error: 'no-table' }, null, false), { kind: 'message', text: 'no roadmap here — /ristretto:prep starts one' });

    // Every row done while brew still proves the suite: the run stays visible, the cup waits.
    const allDone = { ...board, rows: [row('c', 'normal', 'done')] };
    assert.strictEqual(m.view(allDone, null, false).kind, 'cup');
    const proving = m.fold(null, { kind: 'command', command: 'brew', args: '' }, 0);
    assert.strictEqual(m.view(allDone, proving, false).kind, 'board', 'no cup while a run is active');
    assert.strictEqual(m.view(allDone, null, true).kind, 'board', 'nor while another session runs');
  }

  // 6. Tessera's shape: blocked rows say why, and the queue page reads by flight.
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

    // The queue page: what waits on nothing in brew's order, then what waits, by flight, rows
    // without a flight last, as in /ristretto:status.
    const plans = { 'lnw-checks': { depends: ['lnw-core'], blockers: [], findings: [] }, rbac: { depends: ['nodes-connector'], blockers: [], findings: [] } };
    const rows = [{ flight: '', id: 'rbac', title: 'x', tier: 'normal', plan: '', status: 'planned', reason: '' }, ...r.rows];
    const q = m.view({ name: 't', rows, format: { project: null, plugin: '' }, error: null }, null, false, { plans, page: { kind: 'queue' } }).page;
    assert.deepStrictEqual([q.kind, q.back], ['queue', 'Board']);
    assert.deepStrictEqual(q.eligible.map((x) => [x.id, x.detail]), [['lnw-core', 'next'], ['mail-outbound', 'queued']]);
    assert.deepStrictEqual(q.waiting.map((g) => [g.flight, g.rows.map((x) => [x.id, x.detail])]), [['lnw', [['lnw-checks', 'waits on lnw-core']]], ['', [['rbac', 'waits on nodes-connector']]]]);
  }

  // 7. The overview: what a row waits on, what a page says, and what happened.
  {
    const row = (id, status, extra = {}) => ({ flight: '', id, title: id, tier: 'normal', plan: `plans/${id}.md`, commit: '', touched: [], status, reason: '', ...extra });
    const board = { name: 't', format: { project: null, plugin: '' }, error: null, rows: [
      row('core', 'done', { commit: 'abc1234' }), row('old', 'done'), row('mid', 'done'),
      row('a', 'planned'), row('b', 'planned'), row('k', 'blocked', { reason: 'no API' }), row('rv', 'done'),
    ] };
    const plans = {
      a: { acceptance: [{ auto: true, text: 'A works' }], depends: ['core'], blockers: [], evidence: [], review: null, gate: null, findings: [] },
      b: { acceptance: [], depends: ['a', 'ghost'], blockers: [], evidence: [], review: null, gate: null, findings: [] },
      k: { acceptance: [], depends: [], blockers: ['API docs → Anatol', 'write API → Anatol'], evidence: [], review: null, gate: null, findings: [] },
      rv: { acceptance: [], depends: [], blockers: [], evidence: [], review: 'review: needs-review · rounds: 3', gate: null, findings: ['bug · x.php:1 · wrong'] },
      core: { acceptance: [{ auto: true, text: 'boots' }, { auto: false, text: 'cert trusted' }], depends: [], blockers: [], evidence: [{ criteria: [1], proof: 'test_boot' }], review: 'review: clean · rounds: 1', gate: 'exit 0', findings: [] },
    };
    const runs = [
      { id: 'mid', startedAt: 0, endedAt: 100, ms: 100, tokens: { in: 1, out: 1, cache: 0 }, gates: { runs: 1, ms: 60000, red: 0 }, status: 'done' },
      { id: 'core', startedAt: 200, endedAt: 900, ms: 700, tokens: { in: 1, out: 1, cache: 0 }, gates: { runs: 2, ms: 120000, red: 1 }, status: 'done' },
    ];
    const v = m.view(board, null, false, { plans, runs });

    // Waiting: b depends on an unbuilt a and on a name not on the roadmap; a's dependency is done.
    const next = v.cards.find((c) => c.kind === 'next');
    assert.deepStrictEqual([next.rows.map((x) => x.id), next.waiting], [['a'], 1]);

    // What happened: newest run first, rows without a record after, in reverse roadmap order.
    const hist = m.view(board, null, false, { plans, runs, page: { kind: 'history' } }).page;
    assert.deepStrictEqual(hist.rows.map((x) => x.id), ['core', 'mid', 'old']);
    assert.deepStrictEqual([hist.rows[0].meta, hist.rows[2].meta], ['1s', '']);
    // Each done row carries its own time split — no comparison with other features.
    assert.deepStrictEqual(hist.rows.map((x) => x.split), [null, null, null], 'runs recorded without phases');
    runs[1] = { ...runs[1], phases: { plan: 100, code: 400, review: 200, close: 0 } };
    const split = m.view(board, null, false, { plans, runs, page: { kind: 'history' } }).page.rows[0].split;
    assert.deepStrictEqual(split.map((x) => [x.phase, x.ms]), [['plan', 100], ['code', 400], ['review', 200]]);

    // A page opens one feature; it goes back to the Board and offers nothing to press.
    const opened = (id, busy = false) => m.view(board, null, busy, { plans, runs, page: { kind: 'feature', id } });
    assert.strictEqual(opened('a').kind, 'page');
    const da = opened('a').page.details;
    assert.deepStrictEqual([da.deps, da.acceptance[0].proof], [[{ id: 'core', status: 'done', ok: true }], null]);
    const pk = opened('k').page;
    assert.deepStrictEqual([pk.back, pk.details.blockers.length, pk.details.action], ['Board', 2, undefined]);
    const drv = opened('rv').page.details;
    assert.deepStrictEqual([drv.findings, drv.action], [['bug · x.php:1 · wrong'], undefined]);
    const pcore = opened('core').page;
    assert.deepStrictEqual([pcore.back, pcore.split.length], ['Board', 3]);
    const dcore = pcore.details;
    assert.deepStrictEqual(dcore.acceptance.map((x) => x.proof), ['test_boot', null], 'each criterion with its proof');
    assert.deepStrictEqual([dcore.commit, dcore.run.gates.red, dcore.review], ['abc1234', 1, 'review: clean · rounds: 1']);
    const dold = opened('old').page.details;
    plans.mid = { ...plans.core, evidence: [], itemised: false };
    assert.strictEqual(opened('mid').page.details.unitemised, true, 'prose Evidence: said so, not drawn as nothing proved');
    assert.strictEqual(dcore.unitemised, false);
    // immo-wert writes Plan cells repo-relative.
    assert.strictEqual(m.parseRoadmap(['| Feature | Status | Plan |', '|---|---|---|', '| x | planned | [plan](docs/ristretto/plans/x.md) |'].join('\n')).rows[0].plan, 'plans/x.md');
    assert.deepStrictEqual([dold.missing, dold.run], [true, null], 'no plan read: said so, nothing invented');
    assert.strictEqual(m.view(board, null, false, { plans, runs, page: { kind: 'feature', id: 'gone' } }).kind, 'board', 'a page whose feature is gone falls back to the overview');
    assert.deepStrictEqual(startActions(opened('k', true)), [], 'no action on a page');
  }

  // 8. Who a blocked row waits on, and the domain facts row and page.
  {
    assert.strictEqual(m.waitsOn('waiting on Jakob: confirm the pass mark (proposal: 0 missed)'), 'waits on Jakob');
    assert.strictEqual(m.waitsOn('waiting on Anatol — Nodes write API'), 'waits on Anatol');
    assert.strictEqual(m.waitsOn('no API docs yet'), 'no API docs yet');
  }

  // 8b. Facts are information; a conflict is the only thing that needs a person.
  {
    const fact = (title, state, conflict = null, file = 'adsb-lol.md') => ({ file, title, text: `${title} text`, source: 's', state, by: '', conflict });
    const tree = [
      fact('API terms', 'unconfirmed'),
      fact('Licence', 'confirmed'),
      fact('Rate limits', 'unconfirmed', { what: '429 now carries X-RateLimit-Limit', source: 'live', by: 'review spotter-data, 2026-11-02' }),
      fact('trueNorth is magnetic on Android', 'unconfirmed', null, 'sensors.md'),
    ];
    const board = { ...m.EMPTY_BOARD, name: 'plane-spotter', rows: [{ flight: '', id: 'a', title: 'A', tier: 'normal', plan: '', commit: '', touched: [], status: 'planned', reason: '' }], format: { project: '0.20', plugin: '0.20' } };
    const v = m.view(board, null, false, { domain: { tree } });
    assert.deepStrictEqual(v.cards.find((c) => c.kind === 'facts'), { kind: 'facts', n: 4, binding: 1, conflicts: 1 }, 'the facts as one line');
    const needs = v.cards.find((c) => c.kind === 'needs');
    assert.deepStrictEqual(needs.rows.map((r) => [r.id, r.detail, r.tone]), [['Rate limits', 'adsb-lol.md · in conflict', 'warning']]);
    const calm = m.view(board, null, false, { domain: { tree: tree.filter((f) => !f.conflict) } });
    assert.strictEqual(calm.cards.find((c) => c.kind === 'needs'), undefined, 'facts without a conflict need nobody');
    assert.strictEqual(m.view(board, null, false, { domain: { tree: [] } }).cards.find((c) => c.kind === 'facts'), undefined, 'no facts: no line');

    const pg = m.view(board, null, false, { domain: { tree }, page: { kind: 'domain' } }).page;
    assert.deepStrictEqual([pg.kind, pg.back, pg.n, pg.binding, pg.conflicts], ['domain', 'Board', 4, 1, 1]);
    assert.deepStrictEqual(pg.groups.map((g) => [g.name, g.rows.map((f) => f.title)]), [
      ['adsb-lol', ['Rate limits', 'Licence', 'API terms']],
      ['sensors', ['trueNorth is magnetic on Android']],
    ], 'per file: conflicts first, then binding, then context');
    assert.ok(!('pending' in pg) && !('locked' in pg) && !('confirmed' in pg), 'nothing to confirm, commit or lock');

    // A feature blocked on a fact in conflict waits on the fact file.
    const blocked = { ...board, rows: [{ ...board.rows[0], status: 'blocked', reason: 'blocked: domain/adsb-lol.md: Rate limits is in conflict' }] };
    const row = m.view(blocked, null, false, { domain: { tree } }).cards.find((c) => c.kind === 'needs').rows[0];
    assert.strictEqual(row.detail, 'waits on domain/adsb-lol.md');
    const bp = m.view(blocked, null, false, { domain: { tree }, page: { kind: 'feature', id: 'a' } }).page;
    assert.strictEqual(bp.waitingOn, 'domain/adsb-lol.md');
    assert.strictEqual(m.factOf('waiting on Anatol: the V1.2 doc'), null);
  }

  // The Files card: the commit's files, and nothing before there is a commit (noCommitNoFiles).
  {
    const rows = [
      { flight: '', id: 'd', title: 'D', tier: 'normal', plan: '', commit: 'a7928f6', touched: ['lib/'], status: 'done', reason: '' },
      { flight: '', id: 'p', title: 'P', tier: 'normal', plan: '', commit: '', touched: ['pubspec.yaml', 'lib/data/'], status: 'planned', reason: '' },
      { flight: '', id: 'n', title: 'N', tier: 'normal', plan: '', commit: '', touched: [], status: 'planned', reason: '' },
    ];
    const board = { ...m.EMPTY_BOARD, name: 'x', rows, format: { project: '0.20', plugin: '0.20' } };
    const list = Array.from({ length: 13 }, (_, i) => ({ path: `lib/f${String(i).padStart(2, '0')}.dart`, add: 2, del: 1, bin: false }));
    // Files are read per feature (its commits by ID); ristretto's own docs ride along in the
    // feature commit now and are not what a code review reads.
    const bookkeeping = [{ path: 'docs/ristretto/roadmap.md', add: 1, del: 1, bin: false }, { path: 'docs/ristretto/plans/archived/d.md', add: 40, del: 0, bin: false }];
    const page = (id, extra = {}) => m.view(board, null, false, { page: { kind: 'feature', id }, files: { d: [...list, ...bookkeeping], n: bookkeeping }, ...extra }).page;
    const d = page('d').files;
    assert.deepStrictEqual([d.n, d.add, d.del], [13, 26, 13]);
    assert.deepStrictEqual(d.rows.map((r) => r.name), ['lib/'], 'more than 12 files: only the top level shows');
    const opened = page('d', { folders: { d: { 'lib/': true } } }).files;
    assert.strictEqual(opened.rows.length, 14, 'a folder opened by a click shows its files');
    assert.strictEqual(page('p').files, null, 'no commit yet: no card, whatever an old roadmap said it would touch');
    assert.strictEqual(page('n').files, null, 'only bookkeeping: no card');
    assert.strictEqual(m.view(board, null, false, { page: { kind: 'feature', id: 'd' } }).page.files, null, 'commits not read yet: no card');
    assert.strictEqual(m.view(board, null, false, { page: { kind: 'feature', id: 'd' }, files: { d: [] } }).page.files, null, 'no commit found: no card');
  }

  // Final review #4: a feature blocked on a fact is recognised through the roadmap, whichever
  // shape the agent wrote — `blocked: domain/…` (common.md) or `blocked — <ID> — domain/…`.
  {
    const text = [
      '| Feature | Title | Status |', '|---|---|---|',
      '| a | A | blocked: domain/adsb-lol.md: Rate limits is in conflict |',
      '| b | B | blocked — SPOT-3 — domain/sensors.md: trueNorth is in conflict |',
      '| c | C | blocked: waiting on Jakob: the pass mark |',
    ].join('\n');
    const rows = m.parseRoadmap(text).rows;
    assert.deepStrictEqual(rows.map((r) => r.reason), ['domain/adsb-lol.md: Rate limits is in conflict', 'SPOT-3 — domain/sensors.md: trueNorth is in conflict', 'waiting on Jakob: the pass mark'], 'a leading ":" is dropped like a dash');
    assert.deepStrictEqual(rows.map((r) => m.factOf(r.reason)), ['adsb-lol.md', 'sensors.md', null]);
    const v = m.view({ ...m.EMPTY_BOARD, name: 'x', rows, format: { project: '0.20', plugin: '0.20' } }, null, false, {});
    const shownRows = v.cards.find((c) => c.kind === 'needs').rows;
    assert.deepStrictEqual(shownRows.map((r) => r.detail), ['waits on domain/adsb-lol.md', 'waits on domain/sensors.md', 'waits on Jakob']);
  }

  // A check re-run adds to the build's numbers instead of replacing them.
  {
    const rows = [
      { flight: '', id: 'cam', title: 'C', tier: 'normal', plan: '', commit: '', touched: [], status: 'done', reason: '' },
      { flight: '', id: 'next', title: 'N', tier: 'normal', plan: '', commit: '', touched: [], status: 'planned', reason: '' },
    ];
    const board = { ...m.EMPTY_BOARD, name: 'x', rows, format: { project: '0.20', plugin: '0.20' } };
    const run =(startedAt, ms, phases) => ({ id: 'cam', command: 'pull', startedAt, endedAt: startedAt + ms, ms, status: 'done', tokens: { in: 10, out: 1, cache: 0 }, gates: { runs: 1, ms: 5, red: 0 }, phases });
    const runs = [run(0, 900000, { plan: 100000, code: 600000, review: 150000, close: 50000 }), run(2000000, 60000, { plan: 0, code: 0, review: 0, close: 60000 })];
    const v = m.view(board, null, false, { runs });
    assert.strictEqual(v.cards.find((c) => c.kind === 'done').rows[0].meta, '16m', 'the Done row shows both runs');
    const p = m.view(board, null, false, { runs, page: { kind: 'feature', id: 'cam' } }).page;
    assert.deepStrictEqual(p.split.map((s) => [s.phase, s.ms]), [['plan', 100000], ['code', 600000], ['review', 150000], ['close', 110000]]);
    assert.strictEqual(p.details.run.runs, 2);
  }

  // A 0.22 roadmap has no Plan column: every plan is plans/<ID>.md. Files touched is not read.
  {
    const text = '| Flight | Feature | Title | Tier | Status |\n|---|---|---|---|---|\n| f | a | A | normal | done |\n';
    const [row] = m.parseRoadmap(text).rows;
    assert.strictEqual(row.plan, 'plans/a.md');
    assert.ok(!('touched' in row));
  }

  // Format notice. The format has its own version now; the board must compare against it, not
  // against plugin.json — on 0.21.0 with format 0.20 a current project would carry a notice
  // nothing could ever clear.
  {
    const versionSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'migrate.js'), 'utf8');
    const declared = /const FORMAT = '(\d+\.\d+)';/.exec(versionSrc)[1];
    assert.strictEqual(m.formatOf(versionSrc), declared, 'formatOf reads the FORMAT migrate.js declares');
    assert.strictEqual(m.formatOf('no declaration here'), '', 'and nothing when there is none');
    const board = { name: 't', rows: [], format: { project: declared, plugin: m.formatOf(versionSrc) }, error: null };
    assert.ok(!shown(m.view(board, null, false)).includes('another ristretto format'), 'a project on the current format carries no notice');
    const tsx = fs.readFileSync(path.join(ROOT, 'hooks', 'board.tsx'), 'utf8');
    assert.ok(!tsx.includes('plugin.json'), 'board.tsx must not take the format from plugin.json');
    assert.ok(/formatOf\(/.test(tsx) && tsx.includes('scripts/migrate.js'), 'board.tsx reads the format from migrate.js');
    // The pane never draws an input field, and acts on domain files only through board-domain.
    assert.ok(!/\bInput\b/.test(tsx), 'no input fields in the pane');
    assert.ok(tsx.includes("from './board-domain.mjs'"), 'domain edits come from board-domain.mjs');
    assert.ok(!/\b(commitArgs|addArgs|confirmIn|removeIn|restoreIn|lockOf|signatureOf|pendingOf)\b/.test(tsx), 'the board confirms, removes and commits nothing');
    const rd = tsx.slice(tsx.indexOf('async function refreshDomain'));
    assert.ok(!/'git'/.test(rd.slice(0, rd.indexOf('\nasync function', 10))), 'facts are read from the files alone');
    // Rendering rules 1 and 2 (spec 0.2): one timer, the poll, and no clock read while drawing —
    // the engine redraws a drawing that read the clock, and every redraw rebuilds every image.
    const drawing = tsx.slice(tsx.indexOf('function bandLine'));
    assert.ok(!/\$\.clock\.now\(\)/.test(drawing.replace(/const go = [\s\S]*?\}\)\(\)\n/, '').replace(/run: \(\) => void \(async \(\) => \{[\s\S]*?\}\)\(\),/g, '')), 'no $.clock.now() while drawing; handlers stamp drawnAt');
    assert.strictEqual((tsx.match(/\$\.clock\.every\(/g) || []).length, 1, 'one timer: the 5 s poll');
    assert.ok(!/advanceClock|key: 'tick'/.test(tsx), 'no clock tick');
    // The marks live in board-svg.mjs now: facts have their own, never the person's.
    const svgSrc = fs.readFileSync(path.join(ROOT, 'hooks', 'board-svg.mjs'), 'utf8');
    assert.ok(/\bfacts: \(\) => BOOK\(/.test(svgSrc) && /'fact-conflict': \(\) => `\$\{BOOK\(/.test(svgSrc), 'facts have their own icon');
    assert.ok(!/'person'[^\n]*Domain facts|Domain facts[^\n]*'person'/.test(tsx), 'the person icon is not the facts icon');
    assert.ok(/c\.kind === 'needs'/.test(tsx), 'the Needs you card (conflict rows among its rows) is drawn');
    assert.ok(/'show', '--numstat', '--format=', /.test(tsx), 'the Files card reads the commit with numstat');
    assert.ok(/featureLogArgs\(id\)/.test(tsx) && /sumFiles\(/.test(tsx), 'the Files card finds a feature\'s commits by its ID');
    // Final review #5: the Commit cell is the roadmap's text, not a trusted argument.
    assert.ok(/'--end-of-options', commit\]/.test(tsx) && tsx.includes('/^[0-9a-f]{4,40}$/i.test(commit)'), 'only a hash reaches git, and never as an option');
    assert.ok(/<Box key=\{`acc-\$\{i\}`\} flexDirection="row" gap=\{1\} alignItems="flex-start">/.test(tsx), 'an acceptance mark sits on the first line');
    // Live check 2026-10-13: the proof line truncates, so its column must be allowed to shrink
    // below that line's width — otherwise the criterion and the proof run out of the card.
    assert.ok(/<Box flexDirection="column" flexGrow=\{1\} flexShrink=\{1\} overflow="hidden">\s*<Text wrap="wrap">\{md\(a\.text/.test(tsx), 'an acceptance column shrinks to the card');
    for (const title of ['>Acceptance<', '>Files<', '>Review<', '>Checks<']) assert.ok(tsx.includes(title), `a ${title} card`);
    // The engine's JSX refuses a Button whose `plain` (or `dimColor`) is anything but true or absent
    // ("JSX element <Button key="✓"> plain is true or absent" — the facts page drew nothing).
    assert.ok(!/<Button[^>]*\b(plain|dimColor)=\{/.test(tsx), 'a Button takes plain/dimColor only as a bare flag, never as an expression');
  }

  // Final review I2, reworded: every feature done → the cup, unless a fact is in conflict.
  {
    const done = { name: 't', format: { project: null, plugin: '' }, error: null, rows: [{ flight: '', id: 'z', title: 'z', tier: 'normal', plan: '', commit: '', status: 'done', reason: '' }] };
    assert.strictEqual(m.view(done, null, false, {}).kind, 'cup');
    const calm = { file: 'mail.md', title: 'A', text: 'a', source: '', state: 'unconfirmed', by: '', conflict: null };
    assert.strictEqual(m.view(done, null, false, { domain: { tree: [calm] } }).kind, 'cup', 'context facts do not hold the cup back');
    const v = m.view(done, null, false, { domain: { tree: [{ ...calm, conflict: { what: 'w', source: 's', by: 'b' } }] } });
    assert.strictEqual(v.kind, 'board', 'a conflict keeps the overview');
  }

  // The band above the prompt: only the main thing — what runs and its step, who is needed.
  {
    const row = (id, status) => ({ flight: '', id, title: id, tier: 'normal', plan: '', commit: '', touched: [], status, reason: '' });
    const board = { name: 't', format: { project: null, plugin: '' }, error: null, rows: [row('a', 'done'), row('b', 'blocked'), row('c', 'planned'), row('d', 'done')] };
    assert.deepStrictEqual(m.bandOf(board, null, false, {}), { idle: { open: 2, needYou: 1, ready: false } });
    const live = { command: 'pull', id: 'c', phase: 'coding', round: 0, since: 0, gate: null, armed: true };
    const run = m.bandOf(board, live, false, {}).running;
    assert.deepStrictEqual([run.id, run.step, run.red, run.needYou, run.effort.phases.length], ['c', 'code', false, 1, 4]);
    assert.strictEqual(m.bandOf(board, { ...live, gate: { since: 0, red: true } }, false, {}).running.step, 'gate red');
    assert.deepStrictEqual(m.bandOf(board, null, true, {}).running.step, 'a run is active in another session');
    assert.ok(!/ahead|done|total|clock/.test(JSON.stringify(m.bandOf(board, null, false, {}))), 'no tally, no time, no ahead');
    // Ready: everything on the branch done, nothing holds it, the suite green on this code.
    const ready = { ...board, rows: [row('a', 'done'), row('c', 'planned')] };
    const branch = { name: 'b', base: 'main', ids: ['a'], lastBrew: '' };
    assert.strictEqual(m.bandOf(ready, null, false, { branch, suite: { state: 'green', text: 'suite green', failing: '' } }).idle.ready, true);
    assert.strictEqual(m.bandOf(ready, null, false, { branch, suite: { state: 'unproven', text: 'suite unproven', failing: '' } }).idle.ready, false, 'never ready on an unproven suite');
    assert.strictEqual(m.bandOf({ ...board, error: 'no-roadmap', rows: [] }, null, false, {}), null, 'no roadmap: no band');
    const tsx = fs.readFileSync(path.join(ROOT, 'hooks', 'board.tsx'), 'utf8');
    assert.ok(/component: 'AbovePrompt'/.test(tsx) && /bandOf\(/.test(tsx), 'the band is drawn above the prompt');
    assert.ok(/\$\.ui\.close\(\{ id: PANE \}\)/.test(tsx) && /on\('ui\.close'/.test(tsx), 'open/close follows the pane, closed by the band or by its own x');
  }

  // The chat side of facts: who may note a conflict, where it is settled, when prep asks.
  {
    const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
    const prep = read('commands/prep.md');
    assert.ok(/research\.js" conflict/.test(read('briefs/common.md')), 'builders and reviewers note conflicts through the script');
    assert.ok(/research\.js" conflict/.test(read('briefs/researcher.md')), 'so does research');
    assert.ok(/blocked: domain\/<file>: <title> is in conflict/.test(read('briefs/common.md')), 'a binding fact in conflict blocks, in the shape the board reads');
    assert.ok(/## Facts — `prep facts`/.test(prep) && /update \/ remove \/ keep/.test(prep), 'prep settles conflicts in the chat');
    assert.ok(/at most two/.test(prep) && /\(stays context: domain\/<file>: <title>\)/.test(prep), 'prep asks about at most two binding facts');
    assert.ok(/in conflict — \/ristretto:prep facts/.test(read('commands/status.md')) && !/to confirm — open the board/.test(read('commands/status.md')), 'status counts conflicts, not unconfirmed facts');
    // One commit per feature, found by its ID; the plan never moves and nothing re-runs a check.
    const closer = read('briefs/closer.md');
    assert.ok(/one commit holds code, plan and roadmap row/.test(closer) && /change no other cell/.test(closer) && !/archiv/i.test(closer), 'the closer commits once and only sets the status');
    assert.ok(!/re-run/.test(closer), 'the user\'s word ticks a box; nothing re-runs a check');
    assert.ok(/no plan link, date, file list or hash/.test(prep), 'the roadmap holds order and status only');
  }

  // 20. v3: one state decides what holds the branch, what needs you, what is next, what is done.
  {
    const R = (id, status, extra = {}) => ({ flight: '', id, title: `${id} title`, tier: 'normal', plan: '', commit: '', touched: [], status, reason: '', ...extra });
    const P = (o = {}) => ({ depends: [], blockers: [], findings: [], acceptance: [], ...o });
    const board = {
      name: 'roadmap', format: { project: null, plugin: '' }, error: null,
      rows: [
        R('d-old', 'done'), R('d-here', 'done'), R('human-here', 'done'), R('review-here', 'done'),
        R('human-away', 'done'), R('blk', 'blocked', { reason: 'waiting on Anatol: the API doc' }),
        R('p1', 'planned'), R('p2', 'planned'), R('p3', 'planned'), R('p4', 'planned'), R('p5', 'planned'), R('p6', 'planned'),
        R('pw', 'planned'),
      ],
    };
    const plans = { 'review-here': P({ findings: ['block · a.js:1 · a', 'bug · b.js:2 · b'] }), pw: P({ depends: ['blk'] }) };
    const checks = {
      'human-here': [{ done: true, text: 'x' }, { done: false, text: 'y' }],
      'review-here': [{ done: false, text: 'x' }, { done: false, text: 'y' }],
      'human-away': [{ done: false, text: 'z' }],
    };
    const branch = { name: 'brew/x', base: 'main', ids: ['human-here', 'review-here', 'd-here', 'blk-nope'], lastBrew: '' };
    const runs = [{ id: 'd-here', startedAt: 0, endedAt: 9000, ms: 9000, phases: { plan: 1000, code: 8000, review: 0, close: 0 } }];
    const opts = { branch, suite: { state: 'green', text: 'suite green', failing: '' }, runs, plans, checks, domain: { tree: [] }, drawnAt: 10000 };
    let s = m.stateOf(board, null, false, opts);
    const by = (list, id) => list.find((r) => r.id === id);

    // Holders: what this branch's features still wait on, in their tone.
    assert.deepStrictEqual(s.holders.map((h) => [h.id, h.detail, h.tone, h.glyph]), [
      ['human-here', '1 check open', 'permission', 'person'],
      ['review-here', '2 findings · 2 checks open', 'permission', 'person'],
    ]);
    const findingsOnly = m.stateOf(board, null, false, { ...opts, checks: { 'review-here': [] } });
    assert.deepStrictEqual(['detail', 'tone', 'glyph'].map((k) => by(findingsOnly.holders, 'review-here')[k]), ['2 findings open', 'warning', 'findings']);
    assert.strictEqual(s.branchIds.length, 4);
    // The same kind of row off the branch, and a blocked row with no commit here, need you instead.
    assert.deepStrictEqual(s.needsYou.map((r) => r.id), ['human-away', 'blk']);
    assert.strictEqual(by(s.needsYou, 'blk').detail, 'waits on Anatol');
    assert.ok(!by(s.holders, 'blk'));
    assert.strictEqual(s.needYou, s.needsYou.length);
    assert.strictEqual(s.open, 8, 'open = rows not done');

    // Up next: eligible planned rows in roadmap order, at most 5, the rest counted.
    assert.deepStrictEqual(s.upNext.rows.map((r) => [r.id, r.detail]), [['p1', 'next'], ['p2', 'queued'], ['p3', 'queued'], ['p4', 'queued'], ['p5', 'queued']]);
    assert.deepStrictEqual([s.upNext.more, s.upNext.waiting, s.upNext.eligible], [1, 1, 6]);
    assert.strictEqual(s.nextId, 'p1');

    // Done: this branch's, newest first, each with its own split; the total beside it.
    assert.deepStrictEqual(s.done.here.map((r) => r.id), ['d-here']);
    assert.deepStrictEqual([s.done.total, s.done.recent], [2, false]);
    assert.strictEqual(by(s.done.here, 'd-here').meta, '9s');
    assert.ok(by(s.done.here, 'd-here').split);

    // A red suite proving this code holds the branch first; an unproven one holds nothing.
    s = m.stateOf(board, null, false, { ...opts, suite: { state: 'red', text: 'full suite · red · test', failing: 'test' } });
    assert.deepStrictEqual([s.holders[0].id, s.holders[0].detail, s.holders[0].tone], ['full suite', 'red · test', 'error']);
    s = m.stateOf(board, null, false, { ...opts, suite: { state: 'unproven', text: 'suite unproven', failing: '' } });
    assert.strictEqual(s.holders.length, 2);

    // Every box ticked: the feature is plainly done. Nothing re-runs; brew's next is a planned row.
    const ticked = { ...checks, 'human-here': [{ done: true, text: 'x' }] };
    s = m.stateOf(board, null, false, { ...opts, checks: ticked });
    assert.strictEqual(s.nextId, 'p1');
    assert.ok(!by(s.holders, 'human-here'));
    assert.deepStrictEqual(s.done.here.map((r) => r.id), ['d-here', 'human-here']);

    // A blocked feature whose code is on the branch holds it.
    s = m.stateOf(board, null, false, { ...opts, branch: { ...branch, ids: [...branch.ids, 'blk'] } });
    assert.deepStrictEqual([by(s.holders, 'blk').detail, by(s.holders, 'blk').tone], ['blocked · waits on Anatol', 'error']);
    assert.ok(!by(s.needsYou, 'blk'));

    // In progress with no run active holds it; the running feature itself is the Brewing card's.
    const prog = { ...board, rows: [...board.rows, R('ip', 'in-progress')] };
    s = m.stateOf(prog, null, false, { ...opts, branch: { ...branch, ids: [...branch.ids, 'ip'] } });
    assert.strictEqual(by(s.holders, 'ip').detail, 'in progress · no run');
    s = m.stateOf(prog, { command: 'pull', id: 'ip', phase: 'coding', round: 0, since: 0, gate: null, armed: true }, false, { ...opts, branch: { ...branch, ids: [...branch.ids, 'ip'] } });
    assert.ok(!by(s.holders, 'ip'));
    assert.ok(s.busy);

    // No scope (no base, nothing ahead): no holders; every needs-* row needs you; Recently done.
    s = m.stateOf(board, null, false, { ...opts, branch: { ...branch, ids: null } });
    assert.deepStrictEqual([s.holders.length, s.branchIds], [0, null]);
    assert.deepStrictEqual(s.needsYou.map((r) => r.id), ['human-here', 'review-here', 'human-away', 'blk']);
    assert.strictEqual(s.done.recent, true);
    assert.deepStrictEqual(s.done.here.map((r) => r.id), ['d-here', 'd-old'], 'newest first: measured, then later rows');

    // A fact in conflict needs you, amber.
    s = m.stateOf(board, null, false, { ...opts, domain: { tree: [{ file: 'web-auth.md', title: 'Sessions', state: 'confirmed', conflict: { what: 'x' } }] } });
    const fact = s.needsYou[s.needsYou.length - 1];
    assert.deepStrictEqual([fact.glyph, fact.detail, fact.tone, fact.open.kind], ['fact-conflict', 'web-auth.md · in conflict', 'warning', 'domain']);

    // No buttons anywhere: the person acts in the chat.
    assert.ok(!/"action"/.test(JSON.stringify(m.stateOf(board, null, false, opts))));
  }

  // 20b. A done feature still asks a person while its plan has an open box; there is no status for it.
  {
    const R = (id, status) => ({ flight: '', id, title: `${id} title`, tier: 'normal', plan: `plans/${id}.md`, commit: '', status, reason: '' });
    const board = { name: 'r', format: { project: null, plugin: '' }, error: null, rows: [R('a', 'done'), R('b', 'done')] };
    const at = (opts) => m.stateOf(board, null, false, { suite: { state: 'green', text: '', failing: '' }, domain: { tree: [] }, ...opts });

    // doneWithOpenCheckNeedsYou
    let s = at({ checks: { a: [{ done: false, text: 'x', how: 'y' }, { done: true, text: 'z', how: '' }] } });
    assert.deepStrictEqual(s.needsYou.map((r) => [r.id, r.detail, r.glyph]), [['a', '1 check open', 'person']]);
    assert.deepStrictEqual(s.done.all.map((r) => r.id), ['b'], 'a feature that waits on you is not under Done');
    assert.strictEqual(s.open, 0, 'it is still done: it is not open work');

    // doneWithOpenDecisionNeedsYou
    const decisions = { a: [{ done: null, text: 'prep ruling' }, { done: false, text: 'q1 → r1' }, { done: false, text: 'q2 → r2' }] };
    s = at({ decisions });
    assert.deepStrictEqual(s.needsYou.map((r) => [r.id, r.detail]), [['a', '2 decisions open']]);
    s = at({ decisions, checks: { a: [{ done: false, text: 'x', how: '' }] } });
    assert.deepStrictEqual(s.needsYou.map((r) => [r.id, r.detail]), [['a', '1 check · 2 decisions open']]);
    s = at({ decisions, branch: { name: 'x', base: 'main', ids: ['a'], lastBrew: '' } });
    assert.deepStrictEqual(s.holders.map((r) => [r.id, r.detail, r.tone]), [['a', '2 decisions open', 'permission']], 'on the branch it holds the branch');

    // notesAndLeansAskNothing: a note or a lean is recorded, never a person's turn; anything else tagged is.
    const findings = (list) => ({ a: { depends: [], blockers: [], findings: list } });
    s = at({ plans: findings(['note · x.php:1 · fine', 'lean · y.php:2 · shorter', 'prose that wraps']) });
    assert.deepStrictEqual(s.needsYou, [], 'notes and leans only');
    s = at({ plans: findings(['bug · x.php:1 · wrong', 'lean · y.php:2 · shorter']) });
    assert.deepStrictEqual(s.needsYou.map((r) => [r.id, r.detail, r.glyph]), [['a', '1 finding open', 'findings']]);

    // doneCleanIsDone: ticked checks and confirmed or prep decisions leave nothing to do.
    s = at({ checks: { a: [{ done: true, text: 'x', how: '' }] }, decisions: { a: [{ done: true, text: 'q → r' }, { done: null, text: 'p' }] } });
    assert.deepStrictEqual([s.needsYou, s.done.all.map((r) => r.id)], [[], ['b', 'a']]);
    // The feature page carries the plan's decisions with their boxes.
    const page = m.view(board, null, false, { decisions, page: { kind: 'feature', id: 'a' } }).page;
    assert.deepStrictEqual(page.details.decisions, decisions.a);
  }

  // 21. v3: the feature at work, its effort, its roles, and this brew's tally.
  {
    const L = (o) => ({ command: 'pull', id: 'f', phase: 'coding', round: 0, since: 0, gate: null, armed: true, ...o });
    const states = (e) => e.phases.map((p) => (p.state === 'current' ? `${p.name}:${p.progress}` : `${p.name}:${p.state}`));

    // Effort: phases before the current one done; code sits mid-phase (no unit record, spec 0.3 #11).
    let e = m.effortOf(L({}), 'pull');
    assert.deepStrictEqual(states(e), ['plan:done', 'code:0.5', 'review:todo', 'close:todo']);
    assert.deepStrictEqual([e.step, e.red], ['code', false]);
    e = m.effortOf(L({ command: 'shot' }), 'shot');
    assert.deepStrictEqual(e.phases.map((p) => p.name), ['code', 'review', 'close'], 'shot has no plan');
    // A fix round stays in review, so the thumb never jumps back to code.
    e = m.effortOf(L({ phase: 'fixing', round: 1 }), 'pull');
    assert.deepStrictEqual([e.phases[2].state, e.step], ['current', 'fix r1']);
    e = m.effortOf(L({ phase: 'review', round: 2, command: 'brew' }), 'brew');
    assert.deepStrictEqual([e.step, e.phases[2].progress], ['review r2', 0.5], 'brew reviews up to 3 rounds');
    e = m.effortOf(L({ gate: { since: 0, red: true } }), 'pull');
    assert.strictEqual(e.red, true);
    e = m.effortOf(L({ phase: 'interrupted' }), 'pull');
    assert.ok(e.phases.every((p) => p.state !== 'current'));
    assert.strictEqual(e.step, 'interrupted');

    // Roles: who works, on which model, for how long; the running one is live.
    const roles = { f: [
      { role: 'planner', model: 'Opus 5.5', startedAt: 1000, endedAt: 61000 },
      { role: 'implementer', model: 'Sonnet 5.5', startedAt: 61000, endedAt: null },
    ] };
    assert.deepStrictEqual(m.rolesOf(roles, 'f', 121000), [
      { role: 'planner', model: 'Opus 5.5', time: { ms: 60000, live: false }, state: 'done' },
      { role: 'implementer', model: 'Sonnet 5.5', time: { ms: 60000, live: true }, state: 'current' },
    ]);
    assert.deepStrictEqual(m.rolesOf({}, 'f', 0), []);
    // A main-loop phase change in pull or shot names the role that starts; brew's roles are spawns.
    assert.deepStrictEqual(m.mainRoleOf(L({ phase: 'planning' }), L({ phase: 'coding' })), { id: 'f', role: 'implementer', round: 0 });
    assert.deepStrictEqual(m.mainRoleOf(L({ phase: 'review', round: 1 }), L({ phase: 'fixing', round: 1 })), { id: 'f', role: 'fixer', round: 1 });
    assert.deepStrictEqual(m.mainRoleOf(L({ phase: 'review' }), L({ phase: 'closing' })), { id: 'f', role: 'closer', round: 0 });
    assert.strictEqual(m.mainRoleOf(L({ phase: 'coding' }), L({ phase: 'coding' })), null);
    assert.strictEqual(m.mainRoleOf(L({ command: 'brew', phase: 'planning' }), L({ command: 'brew', phase: 'coding' })), null);

    // This brew: brewed + blocked + to go = total; the current feature is one to go.
    const R = (id, status, extra = {}) => ({ flight: '', id, title: `${id} title`, tier: 'normal', plan: '', commit: '', touched: [], status, reason: '', ...extra });
    const board = {
      name: 'r', format: { project: null, plugin: '' }, error: null,
      rows: [R('a', 'done'), R('b', 'done'), R('c', 'in-progress'), R('d', 'blocked', { reason: 'waiting on Anatol: x' }), R('e', 'planned'), R('f2', 'planned'), R('g', 'planned'), R('h', 'planned'), R('w', 'planned'), R('old', 'done')],
    };
    const plans = { w: { depends: ['d'], blockers: [], findings: [] } };
    const live = L({ command: 'brew', id: 'c', phase: 'coding' });
    const snapshot = { startedAt: 1000, ids: ['a', 'b', 'c', 'd', 'e', 'f2', 'g', 'h', 'w'] };
    const runs = [{ id: 'a', startedAt: 2000, endedAt: 50000, ms: 48000, phases: {} }, { id: 'b', startedAt: 50000, endedAt: 90000, ms: 40000, phases: {} }];
    const opts = { snapshot, runs, roles: { c: roles.f }, run: { id: 'c', startedAt: 90000 }, plans, checks: {}, drawnAt: 150000 };
    let w = m.brewingOf(board, live, opts);
    assert.strictEqual(w.title, 'Brewing');
    assert.deepStrictEqual(w.tally, { brewed: 2, blocked: 1, toGo: 5, total: 8 });
    assert.strictEqual(w.tally.brewed + w.tally.blocked + w.tally.toGo, w.tally.total);
    assert.deepStrictEqual([w.inset.id, w.inset.status, w.inset.elapsed], ['c', 'code', { ms: 60000, live: true }]);
    assert.deepStrictEqual(w.clock, { ms: 149000, live: true }, 'the brew runs from its snapshot');
    assert.strictEqual(w.inset.roles.length, 2);
    // Rest rows: next, two queued, the brewed (newest first), every blocked, what waits on a blocked one.
    assert.deepStrictEqual(w.rows.map((r) => [r.id, r.detail]), [
      ['e', 'next'], ['f2', 'queued'], ['g', 'queued'], ['b', 'brewed'], ['a', 'brewed'], ['d', 'blocked · waits on Anatol'], ['w', 'waits on d'],
    ]);
    assert.deepStrictEqual(w.rows.find((r) => r.id === 'a').meta, '48s');
    assert.strictEqual(w.more, 1, 'one more queued');
    assert.strictEqual(w.inset.gate, null, 'the gate line only when red');
    w = m.brewingOf(board, { ...live, gate: { since: 0, red: true } }, opts);
    assert.deepStrictEqual([w.red, w.inset.gate.red], [true, true]);

    // Review Focus 3: a brew the board did not see start — no tally, the rest from Up next.
    w = m.brewingOf(board, live, { ...opts, snapshot: null });
    assert.strictEqual(w.tally, null);
    assert.deepStrictEqual(w.rows.map((r) => r.id), ['e', 'f2', 'g']);
    assert.strictEqual(w.clock, null);
    // A pull is the feature alone.
    w = m.brewingOf(board, L({ id: 'c' }), { ...opts, snapshot: null });
    assert.deepStrictEqual([w.title, w.rows.length, w.tally], ['Pulling', 0, null]);
    // Between features (or starting) nothing is at work yet.
    w = m.brewingOf(board, L({ command: 'brew', id: null, phase: 'starting' }), opts);
    assert.deepStrictEqual([w.inset, w.text], [null, 'starting']);
    assert.strictEqual(m.brewingOf(board, null, opts), null);
    assert.ok(!/"action"/.test(JSON.stringify(m.brewingOf(board, live, opts))));
  }

  console.log('board-model.test.js: all checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
