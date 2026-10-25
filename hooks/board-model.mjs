// Pure logic of the roadmap board: no $, no Node, no DOM — hooks/board.tsx feeds it what the
// session did and draws what it returns. Tested by scripts/board-model.test.js.

import { SATISFIES, parsePlan, proofFor, waitingOn } from './board-plan.mjs';
import { mergeRuns, splitOf } from './board-runs.mjs';
import { OPEN_UP_TO, rowsOf, treeOf } from './board-files.mjs';

export const STATUSES = ['planned', 'in-progress', 'blocked', 'done'];

export const EMPTY_BOARD = { name: '', rows: [], format: { project: null, plugin: '' }, error: null, plans: {}, checks: {}, decisions: {} };

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

// Whose run .ristretto/pulling is. gate.js writes the owning session id into it ('' until a
// hook claims it) and ages a marker with no gate run for a day out as a leftover.
const MARKER_MAX_IDLE_MS = 24 * 60 * 60 * 1000;
export function markerState(owner, idleMs, sessionId) {
  if (owner === null || (idleMs !== null && idleMs > MARKER_MAX_IDLE_MS)) return 'none';
  if (owner === '') return 'unclaimed';
  return owner === sessionId ? 'mine' : 'other';
}

// `blocked — no API docs` → blocked + 'no API docs'; `done—**retired**` → done.
function statusOf(cell) {
  const token = (/^[a-z-]+/.exec(cell) || [''])[0];
  const status = STATUSES.includes(token) ? token : 'unknown';
  const reason = status === 'unknown' ? cell : cell.slice(token.length).replace(/^\s*[:—–-]\s*/, '').trim();
  return { status, reason };
}

// The on-disk format has its own version, declared in scripts/migrate.js — not the plugin's
// MAJOR.MINOR. Reading it from the same place migrate.js does keeps the board and `check` agreeing.
export function formatOf(versionSource) {
  return (/const FORMAT = '(\d+\.\d+)';/.exec(String(versionSource)) || [])[1] || '';
}

export function parseRoadmap(text) {
  const lines = text.split(/\r?\n/);
  const format = (/<!--\s*ristretto-format:\s*([\d.]+)\s*-->/.exec(text) || [null, null])[1];
  const at = lines.findIndex((line) => /^\s*\|/.test(line) && cells(line).some((c) => /^(Feature|ID)$/i.test(c)));
  if (at < 0) return { rows: [], format, error: 'no-table' };

  const head = cells(lines[at]).map((c) => c.toLowerCase());
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const [iFlight, iId, iTitle, iTier, iStatus, iCommit] = [col('flight'), col('feature', 'id'), col('title'), col('tier'), col('status'), col('commit')];

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
      // A plan never moves: it is plans/<ID>.md, relative to docs/ristretto/.
      plan: row[iId] ? `plans/${row[iId]}.md` : '',
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

export function elapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${pad(s % 60)}s`;
  return `${Math.floor(s / 3600)}h${pad(Math.floor((s % 3600) / 60))}m`;
}

// How long something finished took, to the unit that matters: `45s`, `36m`, `1h05m`. The
// running clock keeps its seconds (elapsed); a finished span does not need them.
export function duration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

// Plan text carries Markdown the pane cannot draw: `**bold**` and `code` become styled
// segments, the markers dropped. An unclosed marker is kept as written.
export function inline(text) {
  const out = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  for (let m; (m = re.exec(text));) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push(m[1] !== undefined ? { text: m[1], bold: true } : { text: m[2], code: true });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

// The same text as one plain line, for a row's single truncated line.
export const plain = (text) => inline(text).map((seg) => seg.text).join('');

// A blocked row names only who it waits on; the reason is on its page.
export function waitsOn(reason) {
  const m = /^\s*waiting on\s+(.+?)\s*[:—–]/i.exec(reason || '');
  return m ? `waits on ${m[1]}` : plain(reason || '');
}

// A feature that stopped on a fact in conflict names it as `domain/<file>.md: …` — first in the
// reason (`blocked: domain/…`, common.md) or after the ID (`blocked — <ID> — domain/…`).
export function factOf(reason) {
  return (/(?:^|[\s—–-])domain\/([^:\s]+\.md):/i.exec(reason || '') || [])[1] ?? null;
}

// One glyph and one tone per status. Tones are Claude theme keys, so the pane follows the
// person's light/dark theme on every surface; single-width glyphs, because emoji draw unevenly.
const LOOK = {
  planned: { mark: '○', tone: 'inactive', tag: '' },
  'in-progress': { mark: '●', tone: 'claude', tag: 'in progress' },
  blocked: { mark: '✕', tone: 'error', tag: 'blocked' },
  done: { mark: '✓', tone: 'success', tag: '' },
  unknown: { mark: '?', tone: 'inactive', tag: '' },
};

const PREP = 'no roadmap here — /ristretto:prep starts one';

// What an opened row says: what it needs, what done means for it, and what happened.
function detailsOf(row, plan, ctx) {
  const details = {
    deps: plan ? plan.depends.map((id) => {
      const status = ctx.statusOf.get(id) ?? 'missing';
      return { id, status, ok: SATISFIES.has(status) };
    }) : [],
    acceptance: plan ? plan.acceptance.map((a, i) => ({ ...a, proof: row.status === 'done' ? proofFor(plan, i + 1) : null })) : [],
    blockers: row.status === 'blocked' && plan ? plan.blockers : [],
    findings: plan ? plan.findings : [],
    checks: ctx.checks[row.id] ?? [],
    decisions: ctx.decisions[row.id] ?? [],
    review: plan ? plan.review : null,
    gate: plan ? plan.gate : null,
    commit: row.commit || null,
    run: ctx.runOf.get(row.id) ?? null,
    missing: !plan,
    // A done plan whose Evidence is prose proves its criteria, just not one by one.
    unitemised: row.status === 'done' && plan?.itemised === false,
  };
  return details;
}

// Every page goes back to the board, by one label.
const BACK = 'Board';

function featurePage(row, ctx) {
  const look = LOOK[row.status];
  const plan = ctx.plans[row.id];
  const run = ctx.runOf.get(row.id);
  const fact = row.status === 'blocked' ? factOf(row.reason) : null;
  return {
    kind: 'feature',
    id: row.id,
    title: row.title,
    status: row.status,
    mark: look.mark,
    tone: look.tone,
    back: BACK,
    goal: plan?.goal ?? null,
    waitingOn: fact ? `domain/${fact}` : (/^\s*waiting on\s+(.+?)\s*[:—–]/i.exec(row.reason || '') || [])[1] ?? null,
    split: run ? splitOf(run) : null,
    files: filesOf(row, ctx),
    details: detailsOf(row, plan, ctx),
  };
}

// The Files card: what the feature's commits changed (board.tsx finds them by ID); before there
// is a commit, no card. ristretto's own docs ride along in the feature commit and are not what a
// review reads. Up to OPEN_UP_TO files start open; a click overrides per folder.
function filesOf(row, ctx) {
  const list = (ctx.files[row.id] ?? []).filter((f) => !f.path.startsWith('docs/ristretto/'));
  if (list.length === 0) return null;
  const tree = treeOf(list);
  const clicked = ctx.folders[row.id] ?? {};
  const all = list.length <= OPEN_UP_TO;
  return { n: list.length, add: tree.add, del: tree.del, rows: rowsOf(tree, (p) => clicked[p] ?? all) };
}

// The facts as information: per file, those in conflict first, then the binding ones, then
// context. Nothing here is confirmed, removed or committed — that happens in the chat.
export function domainPage(domain) {
  const rank = (f) => (f.conflict ? 0 : f.state === 'confirmed' ? 1 : 2);
  const files = [...new Set(domain.tree.map((f) => f.file))].sort();
  return {
    kind: 'domain',
    back: BACK,
    n: domain.tree.length,
    binding: domain.tree.filter((f) => f.state === 'confirmed').length,
    conflicts: domain.tree.filter((f) => f.conflict).length,
    groups: files.map((file) => ({
      file,
      name: file.replace(/\.md$/, ''),
      rows: domain.tree.map((f, i) => ({ f, i })).filter(({ f }) => f.file === file)
        .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i).map(({ f }) => f),
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// v3: one state, branch first (spec section 0 and 4). What holds this branch from shipping, what
// needs a person but is not this branch's, what brew takes next, and what is done. Rows carry no
// action: the person acts in the chat. Times are measured to `opts.drawnAt`, the stamp of the
// handler that changed what is shown, never to a clock read while drawing.

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const featureOpen = (id) => ({ kind: 'feature', id });

// What a done feature still asks of a person, read from its plan: open findings and open manual
// checks. A decision taken during the build is in force, not a question, so it never counts.
// Derived when shown, never stored as a status. null: nothing.
function waitsOf(row, ctx) {
  if (row.status !== 'done') return null;
  // A finding is `<tag> · <where> · <what>`. A note or a lean is recorded, not a person's turn,
  // and an untagged line is prose around the findings.
  const findings = (ctx.plans[row.id]?.findings ?? []).filter((f) => { const tag = /^(\w+)\s+·/.exec(f); return tag && !['note', 'lean'].includes(tag[1]); }).length;
  const checks = (ctx.checks[row.id] ?? []).filter((c) => !c.done).length;
  if (!findings && !checks) return null;
  // A box a person ticks first; findings alone are a look, not an answer.
  const person = checks > 0;
  const words = [[findings, 'finding'], [checks, 'check']].filter(([n]) => n).map(([n, w]) => plural(n, w));
  return { detail: `${words.join(' · ')} open`, glyph: person ? 'person' : 'findings', tone: person ? 'permission' : 'warning' };
}

const blockedWords = (row) => {
  const fact = factOf(row.reason);
  return fact ? `waits on domain/${fact}` : waitsOn(row.reason);
};

// The feature brew takes first: the topmost planned row that waits on nothing, in roadmap order.
function nextPick(rows, ctx, running) {
  for (const r of rows) {
    if (r.id === running) continue;
    if (r.status === 'planned' && waitingOn(ctx.plans[r.id], ctx.statusOf).length === 0 && !(ctx.plans[r.id]?.blockers?.length)) return r.id;
  }
  return null;
}

function doneRowOf(r, run) {
  return {
    key: `done-${r.id}`, glyph: 'done', id: r.id, detail: plain(r.title), tone: 'dim',
    meta: run ? duration(run.ms) : '', split: run ? splitOf(run) : null, open: featureOpen(r.id),
  };
}

export function stateOf(board, live, elsewhere = false, opts = {}) {
  const rows = board.rows;
  const busy = live !== null || elsewhere;
  const running = live && live.id;
  const statusOf = new Map(rows.map((r) => [r.id, r.status]));
  const runOf = mergeRuns(opts.runs ?? []);
  const ctx = { busy, plans: opts.plans ?? {}, checks: opts.checks ?? {}, decisions: opts.decisions ?? {}, statusOf, runOf, files: opts.files ?? {}, folders: opts.folders ?? {} };
  const branchIds = opts.branch?.ids ?? null;
  const onBranch = (id) => !!branchIds && branchIds.includes(id);
  const nextId = nextPick(rows, ctx, running);
  const suite = opts.suite ?? { state: 'unproven', text: 'suite unproven', failing: '' };

  // What holds the branch: its features that are not done, in roadmap order, a red suite first.
  const holders = [];
  if (branchIds) {
    if (suite.state === 'red') {
      holders.push({ key: 'hold-suite', glyph: 'suite-red', id: 'full suite', detail: `red · ${suite.failing || 'a gate'}`, tone: 'error', open: null });
    }
    for (const r of rows) {
      if (!onBranch(r.id) || r.id === running) continue;
      const hold = (detail, tone, glyph = r.status === 'in-progress' ? 'running' : r.status) => holders.push({
        key: `hold-${r.id}`, glyph, id: r.id, detail, tone,
        open: featureOpen(r.id), ...(r.id === nextId ? { tag: 'next' } : {}),
      });
      const waits = waitsOf(r, ctx);
      if (waits) hold(waits.detail, waits.tone, waits.glyph);
      else if (r.status === 'blocked') hold(`blocked · ${blockedWords(r)}`, 'error');
      else if (r.status === 'in-progress') hold('in progress · no run', 'dim');
    }
  }

  // What needs a person but does not hold this branch: blocked rows without code here, done rows
  // with open boxes or findings built elsewhere (or every one, with no scope), facts in conflict.
  const needsYou = [];
  for (const r of rows) {
    if (onBranch(r.id) || r.id === running) continue;
    const waits = waitsOf(r, ctx);
    if (r.status === 'blocked') needsYou.push({ key: `need-${r.id}`, glyph: 'blocked', id: r.id, detail: blockedWords(r), tone: 'dim', open: featureOpen(r.id) });
    else if (waits) needsYou.push({ key: `need-${r.id}`, glyph: waits.glyph, id: r.id, detail: waits.detail, tone: 'dim', open: featureOpen(r.id) });
  }
  for (const f of (opts.domain ?? { tree: [] }).tree.filter((x) => x.conflict)) {
    needsYou.push({ key: `fact-${f.file}-${f.title}`, glyph: 'fact-conflict', id: f.title, detail: `${f.file} · in conflict`, tone: 'warning', open: { kind: 'domain' } });
  }

  // Up next: what waits on nothing, in brew's order, five at most.
  const planned = rows.filter((r) => r.status === 'planned' && r.id !== running);
  const free = (r) => waitingOn(ctx.plans[r.id], statusOf).length === 0 && !(ctx.plans[r.id]?.blockers?.length);
  const eligible = planned.filter(free);
  const upNext = {
    rows: eligible.slice(0, 5).map((r) => ({
      key: `next-${r.id}`, glyph: r.id === nextId ? 'next' : 'planned', id: r.id, detail: r.id === nextId ? 'next' : 'queued',
      tone: r.id === nextId ? 'default' : 'dim', open: featureOpen(r.id),
    })),
    eligible: eligible.length,
    more: Math.max(0, eligible.length - 5),
    all: eligible.map((r) => r.id),
    waiting: planned.length - eligible.length,
  };

  // Done: newest first, a measured run by when it ended, the rest by roadmap order reversed.
  const finished = rows.filter((r) => r.status === 'done' && !waitsOf(r, ctx));
  const measured = finished.filter((r) => runOf.has(r.id)).sort((a, b) => runOf.get(b.id).endedAt - runOf.get(a.id).endedAt);
  const ordered = [...measured, ...finished.filter((r) => !runOf.has(r.id)).reverse()];
  const here = branchIds ? ordered.filter((r) => onBranch(r.id)) : ordered.slice(0, 5);
  const done = { here: here.map((r) => doneRowOf(r, runOf.get(r.id))), total: finished.length, recent: !branchIds, all: ordered.map((r) => doneRowOf(r, runOf.get(r.id))) };

  return {
    busy, ctx, branchIds, holders, needsYou, upNext, nextId, done, suite,
    open: rows.filter((r) => r.status !== 'done').length,
    needYou: needsYou.length,
  };
}

// The effort bar for a run (spec 5): plan · code · review · close (shot has no plan), the
// phases before the current one done. Code sits mid-phase (no unit record, spec 0.3 #11); review
// moves by round, 3 for brew and 2 for pull and shot; a fix round stays in review. Progress moves
// only with the phase or round, never with the clock.
const AT = { planning: 'plan', coding: 'code', fixing: 'review', review: 'review', closing: 'close' };
export function effortOf(live, command) {
  const names = command === 'shot' ? ['code', 'review', 'close'] : ['plan', 'code', 'review', 'close'];
  const phase = live?.phase ?? null;
  const at = AT[phase] ? names.indexOf(AT[phase]) : -1;
  const round = Math.max(1, live?.round || 0);
  const max = command === 'brew' ? 3 : 2;
  const progress = (name) => {
    if (name !== 'review') return 0.5;
    const p = phase === 'fixing' ? (round - 0.25) / max : (round - 0.5) / max;
    return Math.min(0.95, Math.max(0.05, p));
  };
  const step = phase === 'review' ? (round > 1 ? `review r${round}` : 'review')
    : phase === 'fixing' ? `fix r${round}`
      : AT[phase] ?? (phase || 'starting');
  const done = phase === 'interrupted' ? -1 : at;
  return {
    phases: names.map((name, i) => (i === at && phase !== 'interrupted'
      ? { name, state: 'current', progress: progress(name) }
      : { name, state: i < done ? 'done' : 'todo' })),
    red: !!live?.gate?.red,
    step,
  };
}

// The role table: each role's time, the running one live (measured to the drawing's stamp).
export function rolesOf(roles, id, drawnAt) {
  return (roles?.[id] ?? []).map((r) => ({
    role: r.role,
    model: r.model,
    time: { ms: Math.max(0, (r.endedAt ?? drawnAt) - r.startedAt), live: r.endedAt === null || r.endedAt === undefined },
    state: r.endedAt === null || r.endedAt === undefined ? 'current' : 'done',
  }));
}

// The role a main-loop phase change starts in pull or shot (spec 4.8); brew's roles all arrive
// as spawns, so it has none here.
const MAIN_ROLE = { coding: 'implementer', fixing: 'fixer', closing: 'closer' };
export function mainRoleOf(before, after) {
  if (!after || !after.id || after.command === 'brew' || !MAIN_ROLE[after.phase]) return null;
  if (before && before.id === after.id && before.phase === after.phase) return null;
  return { id: after.id, role: MAIN_ROLE[after.phase], round: after.round || 0 };
}

// The Brewing card (spec 4.6, section 0): the feature at work, then the rest of this brew. With
// the snapshot the board took when brew started, the tally (brewed + blocked + to go = total, the
// current feature one to go); without it (a brew the board did not see start) the rest comes from
// Up next. A pull or shot is the feature alone. `opts.run` is the run in progress (its start).
export function brewingOf(board, live, opts = {}) {
  if (!live) return null;
  const rows = board.rows;
  const drawnAt = opts.drawnAt ?? 0;
  const statusOf = new Map(rows.map((r) => [r.id, r.status]));
  const ctx = { plans: opts.plans ?? {}, checks: opts.checks ?? {}, decisions: opts.decisions ?? {}, statusOf };
  const brew = live.command === 'brew';
  const current = live.id ? rows.find((r) => r.id === live.id) ?? { id: live.id, title: '', status: 'in-progress' } : null;
  const effort = effortOf(live, live.command);
  const snap = brew ? opts.snapshot ?? null : null;
  const runOf = mergeRuns((opts.runs ?? []).filter((r) => !snap || r.startedAt >= snap.startedAt));

  const inset = current && {
    id: current.id,
    title: plain(current.title || ''),
    glyph: effort.red ? 'gate-red' : 'running',
    status: effort.step,
    red: effort.red,
    effort,
    roles: rolesOf(opts.roles, current.id, drawnAt),
    gate: effort.red ? { red: true, text: 'gate red' } : null,
    elapsed: { ms: Math.max(0, drawnAt - (opts.run && opts.run.id === current.id ? opts.run.startedAt : live.since)), live: live.phase !== 'interrupted' },
  };

  const queued = (ids) => ids.map((id, i) => ({
    key: `q-${id}`, glyph: i === 0 ? 'next' : 'planned', id, detail: i === 0 ? 'next' : 'queued', tone: i === 0 ? 'default' : 'dim', open: featureOpen(id),
  }));
  const free = (r) => waitingOn(ctx.plans[r.id], statusOf).length === 0 && !(ctx.plans[r.id]?.blockers?.length);
  let tally = null;
  let rest = [];
  let more = 0;
  let moreBrewed = 0;
  if (snap) {
    const inBrew = new Set(snap.ids);
    const others = rows.filter((r) => inBrew.has(r.id) && r.id !== live.id);
    const brewed = others.filter((r) => r.status === 'done');
    const blocked = others.filter((r) => r.status === 'blocked');
    const blockedIds = new Set(blocked.map((r) => r.id));
    const deps = (r) => ctx.plans[r.id]?.depends ?? [];
    const waitsBlocked = (r) => deps(r).find((d) => blockedIds.has(d) || (!inBrew.has(d) && !SATISFIES.has(statusOf.get(d))));
    const pending = others.filter((r) => r.status === 'planned');
    const toGo = pending.filter((r) => !waitsBlocked(r));
    const stuck = pending.filter((r) => waitsBlocked(r));
    tally = { brewed: brewed.length, blocked: blocked.length, toGo: toGo.length + (current ? 1 : 0), total: 0 };
    tally.total = tally.brewed + tally.blocked + tally.toGo;
    // In brew's order: what waits on nothing first, then what waits on rows still in this brew.
    const order = [...toGo.filter(free), ...toGo.filter((r) => !free(r))].map((r) => r.id);
    const byEnd = (a, b) => (runOf.get(b.id)?.endedAt ?? 0) - (runOf.get(a.id)?.endedAt ?? 0);
    const brewedShown = brewed.slice().sort(byEnd).slice(0, 3);
    rest = [
      ...queued(order.slice(0, 3)),
      ...brewedShown.map((r) => ({
        key: `brewed-${r.id}`, glyph: r.status, id: r.id, detail: 'brewed', tone: 'dim',
        meta: runOf.has(r.id) ? duration(runOf.get(r.id).ms) : '', open: featureOpen(r.id),
      })),
      ...blocked.map((r) => ({ key: `brew-blocked-${r.id}`, glyph: 'blocked', id: r.id, detail: `blocked · ${blockedWords(r)}`, tone: 'error', open: featureOpen(r.id) })),
      ...stuck.map((r) => ({ key: `brew-waits-${r.id}`, glyph: 'planned', id: r.id, detail: `waits on ${waitsBlocked(r)}`, tone: 'dim', open: featureOpen(r.id) })),
    ];
    more = Math.max(0, order.length - 3);
    moreBrewed = Math.max(0, brewed.length - 3);
  } else if (brew) {
    const order = rows.filter((r) => r.status === 'planned' && r.id !== live.id && free(r)).map((r) => r.id);
    rest = queued(order.slice(0, 3));
    more = Math.max(0, order.length - 3);
  }
  return {
    kind: 'brewing',
    title: brew ? 'Brewing' : 'Pulling',
    red: effort.red,
    lanes: false,
    tally,
    clock: snap ? { ms: Math.max(0, drawnAt - snap.startedAt), live: true } : null,
    inset,
    text: inset ? null : effort.step,
    laneRows: [],
    freeSlot: null,
    rows: rest,
    more,
    moreBrewed,
  };
}

// Every done feature, newest first: the History page.
export function historyPage(state) {
  return { kind: 'history', back: BACK, n: state.done.all.length, rows: state.done.all };
}

// The queue: every feature that waits on nothing, in brew's order, then those that wait, grouped
// by flight (rows without one last, as in /ristretto:status), each saying what it waits on.
export function queuePage(board, state) {
  const { ctx } = state;
  const waiting = board.rows.filter((r) => r.status === 'planned' && !state.upNext.all.includes(r.id));
  const flights = [...new Set(waiting.map((r) => r.flight))].sort((a, b) => (a === '') - (b === ''));
  return {
    kind: 'queue',
    back: BACK,
    eligible: state.upNext.all.map((id, i) => ({
      key: `queue-${id}`, glyph: id === state.nextId ? 'next' : 'planned', id, detail: id === state.nextId ? 'next' : 'queued',
      tone: id === state.nextId ? 'default' : 'dim', open: featureOpen(id),
    })),
    waiting: flights.map((flight) => ({
      key: `flight-${flight || 'other'}`,
      flight,
      rows: waiting.filter((r) => r.flight === flight).map((r) => {
        const on = waitingOn(ctx.plans[r.id], ctx.statusOf).map((w) => w.id);
        const blocker = ctx.plans[r.id]?.blockers?.[0];
        return {
          key: `wait-${r.id}`, glyph: 'planned', id: r.id, tone: 'dim', open: featureOpen(r.id),
          detail: on.length ? `waits on ${on.join(', ')}` : blocker ? `waits on ${plain(blocker)}` : 'waits',
        };
      }),
    })),
  };
}

// The Branch card (spec section 0): its features' state as a bar and the rows that hold it, the
// suite and the last brew underneath. Never "ahead of" anything.
function branchCard(state, branch, compact) {
  const ids = state.branchIds;
  const statusOf = state.ctx.statusOf;
  const count = (glyph) => state.holders.filter((h) => h.glyph === glyph).length;
  // Done and asking nothing: a done feature with an open box is counted where it holds the branch.
  const done = ids ? ids.filter((id) => statusOf.get(id) === 'done').length - count('person') - count('findings') : 0;
  const ready = !!ids && ids.length > 0 && state.holders.length === 0 && state.suite.state === 'green';
  const footer = !branch.base ? (branch.onDefault ? `on ${branch.name} · nothing to compare with` : 'no main branch to compare with')
    : !ids ? 'nothing on this branch yet'
      : [state.suite.text, branch.lastBrew].filter(Boolean).join(' · ');
  return {
    kind: 'branch', compact, branch: branch.name, base: branch.base, scoped: !!ids,
    features: ids ? ids.length : 0, done, holds: state.holders, ready, suite: state.suite, lastBrew: branch.lastBrew, footer,
    bar: { done, review: count('findings'), human: count('person') + count('blocked') + count('running') + count('suite-red') },
  };
}

// The pane as a view (spec section 0): cards in the order of the state. Idle: Branch, Needs you,
// Up next, Done, Domain facts. Running: Brewing, Branch (holders only), Needs you, Done (one line).
// A page replaces the cards; every feature done and nothing for a person is the cup.
export function view(board, live, elsewhere = false, opts = {}) {
  if (board.error === 'no-roadmap' || board.error === 'no-table') return { kind: 'message', text: PREP };
  if (board.error) return { kind: 'message', text: `roadmap unreadable (${board.error}) — /ristretto:status shows it as text` };

  const rows = board.rows;
  const state = stateOf(board, live, elsewhere, opts);
  const domain = opts.domain ?? { tree: [] };
  const page = opts.page?.kind;
  if (page === 'domain') return { kind: 'page', page: domainPage(domain) };
  if (page === 'history') return { kind: 'page', page: historyPage(state) };
  if (page === 'queue') return { kind: 'page', page: queuePage(board, state) };
  if (page === 'feature' && rows.some((r) => r.id === opts.page.id)) {
    return { kind: 'page', page: featurePage(rows.find((r) => r.id === opts.page.id), state.ctx) };
  }
  const conflicted = domain.tree.filter((f) => f.conflict);
  // A red suite on this code holds the branch even when every row is done: never under the cup.
  if (rows.length > 0 && rows.every((r) => r.status === 'done') && !state.busy && !conflicted.length && state.holders.length === 0) return { kind: 'cup', total: rows.length };

  const notices = [];
  const plugin = (/^(\d+\.\d+)/.exec(board.format.plugin) || [])[1];
  if (plugin && board.format.project !== plugin) {
    notices.push({ key: 'format', text: 'written for another ristretto format — the next prep/pull/brew brings it up to date' });
  }

  const cards = [];
  const needs = state.needsYou.length ? { kind: 'needs', rows: state.needsYou } : null;
  const doneCard = (compact) => ({ kind: 'done', compact, recent: state.done.recent, n: state.done.here.length, total: state.done.total, rows: compact ? [] : state.done.here });
  if (state.busy) {
    cards.push(live
      ? brewingOf(board, live, { ...opts, snapshot: opts.snapshot ?? null })
      : { kind: 'brewing', title: 'Brewing', text: 'a run is active in another session', inset: null, tally: null, clock: null, laneRows: [], rows: [], more: 0, moreBrewed: 0, red: false, lanes: false, freeSlot: null });
    if (opts.branch) cards.push(branchCard(state, opts.branch, true));
    if (needs) cards.push(needs);
    cards.push(doneCard(true));
    return { kind: 'board', state: 'running', notices, cards };
  }
  if (opts.branch) cards.push(branchCard(state, opts.branch, false));
  if (needs) cards.push(needs);
  if (state.upNext.eligible + state.upNext.waiting > 0) cards.push({ kind: 'next', ...state.upNext });
  if (state.done.total > 0) cards.push(doneCard(false));
  if (domain.tree.length) {
    cards.push({ kind: 'facts', n: domain.tree.length, binding: domain.tree.filter((f) => f.state === 'confirmed').length, conflicts: conflicted.length });
  }
  return { kind: 'board', state: 'idle', notices, cards };
}

// The band above the prompt: only the main thing (spec section 0). Running: the feature and its
// step (`gate red` when red) on the effort chip, and who is needed. Idle: what is open and who is
// needed, or `ready to ship`. Nothing where there is no roadmap to speak of.
export function bandOf(board, live, elsewhere = false, opts = {}) {
  if (board.error || board.rows.length === 0) return null;
  const state = stateOf(board, live, elsewhere, opts);
  if (live) {
    const effort = effortOf(live, live.command);
    return { running: { id: live.id, step: effort.red ? 'gate red' : effort.step, red: effort.red, effort: { phases: effort.phases, red: effort.red }, needYou: state.needYou } };
  }
  if (elsewhere) return { running: { id: null, step: 'a run is active in another session', red: false, effort: null, needYou: state.needYou } };
  const ready = !!opts.branch && branchCard(state, opts.branch, false).ready;
  return { idle: { open: state.open, needYou: state.needYou, ready } };
}
