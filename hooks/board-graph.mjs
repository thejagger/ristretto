// The roadmap's dependencies as a layered drawing: a feature sits one layer below the deepest
// thing it depends on, so the map reads top to bottom in build order. Pure: no $, no Node —
// hooks/board.tsx turns the layout into SVG. Tested by scripts/board-graph.test.js.

const H = 22; // a node's height
const GAP_X = 10; // between nodes in a layer
const GAP_Y = 26; // between layers
const GAP_WRAP = 8; // between the lines of a layer too wide for one
const MAX_W = 400; // a layer wraps past this, so a narrow pane does not shrink the labels
const PAD = 4; // around the drawing, so a ring on the edge is not cut
const CHAR = 6.6; // px per character at the node's 11.5px label; an image cannot measure itself
const MAX_LABEL = 26;

const label = (id) => (id.length > MAX_LABEL ? `${id.slice(0, MAX_LABEL - 1)}…` : id);
const widthOf = (id) => Math.ceil(label(id).length * CHAR) + 26;

// Which features the map shows. 'open': every feature not done yet, and the done ones they
// rest on directly — what is left and what it stands on. 'all': every feature with an edge.
function pick(rows, deps, scope) {
  const open = rows.filter((r) => r.status !== 'done').map((r) => r.id);
  if (scope === 'all') return new Set(rows.map((r) => r.id).filter((id) => deps.get(id).length > 0 || rows.some((r) => deps.get(r.id).includes(id))));
  const shown = new Set(open);
  for (const id of open) for (const d of deps.get(id)) shown.add(d);
  return shown;
}

// Drops an edge another path already implies: a → c goes when a → b → c is there, so a chain
// draws as a chain and not as a fan of lines that all say the same thing.
function reduce(edges) {
  const out = new Map();
  for (const [from, to] of edges) out.set(from, [...(out.get(from) || []), to]);
  const reaches = (from, to, skip) => {
    const seen = new Set();
    const stack = (out.get(from) || []).filter((n) => n !== skip);
    while (stack.length) {
      const n = stack.pop();
      if (n === to) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      stack.push(...(out.get(n) || []));
    }
    return false;
  };
  return edges.filter(([from, to]) => !reaches(from, to, to));
}

// rows: the roadmap's rows in order; depends: id → the ids its plan depends on; running: the
// feature a run is on now. Ids that are not on the roadmap are left out: the row's own card
// says it depends on something missing.
export function layoutGraph(rows, depends, { scope = 'open', running = null } = {}) {
  const onMap = new Set(rows.map((r) => r.id));
  const deps = new Map(rows.map((r) => [r.id, [...new Set((depends[r.id] || []).filter((d) => d !== r.id && onMap.has(d)))]]));
  const shown = pick(rows, deps, scope);
  const candidates = rows.filter((r) => shown.has(r.id));
  const edges = reduce(candidates.flatMap((r) => deps.get(r.id).filter((d) => shown.has(d)).map((d) => [d, r.id])));
  if (edges.length === 0) return null;
  // A feature with no line to anything says nothing here; its row says it all.
  const linked = new Set(edges.flat());
  const order = candidates.filter((r) => linked.has(r.id));

  // Longest path from a feature with nothing under it; a cycle (a plan error) is cut where
  // the walk meets it again rather than looping.
  const layer = new Map();
  const walking = new Set();
  const depth = (id) => {
    if (layer.has(id)) return layer.get(id);
    if (walking.has(id)) return 0;
    walking.add(id);
    const below = edges.filter(([, to]) => to === id).map(([from]) => depth(from) + 1);
    walking.delete(id);
    layer.set(id, Math.max(0, ...below));
    return layer.get(id);
  };
  order.forEach((r) => depth(r.id));

  // Within a layer, roadmap order first, then each node pulled toward the mean position of
  // what it hangs from, then of what hangs from it: fewer crossings, nothing exhaustive.
  const layers = [];
  for (const r of order) (layers[layer.get(r.id)] = layers[layer.get(r.id)] || []).push(r.id);
  const pos = new Map();
  const place = () => layers.forEach((ids) => ids.forEach((id, i) => pos.set(id, i / Math.max(1, ids.length - 1))));
  const sweep = (near) => layers.forEach((ids) => {
    const key = new Map(ids.map((id) => {
      const ns = near(id).filter((n) => pos.has(n));
      return [id, ns.length ? ns.reduce((sum, n) => sum + pos.get(n), 0) / ns.length : pos.get(id)];
    }));
    ids.sort((a, b) => key.get(a) - key.get(b));
    ids.forEach((id, i) => pos.set(id, i / Math.max(1, ids.length - 1)));
  });
  place();
  sweep((id) => edges.filter(([, to]) => to === id).map(([from]) => from));
  sweep((id) => edges.filter(([from]) => from === id).map(([, to]) => to));

  // Each layer cut into lines that fit MAX_W, in its order; a single wide node is a line.
  const lines = layers.map((ids) => {
    const out = [[]];
    let used = 0;
    for (const id of ids) {
      const w = widthOf(id);
      const line = out[out.length - 1];
      if (line.length > 0 && used + GAP_X + w > MAX_W) { out.push([id]); used = w; }
      else { line.push(id); used += (line.length > 1 ? GAP_X : 0) + w; }
    }
    return out;
  });
  const lineWidth = (ids) => ids.reduce((sum, id) => sum + widthOf(id), 0) + GAP_X * (ids.length - 1);
  const width = Math.max(240, ...lines.flat().map(lineWidth)) + 2 * PAD;
  const statusOf = new Map(rows.map((r) => [r.id, r.status]));
  const nodes = [];
  let y = PAD;
  lines.forEach((cut, l) => {
    if (l > 0) y += GAP_Y - GAP_WRAP;
    for (const ids of cut) {
      let x = PAD + (width - 2 * PAD - lineWidth(ids)) / 2;
      for (const id of ids) {
        nodes.push({ id, label: label(id), status: statusOf.get(id), running: id === running, x, y, w: widthOf(id), h: H, layer: l });
        x += widthOf(id) + GAP_X;
      }
      y += H + GAP_WRAP;
    }
  });
  const height = y - GAP_WRAP + PAD;
  const at = new Map(nodes.map((n) => [n.id, n]));
  // Where a line leaves or meets a node: spread along its edge in the order of the nodes at
  // the other end, so several lines into one node arrive side by side instead of at a point.
  const port = (id, others) => {
    const n = at.get(id);
    const sorted = [...others].sort((a, b) => at.get(a).x - at.get(b).x);
    return (other) => n.x + (n.w * (sorted.indexOf(other) + 1)) / (sorted.length + 1);
  };
  const outOf = new Map(nodes.map((n) => [n.id, port(n.id, edges.filter(([f]) => f === n.id).map(([, t]) => t))]));
  const into = new Map(nodes.map((n) => [n.id, port(n.id, edges.filter(([, t]) => t === n.id).map(([f]) => f))]));
  // A planned feature whose dependencies are not all built waits; its frame is drawn dashed.
  for (const n of nodes) n.waiting = n.status === 'planned' && deps.get(n.id).some((d) => !['done', 'needs-human', 'needs-review'].includes(statusOf.get(d)));
  return {
    width: Math.ceil(width),
    height,
    nodes,
    edges: edges.map(([from, to]) => {
      const a = at.get(from);
      const b = at.get(to);
      return { from, to, built: statusOf.get(from) === 'done', x1: outOf.get(from)(to), y1: a.y + a.h, x2: into.get(to)(from), y2: b.y };
    }),
    hidden: rows.length - nodes.length,
  };
}
