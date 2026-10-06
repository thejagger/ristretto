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

export function endRun(run, now, status) {
  return {
    id: run.id,
    command: run.command,
    startedAt: run.startedAt,
    endedAt: now,
    ms: now - run.startedAt,
    tokens: run.tokens,
    gates: run.gates,
    status,
  };
}

export function keep(records, record, max = 200) {
  return [...records, record].slice(-max);
}

export function trend(records, n = 12) {
  return records.slice(-n).map((rec) => Math.round(rec.gates.ms / 60000));
}

export function count(tokens) {
  if (tokens >= 1e6) return `${(tokens / 1e6).toFixed(1)}M`;
  if (tokens >= 1e4) return `${Math.round(tokens / 1e3)}k`;
  return String(tokens);
}
