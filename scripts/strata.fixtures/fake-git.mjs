#!/usr/bin/env node
// Fake `git` for strata's reporting verbs. Never placed on PATH and never run
// through a shell: `scripts/strata.test.js` points the product at this file via
// $STRATA_GIT, so the product spawns it as `process.execPath fake-git.mjs <args>`
// directly. Portable on Windows, macOS, and Linux alike.
//
// It answers only the call shapes the reporting verbs actually make, from an
// in-memory fixture selected by $GIT_SCENARIO, and fails loud on anything else —
// a shim that answers a call the product no longer makes is how a dead branch
// stays green.

const FIXTURES = {
  // Feature branch off main: one mixed commit, one docs-only, one type-3, plus
  // a ticket in a subject and two authors. Exercises analyze's full output.
  feature_mixed: {
    branch: 'feature/ABC-123-otp',
    defaultBranch: 'main',
    mergeBase: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
    revs: { main: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', HEAD: 'd4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4' },
    count: 3,
    merges: 0,
    log: [
      ['d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4', 'docs(ristretto): add otp plan', ['docs/ristretto/plans/otp.md']],
      ['c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3', 'docs(ristretto): drop stale plan', ['notes.txt']],
      ['b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2', 'feat(ABC-123): add otp resend', ['lib/app.rb', 'docs/ristretto/plans/otp.md']],
    ],
    authors: ['Ada Lovelace|ada@example.com', 'Alan Turing|alan@example.com'],
    configUser: 'Ada Lovelace', configEmail: 'ada@example.com',
  },

  // Default branch, no ticket anywhere, a single docs-only commit.
  default_clean: {
    branch: 'main',
    defaultBranch: 'main',
    mergeBase: null,
    revs: { main: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1' },
    count: 1,
    merges: 0,
    log: [
      ['a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 'docs(ristretto): plan x', ['docs/ristretto/plans/x.md']],
    ],
    authors: ['Ada Lovelace|ada@example.com'],
    configUser: null, configEmail: null,
  },

  // A range that contains a merge commit.
  with_merge: {
    branch: 'feature/mergey',
    defaultBranch: 'main',
    mergeBase: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
    revs: { main: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1' },
    count: 2,
    merges: 1,
    log: [
      ['b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2', 'Merge branch x', []],
    ],
    authors: ['Ada Lovelace|ada@example.com'],
    configUser: 'Ada Lovelace', configEmail: 'ada@example.com',
  },
};

const F = FIXTURES[process.env.GIT_SCENARIO] || FIXTURES.feature_mixed;

function ok() { process.exit(0); }
function fail() { process.exit(1); }
const out = (s) => { process.stdout.write(s + '\n'); };

const args = process.argv.slice(2);
const [sub, ...rest] = args;

if (sub === 'branch' && rest[0] === '--show-current') { out(F.branch); ok(); }

if (sub === 'symbolic-ref') { F.defaultBranch ? out(`refs/remotes/origin/${F.defaultBranch}`) : fail(); ok(); }

if (sub === 'show-ref' && rest[0] === '--verify') {
  const ref = rest.slice(-1)[0];
  ref === `refs/heads/${F.defaultBranch}` ? ok() : fail();
}

if (sub === 'merge-base' && rest[0] === '--is-ancestor') fail(); // default: not an ancestor
if (sub === 'merge-base') { F.mergeBase ? out(F.mergeBase) : fail(); ok(); }

if (sub === 'rev-parse') {
  const hasVerify = rest[0] === '--verify';
  const target = (hasVerify ? rest[1] : rest[0]) || '';
  const base = target.replace(/\^\{commit\}$/, '');
  if (Object.prototype.hasOwnProperty.call(F.revs, base)) { out(F.revs[base]); ok(); }
  if (/^[0-9a-f]{40}$/.test(base)) { out(base); ok(); }
  fail();
}

if (sub === 'rev-list' && rest[0] === '--merges') { out(String(F.merges)); ok(); }
if (sub === 'rev-list' && rest[0] === '--count') { out(String(F.count)); ok(); }

if (sub === 'config' && rest[0] === '--get') fail(); // resolveRemote is gone — must never be called
if (sub === 'config' && rest[0] === 'user.name') { F.configUser ? out(F.configUser) : fail(); ok(); }
if (sub === 'config' && rest[0] === 'user.email') { F.configEmail ? out(F.configEmail) : fail(); ok(); }

if (sub === 'status' && rest[0] === '--porcelain') { ok(); }

if (sub === 'log') {
  if (rest[0] === '--format=%H|%s' && rest.includes('--name-only')) {
    for (const [h, s, files] of F.log) {
      out(`${h}|${s}`);
      for (const f of files) out(f);
      process.stdout.write('\n');
    }
    ok();
  }
  if (rest[0] === '--format=%an%x09%ae') {
    for (const a of F.authors) {
      const tab = a.indexOf('|');
      out(`${a.slice(0, tab)}\t${a.slice(tab + 1)}`);
    }
    ok();
  }
  // Every other log shape is dead (remote/mode machinery deleted) — fail loud.
  console.error(`fake git: unhandled: ${args.join(' ')}`);
  fail();
}

// worktree/cherry-pick/restore/rm/diff are only exercised by the real-repo
// tests in strata.test.js, which do not route through this shim.
console.error(`fake git: unhandled: ${args.join(' ')}`);
fail();
