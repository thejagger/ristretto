// Pure logic of the roadmap board: no $, no Node, no DOM — hooks/board.tsx feeds it what the
// session did and draws what it returns. Tested by scripts/board-model.test.js.

import { SATISFIES, parsePlan, proofFor, waitingOn } from './board-plan.mjs';
import { trend } from './board-runs.mjs';

export const STATUSES = ['planned', 'in-progress', 'blocked', 'needs-human', 'needs-review', 'done'];

export const EMPTY_BOARD = { name: '', rows: [], format: { project: null, plugin: '' }, error: null, plans: {}, checks: {} };

// A table line's cells, `\|` kept as a literal pipe inside its cell. No lookbehind: the hooks
// engine's runtime is not Node, and a regex it cannot compile would keep the module from loading.
const PIPE = '\u0000';
function cells(line) {
  return line
    .trim()
    .replace(/\\\|/g, PIPE)
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.split(PIPE).join('|').trim());
}

// Whether a pane opened unasked would dock beside the transcript; unknown is not docked.
export function docks(viewport) {
  return Boolean(viewport && viewport.isFullscreen === true);
}

// Whose run .ristretto/pulling is. gate.js writes the owning session id into it ('' until a
// hook claims it) and ages a marker with no gate run for a day out as a leftover.
const MARKER_MAX_IDLE_MS = 24 * 60 * 60 * 1000;
export function markerState(owner, idleMs, sessionId) {
  if (owner === null || (idleMs !== null && idleMs > MARKER_MAX_IDLE_MS)) return 'none';
  if (owner === '') return 'unclaimed';
  return owner === sessionId ? 'mine' : 'other';
}

// `needs-human — compose pending` → needs-human + 'compose pending'; `done—**retired**` → done.
function statusOf(cell) {
  const token = (/^[a-z-]+/.exec(cell) || [''])[0];
  const status = STATUSES.includes(token) ? token : 'unknown';
  const reason = status === 'unknown' ? cell : cell.slice(token.length).replace(/^\s*[—–-]\s*/, '').trim();
  return { status, reason };
}

export function parseRoadmap(text) {
  const lines = text.split(/\r?\n/);
  const format = (/<!--\s*ristretto-format:\s*([\d.]+)\s*-->/.exec(text) || [null, null])[1];
  const at = lines.findIndex((line) => /^\s*\|/.test(line) && cells(line).some((c) => /^(Feature|ID)$/i.test(c)));
  if (at < 0) return { rows: [], format, error: 'no-table' };

  const head = cells(lines[at]).map((c) => c.toLowerCase());
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const [iFlight, iId, iTitle, iTier, iStatus, iPlan, iCommit] = [col('flight'), col('feature', 'id'), col('title'), col('tier'), col('status'), col('plan'), col('commit')];

  const rows = [];
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i])) { end = i; break; }
    const row = cells(lines[i]);
    if (row.every((c) => /^:?-+:?$/.test(c))) continue; // the |---| rule
    const flight = iFlight < 0 ? '' : row[iFlight] || '';
    rows.push({
      flight: /^[—–-]?$/.test(flight) ? '' : flight,
      id: row[iId] || '',
      title: iTitle < 0 ? '' : row[iTitle] || '',
      tier: iTier >= 0 && /^easy\b/.test(row[iTier] || '') ? 'easy' : 'normal',
      plan: planOf(iPlan < 0 ? '' : row[iPlan] || ''),
      commit: iCommit < 0 ? '' : (row[iCommit] || '').replace(/`/g, '').replace(/^[—–-]$/, '').trim(),
      ...statusOf(iStatus < 0 ? '' : row[iStatus] || ''),
    });
  }

  // A blocked row whose cell carries no reason may have one in a note under the table:
  // `- **<id>** — <reason>`.
  const notes = new Map();
  for (const line of lines.slice(end)) {
    const note = /^\s*-\s+\*\*([^*]+)\*\*\s+[—–-]\s+(.+?)\s*$/.exec(line);
    if (note) notes.set(note[1].trim(), note[2]);
  }
  for (const row of rows) {
    if (row.status === 'blocked' && !row.reason && notes.has(row.id)) row.reason = notes.get(row.id);
  }
  return { rows, format, error: null };
}

// The plan a row links to, relative to docs/ristretto/: `[plan](plans/x.md)` or a bare path;
// a repo-relative `docs/ristretto/plans/x.md` (immo-wert) reads the same.
function planOf(cell) {
  const link = /\(([^)\s]+\.md)\)/.exec(cell);
  const path = link ? link[1] : /^[^\s[\]()]+\.md$/.test(cell) ? cell : '';
  return path.replace(/^\.?\/?docs\/ristretto\//, '');
}

// A plan's first blocker, from its `- Blockers:` line: the inline text, or the first item
// under it. `—` is none.
export function blockerOf(plan) {
  return parsePlan(plan).blockers[0] ?? null;
}

const BRIEF = /^\s*(?:>\s*)?(PLANNER|IMPLEMENTER|REVIEWER|CLOSER) for ristretto feature \*\*([^*]+)\*\*([^\n]*)/;

export function parseBrief(prompt) {
  const hit = BRIEF.exec(prompt || '');
  if (!hit) return null;
  const role = hit[1] === 'IMPLEMENTER' && /\bfixer\b/.test(hit[3]) ? 'fixer' : hit[1].toLowerCase();
  return { role, id: hit[2].trim() };
}

export function parseReport(role, text) {
  if (role === 'closer') return text.trim() ? 'closed' : null;
  if (role === 'reviewer') {
    if (/review:\s*blocking/.test(text)) return 'blocking';
    if (/review:\s*(clean|notes-only)/.test(text)) return 'clean';
    return null;
  }
  if (role === 'planner') {
    if (/^\s*planned:/m.test(text)) return 'planned';
    if (/^\s*blocked:/m.test(text)) return 'blocked';
  }
  return null;
}

// The subagent's report out of an Agent tool result: its hand-back when it handed back, else
// its content; empty for a background agent, whose report has not arrived.
export function reportText(ran) {
  const result = ran && ran.result;
  if (!result) return '';
  if (result.handbackReport && typeof result.handbackReport.text === 'string') return result.handbackReport.text;
  if (Array.isArray(result.content)) return result.content.map((c) => c.text || '').join('\n');
  return '';
}

const PHASE_OF = { planner: 'planning', implementer: 'coding', fixer: 'fixing', reviewer: 'review', closer: 'closing' };

function idle(command, now) {
  return { command, id: null, phase: null, round: 0, since: now, gate: null, armed: false };
}

// What the pane believes about the running feature after one more observation. `armed` is
// whether .ristretto/pulling has been seen: until it has, an absent marker is not an end.
export function fold(live, obs, now) {
  switch (obs.kind) {
    case 'command': {
      const arg = (obs.args || '').trim().split(/\s+/)[0] || '';
      const id = obs.command === 'brew' || arg === '' || arg === 'next' ? null : arg;
      return { ...idle(obs.command, now), id, phase: 'starting' };
    }
    case 'brief': {
      const base = live || idle(null, now);
      const same = base.id === obs.id;
      return {
        ...base,
        id: obs.id,
        phase: PHASE_OF[obs.role],
        round: (same ? base.round : 0) + (obs.role === 'reviewer' ? 1 : 0),
        since: now,
        gate: null,
      };
    }
    case 'report': {
      if (!live) return null;
      if (obs.verdict === 'blocking') return { ...live, phase: 'fixing', since: now };
      if (obs.verdict === 'clean') return { ...live, phase: 'closing', since: now };
      if (obs.verdict === 'planned') return { ...live, phase: 'coding', since: now };
      if (obs.verdict === 'closed') return { ...live, id: null, phase: 'starting', round: 0, since: now };
      return live;
    }
    case 'gate-start':
      return live && { ...live, gate: { since: now, red: false } };
    case 'gate-end':
      if (!live || !live.gate) return live;
      return { ...live, gate: obs.red ? { ...live.gate, red: true } : null };
    case 'marker': {
      // `unclaimed` is ours only if this session started something; `other` never is.
      const ours = obs.state === 'mine' || (obs.state === 'unclaimed' && live !== null);
      if (!ours) return live && live.armed ? null : live;
      if (!live) return { ...idle(null, now), armed: true };
      if (live.armed) return live;
      // shot has no planner: arming is where its coding starts.
      const coding = live.command === 'shot' && live.phase === 'starting';
      return { ...live, armed: true, ...(coding ? { phase: 'coding', since: now } : {}) };
    }
    case 'main-turn-end':
      if (!live || !live.armed) return null;
      return obs.interrupted ? { ...live, phase: 'interrupted', since: now, gate: null } : live;
    default:
      return live;
  }
}

// How many cells of a `width`-cell bar are filled for done/total, rounded to the nearest cell.
export function bar(done, total, width) {
  const filled = total > 0 ? Math.round((done / total) * width) : 0;
  return { filled, empty: width - filled };
}

export function elapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${pad(s % 60)}s`;
  return `${Math.floor(s / 3600)}h${pad(Math.floor((s % 3600) / 60))}m`;
}

// One glyph and one tone per status. Tones are Claude theme keys, so the pane follows the
// person's light/dark theme on every surface; single-width glyphs, because emoji draw unevenly.
const LOOK = {
  planned: { mark: '○', tone: 'inactive', tag: '' },
  'in-progress': { mark: '●', tone: 'claude', tag: 'in progress' },
  blocked: { mark: '✕', tone: 'error', tag: 'blocked' },
  'needs-human': { mark: '◐', tone: 'permission', tag: 'waiting on you' },
  'needs-review': { mark: '◐', tone: 'warning', tag: 'review' },
  done: { mark: '✓', tone: 'success', tag: '' },
  unknown: { mark: '?', tone: 'inactive', tag: '' },
};

const PREP = 'no roadmap here — /ristretto:prep starts one';

function rowOf(row, ctx) {
  const look = LOOK[row.status];
  const plan = ctx.plans[row.id];
  const waiting = row.status === 'planned' ? waitingOn(plan, ctx.statusOf) : [];
  const out = {
    key: `row-${row.id}`,
    id: row.id,
    status: row.status,
    mark: look.mark,
    tone: look.tone,
    tag: waiting.length > 0 ? 'waits on' : row.status === 'planned' && row.tier === 'easy' ? 'easy' : look.tag,
    detail: row.reason || row.title,
    waiting,
    toggle: { open: ctx.open === row.id },
  };
  if (row.status === 'planned' && !ctx.busy && waiting.length === 0) {
    out.action = { label: 'start', command: row.tier === 'easy' ? 'ristretto:shot' : 'ristretto:pull', args: row.id };
  }
  if (ctx.open === row.id) out.details = detailsOf(row, plan, ctx);
  return out;
}

// What an opened row says: what it needs, what done means for it, and what happened.
function detailsOf(row, plan, ctx) {
  const details = {
    deps: plan ? plan.depends.map((id) => {
      const status = ctx.statusOf.get(id) ?? 'missing';
      return { id, status, ok: SATISFIES.has(status) };
    }) : [],
    acceptance: plan ? plan.acceptance.map((a, i) => ({ ...a, proof: row.status === 'done' ? proofFor(plan, i + 1) : null })) : [],
    blockers: row.status === 'blocked' && plan ? plan.blockers : [],
    findings: row.status === 'needs-review' && plan ? plan.findings : [],
    checks: row.status === 'needs-human' ? ctx.checks[row.id] ?? [] : [],
    review: plan ? plan.review : null,
    gate: plan ? plan.gate : null,
    commit: row.commit || null,
    run: ctx.runOf.get(row.id) ?? null,
    missing: !plan,
    // A done plan whose Evidence is prose proves its criteria, just not one by one.
    unitemised: row.status === 'done' && plan?.itemised === false,
  };
  if (!ctx.busy && row.status === 'blocked') details.action = { label: 'refine', command: 'ristretto:prep', args: `${row.id} deep` };
  if (!ctx.busy && row.status === 'needs-review') details.action = { label: 'judge', command: 'ristretto:pull', args: row.id };
  return details;
}

// The run card: what runs, where it stands, how long, and its gate. Steps follow the command —
// shot has no planner — and an interrupted run shows none current and no clock.
function nowOf(rows, live, now, elsewhere) {
  if (!live) return elsewhere ? { key: 'now', text: 'a run is active in another session' } : null;
  const row = live.id ? rows.find((r) => r.id === live.id) : null;
  if (!row || !live.phase) {
    const what = live.command ? ` — ${live.command}${live.id ? ` ${live.id}` : ''}, ${live.phase || 'starting'}` : '';
    return { key: 'now', text: `a run is active${what}` };
  }
  const stopped = live.phase === 'interrupted';
  const status = live.phase === 'review' ? `review r${live.round}` : live.phase;
  const order = live.command === 'shot' ? ['code', 'review', 'close'] : ['plan', 'code', 'review', 'close'];
  const at = { planning: 'plan', coding: 'code', fixing: 'code', review: 'review', closing: 'close' }[live.phase];
  const current = at ? order.indexOf(at) : -1;
  return {
    key: 'now',
    id: row.id,
    detail: row.title,
    status,
    clock: stopped ? '' : elapsed(now - live.since),
    steps: order.map((label, i) => ({
      label: label === 'review' && i === current ? status : label,
      state: current < 0 ? 'todo' : i < current ? 'done' : i === current ? 'current' : 'todo',
    })),
    gate: live.gate
      ? live.gate.red ? { text: 'gate red', tone: 'error' } : { text: `gate running ${elapsed(now - live.gate.since)}`, tone: 'inactive' }
      : null,
  };
}

// The pane as a view: a summary card, the run card, what needs a person, what is next, and
// what happened, newest first. One row (`opts.open`) opens to its details. No action anywhere
// while a run is active — this session's, or `elsewhere`, another's — so the pane can never
// start a second run.
export function view(board, live, now, elsewhere = false, opts = {}) {
  if (board.error === 'no-roadmap' || board.error === 'no-table') return { kind: 'message', text: PREP };
  if (board.error) return { kind: 'message', text: `roadmap unreadable (${board.error}) — /ristretto:status shows it as text` };

  const rows = board.rows;
  const busy = live !== null || elsewhere;
  const statusOf = new Map(rows.map((r) => [r.id, r.status]));
  const records = opts.runs ?? [];
  const runOf = new Map(records.map((rec) => [rec.id, rec])); // the latest run of each feature wins
  const ctx = { busy, open: opts.open ?? null, plans: opts.plans ?? {}, checks: opts.checks ?? {}, statusOf, runOf };
  const count = (status) => rows.filter((r) => r.status === status).length;
  const done = count('done');
  if (rows.length > 0 && done === rows.length && !busy) return { kind: 'cup', total: rows.length };

  const counts = [
    ['needs-review', 'to review', 'warning'],
    ['needs-human', 'waiting on you', 'permission'],
    ['blocked', 'blocked', 'error'],
  ].map(([status, text, tone]) => ({ status, n: count(status), text, tone }))
    .filter((c) => c.n > 0)
    .map(({ status, n, text, tone }) => ({ status, n, text: `${n} ${text}`, tone }));

  const summary = { name: board.name || 'roadmap', done, total: rows.length, counts };
  summary.segments = ['done', 'needs-review', 'needs-human', 'blocked', 'in-progress', 'planned', 'unknown']
    .map((status) => ({ status, n: count(status), tone: LOOK[status].tone }))
    .filter((s) => s.n > 0);
  if (!busy && count('planned') > 0) summary.action = { label: 'brew all', command: 'ristretto:brew', args: '' };

  const notices = [];
  const plugin = (/^(\d+\.\d+)/.exec(board.format.plugin) || [])[1];
  if (plugin && board.format.project !== plugin) {
    notices.push({ key: 'format', text: 'written for another ristretto format — the next prep/pull/brew brings it up to date' });
  }

  const running = live && live.id;
  const open = (r) => r.status !== 'done' && r.status !== 'planned' && r.id !== running;
  const next = (r) => r.status === 'planned' && r.id !== running;
  // Inside each section rows group by flight, in roadmap order, so a long list reads in parts;
  // rows without a flight come last, as in /ristretto:status.
  const grouped = (picked) => [...new Set(picked.map((r) => r.flight))].sort((a, b) => (a === '') - (b === '')).map((flight) => ({
    key: `flight-${flight || 'other'}`,
    flight,
    rows: picked.filter((r) => r.flight === flight).map((r) => rowOf(r, ctx)),
  }));
  const sections = [
    { key: 'needs-you', title: 'needs you', groups: grouped(rows.filter(open)) },
    { key: 'up-next', title: 'up next', groups: grouped(rows.filter(next)) },
  ].filter((section) => section.groups.length > 0);

  // What happened, newest first: features with a measured run by when it ended, then the
  // rest in reverse roadmap order (a later row is a later feature).
  const finished = rows.filter((r) => r.status === 'done');
  const measured = finished.filter((r) => runOf.has(r.id)).sort((a, b) => runOf.get(b.id).endedAt - runOf.get(a.id).endedAt);
  const ordered = [...measured, ...finished.filter((r) => !runOf.has(r.id)).reverse()];
  const shown = opts.showDone ? ordered : ordered.slice(0, 5);
  return {
    kind: 'board',
    summary,
    notices,
    now: nowOf(rows, live, now, elsewhere),
    sections,
    done: finished.length === 0 ? null : {
      count: finished.length,
      rows: shown.map((r) => ({ ...rowOf(r, ctx), run: runOf.get(r.id) ?? null })),
      more: ordered.length - shown.length,
      trend: trend(records),
      toggle: { label: opts.showDone ? 'hide' : 'show all' },
    },
  };
}
