// What prep pins to the board (spec 2026-11-20 v1): the points it settled, the points still open
// and the facts it found, read from marker lines in its own answer —
//   open: <topic> — <the question>
//   decided: <topic> → <ruling>
//   found: <one fact>
// A marker stands at a line's start, after an optional list mark or quote; lines inside a code
// fence are examples, not pins. Pure: no $, no Node, no clock.

export const EMPTY_PINS = { points: [], found: [], live: null };

// After an optional quote, list mark or number, and a code span or bold around the marker.
const LINE = /^\s*(?:>\s*)?(?:(?:[-*+]|\d+[.)])\s+)?[`*_]{0,2}(open|decided|found)(?::[`*_]{0,2}|[`*_]{0,2}:)\s*(.+?)\s*$/i;
const UNWRAP = /^[`*_]+|[`*_]+$/g;
const FENCE = /^\s*(```|~~~)/;
const RULED = /\s*(?:→|->)\s*/;
const ASKED = /\s+(?:—|-)\s+/;

export function pinsOf(text) {
  const out = { open: [], decided: [], found: [] };
  let fenced = false;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    const hit = fenced ? null : LINE.exec(line);
    if (!hit) continue;
    const kind = hit[1].toLowerCase();
    const body = hit[2].replace(UNWRAP, '').trim();
    if (!body) continue;
    if (kind === 'found') {
      out.found.push(body);
      continue;
    }
    const parts = body.split(kind === 'decided' ? RULED : ASKED);
    if (parts.length < 2 || !parts[0].trim()) continue;
    const topic = parts[0].trim();
    const rest = body.slice(body.indexOf(parts[1], parts[0].length)).trim();
    if (!rest) continue;
    if (kind === 'decided') out.decided.push({ topic, ruling: rest });
    else out.open.push({ topic, question: rest });
  }
  return out;
}

// The pins after one more answer. Points match by topic, case-insensitively, and keep the
// spelling they were first pinned with; an open line on a settled point reopens it. `live` is
// the one point this answer left open, when it named exactly one.
export function foldPins(state, pins) {
  if (!pins || (!pins.open.length && !pins.decided.length && !pins.found.length)) return state;
  const points = (state?.points ?? []).map((p) => ({ ...p }));
  const find = (topic) => points.find((p) => p.topic.toLowerCase() === topic.toLowerCase());
  for (const { topic, question } of pins.open) {
    const p = find(topic);
    if (p) Object.assign(p, { question, ruling: null });
    else points.push({ topic, question, ruling: null });
  }
  for (const { topic, ruling } of pins.decided) {
    const p = find(topic);
    if (p) p.ruling = ruling;
    else points.push({ topic, question: '', ruling });
  }
  const found = [...(state?.found ?? [])];
  for (const fact of pins.found) if (!found.includes(fact)) found.push(fact);
  const live = pins.open.length === 1 ? find(pins.open[0].topic)?.topic ?? null : null;
  return { points, found, live };
}
