// The board's facts (spec 2026-11-09, drawn by v1's views, spec 2026-11-20): one board for a repo
// or a folder of repos. The branch decides what counts as done here: off its base, what the branch
// built; on its base, nothing. At a folder every row carries its repo's folder name. Pure: no $, no Node, no
// clock (`now` is passed in).

import { siblingOf, waitingOn } from './board-plan.mjs';
import { mergeRuns } from './board-runs.mjs';
import { PREP, blockedWords, duration, plain } from './board-model.mjs';


// A repo's base is known and the repo is not on it: its branch is the story.
const offBase = (r) => !!r.branch && !!r.branch.base && !r.branch.onDefault;

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
  return {
    key: `work-${repo.folder ?? ''}-${rec.id}`,
    tag: repo.folder,
    id: rec.id,
    title: plain(row?.title || rec.title || ''),
    step: state === 'stopped' ? `stopped after ${lastDone ? lastDone.name : 'start'}` : rec.step,
    // When it went quiet: the drawing counts the age on from here.
    since: state === 'stopped' ? rec.beat : null,
    red: !!rec.red,
    effort: rec.effort,
    startedAt: rec.startedAt,
    state,
    label: rec.unattended ? 'unattended' : '',
    waited: sib ? `waited on ${sib}, done` : null,
  };
}

// v1 (spec 2026-11-20): the facts the four views draw from, uncapped, with no pages. A done
// feature with an open manual check stays done (`checks` counts them) and each open box is listed
// in `checks`; `boxes` holds every feature's open boxes, by `<folder>/<id>`.
export function storyOf(repos, opts = {}) {
  const shown = repos.filter((r) => !r.board.error);
  const view = shown.some(offBase) ? 'branch' : 'base';
  const runs = workOf(shown, opts);
  const work = runs.map((w) => workRow(w, shown, opts));
  const busy = (repo, id) => runs.some((w) => w.repo === repo && w.rec.id === id && w.state === 'running');
  const done = [], blocked = [], checks = [], taken = [], free = [], held = [], boxes = {};
  for (const repo of shown) {
    const ctx = ctxOf(repo, shown, opts);
    const tag = repo.folder;
    for (const r of repo.board.rows) {
      const open = (ctx.checks[r.id] ?? []).filter((c) => !c.done).map((c) => ({ text: plain(c.text), how: plain(c.how ?? '') }));
      if (open.length) boxes[`${tag ?? ''}/${r.id}`] = open;
      if (busy(repo, r.id)) continue;
      const key = `${tag ?? ''}-${r.id}`;
      if (r.status === 'blocked') {
        blocked.push({ key: `blk-${key}`, tag, id: r.id, reason: blockedWords(r) });
      } else if (r.status === 'done') {
        for (const c of open) checks.push({ tag, id: r.id, ...c });
        if (view === 'branch' && offBase(repo) && (repo.branch.ids ?? []).includes(r.id)) {
          const run = ctx.runOf.get(r.id);
          done.push({ key: `done-${key}`, tag, id: r.id, title: plain(r.title), meta: run ? duration(run.ms) : '', checks: open.length });
          for (const d of ctx.decisions[r.id] ?? []) if (d.taken) taken.push({ tag, id: r.id, text: plain(d.text) });
        }
      } else if (r.status === 'planned') {
        const plan = ctx.plans[r.id];
        const on = waitingOn(plan, ctx.resolve);
        const blocker = plan?.blockers?.[0];
        if (!on.length && !blocker) free.push({ key: `free-${key}`, tag, id: r.id, title: plain(r.title), detail: r.tier === 'easy' ? 'easy' : '' });
        else held.push({ key: `held-${key}`, tag, id: r.id, title: plain(r.title), detail: on.length ? `waits for ${on[0].id}${on[0].status === 'missing' ? ' (not found)' : ''}` : `waits on ${plain(blocker)}` });
      }
    }
  }
  return { view, work, done, blocked, checks, taken, free, held, boxes };
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

// The one line the pane shows when there is no board to draw, or null.
export function messageOf(repos) {
  const m = message(repos);
  return m ? m.text : null;
}
