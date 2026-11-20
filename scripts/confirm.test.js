#!/usr/bin/env node
// Self-check for scripts/confirm.js — run with: node scripts/confirm.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, 'confirm.js');
const c = require('./confirm.js');
const DATE = '2026-11-04';

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
}

const plan = [
  '## Contract',
  '- Acceptance:',
  '  - [auto] a paying user sees no upgrade banner',
  '  - [ ] [human] a free user sees the upgrade banner',
  '    how: hosted project · run the migration',
  '  - [ ] [human] the mail arrives in Outlook',
  '- Provides: —',
  '',
  '## Evidence',
  '- 1: test/banner.test.ts',
  '- 2: pending human',
  '- 3: pending human',
  '- gates: test ok',
  '',
].join('\n');

test('ticksAllOpen', () => {
  const open = c.openChecks(plan);
  assert.deepStrictEqual(open.map((o) => [o.n, o.criterion]), [[1, 2], [2, 3]]);
  const r = c.tick(plan, { date: DATE });
  assert.deepStrictEqual(r.ticked, [1, 2]);
  assert.deepStrictEqual(r.kept, []);
  assert.ok(r.text.includes('  - [x] [human] a free user sees the upgrade banner\n'));
  assert.ok(r.text.includes('  - [x] [human] the mail arrives in Outlook\n'));
  assert.ok(r.text.includes(`- 2: confirmed in chat ${DATE}\n`));
  assert.ok(r.text.includes(`- 3: confirmed in chat ${DATE}\n`));
  assert.ok(r.text.includes('  - [auto] a paying user sees no upgrade banner\n'));
  assert.ok(r.text.includes('- 1: test/banner.test.ts\n'));
});

test('exceptKeepsOne', () => {
  const r = c.tick(plan, { date: DATE, keep: new Map([[2, 'banner still overlaps']]) });
  assert.deepStrictEqual(r.ticked, [1]);
  assert.deepStrictEqual(r.kept, [2]);
  assert.ok(r.text.includes('  - [ ] [human] the mail arrives in Outlook — banner still overlaps\n'));
  assert.ok(r.text.includes('- 3: pending human\n'));
  assert.ok(r.text.includes(`- 2: confirmed in chat ${DATE}\n`));
});

test('noteNotDuplicated', () => {
  const keep = new Map([[2, 'banner still overlaps']]);
  const once = c.tick(plan, { date: DATE, keep }).text;
  const twice = c.tick(once, { date: DATE, keep: new Map([[1, 'banner still overlaps']]) }).text;
  assert.strictEqual(twice, once);
});

test('wrappedBoxTicksFirstLine', () => {
  const wrapped = [
    '- Acceptance:',
    '  - [auto] the build passes',
    '  - [ ] [human] On a physical Android device a push still appears in the tray,',
    '    and tapping it opens the expense.',
    '    how: a physical device · sign in as member A and background the app.',
    '- Provides: —',
    '',
  ].join('\n');
  assert.deepStrictEqual(c.openChecks(wrapped).map((o) => o.criterion), [2]);
  const r = c.tick(wrapped, { date: DATE, keep: new Map([[1, 'no device yet']]) });
  const lines = r.text.split('\n');
  assert.strictEqual(lines[2], '  - [ ] [human] On a physical Android device a push still appears in the tray, — no device yet');
  assert.strictEqual(lines[3], '    and tapping it opens the expense.');
  assert.strictEqual(lines[4], '    how: a physical device · sign in as member A and background the app.');
  const t = c.tick(wrapped, { date: DATE }).text.split('\n');
  assert.strictEqual(t[2], '  - [x] [human] On a physical Android device a push still appears in the tray,');
  assert.strictEqual(t[4], '    how: a physical device · sign in as member A and background the app.');
});

test('migratedSectionTicks', () => {
  const migrated = [
    '- Acceptance:',
    '  - [auto] it works',
    '',
    '## Manual checks (migrated)',
    '- [ ] **proves** · run the seed by hand',
    '',
    '## Evidence',
    '- 1: pending human',
    '',
  ].join('\n');
  const open = c.openChecks(migrated);
  assert.deepStrictEqual(open.map((o) => [o.n, o.criterion]), [[1, null]]);
  const r = c.tick(migrated, { date: DATE });
  assert.ok(r.text.includes('- [x] **proves** · run the seed by hand\n'));
  assert.ok(r.text.includes('- 1: pending human\n'));
});

test('tickIsIdempotent', () => {
  const once = c.tick(plan, { date: DATE }).text;
  const again = c.tick(once, { date: DATE });
  assert.strictEqual(again.text, once);
  assert.deepStrictEqual(again.ticked, []);
});

test('crlfSurvives', () => {
  const r = c.tick(plan.replace(/\n/g, '\r\n'), { date: DATE, keep: new Map([[1, 'later']]) });
  assert.ok(r.text.includes('\r\n'));
  assert.ok(!/[^\r]\n/.test(r.text), 'no bare \\n');
  assert.ok(r.text.includes(`- 3: confirmed in chat ${DATE}\r\n`));
});

test('tableEvidenceUntouched', () => {
  const table = [
    '- Acceptance:',
    '  - [ ] [human] the mail arrives',
    '',
    '## Evidence',
    '| Criterion | Proof |',
    '|---|---|',
    '| 1 | pending human |',
    '',
  ].join('\n');
  const r = c.tick(table, { date: DATE });
  assert.ok(r.text.includes('  - [x] [human] the mail arrives\n'));
  assert.ok(r.text.endsWith('| Criterion | Proof |\n|---|---|\n| 1 | pending human |\n'));
});

test('noteVerbatim', () => {
  const note = `doesn't work — at 375px "mobile"`;
  const r = c.tick(plan, { date: DATE, keep: new Map([[1, note]]) });
  assert.ok(r.text.includes(`  - [ ] [human] a free user sees the upgrade banner — ${note}\n`));
});

// Folders: a roadmap with rows, each row's plan beside it.
function repo(dir, plans) {
  fs.mkdirSync(path.join(dir, 'docs', 'ristretto', 'plans'), { recursive: true });
  const rows = Object.keys(plans).map((id) => `| — | ${id} | ${id} title | normal | done |`);
  fs.writeFileSync(path.join(dir, 'docs', 'ristretto', 'roadmap.md'),
    ['# Ristretto Roadmap', '', '| Flight | Feature | Title | Tier | Status |', '|---|---|---|---|---|', ...rows, ''].join('\n'));
  for (const [id, text] of Object.entries(plans)) fs.writeFileSync(path.join(dir, 'docs', 'ristretto', 'plans', `${id}.md`), text);
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'confirm-'));
const cli = (cwd, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });

test('findsRootAndChildren', () => {
  const root = tmp();
  repo(root, { a: plan });
  repo(path.join(root, 'web'), { b: plan });
  fs.mkdirSync(path.join(root, 'empty'));
  const found = c.findPlans(root).map((f) => ({ ...f, plan: path.relative(root, f.plan).split(path.sep).join('/') }));
  assert.deepStrictEqual(found, [
    { id: 'a', repo: '.', plan: 'docs/ristretto/plans/a.md' },
    { id: 'b', repo: 'web', plan: 'web/docs/ristretto/plans/b.md' },
  ]);
  const listed = JSON.parse(cli(root, 'list').stdout);
  assert.deepStrictEqual(listed.features.map((f) => [f.id, f.repo, f.checks.length]), [['a', '.', 2], ['b', 'web', 2]]);
  assert.deepStrictEqual(JSON.parse(cli(root, 'list', 'b').stdout).features.map((f) => f.id), ['b']);
});

test('sameIdTwoReposRefuses', () => {
  const root = tmp();
  repo(path.join(root, 'api'), { x: plan });
  repo(path.join(root, 'web'), { x: plan });
  const refused = cli(root, 'tick', 'x');
  assert.strictEqual(refused.status, 2);
  assert.ok(/api/.test(refused.stderr) && /web/.test(refused.stderr), refused.stderr);
  const ok = cli(root, 'tick', 'x', '--repo', 'web', '--date', DATE);
  assert.strictEqual(ok.status, 0, ok.stderr);
  assert.deepStrictEqual(JSON.parse(ok.stdout).ticked, [1, 2]);
  assert.ok(fs.readFileSync(path.join(root, 'web', 'docs', 'ristretto', 'plans', 'x.md'), 'utf8').includes('[x] [human]'));
  assert.strictEqual(fs.readFileSync(path.join(root, 'api', 'docs', 'ristretto', 'plans', 'x.md'), 'utf8'), plan);
});

test('keepAndNoteFromCli', () => {
  const root = tmp();
  repo(root, { k: plan });
  const r = cli(root, 'tick', 'k', '--keep', '2', '--note', 'not yet', '--date', DATE);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout).kept, [2]);
  assert.ok(fs.readFileSync(path.join(root, 'docs', 'ristretto', 'plans', 'k.md'), 'utf8').includes('Outlook — not yet'));
});

test('nothingOpenExits1', () => {
  const root = tmp();
  repo(root, { done1: plan.replace(/\[ \] \[human\]/g, '[x] [human]') });
  const r = cli(root, 'tick', 'done1');
  assert.strictEqual(r.status, 1);
  assert.ok(r.stderr.includes('nothing open in done1'), r.stderr);
});

test('unknownIdExits2', () => {
  const root = tmp();
  repo(root, { a: plan });
  assert.strictEqual(cli(root, 'tick', 'nope').status, 2);
});

test('keepOutOfRangeRefuses', () => {
  const root = tmp();
  repo(root, { r: plan });
  const r = cli(root, 'tick', 'r', '--keep', '5', '--note', 'not yet', '--date', DATE);
  assert.strictEqual(r.status, 2);
  assert.ok(/5/.test(r.stderr) && /2 open/.test(r.stderr), r.stderr);
  assert.strictEqual(fs.readFileSync(path.join(root, 'docs', 'ristretto', 'plans', 'r.md'), 'utf8'), plan, 'nothing ticked');
});

// Walking: ristretto ticks a box it checked itself, with what it saw.
const W = '2026-11-20';
test('listShowsHow', () => {
  assert.deepStrictEqual(c.openChecks(plan).map((o) => o.how), ['hosted project · run the migration', null]);
  const root = tmp(); repo(root, { h: plan });
  assert.strictEqual(JSON.parse(cli(root, 'list').stdout).features[0].checks[0].how, 'hosted project · run the migration');
});

test('walkTicksNamedBox', () => {
  const r = c.tick(plan, { date: W, by: 'T', boxes: new Map([[2, '840 before, 840 after']]) });
  assert.deepStrictEqual([r.ticked, r.kept, r.failed], [[2], [], []]);
  assert.ok(r.text.includes('  - [x] [human] the mail arrives in Outlook · checked by ristretto in T, 2026-11-20: 840 before, 840 after\n'));
  assert.ok(r.text.includes('  - [ ] [human] a free user sees the upgrade banner\n'), 'an unnamed box is left as it is');
  assert.ok(r.text.includes(`- 3: seen in T ${W}\n`));
  assert.ok(r.text.includes('- 2: pending human\n'));
});

test('failedStaysOpen', () => {
  const r = c.tick(plan, { date: W, by: 'T', failed: new Map([[1, 'jumps to top']]) });
  assert.deepStrictEqual([r.ticked, r.failed], [[], [1]]);
  assert.ok(r.text.includes('  - [ ] [human] a free user sees the upgrade banner\n'), 'a failed look never ticks');
  assert.ok(r.text.includes('- 2: pending human\n'));
  const findings = r.text.slice(r.text.indexOf('## Open findings'));
  assert.ok(r.text.includes('## Open findings') && findings.includes(`- a free user sees the upgrade banner — not as expected in T, ${W}: jumps to top`), r.text);
});

test('walkRefusesBadNumbers', () => {
  const root = tmp(); repo(root, { w: plan });
  const file = path.join(root, 'docs', 'ristretto', 'plans', 'w.md');
  for (const args of [
    ['--by', 'T', '--box', '5', '--saw', 'x'],
    ['--by', 'T', '--box', '1', '--saw', 'x', '--failed', '1', '--saw', 'y'],
    ['--by', 'T', '--box', '1', '--saw', 'x', '--box', '1', '--saw', 'y'],
    ['--by', 'T', '--keep', '1', '--box', '2', '--saw', 'x'],
    ['--by', 'T', '--box', '1'],
    ['--by', 'T'],
  ]) {
    const r = cli(root, 'tick', 'w', ...args, '--date', W);
    assert.strictEqual(r.status, 2, `${args.join(' ')} → ${r.status} ${r.stderr}`);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), plan, `${args.join(' ')} wrote the plan`);
  }
  const ok = cli(root, 'tick', 'w', '--by', 'T', '--box', '1', '--saw', 'ok', '--failed', '2', '--saw', 'no', '--date', W);
  assert.strictEqual(ok.status, 0, ok.stderr);
  assert.deepStrictEqual(JSON.parse(ok.stdout), { plan: file, ticked: [1], kept: [], failed: [2] });
});

// Review C1: a walk done one look at a time must not shift onto the next box.
test('walkOneCallPerLookStaysOnItsBox', () => {
  const three = plan.replace('- Provides: —', '  - [ ] [human] the export opens\n- Provides: —').replace('- gates: test ok', '- 4: pending human\n- gates: test ok');
  const root = tmp(); repo(root, { s: three });
  const file = path.join(root, 'docs', 'ristretto', 'plans', 's.md');
  const listed = JSON.parse(cli(root, 'list', 's').stdout).features[0].checks;
  assert.deepStrictEqual(listed.map((b) => b.box), [1, 2, 3]);
  assert.strictEqual(cli(root, 'tick', 's', '--by', 'T', '--box', String(listed[0].box), '--saw', 'saw A', '--date', W).status, 0);
  assert.strictEqual(cli(root, 'tick', 's', '--by', 'T', '--box', String(listed[1].box), '--saw', 'saw B', '--date', W).status, 0);
  const t = fs.readFileSync(file, 'utf8');
  assert.ok(t.includes('[x] [human] a free user sees the upgrade banner · checked by ristretto in T, 2026-11-20: saw A'), t);
  assert.ok(t.includes('[x] [human] the mail arrives in Outlook · checked by ristretto in T, 2026-11-20: saw B'), t);
  assert.ok(t.includes('  - [ ] [human] the export opens\n'), 'the box nobody looked at stays open');
  assert.ok(t.includes('- 4: pending human'), t);
  const again = cli(root, 'tick', 's', '--by', 'T', '--box', '1', '--saw', 'x', '--date', W);
  assert.strictEqual(again.status, 2, 'a box already ticked is not open: refuse');
  assert.deepStrictEqual(JSON.parse(cli(root, 'list', 's').stdout).features[0].checks.map((b) => b.box), [3], 'box numbers stay put after a tick');
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
