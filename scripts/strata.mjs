#!/usr/bin/env node
// strata.mjs — deterministic helpers for collapsing docs/ristretto commits.
//
// The command is branch-only and non-destructive: `stratify` builds a fresh PR
// branch inside a throwaway `git worktree`, performing all replay there, so the
// main checkout's HEAD and index are never touched. There is no rewrite mode,
// no remote/mode machinery, and no gate lifecycle.
//
// Verbs:
//   check-branch                       print current/default branch + a resolvable suggested range
//   validate-range <range>             check the range is usable; exit non-zero + stderr on error
//   authors <range>                    list distinct authors in the range + configured identity
//   analyze <range> [--ticket ID]      classify relevant commits, derive type-3 retitles, suggest a PR branch
//   stratify <range> --pr-branch X [--subject S] [--retitle <hash>=<subject>]... [--fold] [--ticket T]
//                                      build the cleaned PR branch (worktree-isolated); prints JSON

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A test seam: when STRATA_GIT names a JS file, every git call is routed through
// it via the running node binary. This keeps the suite portable (no bash shim, no
// PATH wrapper — process.execPath directly) while the product still shells out to
// the real git in ordinary use.
const FAKE_GIT = process.env.STRATA_GIT || null;

function spawnGit(args, cwd, input) {
  return spawnSync(
    FAKE_GIT ? process.execPath : 'git',
    FAKE_GIT ? [FAKE_GIT, ...args] : args,
    { encoding: 'utf8', cwd: cwd || process.cwd(), ...(input !== undefined ? { input } : {}) },
  );
}

// Capture stdout, or null on a non-zero exit. execFileSync semantics, but routed
// through the seam above.
function git(args, cwd) {
  const r = spawnGit(args, cwd);
  if (r.status !== 0) return null;
  return (r.stdout || '').replace(/\n$/, '');
}

function gitQuiet(args, cwd) {
  return spawnGit(args, cwd).status === 0;
}

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

function defaultBranch() {
  const h = git(['symbolic-ref', 'refs/remotes/origin/HEAD']);
  if (h) return h.replace('refs/remotes/origin/', '');
  for (const b of ['main', 'master']) {
    if (gitQuiet(['show-ref', '--verify', '--quiet', `refs/heads/${b}`])) return b;
  }
  return null;
}

function currentBranch() {
  const b = git(['branch', '--show-current']);
  return b && b.length ? b : null; // null when detached
}

function rangeError(range, verb) {
  console.error(`${verb}: cannot read range '${range}' — not a valid hash or ref in this repository (typo? wrong branch? not fetched?)`);
  process.exit(2);
}

// ---- verb: check-branch ------------------------------------------------
function checkBranch() {
  const cur = currentBranch();
  const def = defaultBranch();
  const isDefault = def !== null && cur === def;
  console.log(`current: ${cur ?? '(detached)'}`);
  console.log(`default: ${def ?? '(none)'}`);
  console.log(`is_default: ${isDefault}`);
  if (def && cur !== def) {
    // A resolvable range, not prose: merge-base resolved to its hash, so the
    // exact string can be fed straight to validate-range.
    const mb = git(['merge-base', def, 'HEAD']);
    if (mb) console.log(`suggested_range: ${mb}..HEAD`);
  }
}

// ---- verb: validate-range ----------------------------------------------
function resolveSide(side, errors, label) {
  if (!side) return null; // empty side ('..B' / 'A..') resolved to HEAD by caller
  const h = git(['rev-parse', '--verify', `${side}^{commit}`]);
  if (h === null) {
    errors.push(
      `range ${label} '${side}' is not a valid hash or ref in this repository — ` +
      `cannot resolve it to a commit (typo? wrong branch? not fetched?)`
    );
    return null;
  }
  return h;
}

function validateRange(range) {
  const trimmed = (range || '').trim();
  if (!trimmed) {
    console.error('no range given to validate');
    process.exit(2);
  }
  if (trimmed.includes('...')) {
    console.error(`invalid range '${trimmed}': strata takes a two-dot range A..B — '...' (symmetric difference) has no meaning here`);
    process.exit(2);
  }
  const sides = trimmed.split('..');
  if (sides.length !== 2) {
    console.error(`invalid range '${trimmed}': expected exactly <start>..<end>`);
    process.exit(2);
  }

  const startRaw = sides[0];
  const endRaw = sides[1];
  // git conventions: '..B' => HEAD..B, 'A..' => A..HEAD.
  const startActual = startRaw || 'HEAD';
  const endActual = endRaw || 'HEAD';

  const errors = [];
  const startHash = resolveSide(startActual, errors, 'start');
  const endHash = resolveSide(endActual, errors, 'end');
  if (errors.length) {
    for (const e of errors) console.error(e);
    process.exit(2);
  }

  if (startHash === endHash) {
    console.log('valid: true');
    console.log('note: range start and end resolve to the same commit — the range is empty');
    process.exit(0);
  }

  if (gitQuiet(['merge-base', '--is-ancestor', endActual, startActual])) {
    console.error(`invalid range '${trimmed}': end '${endActual}' is an ancestor of start '${startActual}' (end before start)`);
    process.exit(2);
  }

  const count = git(['rev-list', '--count', `${startActual}..${endActual}`]);
  console.log('valid: true');
  console.log(`start: ${startActual}`);
  console.log(`end: ${endActual}`);
  console.log(`commits_in_range: ${count}`);
  process.exit(0);
}

// ---- verb: authors ------------------------------------------------------
function authors(range) {
  const lines = git(['log', '--format=%an%x09%ae', range]);
  if (!lines) {
    console.error(`cannot list authors for '${range}' — invalid or empty range`);
    process.exit(2);
  }
  const seen = new Map();
  for (const l of lines.split('\n')) {
    const tab = l.indexOf('\t');
    const name = tab === -1 ? l : l.slice(0, tab);
    const email = tab === -1 ? '' : l.slice(tab + 1);
    seen.set(`${name} <${email}>`, (seen.get(`${name} <${email}>`) || 0) + 1);
  }
  const user = git(['config', 'user.name']);
  const email = git(['config', 'user.email']);
  const configured = (user ? `${user} <${email || '(no email)'}>` : null);
  console.log('== Authors in range (commits each) ==');
  for (const [who, n] of seen) console.log(`  (${n})  ${who}`);
  console.log('== Default configured identity ==');
  console.log(`  ${configured || '(none set — ask the user for an identity)'}`);
  if (configured && seen.size > 0) {
    console.log(`  configured_is_in_range: ${seen.has(configured)}`);
  }
  console.log(`distinct_authors: ${seen.size}`);
}

// ---- classification -----------------------------------------------------
// ONE batched call: per-commit hash, subject, and merged file list,
// topological-first (newest first).
function commitsInRange(range) {
  const out = git(['log', '--format=%H|%s', '--name-only', range]);
  if (out === null) return null; // git failed — caller must not read this as "empty range"
  const commits = [];
  let cur = null;
  for (const line of out.split('\n')) {
    const m = /^([0-9a-f]{40})\|(.*)$/.exec(line);
    if (m) {
      cur = { hash: m[1], subj: m[2], files: [] };
      commits.push(cur);
    } else if (line && cur) {
      cur.files.push(line);
    }
  }
  return commits;
}

// A docs path requires the trailing slash: `docs/ristretto-old/` is NOT docs.
const isDocsPath = (f) => f.startsWith('docs/ristretto/');
// Only the exact `docs(ristretto)` scope counts — `docs(api):` does not.
const isDocsScoped = (subj) => /^docs\(ristretto\):/.test(subj);

function classify(c) {
  const pathDocs = c.files.some(isDocsPath);
  const others = c.files.filter((f) => !isDocsPath(f));
  const subjDocs = isDocsScoped(c.subj);
  let kind;
  if (pathDocs && others.length === 0) kind = 'docs-only';
  else if (pathDocs && others.length > 0) kind = 'MIXED (docs path + non-docs files)';
  else if (!pathDocs && subjDocs) kind = 'type-3 (docs(ristretto) scope, no docs path)';
  else kind = 'non-docs (leave untouched)';
  return { kind, subjDocs, pathDocs };
}

// Ticket-shaped token: word-boundary anchored so a bare encoding token like
// `UTF-8` (one digit) never matches, while `ABC-123` does.
const TICKET_RE = /(?:^|[^A-Za-z0-9])([A-Z]{2,8}-[0-9]{2,})(?![A-Za-z0-9])/;
function firstTicket(candidates) {
  for (const c of candidates) {
    const m = TICKET_RE.exec(c);
    if (m) return m[1];
  }
  return null;
}

// ---- type-3 retitle derivation -----------------------------------------
// Ordered, path-driven, case-insensitive, any location. First matching rule
// wins; distinct outcomes >1 or 0 → chore, no scope; the scope is always
// stripped (the script never invents a feature-slug scope the paths don't name).
const RETITLE_RULES = [
  { type: 'docs', test: (f) => /(^|\/)(readme|authors|license|contributing|changelog)(\.[^/]*)?$/i.test(f) },
  { type: 'test', test: (f) => /(^|\/)(tests?|spec)\//i.test(f) || /\.(test|spec)\.[^/]+$/i.test(f) },
  { type: 'ci', test: (f) => /(^|\/)(ci|\.github\/workflows|\.circleci)\//i.test(f)
      || /(^|\/)(\.gitlab-ci\.ya?ml|jenkinsfile|azure-pipelines\.ya?ml)$/i.test(f) },
  { type: 'chore', test: (f) => /(^|\/)(package\.json|\.ristretto\.json)$/i.test(f) },
];

function typeOfPath(f) {
  for (const r of RETITLE_RULES) if (r.test(f)) return r.type;
  return 'chore';
}

// Intent markers (rule 5): a BUG:/FIX:/HACK: prefix, a `fix_` token, or git's
// canonical `Revert "…"` subject upgrades an otherwise-chore outcome to `fix`.
function hasIntentMarker(subj) {
  return /(^|\W)(BUG|FIX|HACK):/.test(subj)
      || /(^|\W)fix_/.test(subj)
      || /(^|\W)Revert "/.test(subj);
}

function deriveRetitle(files, subj) {
  const types = new Set(files.map(typeOfPath));
  let type;
  if (types.size === 1) type = [...types][0];
  else if (types.size === 0) type = hasIntentMarker(subj) ? 'fix' : 'chore';
  else type = 'chore'; // >1 outcome → chore, no refusal
  if (type === 'chore' && hasIntentMarker(subj)) type = 'fix';
  return { type, candidates: [...types] };
}

// The replayed subject for a docs-scoped commit: strip `type(scope): ` and
// re-prefix with the derived type. An explicit override wins outright.
function stripConventional(subj) {
  const m = /^[a-z]+(?:\([^)]*\))?:\s*(.*)$/.exec(subj);
  return m ? m[1] : subj;
}
function retitleSubject(subj, derived) {
  return `${derived.type}: ${stripConventional(subj)}`;
}

// The original message body for a commit, so a retitle preserves it.
function bodyOf(hash, cwd) {
  const b = git(['log', '-1', '--format=%b', hash], cwd);
  return b ? b.replace(/\n+$/, '') : '';
}

function areaOf(file) {
  const parts = file.split('/');
  if (parts.length <= 2) return parts.slice(0, -1).join('/') || parts[0];
  return parts.slice(0, 2).join('/');
}

// Internal fold helper — NOT a public verb.
function coalesceRuns(commits, { minLen = 2 } = {}) {
  const runs = [];
  let cur = [];
  let curAreas = new Set();
  const flush = () => {
    if (cur.length >= minLen) runs.push(cur);
    cur = [];
    curAreas = new Set();
  };
  for (const c of commits) {
    if (c.kind !== 'non-docs (leave untouched)') { flush(); continue; }
    const { type, scope } = parseConventional(c.subj);
    const areas = new Set(c.files.map(areaOf).filter((a) => !isDocsPath(a)));
    if (!scope || areas.size === 0) { flush(); continue; }
    const candidate = { hash: c.hash, scope, subj: c.subj, type };
    if (cur.length === 0) {
      cur.push(candidate);
      for (const a of areas) curAreas.add(a);
      continue;
    }
    const sameScope = cur[cur.length - 1].scope === scope;
    const sharedArea = [...curAreas].some((a) => areas.has(a));
    if (sameScope && sharedArea) {
      cur.push(candidate);
      for (const a of areas) curAreas.add(a);
    } else {
      flush();
      cur.push(candidate);
      for (const a of areas) curAreas.add(a);
    }
  }
  flush();
  return runs;
}

// One parse for the conventional-commit header: the scope and the type come from
// the same subject, so `coalesceRuns` calls this once instead of twice.
function parseConventional(subj) {
  const m = /^([a-z]+)(?:\(([^)]+)\))?:\s/.exec(subj);
  return m ? { type: m[1], scope: m[2] || null } : { type: null, scope: null };
}

function runJson(run) {
  const start = run[run.length - 1].hash;
  const end = run[0].hash;
  return {
    start,
    end,
    scope: run[0].scope,
    type: run[0].type,
    count: run.length,
    subjects: run.map((c) => c.subj),
  };
}

function classifyAll(commits) {
  for (const c of commits) Object.assign(c, classify(c));
}

// ---- merge detection ----------------------------------------------------
function hasMerge(range) {
  const out = git(['rev-list', '--merges', '--count', range]);
  if (out === null) return null; // git failed — caller must not read this as "no merges"
  return Number(out) > 0;
}

// ---- verb: analyze ------------------------------------------------------
function analyze(range, ticket) {
  if (!range) {
    console.error('analyze: no range given — usage: analyze <range> [--ticket ID]');
    process.exit(2);
  }
  const commits = commitsInRange(range);
  if (commits === null) rangeError(range, 'analyze');
  const merged = hasMerge(range);
  if (merged === null) rangeError(range, 'analyze');
  if (merged) {
    fail(`analyze: range '${range}' contains a merge commit — a linear replay cannot handle merges. Pick a linear range.`);
  }
  classifyAll(commits);
  const relevant = commits.filter((c) => c.kind !== 'non-docs (leave untouched)');
  if (relevant.length === 0) {
    console.log(`>> No relevant commits in '${range}'. Nothing to squash.`);
    process.exit(0);
  }

  console.log('');
  console.log(`== Commits in ${range} relevant to docs/ristretto ==`);
  for (const r of relevant) {
    console.log(`  ${r.hash.slice(0, 7)}  [${r.kind}]  ${r.subj}`);
  }

  const type3 = relevant.filter((c) => c.kind === 'type-3 (docs(ristretto) scope, no docs path)');
  if (type3.length) {
    console.log('');
    console.log('== Type-3 retitle proposals ==');
    for (const c of type3) {
      const d = deriveRetitle(c.files, c.subj);
      const candidates = d.candidates.length ? d.candidates.join(', ') : '(none)';
      console.log(`  ${c.hash.slice(0, 7)}  derived_type: ${d.type}`);
      console.log(`           type_candidates: ${candidates} (no scope is derived from paths)`);
      console.log(`           proposed_subject: ${retitleSubject(c.subj, d)}`);
    }
  }

  const runs = coalesceRuns(commits, { minLen: 2 });
  console.log('');
  console.log('== Coalesce-hint ==');
  if (runs.length === 0) {
    console.log('  No contiguous runs of small same-scope commits detected.');
  } else {
    for (const run of runs) {
      console.log(`  ${run.length} consecutive non-docs commits share scope (${run[0].scope}):`);
      for (const c of run) console.log(`    - ${c.hash.slice(0, 7)} ${c.subj}`);
    }
  }

  console.log('');
  console.log('== Fold-runs (machine-readable) ==');
  console.log(JSON.stringify(runs.map(runJson), null, 2));

  console.log('');
  console.log('== Draft subject ==');
  const first = relevant[0];
  console.log(`  ${first.subjDocs ? first.subj : `docs(ristretto): ${first.subj}`}`);

  console.log('');
  console.log('== PR branch ==');
  if (!ticket) ticket = firstTicket([currentBranch() || '', ...relevant.map((r) => r.subj)]);
  console.log(`  pr_branch: ${ticket ? `${ticket}-pr` : `${currentBranch() || 'feature'}-pr`}`);
}

// Clear the branch's docs/ristretto path, then lay down `source`'s tree when it
// has one. The clear always runs — `--ignore-unmatch` makes it a safe no-op on a
// docs-less branch — because a MIXED replay may have just staged docs this path
// must drop (a cat-file-guarded clear would leave them behind). Only the overlay
// is guarded: a source with no docs lays nothing down.
function overlayDocsFrom(source, wt) {
  gitQuiet(['rm', '-r', '-f', '-q', '--ignore-unmatch', '--', 'docs/ristretto'], wt);
  if (gitQuiet(['cat-file', '-e', `${source}:docs/ristretto`], wt)) {
    gitQuiet(['checkout', source, '--', 'docs/ristretto'], wt);
  }
}

// Apply only a commit's non-docs changes. The docs hunk is excluded from the
// patch outright, so neither the `modify/delete` nor the `content` conflict over
// `docs/ristretto` can arise — replay never depends on an intermediate docs
// state, because the final `overlayDocsFrom(origTip, wt)` owns the docs tree.
// A conflict on a real (non-docs) path still fails and stratify still refuses.
// `spawnGit` routes through the test seam, so this works under the fake git too.
function applyNonDocs(hash, wt) {
  const diff = spawnGit(['diff', '--binary', `${hash}^`, hash, '--', '.', ':(exclude)docs/ristretto'], wt);
  if (diff.status !== 0) return { ok: false, detail: null };
  const apply = spawnGit(['apply', '--index', '--3way', '-'], wt, diff.stdout || '');
  if (apply.status !== 0) {
    // `--3way` reports `Applied patch to '<path>' with conflicts.` on stdout;
    // a straight apply failure reports `error: patch failed: <path>:<line>` on
    // stderr. Surface whichever path collided, so the refusal names the file.
    const combined = `${apply.stdout || ''}\n${apply.stderr || ''}`;
    const m = /patch failed:\s*([^\s:]+)/.exec(combined)
      || /Applied patch to '([^']+)' with conflicts/.exec(combined);
    return { ok: false, detail: m ? m[1] : null };
  }
  return { ok: true, detail: null };
}

// ---- verb: stratify -----------------------------------------------------
function parseStratifyArgs(args) {
  const out = { retitle: new Map() };
  let range = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const take = (k) => (a === k ? args[++i] : a.slice(k.length + 1));
    if (a === '--pr-branch' || a.startsWith('--pr-branch=')) out.prBranch = take('--pr-branch');
    else if (a === '--subject' || a.startsWith('--subject=')) out.subject = take('--subject');
    else if (a === '--ticket' || a.startsWith('--ticket=')) out.ticket = take('--ticket');
    else if (a === '--retitle') {
      const v = args[++i] || '';
      const eq = v.indexOf('=');
      if (eq > 0) out.retitle.set(v.slice(0, eq), v.slice(eq + 1));
    } else if (a.startsWith('--retitle=')) {
      const v = a.slice('--retitle='.length);
      const eq = v.indexOf('=');
      if (eq > 0) out.retitle.set(v.slice(0, eq), v.slice(eq + 1));
    } else if (a === '--fold') out.fold = true;
    else if (!range) range = a;
  }
  return { ...out, range };
}

function stratify(opts) {
  const { range } = opts;
  if (!range) fail('stratify: no range given — usage: stratify <range> --pr-branch <name> [--subject S] [--retitle <hash>=<subject>]... [--fold] [--ticket T]');
  // A ticket supplies the default branch name when --pr-branch is omitted,
  // mirroring analyze's `pr_branch:` suggestion.
  if (!opts.prBranch && opts.ticket) opts.prBranch = `${opts.ticket}-pr`;
  if (!opts.prBranch) fail('stratify: --pr-branch <name> (or --ticket T) is required');

  const base = git(['rev-parse', '--verify', `${range.split('..')[0]}^{commit}`]);
  const origTip = git(['rev-parse', '--verify', `${(range.split('..')[1] || 'HEAD')}^{commit}`]);
  if (base === null || origTip === null) fail(`stratify: cannot read range '${range}' — not a valid hash or ref in this repository`);
  const merged = hasMerge(range);
  if (merged === null) fail(`stratify: cannot read range '${range}'.`);
  if (merged) fail(`stratify: range '${range}' contains a merge commit — a linear replay cannot handle merges. Pick a linear range.`);

  // Dirty tree refusal — before any branch or worktree exists.
  const dirty = git(['status', '--porcelain']);
  if (dirty) fail('stratify: working tree is dirty — commit or stash your changes first (the main checkout is never touched otherwise).');
  // Branch-exists refusal.
  if (gitQuiet(['show-ref', '--verify', '--quiet', `refs/heads/${opts.prBranch}`])) {
    fail(`stratify: branch '${opts.prBranch}' already exists — pick another name or delete it first.`);
  }

  const commits = commitsInRange(range);
  if (commits === null) fail(`stratify: cannot read range '${range}'.`);
  classifyAll(commits);
  const oldest = [...commits].reverse(); // commitsInRange is newest-first

  // --fold: detect runs over the original commits (newest-first, exactly as the
  // analyze hint does) and replay each run's members as one folded commit. The
  // detected members are non-docs only — coalesceRuns flushes on any docs commit.
  const foldRunOf = new Map(); // oldest-member hash -> [members, oldest-first]
  if (opts.fold) {
    for (const run of coalesceRuns(commits, { minLen: 2 })) {
      const oldestFirst = [...run].reverse();
      foldRunOf.set(oldestFirst[0].hash, oldestFirst);
    }
  }

  const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-'));
  const wt = path.join(tmpParent, 'wt');
  let branchCreated = false;
  const cleanup = (deleteBranch) => {
    gitQuiet(['worktree', 'remove', '--force', wt]);
    if (deleteBranch && branchCreated) gitQuiet(['branch', '-D', opts.prBranch]);
    try { fs.rmSync(tmpParent, { recursive: true, force: true }); } catch { /* best effort */ }
  };

  try {
    if (!gitQuiet(['worktree', 'add', '-b', opts.prBranch, wt, base])) {
      cleanup(false);
      fail(`stratify: could not create a worktree for branch '${opts.prBranch}'.`);
    }
    branchCreated = true;

    // --retitle keys may be short hashes (as analyze prints them); resolve each
    // against the range's commits so a short-hash override is honoured.
    if (opts.retitle.size) {
      const full = new Map();
      for (const [k, v] of opts.retitle) {
        const hit = commits.find((c) => c.hash === k || c.hash.startsWith(k));
        full.set(hit ? hit.hash : k, v);
      }
      opts.retitle = full;
    }
    const subjectFor = (c) => {
      if (opts.retitle.has(c.hash)) return opts.retitle.get(c.hash);
      if (isDocsScoped(c.subj)) return retitleSubject(c.subj, deriveRetitle(c.files, c.subj));
      return null; // keep original
    };
    // Retitle a replayed commit, keeping its original body as a second paragraph.
    const amendTo = (hash, subject) => {
      const body = bodyOf(hash, wt);
      const args = ['commit', '--amend', '-m', subject];
      if (body) args.push('-m', body);
      if (!gitQuiet(args, wt)) throw { message: `could not retitle ${hash}` };
    };

    const replayed = new Set();
    for (const c of oldest) {
      if (replayed.has(c.hash)) continue;
      if (c.kind === 'docs-only') continue; // absorbed into the appended docs commit

      if (foldRunOf.has(c.hash)) {
        const members = foldRunOf.get(c.hash);
        for (const m of members) {
          // coalesceRuns only admits non-docs members, but route them through the
          // same docs-free apply so the invariant holds if that ever changes.
          const a = applyNonDocs(m.hash, wt);
          if (!a.ok) { throw { conflict: m.hash, path: a.detail }; }
          replayed.add(m.hash);
        }
        const sharedType = new Set(members.map((m) => m.type)).size === 1;
        const type = sharedType ? members[0].type : 'chore';
        const summary = stripConventional(members[members.length - 1].subj);
        if (!gitQuiet(['commit', '-m', `${type}(${members[0].scope}): ${summary}`], wt)) {
          throw { message: 'fold commit failed' };
        }
        continue;
      }

      if (c.kind === 'MIXED (docs path + non-docs files)') {
        // Replay only the non-docs portion; the docs hunk is never in the patch,
        // so no docs conflict can occur mid-replay. The docs tree is laid down
        // wholesale by overlayDocsFrom(origTip, wt) after the loop.
        const a = applyNonDocs(c.hash, wt);
        if (!a.ok) { throw { conflict: c.hash, path: a.detail }; }
        if (!gitQuiet(['commit', '-C', c.hash], wt)) { throw { conflict: c.hash }; }
        const s = subjectFor(c);
        if (s) amendTo(c.hash, s);
      } else if (c.kind === 'type-3 (docs(ristretto) scope, no docs path)') {
        if (!gitQuiet(['cherry-pick', c.hash], wt)) { throw { conflict: c.hash }; }
        const s = subjectFor(c);
        if (s) amendTo(c.hash, s);
      } else {
        if (!gitQuiet(['cherry-pick', c.hash], wt)) { throw { conflict: c.hash }; }
      }
    }

    // Base docs may be stale and tip deletions must propagate — clear, then overlay the tip.
    overlayDocsFrom(origTip, wt);
    if (!gitQuiet(['diff', '--cached', '--quiet'], wt)) {
      const subj = opts.subject || 'docs(ristretto): stratify the planning history';
      if (!gitQuiet(['commit', '-m', subj], wt)) throw { message: 'could not create the docs commit' };
    }

    const prTip = git(['rev-parse', 'HEAD'], wt);
    const verified = gitQuiet(['diff', '--quiet', origTip, prTip], wt);
    if (!verified) {
      // A non-identical tree means the replay dropped or changed content — a
      // broken result, not a usable branch. Leave nothing behind.
      cleanup(true);
      fail(`stratify: result tree differs from ${origTip} — the replay is not byte-identical; removed the PR branch, nothing left behind.`);
    }
    cleanup(false); // branch persists
    console.log(JSON.stringify({ pr_branch: opts.prBranch, base, pr_tip: prTip, verified }, null, 2));
  } catch (e) {
    if (e && e.conflict) {
      gitQuiet(['cherry-pick', '--abort'], wt); // no-op when the conflict came from `git apply`
      cleanup(true);
      const where = e.path ? ` (non-docs path '${e.path}')` : '';
      fail(`stratify: cherry-pick conflict on ${e.conflict}${where} — aborted, no PR branch left behind.`);
    }
    cleanup(true);
    fail(`stratify: ${(e && e.message) || 'failed to build the PR branch'}.`);
  }
}

// ---- dispatch -----------------------------------------------------------
const [verb, ...args] = process.argv.slice(2);
switch (verb) {
  case 'check-branch': checkBranch(); break;
  case 'validate-range': validateRange(args[0] || ''); break;
  case 'authors': authors(args[0] || ''); break;
  case 'analyze': {
    let ticket = null; let range = null;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--ticket') { ticket = args[i + 1]; i++; }
      else if (a.startsWith('--ticket=')) ticket = a.slice('--ticket='.length);
      else if (!range) range = a;
    }
    analyze(range, ticket);
    break;
  }
  case 'stratify': stratify(parseStratifyArgs(args)); break;
  default:
    console.log('usage: node scripts/strata.mjs <verb> [args]');
    console.log('verbs: check-branch | validate-range <range> | authors <range> | analyze <range> [--ticket ID] | stratify <range> --pr-branch <name> [--subject S] [--retitle <hash>=<subject>]... [--fold] [--ticket T]');
    process.exit(1);
}
