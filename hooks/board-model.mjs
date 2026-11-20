// Pure logic of the roadmap board: no $, no Node, no DOM — hooks/board.tsx feeds it what the
// session did and draws what it returns. Tested by scripts/board-model.test.js.


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
const STATUSES = ['planned', 'in-progress', 'blocked', 'done'];
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

// On any line: a builder may say where its repo is before the brief's own first line.
const BRIEF = /^[ \t]*(?:>[ \t]*)?(PLANNER|IMPLEMENTER|REVIEWER|CLOSER) for ristretto feature \*\*([^*]+)\*\*([^\n]*)/m;

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

// Which build command a slash command or a Skill call names: 'pull', 'shot', 'brew', or null.
export function commandOf(name) {
  const hit = /^ristretto:(pull|shot|brew)$/.exec(name || '');
  return hit ? hit[1] : null;
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
      // `agent`: a builder subagent runs it, so the main agent's turns are not this run's.
      return { ...idle(obs.command, now), id, phase: 'starting', unattended: /\bunattended\b/.test(obs.args || ''), agent: !!obs.agent };
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
      // shot has no planner, nor has an unattended easy row: arming is where building starts. An
      // unattended normal row's planner brief, which follows, takes it back to plan.
      const coding = (live.command === 'shot' || live.unattended) && live.phase === 'starting';
      return { ...live, armed: true, ...(coding ? { phase: 'coding', since: now } : {}) };
    }
    // v1's steps after build: a verify proves it (a verify while fixing stays in review), a
    // /code-review reviews it, close.js closes it.
    // A run resumed after an interruption, or one that never saw a brief, moves on too.
    case 'verify':
      return live && ['coding', 'starting', 'interrupted'].includes(live.phase) ? { ...live, phase: 'proving', since: now } : live;
    case 'review':
      return live && ['coding', 'proving', 'starting', 'interrupted'].includes(live.phase) ? { ...live, phase: 'review', round: 1, since: now, gate: null } : live;
    // At a folder there is no marker to say a builder's run ended: the brewer's turn after its
    // close does.
    case 'run-end':
      return null;
    case 'close':
      return live && live.id && live.phase !== 'closing' ? { ...live, phase: 'closing', since: now } : live;
    case 'main-turn-end':
      if (live && live.agent) return live;
      if (!live || !live.armed) return null;
      return obs.interrupted ? { ...live, phase: 'interrupted', since: now, gate: null } : live;
    default:
      return live;
  }
}

// How long something finished took, to the unit that matters: `45s`, `36m`, `1h05m`.
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

export const PREP = 'no roadmap here — /ristretto:prep starts one';

export const blockedWords = (row) => waitsOn(row.reason);

// The effort bar for a run (v1, spec 2026-11-20): plan · build · prove · review · close (shot has
// no plan), the steps before the current one done. The current step sits mid-step; a fix round
// stays in review. Progress moves only with the step, never with the clock.
export const STEPS = ['plan', 'build', 'prove', 'review', 'close'];
const AT = { planning: 'plan', coding: 'build', proving: 'prove', fixing: 'review', review: 'review', closing: 'close' };
export function effortOf(live, command) {
  const names = command === 'shot' ? STEPS.slice(1) : STEPS;
  const phase = live?.phase ?? null;
  const at = AT[phase] ? names.indexOf(AT[phase]) : -1;
  const step = phase === 'interrupted' ? 'stopped' : AT[phase] ?? (phase || 'starting');
  return {
    phases: names.map((name, i) => (i === at
      ? { name, state: 'current', progress: phase === 'fixing' ? 0.75 : 0.5 }
      : { name, state: i < at ? 'done' : 'todo' })),
    red: !!live?.gate?.red,
    step,
  };
}

// What a tool call says about the step a run is at (v1): `gate.js verify` proves the build,
// /code-review reviews it, `close.js` closes it. Anything else says nothing.
const VERIFY = /\bnode\b[^|;&]*\bgate\.js["']?\s+verify\b/;
const CLOSE = /\bnode\b[^|;&]*\bclose\.js["']?\s+\S/;
const REVIEW = /^(?:[\w-]+:)?code-review$/;
export function signalOf({ tool, command, skill } = {}) {
  if (tool === 'Skill') return REVIEW.test(String(skill ?? '')) ? { kind: 'review' } : null;
  if (tool !== 'Bash') return null;
  const cmd = String(command ?? '');
  if (VERIFY.test(cmd)) return { kind: 'verify' };
  if (CLOSE.test(cmd)) return { kind: 'close' };
  return null;
}

// The role a main-loop phase change starts in pull or shot (spec 4.8); brew's roles all arrive
// as spawns, so it has none here.
const MAIN_ROLE = { coding: 'implementer', fixing: 'fixer', closing: 'closer' };
export function mainRoleOf(before, after) {
  if (!after || !after.id || after.command === 'brew' || !MAIN_ROLE[after.phase]) return null;
  if (before && before.id === after.id && before.phase === after.phase) return null;
  return { id: after.id, role: MAIN_ROLE[after.phase], round: after.round || 0 };
}
