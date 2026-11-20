// Which view the board shows, and what each view holds (spec 2026-11-20 v1). The pane follows
// what happens: an attended pull, a brew (any unattended run), prep, or rest. Pure: no $, no
// Node, no clock; `now` is passed in. The drawing turns these into images and rows.

import { effortOf } from './board-model.mjs';

const upper = (s) => String(s ?? '').toUpperCase();
const currentOf = (effort) => (effort ?? []).find((p) => p.state === 'current') ?? null;

export function modeOf({ live, story, prep }) {
  if (live && live.command !== 'brew' && !live.unattended) return 'pull';
  if (live && (live.unattended || live.command === 'brew')) return 'brew';
  if ((story?.work ?? []).some((w) => w.state === 'running')) return 'brew';
  if (prep) return 'prep';
  return 'rest';
}

function cardOf(w) {
  const effort = w.effort ?? [];
  const cur = currentOf(effort);
  const at = cur ? effort.indexOf(cur) + 1 : effort.filter((p) => p.state === 'done').length;
  const stopped = w.state === 'stopped';
  return {
    key: w.key, tag: w.tag, id: w.id, title: w.title,
    word: stopped ? 'STOPPED' : upper(cur ? cur.name : w.step || 'starting'),
    step: stopped || !cur ? null : cur.name,
    count: `${at} / ${effort.length}`,
    effort, red: !!w.red, state: w.state,
  };
}

function brewView({ story }) {
  const { done, work, free, held, blocked } = story;
  const running = work.filter((w) => w.state === 'running');
  const n = done.length + work.length + free.length + held.length + blocked.length;
  const live = running.length ? currentOf(running[0].effort)?.name ?? null : null;
  const starts = running.map((w) => w.startedAt).filter((t) => typeof t === 'number');
  const queue = [...free, ...held];
  const togo = n - done.length - running.length;
  return {
    mode: 'brew',
    head: {
      mode: 'brew', big: String(done.length + 1), step: null, tone: 'ink', small: `/ ${n}`,
      label: running.length ? 'RUNNING' : 'BREWING', since: starts.length ? Math.min(...starts) : null,
      strip: n ? { n, done: done.length, live, red: blocked.length } : null,
      caption: [`${done.length} pulled`, running.length === 1 ? `1 in ${live ?? 'work'}` : `${running.length} running`, `${togo} to go`],
    },
    done: done.slice(-2),
    cards: work.map(cardOf),
    next: queue.slice(0, 2),
    more: Math.max(0, queue.length - 2),
  };
}

function pullView({ live, story, pins, started, title }) {
  const e = effortOf(live, live?.command);
  const cur = currentOf(e.phases);
  const stopped = live?.phase === 'interrupted';
  const at = cur ? e.phases.indexOf(cur) + 1 : 0;
  const mine = started && started.id === live?.id ? started : null;
  return {
    mode: 'pull',
    head: {
      mode: 'pull', big: stopped ? 'STOPPED' : cur ? upper(cur.name) : 'STARTING', step: stopped || !cur ? null : cur.name, tone: 'ink', small: '',
      label: cur ? `STEP ${at} / ${e.phases.length}` : stopped ? 'INTERRUPTED' : 'STARTING', since: stopped ? null : mine?.startedAt ?? null,
      strip: null, caption: null,
    },
    feature: { id: live?.id ?? null, title: title || '' },
    effort: e,
    steps: e.phases.map((p) => ({ name: p.name, state: p.state, ms: mine?.steps?.[p.name] ?? null })),
    decided: (pins?.points ?? []).filter((p) => p.ruling !== null).map(({ topic, ruling }) => ({ topic, ruling })),
    checks: story?.boxes?.[`/${live?.id}`] ?? [],
  };
}

function prepView({ prep, pins, title }) {
  const points = pins?.points ?? [];
  const ruled = points.filter((p) => p.ruling !== null);
  const open = points.filter((p) => p.ruling === null);
  return {
    mode: 'prep',
    head: {
      mode: 'prep', big: String(ruled.length), step: null, tone: 'ink', small: `/ ${points.length}`,
      label: 'POINTS SETTLED', since: prep?.startedAt ?? null,
      strip: points.length ? { n: points.length, done: ruled.length, live: open.length ? 'brass' : null, red: 0 } : null, caption: null,
    },
    feature: prep?.id ? { id: prep.id, title: title || '' } : null,
    decided: ruled.map(({ topic, ruling }) => ({ topic, ruling })),
    open: open.map(({ topic, question }) => ({ topic, question, live: topic === pins?.live })),
    found: [...(pins?.found ?? [])],
  };
}

function restView({ story }) {
  const { done, free, held, blocked, checks, taken } = story;
  const yours = checks.length + blocked.length;
  const n = done.length + free.length + held.length + blocked.length;
  return {
    mode: 'rest',
    head: {
      mode: 'rest', big: yours ? 'YOUR TURN' : 'READY', step: null, tone: yours ? 'you' : 'ink', small: '',
      label: done.length ? `${done.length} / ${n} PULLED` : `${free.length} CAN START`, since: null,
      strip: done.length ? { n, done: done.length, live: null, red: blocked.length } : null, caption: null,
    },
    checks, blocked, taken,
    next: [...free, ...held].slice(0, 2),
    counts: { done: done.length, n, free: free.length },
  };
}

export function viewOf(args) {
  if (args.mode === 'brew') return brewView(args);
  if (args.mode === 'pull') return pullView(args);
  if (args.mode === 'prep') return prepView(args);
  return restView(args);
}

// The chip above the prompt, the view at a glance; null when there is nothing to say.
export function chipOf(view) {
  const h = view.head;
  if (view.mode === 'brew') {
    const card = view.cards.find((c) => c.state === 'running') ?? view.cards[0] ?? null;
    return { label: `BREW ${h.big} ${h.small}${card ? ` · ${card.id}` : ''}`, word: card ? card.word : 'BREWING', step: card?.step ?? null, tone: 'ink', since: h.since, strip: h.strip };
  }
  if (view.mode === 'pull') {
    const phases = view.effort.phases;
    const cur = currentOf(phases);
    const at = cur ? phases.indexOf(cur) + 1 : 0;
    return {
      label: (at ? `PULL ${at} / ${phases.length}` : 'PULL') + (view.feature.id ? ` · ${view.feature.id}` : ''),
      word: h.big, step: h.step, tone: 'ink', since: h.since,
      strip: { n: phases.length, done: phases.filter((p) => p.state === 'done').length, live: cur?.name ?? null, red: 0 },
    };
  }
  if (view.mode === 'prep') {
    const n = view.decided.length + view.open.length;
    return { label: `PREP${view.feature ? ` · ${view.feature.id}` : ''}`, word: n ? `${view.decided.length} / ${n} SETTLED` : 'TALKING', step: null, tone: 'brass', since: h.since, strip: h.strip };
  }
  const yours = view.checks.length + view.blocked.length;
  if (!yours && !view.counts.n) return null;
  const label = view.counts.done ? `${view.counts.done} / ${view.counts.n} PULLED${view.blocked.length ? ` · ${view.blocked.length} BLOCKED` : ''}` : `${view.counts.free} CAN START`;
  return { label, word: yours ? `YOUR TURN · ${yours}` : 'READY', step: null, tone: yours ? 'you' : 'ink', since: null, strip: h.strip };
}
