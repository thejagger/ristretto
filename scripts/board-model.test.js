#!/usr/bin/env node
// Self-check for hooks/board-model.mjs — run with: node scripts/board-model.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');

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
    // 0.23: pull is the one flow and dispatches the planner and the fixer; it implements in its own
    // turn, review is /code-review and closing is close.js, so those roles get no subagent brief.
    assert.deepStrictEqual([...roles].sort(), ['fixer', 'planner'],
      'pull.md must carry a brief for every role it dispatches');
    // The prompt the model sends has no leading "> ".
    assert.deepStrictEqual(m.parseBrief('REVIEWER for ristretto feature **pw-galerie**.\nDiff: x'), { role: 'reviewer', id: 'pw-galerie' });
    assert.strictEqual(m.parseBrief('Explore the repo for ristretto usages'), null);
    // A builder at a folder of repos tells its planner where the repo is, sometimes first.
    assert.deepStrictEqual(m.parseBrief('Work in the repo at C:\\x\\calc.\n\nPLANNER for ristretto feature **CALC-2**.\nPlan: p'), { role: 'planner', id: 'CALC-2' });

    // briefs/reviewer.md went in 0.23 (review is /code-review); runs recorded before still read.
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

    // A pull a builder subagent runs: the brewer's own turn ending is not that run's end; its
    // marker going away is.
    live = m.fold(null, { kind: 'command', command: 'pull', args: 'f-4 unattended', agent: true }, 0);
    assert.strictEqual(m.fold(live, { kind: 'main-turn-end' }, 1), live, 'a builder\'s pull outlives the brewer\'s turn, armed or not');
    const built = m.fold(m.fold(live, { kind: 'marker', state: 'mine' }, 2), { kind: 'brief', role: 'planner', id: 'f-4' }, 3);
    assert.deepStrictEqual([built.phase, built.unattended, built.agent], ['planning', true, true]);
    assert.strictEqual(m.fold(built, { kind: 'main-turn-end' }, 4), built);
    assert.strictEqual(m.fold(built, { kind: 'marker', state: 'none' }, 5), null, 'the builder disarmed: the run ended');

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
    // An unattended pull says so: the folder board labels the brewer's repo session by it.
    assert.strictEqual(m.fold(null, { kind: 'command', command: 'pull', args: 'x unattended' }, 0).unattended, true);
    assert.strictEqual(m.fold(null, { kind: 'command', command: 'pull', args: 'x' }, 0).unattended, false);
    live = m.fold(null, { kind: 'marker', state: 'mine' }, 5);
    assert.deepStrictEqual([live.command, live.id, live.phase, live.armed], [null, null, null, true]);
    // Nothing running: gates, reports and turn ends change nothing.
    for (const obs of [{ kind: 'gate-start' }, { kind: 'gate-end', red: true }, { kind: 'main-turn-end' }, { kind: 'marker', state: 'none' }]) {
      assert.strictEqual(m.fold(null, obs, 1), null);
    }
  }

  // 8. Who a blocked row waits on.
  {
    assert.strictEqual(m.waitsOn('waiting on Jakob: confirm the pass mark (proposal: 0 missed)'), 'waits on Jakob');
    assert.strictEqual(m.waitsOn('waiting on Anatol — Nodes write API'), 'waits on Anatol');
    assert.strictEqual(m.waitsOn('no API docs yet'), 'no API docs yet');
  }


  // A 0.22 roadmap has no Plan column: every plan is plans/<ID>.md. Files touched is not read.
  {
    const text = '| Flight | Feature | Title | Tier | Status |\n|---|---|---|---|---|\n| f | a | A | normal | done |\n';
    const [row] = m.parseRoadmap(text).rows;
    assert.strictEqual(row.plan, 'plans/a.md');
    assert.ok(!('touched' in row));
  }

  // One commit per feature, found by its ID; the plan never moves and nothing re-runs a check.
  {
    const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
    const prep = read('commands/prep.md');
    // 0.23: the closer brief is close.js plus common.md's Commits; the rules stay.
    assert.ok(/code, plan and roadmap row/.test(read('briefs/common.md')), 'one commit holds code, plan and roadmap row');
    assert.ok(/cells\[status\] = 'done'/.test(read('scripts/close.js')) && !/archiv/i.test(read('scripts/close.js')), 'close.js only sets the status (and the tier on an escalation)');
    assert.ok(!/re-run/.test(read('scripts/close.js')), 'the user\'s word ticks a box; nothing re-runs a check');
    assert.ok(/holds order and status, nothing else/.test(prep), 'the roadmap holds order and status only');
  }

  // The board's source rules: the format is migrate.js's, the pane is display only, one timer,
  // no clock read while drawing.
  {
    const versionSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'migrate.js'), 'utf8');
    const declared = /const FORMAT = '(\d+\.\d+)';/.exec(versionSrc)[1];
    assert.strictEqual(m.formatOf(versionSrc), declared, 'formatOf reads the FORMAT migrate.js declares');
    assert.strictEqual(m.formatOf('no declaration here'), '', 'and nothing when there is none');
    const tsx = fs.readFileSync(path.join(ROOT, 'hooks', 'board.tsx'), 'utf8');
    // A control byte in the source makes git and grep treat board.tsx as binary.
    assert.ok(!/[\u0000-\u0008]/.test(tsx), 'board.tsx carries no control bytes');
    assert.ok(!/formatOf\([^\n]*plugin\.json/.test(tsx), 'board.tsx must not take the format from plugin.json');
    assert.ok(/formatOf\(/.test(tsx) && tsx.includes('scripts/migrate.js'), 'board.tsx reads the format from migrate.js');
    assert.ok(!/\bInput\b/.test(tsx), 'no input fields');
    // Display only, but for one press area: the chip above the prompt opens and closes the pane.
    assert.ok(!/<Button\b|els\.Button/.test(tsx), 'no Button anywhere');
    assert.strictEqual((tsx.match(/<els\.Client\b/g) || []).length, 1, 'one press area: the chip\'s toggle');
    assert.ok(!/Client\b/.test(tsx.slice(tsx.indexOf('async function drawPane'), tsx.indexOf('// The band above the prompt: the chip, the view'))), 'the pane itself presses nothing');
    assert.ok(!/\b(commitArgs|addArgs|confirmIn|removeIn|restoreIn)\b/.test(tsx), 'the board confirms, removes and commits nothing');
    const drawing = tsx.slice(tsx.indexOf('// ---- the pane, v1'));
    assert.ok(drawing.length > 100 && !/\$\.clock\.now\(\)/.test(drawing), 'no $.clock.now() while drawing; handlers stamp drawnAt');
    assert.strictEqual((tsx.match(/\$\.clock\.every\(/g) || []).length, 1, 'one timer: the 5 s poll');
    for (const call of ['modeOf(', 'viewOf(', 'storyOf(', 'chipOf(', 'header(', 'rail(', 'meter(', 'stepWord(']) assert.ok(drawing.includes(call), call);
  }

  // 22. v1: the five steps, told by verify, /code-review and close.js.
  {
    const run = (phase) => ({ command: 'pull', id: 'a', phase, round: 0, since: 0, gate: null, armed: true });
    assert.deepStrictEqual(m.STEPS, ['plan', 'build', 'prove', 'review', 'close']);
    assert.deepStrictEqual(m.signalOf({ tool: 'Bash', command: 'node "C:\\Users\\x\\ristretto\\scripts\\gate.js" verify' }), { kind: 'verify' });
    assert.deepStrictEqual(m.signalOf({ tool: 'Bash', command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" verify' }), { kind: 'verify' });
    assert.deepStrictEqual(m.signalOf({ tool: 'Bash', command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/close.js" a --input .ristretto/close-a.json' }), { kind: 'close' });
    assert.deepStrictEqual(m.signalOf({ tool: 'Bash', command: 'node C:\\p\\scripts\\close.js a --input x' }), { kind: 'close' });
    assert.deepStrictEqual(m.signalOf({ tool: 'Skill', skill: 'code-review' }), { kind: 'review' });
    assert.deepStrictEqual(m.signalOf({ tool: 'Skill', skill: 'engineering:code-review' }), { kind: 'review' });
    assert.strictEqual(m.signalOf({ tool: 'Bash', command: 'node scripts/gate.js arm' }), null);
    assert.strictEqual(m.signalOf({ tool: 'Bash', command: 'git log -- scripts/close.js' }), null);
    assert.strictEqual(m.signalOf({ tool: 'Bash', command: 'cat scripts/gate.js | grep verify' }), null);
    assert.strictEqual(m.signalOf({ tool: 'Skill', skill: 'ristretto:pull' }), null);
    assert.strictEqual(m.signalOf({ tool: 'Bash' }), null);

    assert.strictEqual(m.fold(run('coding'), { kind: 'verify' }, 5).phase, 'proving');
    assert.strictEqual(m.fold(run('coding'), { kind: 'verify' }, 5).since, 5);
    assert.strictEqual(m.fold(run('fixing'), { kind: 'verify' }, 5).phase, 'fixing');
    assert.strictEqual(m.fold(run('review'), { kind: 'verify' }, 5).phase, 'review', 'a verify after review stays in review');
    assert.strictEqual(m.fold(run('proving'), { kind: 'review' }, 5).phase, 'review');
    assert.strictEqual(m.fold(run('coding'), { kind: 'review' }, 5).phase, 'review');
    assert.strictEqual(m.fold(run('review'), { kind: 'close' }, 5).phase, 'closing');
    assert.strictEqual(m.fold(run('fixing'), { kind: 'close' }, 5).phase, 'closing');
    assert.strictEqual(m.fold(null, { kind: 'verify' }, 5), null);
    assert.strictEqual(m.fold({ ...run('coding'), id: null }, { kind: 'close' }, 5).phase, 'coding', 'no feature, nothing to close');

    const e = m.effortOf(run('proving'), 'pull');
    assert.deepStrictEqual(e.phases.map((p) => [p.name, p.state]), [['plan', 'done'], ['build', 'done'], ['prove', 'current'], ['review', 'todo'], ['close', 'todo']]);
    assert.strictEqual(e.step, 'prove');
    assert.deepStrictEqual(m.effortOf(run('coding'), 'shot').phases.map((p) => p.name), ['build', 'prove', 'review', 'close']);
    assert.strictEqual(m.effortOf(run('fixing'), 'pull').step, 'review');
    assert.strictEqual(m.effortOf(run('closing'), 'pull').step, 'close');
    assert.strictEqual(m.effortOf(run('interrupted'), 'pull').step, 'stopped');
    assert.strictEqual(m.effortOf(run('starting'), 'pull').step, 'starting');
  }

  console.log('board-model.test.js: all checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
