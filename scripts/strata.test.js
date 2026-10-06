#!/usr/bin/env node
// Self-check for strata.mjs — run with: node scripts/strata.test.js
//
// Reporting verbs are driven through the fake git shim (scripts/strata.fixtures/
// fake-git.mjs), pointed at by $STRATA_GIT so the product spawns it via
// process.execPath directly — no bash wrapper, no PATH edit. `stratify`, which
// does real git surgery, is driven against real temporary repositories.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(__dirname, 'strata.mjs');
const FAKE_GIT = path.join(__dirname, 'strata.fixtures', 'fake-git.mjs');

let pass = 0;
function ok(name) { pass++; console.log(`  PASS  ${name}`); }

// --- reporting verbs, via the shim ---------------------------------------
function runShim(scenario, verb, args = []) {
  return spawnSync(process.execPath, [SCRIPT, verb, ...args], {
    encoding: 'utf8',
    env: { ...process.env, STRATA_GIT: FAKE_GIT, GIT_SCENARIO: scenario },
  });
}

function expect(scenario, verb, args, { code = 0, out = [], err = [] } = {}) {
  const r = runShim(scenario, verb, args);
  const label = `${verb} [${scenario}] ${args.join(' ')}`;
  assert.strictEqual(r.status, code, `${label}: exit ${r.status} !== ${code}\n${r.stderr}`);
  for (const s of out) assert.ok(r.stdout.includes(s), `${label}: stdout missing "${s}"\n${r.stdout}`);
  for (const s of err) assert.ok(r.stderr.includes(s), `${label}: stderr missing "${s}"\n${r.stderr}`);
  ok(label);
}

console.log('== dispatch ==');
{
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.strictEqual(r.status, 1, 'no-arg must exit 1');
  assert.ok(r.stdout.includes('usage:'), 'no-arg usage goes to stdout');
  ok('no-arg prints usage on stdout, exits 1');

  const src = fs.readFileSync(SCRIPT, 'utf8');
  for (const v of ['check-branch', 'validate-range', 'authors', 'analyze', 'stratify']) {
    assert.ok(src.includes(`case '${v}':`), `dispatch must expose ${v}`);
  }
  assert.ok(!/case 'coalesce-runs'/.test(src), 'coalesce-runs must NOT be a public verb');
  for (const dead of ['--mode', '--remotes', 'pushedHashes', 'computePushed', 'resolveRemote',
                      'printRemoteCheck', 'printModeAndPrBranch']) {
    assert.ok(!src.includes(dead), `dead machinery "${dead}" must be gone`);
  }
  ok('dispatch exposes exactly the five verbs; remote/mode machinery gone');
}

console.log('== check-branch ==');
expect('feature_mixed', 'check-branch', [], {
  out: ['current: feature/ABC-123-otp', 'default: main', 'is_default: false',
        'suggested_range: a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1..HEAD'],
});
expect('default_clean', 'check-branch', [], { out: ['current: main', 'default: main', 'is_default: true'] });

console.log('== validate-range ==');
expect('feature_mixed', 'validate-range', ['main..HEAD'], { out: ['valid: true', 'commits_in_range: 3'] });
expect('feature_mixed', 'validate-range', [], { code: 2, err: ['no range given'] });
expect('feature_mixed', 'validate-range', ['main...HEAD'], { code: 2, err: ['two-dot range'] });
expect('feature_mixed', 'validate-range', ['a..b..c'], { code: 2, err: ['exactly <start>..<end>'] });

console.log('== authors ==');
expect('feature_mixed', 'authors', ['main..HEAD'], {
  out: ['Ada Lovelace <ada@example.com>', 'Alan Turing <alan@example.com>', 'distinct_authors: 2'],
});

console.log('== analyze: classification ==');
expect('feature_mixed', 'analyze', ['main..HEAD'], {
  out: ['[MIXED (docs path + non-docs files)]', '[docs-only]',
        '[type-3 (docs(ristretto) scope, no docs path)]',
        'derived_type:', 'type_candidates:', 'pr_branch: ABC-123-pr'],
});
// The remote/mode sections are gone.
{
  const r = runShim('feature_mixed', 'analyze', ['main..HEAD']);
  for (const gone of ['== Remote check ==', '== Mode ==', 'Recommended:']) {
    assert.ok(!r.stdout.includes(gone), `analyze must not print "${gone}"`);
  }
  ok('analyze prints no Remote/Mode/Recommended sections');
}

console.log('== analyze: merge refusal ==');
{
  const r = runShim('with_merge', 'analyze', ['main..HEAD']);
  assert.strictEqual(r.status, 2, 'analyze refuses a range with a merge');
  assert.ok(/merge commit/.test(r.stderr), 'analyze names the merge');
  ok('analyze refuses a merge, exit 2 stderr');
}

console.log('== stratify against real temp repos ==');

// Build a deterministic temp repo and return its path.
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ristretto-strata-'));
  const g = (a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@example.com']);
  g(['config', 'user.name', 'Tester']);
  return {
    dir,
    run: (a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' }),
    commit: (files, msg) => {
      for (const [p, body] of Object.entries(files)) {
        fs.mkdirSync(path.join(dir, path.dirname(p)), { recursive: true });
        fs.writeFileSync(path.join(dir, p), body);
      }
      g(['add', '-A']);
      g(['commit', '-qm', msg]);
      return g(['rev-parse', 'HEAD']).stdout.trim();
    },
    stratify: (args) => spawnSync(process.execPath, [SCRIPT, 'stratify', ...args], { cwd: dir, encoding: 'utf8' }),
    head: () => g(['rev-parse', 'HEAD']).stdout.trim(),
    out: (a) => g(a).stdout.trim(),
  };
}

function baseFixture() {
  const r = repo();
  r.commit({ 'README.md': 'base\n', 'docs/ristretto/plans/a.md': 'p1\n', 'app.js': 'app0\n' }, 'chore: init');
  r.run(['checkout', '-qb', 'feature/x']);
  r.commit({ 'app.js': 'code1\n' }, 'feat(app): add app');
  r.commit({ 'docs/ristretto/plans/b.md': 'p2\n', 'app.js': 'code1\ncode2\n' }, 'feat(app): add plan + code');
  r.commit({ 'docs/ristretto/plans/c.md': 'p3\n' }, 'docs(ristretto): add plan c');
  const type3 = r.commit({ 'notes.txt': 'z\n' }, 'docs(ristretto): drop stale plan');
  return { r, type3 };
}

// criterion: stratify builds the branch, verified true, source tip unchanged
{
  const { r } = baseFixture();
  const sourceTip = r.head();
  const res = r.stratify(['main..HEAD', '--pr-branch', 'cleaned']);
  assert.strictEqual(res.status, 0, `stratify must succeed\n${res.stderr}`);
  const json = JSON.parse(res.stdout);
  assert.strictEqual(json.pr_branch, 'cleaned');
  assert.strictEqual(json.verified, true, 'verified must be true');
  assert.ok(json.base && json.pr_tip, 'JSON carries base and pr_tip');
  assert.strictEqual(r.run(['show-ref', '--verify', '--quiet', 'refs/heads/cleaned']).status, 0, 'branch exists');
  assert.strictEqual(r.head(), sourceTip, 'source branch tip unchanged');
  ok('stratify: branch built, verified true, source tip unchanged, JSON fields present');
}

// criterion: mixed replayed copy carries non-docs and no docs; one docs-add commit
{
  const { r } = baseFixture();
  const res = r.stratify(['main..HEAD', '--pr-branch', 'cleaned']);
  assert.strictEqual(res.status, 0, res.stderr);
  const filesOf = (h) => r.out(['show', '--name-only', '--format=', h]).split('\n').filter(Boolean);
  const replayed = r.out(['rev-list', '--reverse', 'main..cleaned']).split('\n').filter(Boolean);
  const mixed = replayed.find((h) => r.out(['log', '-1', '--format=%s', h]) === 'feat(app): add plan + code');
  assert.ok(mixed, 'mixed commit replayed');
  const mixedFiles = filesOf(mixed);
  assert.ok(mixedFiles.includes('app.js'), 'mixed copy keeps its non-docs file');
  assert.ok(!mixedFiles.some((f) => f.startsWith('docs/ristretto/')), 'mixed copy carries no docs file');
  const adds = r.out(['log', '--diff-filter=A', '--oneline', 'main..cleaned', '--', 'docs/ristretto/']).split('\n').filter(Boolean);
  assert.strictEqual(adds.length, 1, `exactly one docs-add commit, got ${adds.length}`);
  ok('mixed copy strips docs; exactly one docs(ristretto) add commit');
}

// criterion: docs-only contributes no replayed commit; type-3 retitled
{
  const { r, type3 } = baseFixture();
  const res = r.stratify(['main..HEAD', '--pr-branch', 'cleaned']);
  assert.strictEqual(res.status, 0, res.stderr);
  const subjects = r.out(['log', '--format=%s', 'main..cleaned']).split('\n').filter(Boolean);
  assert.ok(!subjects.includes('docs(ristretto): add plan c'), 'docs-only commit not replayed');
  const type3Subj = r.out(['log', '-1', '--format=%s', type3]);
  assert.strictEqual(type3Subj, 'docs(ristretto): drop stale plan');
  const replayedType3 = subjects.find((s) => s.includes('drop stale plan'));
  assert.strictEqual(replayedType3, 'chore: drop stale plan', 'type-3 retitled, docs scope stripped');
  ok('docs-only skipped; type-3 replayed with derived subject');
}

// criterion: retitle derivation per path class (case-insensitive on all rules)
{
  const cases = [
    ['tests/foo.test.js', 'test'],
    ['Tests/helper.js', 'test'],
    ['.github/workflows/ci.yml', 'ci'],
    ['.GitHub/workflows/ci.yml', 'ci'],
    ['README.md', 'docs'],
    ['CHANGELOG.md', 'docs'],
    ['package.json', 'chore'],
    ['Package.json', 'chore'],
    ['.Ristretto.json', 'chore'],
    ['PACKAGES.JSON', 'chore'],
  ];
  for (const [p, type] of cases) {
    const r = repo();
    r.commit({ 'placeholder.txt': 'x\n' }, 'chore: init');
    r.run(['checkout', '-qb', 'feature/x']);
    r.commit({ [p]: 'x\n' }, `docs(ristretto): touch ${p}`);
    const res = r.stratify(['main..HEAD', '--pr-branch', 'cleaned']);
    assert.strictEqual(res.status, 0, `${p}: ${res.stderr}`);
    const subj = r.out(['log', '--format=%s', 'main..cleaned']).split('\n').filter(Boolean);
    assert.ok(subj.includes(`${type}: touch ${p}`), `${p} should retitle to "${type}", got ${JSON.stringify(subj)}`);
  }
  ok('retitle derivation: test/ci/docs/chore per path class, case-insensitive (chore i-flag pinned)');
}

// criterion: a MIXED commit on a docs-less base replays with no docs
// (pins the ruling: the docs clear must run even when the base has no docs)
{
  const r = repo();
  r.commit({ 'placeholder.txt': 'x\n' }, 'chore: init'); // base has NO docs/ristretto
  r.run(['checkout', '-qb', 'feature/x']);
  r.commit({ 'app.js': 'a\n', 'docs/ristretto/plans/x.md': 'p\n' }, 'feat(app): add code + plan');
  const res = r.stratify(['main..HEAD', '--pr-branch', 'cleaned']);
  assert.strictEqual(res.status, 0, `docs-less-base mixed must succeed: ${res.stderr}`);
  const filesOf = (h) => r.out(['show', '--name-only', '--format=', h]).split('\n').filter(Boolean);
  const replayed = r.out(['rev-list', '--reverse', 'main..cleaned']).split('\n').filter(Boolean);
  const mixed = replayed.find((h) => r.out(['log', '-1', '--format=%s', h]) === 'feat(app): add code + plan');
  assert.ok(mixed, 'mixed commit replayed');
  assert.ok(filesOf(mixed).includes('app.js'), 'mixed copy keeps its non-docs file');
  assert.ok(!filesOf(mixed).some((f) => f.startsWith('docs/ristretto/')),
    'mixed copy carries no docs on a docs-less base');
  ok('MIXED on docs-less base replays without docs (clear-guard regression pinned)');
}

// criterion: the chore RETITLE_RULE carries the i flag like its three siblings
// (the round-3 block; observable output is identical — the default already yields
// chore — so the pin is structural, matching the dispatch dead-machinery grep)
{
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(/package\\\.json\|\\\.ristretto\\\.json\)\$\/i\.test/.test(src),
    'chore RETITLE_RULE must be case-insensitive (trailing i flag)');
  ok('chore RETITLE_RULE carries the i flag (round-3 block pinned structurally)');
}

// criterion: a Revert "…" subject upgrades a chore type-3 retitle to fix
{
  const r = repo();
  r.commit({ 'placeholder.txt': 'x\n' }, 'chore: init');
  r.run(['checkout', '-qb', 'feature/x']);
  r.commit({ 'package.json': '{"x":1}\n' }, 'docs(ristretto): Revert "feat: add pkg"');
  const res = r.stratify(['main..HEAD', '--pr-branch', 'cleaned']);
  assert.strictEqual(res.status, 0, res.stderr);
  const subjects = r.out(['log', '--format=%s', 'main..cleaned']).split('\n').filter(Boolean);
  assert.ok(subjects.includes('fix: Revert "feat: add pkg"'),
    `revert must retitle to fix, got ${JSON.stringify(subjects)}`);
  assert.ok(!subjects.some((s) => s.startsWith('chore:')), 'revert must not derive chore');
  ok('Revert "…" intent marker → fix (not chore)');
}

// criterion: multi-outcome type-3 → chore; --retitle overrides
{
  const r = repo();
  r.commit({ 'placeholder.txt': 'x\n' }, 'chore: init');
  r.run(['checkout', '-qb', 'feature/x']);
  const h = r.commit({ 'README.md': 'x\n', 'tests/foo.test.js': 't\n' }, 'docs(ristretto): multi-outcome');
  const res = r.stratify(['main..HEAD', '--pr-branch', 'cleaned']);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(r.out(['log', '--format=%s', 'main..cleaned']).includes('chore: multi-outcome'), 'multi-outcome → chore, no refusal');

  const r2 = repo();
  r2.commit({ 'placeholder.txt': 'x\n' }, 'chore: init');
  r2.run(['checkout', '-qb', 'feature/x']);
  const h2 = r2.commit({ 'README.md': 'x\n', 'tests/foo.test.js': 't\n' }, 'docs(ristretto): multi-outcome');
  const res2 = r2.stratify(['main..HEAD', '--pr-branch', 'cleaned', '--retitle', `${h2}=chore: bespoke`]);
  assert.strictEqual(res2.status, 0, res2.stderr);
  assert.ok(r2.out(['log', '--format=%s', 'main..cleaned']).includes('chore: bespoke'), '--retitle override applied');
  void h;
  ok('multi-outcome → chore; --retitle override wins');
}

// criterion: refusals (dirty, branch-exists, merge) exit 2, no temp worktree
{
  const { r } = baseFixture();
  fs.writeFileSync(path.join(r.dir, 'dirty.txt'), 'x\n');
  let res = r.stratify(['main..HEAD', '--pr-branch', 'clean-dirty']);
  assert.strictEqual(res.status, 2, 'dirty tree refuses');
  assert.ok(/dirty/.test(res.stderr), 'dirty refusal names it');
  fs.unlinkSync(path.join(r.dir, 'dirty.txt'));

  res = r.stratify(['main..HEAD', '--pr-branch', 'cleaned']);
  assert.strictEqual(res.status, 0, res.stderr);
  res = r.stratify(['main..HEAD', '--pr-branch', 'cleaned']);
  assert.strictEqual(res.status, 2, 'existing branch refuses');
  assert.ok(/already exists/.test(res.stderr), 'branch-exists refusal names it');

  const list = r.out(['worktree', 'list']).split('\n').filter(Boolean);
  assert.strictEqual(list.length, 1, `no temp worktree left, got ${list.length}`);

  // merge refusal
  const m = repo();
  m.commit({ 'f.txt': 'a\n' }, 'chore: init');
  m.run(['checkout', '-qb', 'side']);
  m.commit({ 'g.txt': 'b\n' }, 'feat: side');
  m.run(['checkout', '-q', 'main']);
  m.run(['merge', '-q', '--no-ff', '--no-edit', 'side']);
  res = m.stratify(['main~1..HEAD', '--pr-branch', 'never']);
  assert.strictEqual(res.status, 2, 'merge refuses');
  assert.ok(/merge commit/.test(res.stderr), 'merge refusal names it');
  assert.strictEqual(m.out(['worktree', 'list']).split('\n').filter(Boolean).length, 1, 'no temp worktree after merge refusal');
  ok('dirty / branch-exists / merge refusals exit 2, no temp worktree left');
}

// criterion: cherry-pick conflict aborts, removes worktree, names the hash
{
  const r = repo();
  r.commit({ 'f.txt': 'a\n' }, 'chore: init');
  r.run(['checkout', '-qb', 'feature/x']);
  const conflict = r.commit({ 'f.txt': 'b\n' }, 'feat: a to b');
  r.run(['checkout', '-q', 'main']);
  r.commit({ 'f.txt': 'z\n' }, 'chore: diverge');
  const res = r.stratify(['main..feature/x', '--pr-branch', 'conf']);
  assert.strictEqual(res.status, 2, 'conflict refuses');
  assert.ok(res.stderr.includes(conflict), 'conflict names the hash');
  assert.strictEqual(r.out(['worktree', 'list']).split('\n').filter(Boolean).length, 1, 'no temp worktree after conflict');
  assert.ok(!r.out(['branch']).includes('conf'), 'no half-built PR branch left');
  ok('cherry-pick conflict aborts cleanly, names hash, no worktree/branch left');
}

// criterion: main checkout undisturbed by a successful stratify
{
  const { r } = baseFixture();
  const before = { head: r.head(), status: r.out(['status', '--porcelain']) };
  const res = r.stratify(['main..HEAD', '--pr-branch', 'cleaned']);
  assert.strictEqual(res.status, 0, res.stderr);
  const after = { head: r.head(), status: r.out(['status', '--porcelain']) };
  assert.deepStrictEqual(after, before, 'main checkout HEAD/status identical');
  assert.ok(!fs.existsSync(path.join(r.dir, '.ristretto', 'pulling')), 'no pulling marker created');
  ok('main checkout undisturbed; no marker created');
}

// criterion: a range whose tip docs equal the base's appends no docs commit
{
  const r = repo();
  r.commit({ 'README.md': 'base\n', 'docs/ristretto/plans/a.md': 'p\n' }, 'chore: init');
  r.run(['checkout', '-qb', 'feature/x']);
  r.commit({ 'code.js': 'c\n' }, 'feat: add code only');
  const res = r.stratify(['main..HEAD', '--pr-branch', 'cleaned']);
  assert.strictEqual(res.status, 0, `no-net-docs-change must not fail: ${res.stderr}`);
  const json = JSON.parse(res.stdout);
  assert.strictEqual(json.verified, true, 'verified true');
  const subjects = r.out(['log', '--format=%s', 'main..cleaned']).split('\n').filter(Boolean);
  assert.ok(!subjects.some((s) => s.startsWith('docs(ristretto)')), 'no spurious docs commit appended');
  ok('range with no net docs change succeeds without an empty docs commit');
}

// criterion: a range that deletes docs still builds a byte-identical branch
{
  const r = repo();
  r.commit({ 'docs/ristretto/plans/a.md': 'p\n', 'docs/ristretto/plans/b.md': 'q\n', 'code.js': 'c\n' }, 'chore: init');
  r.run(['checkout', '-qb', 'feature/x']);
  r.run(['rm', '-q', 'docs/ristretto/plans/b.md']);
  r.run(['commit', '-qm', 'docs(ristretto): drop plan b']);
  const res = r.stratify(['main..HEAD', '--pr-branch', 'cleaned']);
  assert.strictEqual(res.status, 0, `docs-deletion range must succeed: ${res.stderr}`);
  assert.strictEqual(JSON.parse(res.stdout).verified, true, 'verified true after docs deletion');
  assert.ok(r.run(['diff', '--quiet', 'feature/x', 'cleaned']).status === 0, 'tip tree identical after docs deletion');
  ok('range deleting docs builds a byte-identical branch');
}

// criterion: --fold collapses a same-scope run and keeps the tip
{
  const r = repo();
  r.commit({ 'README.md': 'base\n', 'docs/ristretto/plans/a.md': 'p\n' }, 'chore: init');
  r.run(['checkout', '-qb', 'feature/x']);
  r.commit({ 'f.js': '1\n' }, 'fix(gate): tighten lock');
  r.commit({ 'f.js': '1\n2\n' }, 'refactor(gate): extract ratchet');
  r.commit({ 'f.js': '1\n2\n3\n' }, 'chore(gate): rename helper');
  r.commit({ 'docs/ristretto/plans/b.md': 'q\n' }, 'docs(ristretto): add plan');
  const res = r.stratify(['main..HEAD', '--pr-branch', 'folded', '--fold']);
  assert.strictEqual(res.status, 0, res.stderr);
  const gateCommits = r.out(['log', '--format=%s', 'main..folded']).split('\n').filter((s) => s.includes('(gate)'));
  assert.strictEqual(gateCommits.length, 1, `three same-scope commits fold to one, got ${gateCommits.length}`);
  assert.ok(r.run(['diff', '--quiet', 'feature/x', 'folded']).status === 0, 'folded tip tree identical to source');
  ok('--fold collapses a run; tip tree byte-identical');
}

// criterion: MIXED commit whose docs file was ADDED by a skipped docs-only
// commit (modify/delete flavor). The docs hunk must never reach the replay, so
// the missing-from-base file cannot conflict.
{
  const r = repo();
  r.commit({ 'README.md': 'base\n' }, 'chore: init'); // base has NO docs/ristretto
  r.run(['checkout', '-qb', 'feature/x']);
  r.commit({ 'docs/ristretto/plans/x.md': 'plan v1\n' }, 'Prep: queue x'); // docs-only ADD (skipped)
  r.commit({ 'docs/ristretto/plans/x.md': 'plan v1\nplan v2\n', 'app.js': 'app\n' },
    'feat(x): implement x'); // MIXED MODIFY
  const res = r.stratify(['main..HEAD', '--pr-branch', 'cleaned']);
  assert.strictEqual(res.status, 0, `modify/delete flavor must succeed: ${res.stderr}`);
  assert.strictEqual(JSON.parse(res.stdout).verified, true, 'verified true');
  const filesOf = (h) => r.out(['show', '--name-only', '--format=', h]).split('\n').filter(Boolean);
  const replayed = r.out(['rev-list', '--reverse', 'main..cleaned']).split('\n').filter(Boolean);
  const mixed = replayed.find((h) => r.out(['log', '-1', '--format=%s', h]) === 'feat(x): implement x');
  assert.ok(mixed, 'mixed commit replayed');
  assert.ok(filesOf(mixed).includes('app.js'), 'mixed copy keeps its non-docs file');
  assert.ok(!filesOf(mixed).some((f) => f.startsWith('docs/ristretto/')), 'mixed copy carries no docs file');
  assert.ok(r.run(['diff', '--quiet', 'feature/x', 'cleaned']).status === 0, 'tip tree byte-identical');
  ok('MIXED after a docs-only ADD replays without conflict (modify/delete flavor)');
}

// criterion: two MIXED commits editing the same docs file, where the second's
// hunk was authored on top of the first's docs change that stratify strips
// (content flavor). Excluding docs from the replay removes the mismatch.
{
  const r = repo();
  r.commit({ 'README.md': 'base\n', 'docs/ristretto/roadmap.md': 'roadmap v1\n', 'code.js': 'c0\n' }, 'chore: init');
  r.run(['checkout', '-qb', 'feature/x']);
  r.commit({ 'docs/ristretto/roadmap.md': 'roadmap v1\na\n', 'code.js': 'c0\nc1\n' }, 'feat(a): mixed roadmap');
  r.commit({ 'docs/ristretto/roadmap.md': 'roadmap v1\na\nb\n', 'code.js': 'c0\nc1\nc2\n' }, 'feat(b): mixed roadmap');
  const res = r.stratify(['main..HEAD', '--pr-branch', 'cleaned']);
  assert.strictEqual(res.status, 0, `content flavor must succeed: ${res.stderr}`);
  assert.strictEqual(JSON.parse(res.stdout).verified, true, 'verified true');
  const filesOf = (h) => r.out(['show', '--name-only', '--format=', h]).split('\n').filter(Boolean);
  for (const subj of ['feat(a): mixed roadmap', 'feat(b): mixed roadmap']) {
    const h = r.out(['rev-list', '--reverse', 'main..cleaned']).split('\n').filter(Boolean)
      .find((x) => r.out(['log', '-1', '--format=%s', x]) === subj);
    assert.ok(h, `${subj} replayed`);
    assert.ok(filesOf(h).includes('code.js'), `${subj} keeps its non-docs file`);
    assert.ok(!filesOf(h).some((f) => f.startsWith('docs/ristretto/')), `${subj} carries no docs file`);
  }
  assert.ok(r.run(['diff', '--quiet', 'feature/x', 'cleaned']).status === 0, 'tip tree byte-identical');
  ok('two MIXED roadmap edits replay without conflict (content flavor)');
}
console.log('== fake-git fails loud on dead call shapes ==');
{
  const r = spawnSync(process.execPath, [FAKE_GIT, 'log', '--remotes=origin', '--format=%H', 'main..HEAD'], {
    encoding: 'utf8', env: { ...process.env, GIT_SCENARIO: 'feature_mixed' },
  });
  assert.strictEqual(r.status, 1, 'dead --remotes log form must fail loud');
  assert.ok(/unhandled/.test(r.stderr), 'shim says unhandled');
  ok('fake-git rejects the deleted remote call shape');
}

console.log(`\nstrata.test.js: all checks passed (${pass})`);
