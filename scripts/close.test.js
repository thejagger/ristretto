#!/usr/bin/env node
// Self-check for scripts/close.js — run with: node scripts/close.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const SCRIPT = path.join(__dirname, 'close.js');
const c = require('./close.js');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const plan = [
  '# x',
  '',
  '## Contract',
  '- Acceptance:',
  '  - [auto] it works',
  '- Provides: —',
  '- Decisions:',
  '  - prep ruling: the list sorts by date',
  '',
  '## Approach',
  '- Likely touchpoints: src/a.js',
  '',
].join('\n');

const input = (over = {}) => ({
  evidence: ['1: test/a.test.js', 'review: /code-review high · fixed: 1 · open: 0'],
  decisions: [],
  findings: [],
  escalated: null,
  ...over,
});

const roadmap = [
  '# Ristretto Roadmap',
  '',
  '| Flight | Feature | Title | Tier | Status |',
  '|---|---|---|---|---|',
  '| — | x | The x feature | easy | in-progress |',
  '| — | y | The y feature | normal | planned |',
  '',
].join('\n');

test('writesEvidence', () => {
  const out = c.closePlan(plan, input());
  assert.ok(out.includes('## Evidence\n- 1: test/a.test.js\n- review: /code-review high · fixed: 1 · open: 0'), out);
});

test('reclosingReplacesEvidence', () => {
  const old = plan.replace('## Approach', '## Evidence\n- 1: pending human\n- gates: old\n\n## Approach');
  const out = c.closePlan(old, input());
  assert.ok(!out.includes('gates: old') && !out.includes('pending human'), out);
  assert.ok(out.includes('- 1: test/a.test.js'));
  assert.ok(out.includes('## Approach\n- Likely touchpoints: src/a.js\n'), 'Approach stays');
  assert.strictEqual(out.split('## Evidence').length, 2, 'one Evidence section');
});

test('decisionsBecomeTaken', () => {
  const out = c.closePlan(plan, input({ decisions: [{ question: 'which client?', ruling: 'the bare one' }] }));
  assert.ok(out.includes('  - prep ruling: the list sorts by date\n  - taken: which client? → the bare one\n'), out);
  const bare = plan.replace('- Decisions:\n  - prep ruling: the list sorts by date\n', '');
  const out2 = c.closePlan(bare, input({ decisions: [{ question: 'q', ruling: 'r' }] }));
  assert.ok(out2.includes('- Provides: —\n- Decisions:\n  - taken: q → r\n\n## Approach'), out2);
});

test('findingsSection', () => {
  const out = c.closePlan(plan, input({ findings: ['src/a.js:3 loads rows twice', 'src/b.js:9 unused import'] }));
  assert.ok(out.includes('## Open findings\n- src/a.js:3 loads rows twice\n- src/b.js:9 unused import'), out);
  assert.ok(!c.closePlan(plan, input()).includes('## Open findings'));
  const again = c.closePlan(out, input());
  assert.ok(!again.includes('## Open findings'), 'a re-close with no findings clears the old section');
});

test('escalationFlipsTier', () => {
  const out = c.closePlan(plan, input({ escalated: 'needs a migration' }));
  assert.ok(out.includes('- tier: normal · escalated from easy: needs a migration'), out);
  const r = c.closeRoadmap(roadmap, 'x', { escalated: 'needs a migration' });
  assert.ok(r.includes('| — | x | The x feature | normal | done |'), r);
});

test('roadmapOnlyStatus', () => {
  const r = c.closeRoadmap(roadmap, 'x', { escalated: null });
  assert.ok(r.includes('| — | x | The x feature | easy | done |'), r);
  assert.ok(r.includes('| — | y | The y feature | normal | planned |'), 'other rows untouched');
});

test('crlfSurvives', () => {
  const p = c.closePlan(plan.replace(/\n/g, '\r\n'), input({ findings: ['f'], decisions: [{ question: 'q', ruling: 'r' }] }));
  const r = c.closeRoadmap(roadmap.replace(/\n/g, '\r\n'), 'x', { escalated: null });
  for (const t of [p, r]) assert.ok(t.includes('\r\n') && !/[^\r]\n/.test(t), 'no bare \\n');
});

function repo(dir, ids) {
  fs.mkdirSync(path.join(dir, 'docs', 'ristretto', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'ristretto', 'roadmap.md'),
    roadmap.replace('| — | y |', ids.includes('y') ? '| — | y |' : '| — | zz |').replace('| x |', `| ${ids[0]} |`));
  for (const id of ids) fs.writeFileSync(path.join(dir, 'docs', 'ristretto', 'plans', `${id}.md`), plan);
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'close-'));
const cli = (cwd, args, stdin) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', input: stdin });

test('cliDeletesBuildPlan', () => {
  const root = tmp();
  repo(root, ['x']);
  fs.mkdirSync(path.join(root, '.ristretto', 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ristretto', 'build', 'x.md'), 'build plan');
  const r = cli(root, ['x'], JSON.stringify(input()));
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.ok(out.plan && out.roadmap);
  assert.ok(!fs.existsSync(path.join(root, '.ristretto', 'build', 'x.md')));
  assert.ok(fs.readFileSync(path.join(root, 'docs', 'ristretto', 'roadmap.md'), 'utf8').includes('| easy | done |'));
  assert.ok(fs.readFileSync(path.join(root, 'docs', 'ristretto', 'plans', 'x.md'), 'utf8').includes('## Evidence'));
});

test('cliSameIdTwoRepos', () => {
  const root = tmp();
  repo(path.join(root, 'api'), ['x']);
  repo(path.join(root, 'web'), ['x']);
  const refused = cli(root, ['x'], JSON.stringify(input()));
  assert.strictEqual(refused.status, 2);
  assert.ok(/api/.test(refused.stderr) && /web/.test(refused.stderr), refused.stderr);
  const ok = cli(root, ['x', '--repo', 'web'], JSON.stringify(input()));
  assert.strictEqual(ok.status, 0, ok.stderr);
  assert.ok(fs.readFileSync(path.join(root, 'api', 'docs', 'ristretto', 'roadmap.md'), 'utf8').includes('in-progress'), 'api untouched');
});

test('cliBadInputRefuses', () => {
  const root = tmp();
  repo(root, ['x']);
  const r = cli(root, ['x'], 'not json');
  assert.strictEqual(r.status, 2);
  assert.strictEqual(fs.readFileSync(path.join(root, 'docs', 'ristretto', 'plans', 'x.md'), 'utf8'), plan, 'nothing written');
});

// A pull on Windows fed the input through `cmd /c ... < file` at every close: PowerShell has no
// `<`, and a failed stdin read said only "input must be JSON".
test('cliReadsInputFile', () => {
  const root = tmp();
  repo(root, ['x']);
  fs.mkdirSync(path.join(root, '.ristretto'), { recursive: true });
  const file = path.join(root, '.ristretto', 'close-x.json');
  fs.writeFileSync(file, String.fromCharCode(0xfeff) + JSON.stringify(input())); // a BOM, as Windows PowerShell writes one
  const r = cli(root, ['x', '--input', '.ristretto/close-x.json']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.readFileSync(path.join(root, 'docs', 'ristretto', 'roadmap.md'), 'utf8').includes('| easy | done |'));
  assert.ok(!fs.existsSync(file), 'the input file is transient: gone once it is placed');
});

test('cliBadInputSaysWhy', () => {
  const root = tmp();
  repo(root, ['x']);
  const bad = cli(root, ['x'], '{"evidence": [');
  assert.strictEqual(bad.status, 2);
  assert.ok(bad.stderr.includes('not valid JSON'), bad.stderr);
  fs.writeFileSync(path.join(root, 'bad.json'), 'not json');
  const kept = cli(root, ['x', '--input', 'bad.json']);
  assert.strictEqual(kept.status, 2);
  assert.ok(fs.existsSync(path.join(root, 'bad.json')), 'a refused input file stays');
  const missing = cli(root, ['x', '--input', 'nope.json']);
  assert.strictEqual(missing.status, 2);
  assert.ok(missing.stderr.includes('cannot read') && missing.stderr.includes('nope.json'), missing.stderr);
});

(async () => {
  const bp = await import(pathToFileURL(path.join(__dirname, '..', 'hooks', 'board-plan.mjs')).href);
  test('boardReadsCodeReviewLine', () => {
    const parsed = bp.parsePlan(c.closePlan(plan, input()));
    assert.ok(parsed.review && parsed.review.startsWith('review: /code-review high'), String(parsed.review));
  });
  let failed = 0;
  for (const [name, fn] of tests) {
    try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message.split('\n')[0]}`); }
  }
  if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
  console.log('\nall passed');
})();
