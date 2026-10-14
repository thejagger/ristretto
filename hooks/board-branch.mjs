// The branch the session is on, the base it is measured against, the features it holds and the
// full-suite verdict, as git argv to run and parsers of what git printed (spec 4.1–4.5). Pure:
// no $, no Node, no clock (the time is passed in).

import { featureIdOf, isDocs } from './board-files.mjs';

export const headArgs = ['rev-parse', '--abbrev-ref', 'HEAD'];
export const shortHeadArgs = ['rev-parse', '--short', 'HEAD'];
export const baseArgs = {
  originHead: ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'],
  refs: ['for-each-ref', '--format=%(refname)', 'refs/heads/main', 'refs/heads/master', 'refs/remotes/origin/main', 'refs/remotes/origin/master'],
};

const lines = (text) => String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const REMOTE = 'refs/remotes/origin/';
const LOCAL = 'refs/heads/';

// The base (spec 4.2): off the default branch, the default branch (origin/HEAD's target, else
// main, else master), the one of local and remote that contains the other, local when they have
// diverged. On the default branch, its remote-tracking ref, or nothing. `isAncestor(a, b)` is the
// caller's answer to `git merge-base --is-ancestor a b`.
export function parseBase({ head, originHead, refs, isAncestor }) {
  const have = new Set(lines(refs));
  const origin = lines(originHead)[0] || '';
  const name = origin.startsWith(REMOTE)
    ? origin.slice(REMOTE.length)
    : ['main', 'master'].find((n) => have.has(LOCAL + n) || have.has(REMOTE + n));
  if (!name) return null;
  const remote = origin === REMOTE + name || have.has(REMOTE + name) ? REMOTE + name : null;
  const local = have.has(LOCAL + name) ? LOCAL + name : null;
  if (head === name) return remote ? { ref: remote, label: `origin/${name}` } : null;
  if (local && remote) {
    if (isAncestor(local, remote)) return { ref: remote, label: name };
    return { ref: local, label: name };
  }
  const ref = local || remote;
  return ref ? { ref, label: name } : null;
}

export function logArgs(baseRef) {
  return ['log', '--format=%ct%x09%s', `${baseRef}..HEAD`, '--'];
}

// `<seconds>\t<subject>` per commit, newest first, as git printed them.
export function parseLog(stdout) {
  return String(stdout ?? '').split(/\r?\n/).flatMap((line) => {
    const m = /^(\d+)\t(.*)$/.exec(line);
    return m ? [{ at: Number(m[1]) * 1000, subject: m[2] }] : [];
  });
}

// The features on the branch, newest first, each once. A feature counts only through a commit
// that is not docs (the closer always commits `feat(<ID>)`), so a block's roadmap edit or a check
// re-run never puts a feature here; and only an ID `known` says is one (a roadmap row, an
// archived plan), so `fix(board):` in a plugin's own repo is not a feature.
export function featuresOn(commits, known) {
  const out = [];
  for (const c of commits) {
    if (isDocs(c.subject)) continue;
    const id = featureIdOf(c.subject);
    if (id && !out.includes(id) && known(id)) out.push(id);
  }
  return out;
}

const HEX = /^[0-9a-f]{40}$/;

// Whether the proved tree is HEAD's code: exit 0 when it is. The roadmap and plans are left out,
// so a close commit after the verify keeps it. Only a hex tree from the file reaches git.
export function suiteArgs(tree) {
  return typeof tree === 'string' && HEX.test(tree)
    ? ['diff', '--quiet', '--end-of-options', tree, 'HEAD', '--', '.', ':(exclude)docs/ristretto']
    : null;
}

// The verdict as the Branch card reads it (spec 4.5): green or red only while it proves the code
// that is there; anything else, stale, unverified, missing or unreadable, is unproven.
export function suiteOf(record, { treeMatches, head } = {}) {
  const unproven = { state: 'unproven', text: 'suite unproven', failing: '' };
  if (!record || typeof record !== 'object' || (record.verdict !== 'green' && record.verdict !== 'red')) return unproven;
  let current;
  if (record.tree === null || record.tree === undefined) current = typeof head === 'string' && HEX.test(head) && record.head === head;
  else current = HEX.test(String(record.tree)) && treeMatches === true;
  if (!current) return unproven;
  if (record.verdict === 'green') return { state: 'green', text: 'suite green', failing: '' };
  const failing = String(record.failing || 'a gate');
  return { state: 'red', text: `full suite · red · ${failing}`, failing };
}

const pad = (n) => String(n).padStart(2, '0');
const DAY = 86400000;

// When something happened, as a person says it: `today 13:13`, `yesterday`, `3 days ago`, by
// local calendar days. `now` is passed in.
export function ago(ms, now) {
  const d = new Date(ms), n = new Date(now);
  const days = Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / DAY);
  if (days <= 0) return `today ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

// The branch as the board shows it. `ids` is null when nothing can be scoped to it (no base, or
// nothing ahead, spec 4.3). `lastBrew` is the newest run of a feature on it, else its newest
// feature commit.
export function branchOf({ head, base, commits, known, runs, now }) {
  const ids = base && commits.length ? featuresOn(commits, known) : null;
  let lastBrew = '';
  if (ids && ids.length) {
    const ended = (runs || []).filter((r) => ids.includes(r.id) && r.endedAt).map((r) => r.endedAt);
    if (ended.length) lastBrew = `last brew ${ago(Math.max(...ended), now)}`;
    else {
      const at = commits.filter((c) => !isDocs(c.subject) && ids.includes(featureIdOf(c.subject))).map((c) => c.at);
      if (at.length) lastBrew = `last commit ${ago(Math.max(...at), now)}`;
    }
  }
  return { name: head, base: base ? base.label : null, ids, lastBrew };
}
