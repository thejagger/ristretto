// The run a pulling session leaves for the folder board: the board in the session doing the
// pull writes it to its repo's .ristretto/at-work.json (gitignored), the board at the folder above
// reads every child's. The heartbeat is a plain file write, never an atom, so it redraws nothing.
// Pure: no $, no Node, no clock (the time is passed in).

import { effortOf } from './board-model.mjs';

export const HEARTBEAT_MS = 60000;
export const STALE_MS = 900000;

// What this session's run shows, or null with no feature at work. `prev` keeps the time the same
// feature started.
export function recordOf(live, { session, title, now, prev = null }) {
  if (!live || !live.id) return null;
  const effort = effortOf(live, live.command);
  return {
    v: 1,
    session,
    id: live.id,
    command: live.command,
    unattended: !!live.unattended,
    title: title || '',
    startedAt: prev && prev.id === live.id && prev.endedAt === null ? prev.startedAt : now,
    phase: live.phase,
    step: effort.red ? 'gate red' : effort.step,
    red: effort.red,
    effort: effort.phases,
    beat: now,
    endedAt: null,
  };
}

export function endedOf(prev, now) {
  return { ...prev, beat: now, endedAt: now };
}

export function needsBeat(rec, now) {
  return !!rec && rec.endedAt === null && now - rec.beat >= HEARTBEAT_MS;
}

// Whether two records draw the same: the heartbeat alone never counts.
export function sameShown(a, b) {
  if (!a || !b) return a === b;
  return a.id === b.id && a.phase === b.phase && a.step === b.step && a.red === b.red && a.endedAt === b.endedAt;
}

// A record as the folder board sees it. Running: the heartbeat is fresh and the pull's marker is
// there and not another session's. Stopped: it went quiet, the marker is gone, or another session
// owns the pull now. Ended: the run closed. `owner` is the marker's text ('' when unclaimed).
export function judge(rec, { owner, markerExists, now }) {
  if (!rec || rec.v !== 1 || !rec.id) return { state: 'none', rec: null };
  if (rec.endedAt !== null && rec.endedAt !== undefined) return { state: 'ended', rec };
  const quiet = now - rec.beat >= STALE_MS;
  const theirs = markerExists && (owner === '' || owner === rec.session);
  return { state: !quiet && theirs ? 'running' : 'stopped', rec };
}
