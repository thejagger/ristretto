// The Timeline (spec 2026-11-09): one board for a repo or a folder of repos. The branch decides
// the view: off its base, a repo tells its branch's story (done on it, at work); on its base, only
// what is open. At a folder every row carries its repo's folder name. Pure: no $, no Node, no
// clock (`now` is passed in).

import { siblingOf, waitingOn } from './board-plan.mjs';
import { mergeRuns } from './board-runs.mjs';
import { BACK, PREP, blockedWords, duration, featurePage, plain, waitsOf } from './board-model.mjs';

const CAP = { needs: 3, list: 5 };
const open = (id, folder) => ({ kind: 'feature', id, folder: folder ?? null });
const section = (all, cap) => ({ rows: all.slice(0, cap), more: Math.max(0, all.length - cap), total: all.length });

// A repo's base is known and the repo is not on it: its branch is the story.
const offBase = (r) => !!r.branch && !!r.branch.base && !r.branch.onDefault;
// No base found off the default branch: nothing to measure the branch by. On the default branch
// with no remote, the repo is simply on its base.
const baseUnknown = (r) => !!r.branch && !r.branch.base && !r.branch.onDefault;

// The status a Depends id names: a plain id in this repo, `<folder>/<id>` in the sibling repo of
// that name, else in `siblings` (the roadmaps of sibling folders the board does not show).
export function statusIn(repos, folder, siblings = {}) {
  const byFolder = new Map(repos.map((r) => [r.folder, r]));
  const own = byFolder.get(folder);
  return (id) => {
    const sib = siblingOf(id);
    if (!sib) return own?.board.rows.find((x) => x.id === id)?.status;
    const other = byFolder.get(sib.folder);
    if (other && sib.folder !== null) return other.board.rows.find((x) => x.id === sib.id)?.status;
    return siblings[sib.folder]?.[sib.id];
  };
}

function ctxOf(repo, repos, opts) {
  const resolve = statusIn(repos, repo.folder, opts.siblings);
  return {
    busy: false,
    plans: repo.board.plans ?? {},
    checks: repo.board.checks ?? {},
    decisions: repo.board.decisions ?? {},
    statusOf: { get: resolve },
    resolve,
    runOf: mergeRuns(repo.runs ?? []),
    files: opts.files ?? {},
    folders: opts.folders ?? {},
  };
}

// What runs: every repo's record from another session, and this session's own record for its repo.
function workOf(repos, opts) {
  const out = [];
  for (const repo of repos) {
    const mine = opts.own && opts.own.rec && opts.own.folder === repo.folder ? opts.own.rec : null;
    const theirs = repo.atWork && (repo.atWork.state === 'running' || repo.atWork.state === 'stopped') && repo.atWork.rec.session !== opts.session ? repo.atWork : null;
    for (const [state, rec] of [mine ? ['running', mine] : null, theirs ? [theirs.state, theirs.rec] : null].filter(Boolean)) out.push({ repo, state, rec });
  }
  return out;
}

function workRow({ repo, state, rec }, repos, opts) {
  const row = repo.board.rows.find((r) => r.id === rec.id);
  const plan = repo.board.plans?.[rec.id];
  const resolve = statusIn(repos, repo.folder, opts.siblings);
  const sib = (plan?.depends ?? []).find((id) => siblingOf(id) && resolve(id) === 'done');
  const lastDone = [...(rec.effort ?? [])].reverse().find((p) => p.state === 'done');
  const name = repo.folder ?? repo.board.name;
  return {
    key: `work-${repo.folder ?? ''}-${rec.id}`,
    tag: repo.folder,
    id: rec.id,
    title: plain(row?.title || rec.title || ''),
    step: state === 'stopped' ? `stopped after ${lastDone ? lastDone.name : 'start'} · ${duration((opts.now ?? 0) - rec.beat)} ago` : rec.step,
    red: !!rec.red,
    effort: rec.effort,
    startedAt: rec.startedAt,
    state,
    label: rec.unattended ? `session “${name}: brew” · unattended` : '',
    waited: sib ? `waited on ${sib}, done` : null,
    open: open(rec.id, repo.folder),
  };
}

// The sections, before caps.
function parts(repos, opts) {
  const view = repos.some(offBase) ? 'branch' : 'base';
  const work = workOf(repos, opts);
  const busy = (repo, id) => work.some((w) => w.repo === repo && w.rec.id === id && w.state === 'running');
  const needs = [], done = [], free = [], held = [];
  for (const repo of repos) {
    const ctx = ctxOf(repo, repos, opts);
    for (const r of repo.board.rows) {
      if (busy(repo, r.id)) continue;
      const tag = repo.folder;
      const waits = waitsOf(r, ctx);
      if (r.status === 'blocked') needs.push({ key: `need-${tag ?? ''}-${r.id}`, glyph: 'blocked', tag, id: r.id, detail: blockedWords(r), tone: 'dim', open: open(r.id, tag), repo });
      else if (waits) needs.push({ key: `need-${tag ?? ''}-${r.id}`, glyph: waits.glyph, tag, id: r.id, detail: waits.detail, tone: 'dim', open: open(r.id, tag), repo });
      else if (r.status === 'done' && view === 'branch' && offBase(repo) && (repo.branch.ids ?? []).includes(r.id)) {
        const run = ctx.runOf.get(r.id);
        done.push({ key: `done-${tag ?? ''}-${r.id}`, glyph: 'done', tag, id: r.id, detail: plain(r.title), meta: run ? duration(run.ms) : '', tone: 'dim', open: open(r.id, tag), flight: r.flight });
      } else if (r.status === 'planned') {
        const plan = ctx.plans[r.id];
        const on = waitingOn(plan, ctx.resolve);
        const blocker = plan?.blockers?.[0];
        if (!on.length && !blocker) {
          const half = (plan?.depends ?? []).map(siblingOf).find(Boolean);
          free.push({ key: `free-${tag ?? ''}-${r.id}`, glyph: 'planned', tag, id: r.id, detail: half ? `${half.folder} half done` : r.tier === 'easy' ? 'easy' : '', tone: 'default', open: open(r.id, tag), repo });
        } else {
          const detail = on.length ? `waits for ${on[0].id}${on[0].status === 'missing' ? ' (not found)' : ''}` : `waits on ${plain(blocker)}`;
          held.push({ key: `held-${tag ?? ''}-${r.id}`, glyph: 'planned', tag, id: r.id, detail, tone: 'dim', open: open(r.id, tag), repo });
        }
      }
    }
  }
  if (free.length && !work.length) Object.assign(free[0], { glyph: 'next', detail: 'next' });
  return { view, work, needs, done, free, held };
}

const strip = ({ repo, flight, ...row }) => row;

function footOf(repos, view, work) {
  const brewing = (repo) => work.some((w) => w.repo === repo && w.state === 'running');
  const open = (repo) => repo.board.rows.filter((r) => r.status !== 'done').length;
  if (view === 'branch') {
    return repos.map((repo) => {
      if (baseUnknown(repo)) return { tag: repo.folder, branch: repo.branch.name, note: 'base unknown' };
      if (!offBase(repo)) return { tag: repo.folder, branch: repo.branch ? repo.branch.name : '—', note: open(repo) ? `${open(repo)} open` : 'nothing open' };
      const state = brewing(repo) ? 'brewing' : repo.suite?.text || 'suite unproven';
      return { tag: repo.folder, branch: repo.branch.name, note: [repo.age, state].filter(Boolean).join(' · ') };
    });
  }
  if (repos.length === 1 && repos[0].folder === null) {
    const repo = repos[0];
    return [{ tag: null, branch: repo.branch ? repo.branch.name : '—', note: baseUnknown(repo) ? 'base unknown' : brewing(repo) ? 'brewing' : '' }];
  }
  const anyBrewing = repos.some(brewing);
  return [{ tag: null, branch: `${repos.map((r) => r.folder).join(', ')} on their base branch`, note: anyBrewing ? 'brewing' : 'nothing brewing' }];
}

function message(repos) {
  if (!repos.length) return { kind: 'message', text: PREP };
  if (repos.length === 1) {
    const e = repos[0].board.error;
    if (e === 'no-roadmap' || e === 'no-table') return { kind: 'message', text: PREP };
    if (e) return { kind: 'message', text: `roadmap unreadable (${e}) — /ristretto:status shows it as text` };
  }
  return null;
}

export function timelineOf(repos, opts = {}) {
  const msg = message(repos);
  if (msg) return msg;
  const shown = repos.filter((r) => !r.board.error);
  const p = parts(shown, opts);
  const groups = [];
  for (const row of p.done.slice(0, CAP.list)) {
    const g = groups.find((x) => x.flight === row.flight) ?? (groups.push({ flight: row.flight, rows: [] }), groups[groups.length - 1]);
    g.rows.push(strip(row));
  }
  const ended = shown.filter((repo) => repo.folder !== null && repo.atWork?.state === 'ended' && repo.atWork.rec.unattended
    && !p.work.some((w) => w.repo === repo && w.state === 'running') && !p.free.some((f) => f.repo === repo));
  return {
    kind: 'timeline',
    name: repos.length === 1 && repos[0].folder === null ? repos[0].board.name : opts.name ?? '',
    view: p.view,
    needs: section(p.needs.map(strip), CAP.needs),
    done: p.view === 'branch' ? { groups, more: Math.max(0, p.done.length - CAP.list), total: p.done.length } : null,
    atWork: p.work.map((w) => workRow(w, shown, opts)),
    idle: ended.map((repo) => ({ folder: repo.folder, needYou: p.needs.filter((n) => n.repo === repo).length })),
    startNow: section(p.free.map(strip), CAP.list),
    next: section(p.held.map(strip), CAP.list),
    foot: footOf(shown, p.view, p.work),
  };
}

// The band above the prompt: who brews (tagged at a folder), else a brew branch's tally, else
// what can start; and how many need the person.
export function timelineBandOf(repos, opts = {}) {
  const shown = repos.filter((r) => !r.board.error && r.board.rows.length);
  if (!shown.length) return null;
  const p = parts(shown, opts);
  const needYou = p.needs.length;
  const running = p.work.filter((w) => w.state === 'running').map((w) => workRow(w, shown, opts));
  if (running.length) return { running: { parts: running.map((w) => ({ tag: w.tag, id: w.id, step: w.step, red: w.red, effort: w.effort })), needYou } };
  if (p.view === 'branch' && p.done.length) return { finished: { done: p.done.length, branches: shown.filter(offBase).length, needYou } };
  const first = p.free[0];
  return { idle: { next: first ? { tag: first.tag, id: first.id } : null, canStart: p.free.length, needYou } };
}

// A page the overview opens: a feature from its own repo; the whole queue (needs you, can start,
// next); every feature done on the brew branches.
export function pageOf(repos, page, opts = {}) {
  const shown = repos.filter((r) => !r.board.error);
  if (page?.kind === 'feature') {
    const repo = shown.find((r) => r.folder === (page.folder ?? null));
    const row = repo?.board.rows.find((r) => r.id === page.id);
    return row ? { ...featurePage(row, ctxOf(repo, shown, opts)), tag: repo.folder } : null;
  }
  const p = parts(shown, opts);
  if (page?.kind === 'queue') {
    return {
      kind: 'queue', back: BACK,
      eligible: p.free.map(strip),
      waiting: [
        ...(p.needs.length ? [{ key: 'flight-needs', flight: 'needs you', rows: p.needs.map(strip) }] : []),
        ...(p.held.length ? [{ key: 'flight-next', flight: 'next', rows: p.held.map(strip) }] : []),
      ],
    };
  }
  if (page?.kind === 'history') return { kind: 'history', back: BACK, n: p.done.length, rows: p.done.map(strip) };
  return null;
}
