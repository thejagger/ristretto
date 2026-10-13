// What building a feature took: a run starts when the board first sees which feature is
// running and ends when another one starts or nothing does. Its time, tokens and gate time are
// measured from events the board already observes; no dollars, since a subscription pays no
// per-token price. Pure: no $, no Node.

export function track(run, live, now) {
  const id = live ? live.id : null;
  if (run && run.id === id) return { run, ended: null };
  const next = id ? {
    id,
    command: live.command,
    startedAt: now,
    tokens: { in: 0, out: 0, cache: 0 },
    gates: { runs: 0, ms: 0, red: 0 },
    phases: { plan: 0, code: 0, review: 0, close: 0 },
    at: null,
  } : null;
  return { run: next, ended: run || null };
}

export function addTokens(run, usage) {
  if (!run || !usage) return run;
  return {
    ...run,
    tokens: {
      in: run.tokens.in + (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0),
      out: run.tokens.out + (usage.output_tokens || 0),
      cache: run.tokens.cache + (usage.cache_read_input_tokens || 0),
    },
  };
}

export function addGate(run, ms, red) {
  if (!run) return run;
  return { ...run, gates: { runs: run.gates.runs + 1, ms: run.gates.ms + ms, red: run.gates.red + (red ? 1 : 0) } };
}

// Where a run's time goes: the fold's phase, read into four buckets. A fix round is code; any
// other phase (starting, interrupted, another feature's) stops the clock.
const BUCKET = { planning: 'plan', coding: 'code', fixing: 'code', review: 'review', closing: 'close' };
const PHASES = ['plan', 'code', 'review', 'close'];

export function markPhase(run, live, now) {
  if (!run) return run;
  const bucket = (live && live.id === run.id && BUCKET[live.phase]) || null;
  const at = run.at || null;
  if (at && at.bucket === bucket) return run;
  if (!at && !bucket) return run;
  const phases = { plan: 0, code: 0, review: 0, close: 0, ...(run.phases || {}) };
  if (at) phases[at.bucket] += Math.max(0, now - at.since);
  return { ...run, phases, at: bucket ? { bucket, since: now } : null };
}

// A finished run's time per phase, non-zero ones in order; null for a run recorded before
// phases were (or one that never reached a phase).
export function splitOf(record) {
  if (!record || !record.phases) return null;
  const split = PHASES.map((phase) => ({ phase, ms: record.phases[phase] || 0 })).filter((x) => x.ms > 0);
  return split.length > 0 ? split : null;
}

// Every run of a feature, added up: the build, then a check re-run after the manual checks, or a
// re-pull after a block. The feature cost all of it, so a later short run must not replace the
// build. One entry per feature, in the order of its last run; status and command are the last's.
export function mergeRuns(records) {
  const out = new Map();
  for (const rec of records) {
    const was = out.get(rec.id);
    out.delete(rec.id);
    if (!was) {
      out.set(rec.id, { ...rec, runs: 1 });
      continue;
    }
    const sum = (a = {}, b = {}) => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [k, (a[k] || 0) + (b[k] || 0)]));
    out.set(rec.id, {
      ...rec,
      runs: was.runs + 1,
      startedAt: Math.min(was.startedAt, rec.startedAt),
      ms: was.ms + rec.ms,
      tokens: sum(was.tokens, rec.tokens),
      gates: sum(was.gates, rec.gates),
      ...(was.phases || rec.phases ? { phases: sum(was.phases, rec.phases) } : {}),
    });
  }
  return out;
}

export function endRun(run, now, status) {
  const closed = markPhase(run, null, now);
  return {
    id: run.id,
    command: run.command,
    startedAt: run.startedAt,
    endedAt: now,
    ms: now - run.startedAt,
    tokens: run.tokens,
    gates: run.gates,
    phases: closed.phases,
    status,
  };
}

export function keep(records, record, max = 200) {
  return [...records, record].slice(-max);
}

export function count(tokens) {
  if (tokens >= 1e6) return `${(tokens / 1e6).toFixed(1)}M`;
  if (tokens >= 1e4) return `${Math.round(tokens / 1e3)}k`;
  return String(tokens);
}
