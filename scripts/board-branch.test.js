#!/usr/bin/env node
// Self-check for hooks/board-branch.mjs — run with: node scripts/board-branch.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const file = path.join(__dirname, '..', 'hooks', 'board-branch.mjs');
  const b = await import(pathToFileURL(file).href);
  const H = (c) => c.repeat(40);

  // git argv: fixed arrays, refs only from git's own output.
  assert.deepStrictEqual(b.headArgs, ['rev-parse', '--abbrev-ref', 'HEAD']);
  assert.deepStrictEqual(b.shortHeadArgs, ['rev-parse', '--short', 'HEAD']);
  assert.deepStrictEqual(b.logArgs('refs/heads/main'), ['log', '--format=%ct%x09%s', 'refs/heads/main..HEAD', '--']);

  // The base (spec 4.2). Review Focus 1: no base at all.
  assert.strictEqual(b.parseBase({ head: 'feature/x', originHead: '', refs: '', isAncestor: () => false }), null);
  // Local main behind origin/main: the one that contains the other.
  assert.deepStrictEqual(b.parseBase({ head: 'feature/x', originHead: 'refs/remotes/origin/main', refs: 'refs/heads/main\nrefs/remotes/origin/main\n', isAncestor: (a, c) => a === 'refs/heads/main' && c === 'refs/remotes/origin/main' }), { ref: 'refs/remotes/origin/main', label: 'main' });
  // Diverged: the local one.
  assert.deepStrictEqual(b.parseBase({ head: 'feature/x', originHead: 'refs/remotes/origin/main', refs: 'refs/heads/main\nrefs/remotes/origin/main\n', isAncestor: () => false }), { ref: 'refs/heads/main', label: 'main' });
  // No remote: local main, else master.
  assert.deepStrictEqual(b.parseBase({ head: 'feature/x', originHead: '', refs: 'refs/heads/master\n', isAncestor: () => false }), { ref: 'refs/heads/master', label: 'master' });
  assert.deepStrictEqual(b.parseBase({ head: 'HEAD', originHead: '', refs: 'refs/heads/main\nrefs/heads/master\n', isAncestor: () => false }), { ref: 'refs/heads/main', label: 'main' }, 'a detached HEAD compares with main');
  // origin/HEAD naming another default branch.
  assert.deepStrictEqual(b.parseBase({ head: 'feature/x', originHead: 'refs/remotes/origin/develop', refs: 'refs/heads/main\n', isAncestor: () => false }), { ref: 'refs/remotes/origin/develop', label: 'develop' });
  // On the default branch: its remote-tracking ref, else nothing to compare with.
  assert.deepStrictEqual(b.parseBase({ head: 'main', originHead: 'refs/remotes/origin/main', refs: 'refs/heads/main\nrefs/remotes/origin/main\n', isAncestor: () => true }), { ref: 'refs/remotes/origin/main', label: 'origin/main' });
  assert.strictEqual(b.parseBase({ head: 'main', originHead: '', refs: 'refs/heads/main\n', isAncestor: () => true }), null);

  // The default branch's name, so a card on it can say there is nothing to compare with.
  assert.strictEqual(b.defaultBranch({ originHead: 'refs/remotes/origin/develop', refs: '' }), 'develop');
  assert.strictEqual(b.defaultBranch({ originHead: '', refs: 'refs/heads/master\n' }), 'master');
  assert.strictEqual(b.defaultBranch({ originHead: '', refs: '' }), null);
  assert.strictEqual(b.branchOf({ head: 'main', base: null, commits: [], known: () => true, runs: [], now: 0, onDefault: true }).onDefault, true);

  // Commits and the features on the branch: a feature counts only through a commit that is not docs.
  const commits = b.parseLog('1760430000\tfeat(lnw-export): a\n1760420000\tdocs(ristretto): strata\n1760410000\tfix(board): b\n1760400000\tdocs(lnw-export): manual checks passed\n\n');
  assert.deepStrictEqual(commits[0], { at: 1760430000000, subject: 'feat(lnw-export): a' });
  assert.strictEqual(commits.length, 4);
  assert.deepStrictEqual(b.featuresOn(commits, (id) => id === 'lnw-export'), ['lnw-export']);
  // A docs commit alone never puts a feature on the branch (a block's roadmap edit, a check re-run).
  assert.deepStrictEqual(b.featuresOn(b.parseLog('1760430000\tdocs(lnw-mail): blocked\n1760420000\tdocs(sisi-rename): manual checks passed\n'), () => true), []);
  assert.deepStrictEqual(b.featuresOn(b.parseLog('3\tfix(a): x\n2\tfeat(b): y\n1\tfeat(a): z\n'), () => true), ['a', 'b'], 'newest first, each once');

  // Review Focus 2: stale, pruned or half-written verdicts never read green.
  assert.strictEqual(b.suiteOf(null, { treeMatches: false, head: H('a') }).state, 'unproven');
  assert.strictEqual(b.suiteOf({ verdict: 'green', tree: H('b'), head: H('c') }, { treeMatches: false, head: H('a') }).state, 'unproven');
  assert.strictEqual(b.suiteOf({ verdict: 'green', tree: H('b'), head: H('c') }, { treeMatches: true, head: H('a') }).state, 'green');
  assert.strictEqual(b.suiteOf({ verdict: 'green', tree: null, head: H('a') }, { treeMatches: false, head: H('a') }).state, 'green', 'no tree: the head must match');
  assert.strictEqual(b.suiteOf({ verdict: 'green', tree: null, head: H('b') }, { treeMatches: false, head: H('a') }).state, 'unproven');
  assert.strictEqual(b.suiteOf({ verdict: 'green', tree: null, head: null }, { treeMatches: false, head: null }).state, 'unproven', 'no proof at all is no proof');
  const red = b.suiteOf({ verdict: 'red', tree: H('b'), failing: 'test' }, { treeMatches: true });
  assert.deepStrictEqual([red.state, red.failing], ['red', 'test']);
  assert.strictEqual(b.suiteOf({ verdict: 'unverified', tree: H('b') }, { treeMatches: true }).state, 'unproven');
  assert.strictEqual(b.suiteOf({ verdict: 'green', tree: 'not-a-tree' }, { treeMatches: true }).state, 'unproven', 'a half-written file never proves');
  assert.strictEqual(b.suiteOf('garbage', { treeMatches: true }).state, 'unproven');
  assert.deepStrictEqual(b.suiteArgs(H('b')), ['diff', '--quiet', '--end-of-options', H('b'), 'HEAD', '--', '.', ':(exclude)docs/ristretto']);
  assert.strictEqual(b.suiteArgs('../../etc'), null);
  assert.strictEqual(b.suiteArgs('z'.repeat(40)), null);
  assert.strictEqual(b.suiteArgs(null), null);

  // When, in words a person reads: local days, the clock passed in.
  const now = new Date(2026, 9, 14, 15, 0).getTime();
  assert.strictEqual(b.ago(new Date(2026, 9, 14, 13, 13).getTime(), now), 'today 13:13');
  assert.strictEqual(b.ago(new Date(2026, 9, 13, 23, 59).getTime(), now), 'yesterday');
  assert.strictEqual(b.ago(new Date(2026, 9, 11, 9, 0).getTime(), now), '3 days ago');

  // The branch: no base (or nothing ahead) means no scope.
  let br = b.branchOf({ head: 'feature/x', base: null, commits: [], known: () => true, runs: [], now });
  assert.deepStrictEqual([br.name, br.base, br.ids], ['feature/x', null, null]);
  br = b.branchOf({ head: 'feature/x', base: { ref: 'refs/heads/main', label: 'main' }, commits: [], known: () => true, runs: [], now });
  assert.strictEqual(br.ids, null, 'nothing ahead: nothing is scoped to the branch');
  const at = new Date(2026, 9, 14, 13, 13).getTime();
  br = b.branchOf({ head: 'brew/x', base: { ref: 'refs/heads/main', label: 'main' }, commits: [{ at: at - 3600000, subject: 'feat(a): x' }], known: () => true, runs: [{ id: 'a', endedAt: at }, { id: 'zz', endedAt: at + 60000 }], now });
  assert.deepStrictEqual([br.base, br.ids, br.lastBrew], ['main', ['a'], 'last brew today 13:13'], 'the newest run of a feature on the branch');
  br = b.branchOf({ head: 'brew/x', base: { ref: 'refs/heads/main', label: 'main' }, commits: [{ at, subject: 'feat(a): x' }], known: () => true, runs: [], now });
  assert.strictEqual(br.lastBrew, 'last commit today 13:13', 'no run record: the newest feature commit');
  br = b.branchOf({ head: 'brew/x', base: { ref: 'refs/heads/main', label: 'main' }, commits: [{ at, subject: 'chore: x' }], known: () => true, runs: [], now });
  assert.deepStrictEqual([br.ids, br.lastBrew], [[], ''], 'ahead with no feature: an empty scope');

  assert.ok(!/Date\.now|Math\.random/.test(fs.readFileSync(file, 'utf8')), 'the clock is passed in, never read');
  console.log('board-branch.test.js: all checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
