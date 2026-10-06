#!/usr/bin/env node
// Self-check for hooks/board-graph.mjs — run with: node scripts/board-graph.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const g = await import(pathToFileURL(path.join(__dirname, '..', 'hooks', 'board-graph.mjs')).href);
  const row = (id, status = 'done') => ({ id, status });
  const rows = [row('core'), row('auth'), row('api'), row('ui', 'planned'), row('report', 'blocked'), row('lone', 'planned'), row('old')];
  const depends = { auth: ['core'], api: ['core', 'auth'], ui: ['api', 'ghost'], report: ['ui', 'api'], old: ['core'] };

  // What is left — ui, report — and the done features they rest on; a feature with no line to
  // anything (lone) is not drawn, and neither is a name the roadmap does not have (ghost).
  const open = g.layoutGraph(rows, depends, { running: 'ui' });
  assert.deepStrictEqual(open.nodes.map((n) => n.id).sort(), ['api', 'report', 'ui']);
  // report → api is implied by report → ui → api, so only the chain is drawn.
  assert.deepStrictEqual(open.edges.map((e) => `${e.from}>${e.to}`), ['api>ui', 'ui>report']);
  assert.deepStrictEqual(open.nodes.map((n) => [n.id, n.layer]), [['api', 0], ['ui', 1], ['report', 2]]);
  const at = Object.fromEntries(open.nodes.map((n) => [n.id, n]));
  assert.strictEqual(at.ui.running, true);
  assert.deepStrictEqual(open.edges.map((e) => e.built), [true, false], 'a line from a done feature is built');
  assert.ok(open.edges.every((e) => e.y2 > e.y1), 'every line runs downward, into the build order');

  // The whole roadmap: every feature with a line, layered by its deepest dependency.
  const all = g.layoutGraph(rows, depends, { scope: 'all' });
  assert.deepStrictEqual(all.nodes.map((n) => [n.id, n.layer]).sort(), [['api', 2], ['auth', 1], ['core', 0], ['old', 1], ['report', 4], ['ui', 3]]);

  // A planned feature whose dependency is not built is drawn as waiting.
  const waits = g.layoutGraph([row('a', 'planned'), row('b', 'planned')], { b: ['a'] });
  assert.deepStrictEqual(waits.nodes.map((n) => [n.id, n.waiting]), [['a', false], ['b', true]]);

  // No edge, no map; a cycle (a plan error) is cut rather than looped.
  assert.strictEqual(g.layoutGraph([row('x', 'planned')], {}), null);
  const cyc = g.layoutGraph([row('p', 'planned'), row('q', 'planned')], { p: ['q'], q: ['p'] });
  assert.strictEqual(cyc.nodes.length, 2);

  // A layer too wide for the pane wraps onto a second line instead of shrinking the drawing.
  const wide = Array.from({ length: 8 }, (_, i) => row(`feature-number-${i}`));
  const top = g.layoutGraph([...wide, row('sink', 'planned')], { sink: wide.map((r) => r.id) });
  assert.ok(top.width <= 410, `width ${top.width}`);
  assert.ok(new Set(top.nodes.filter((n) => n.layer === 0).map((n) => n.y)).size > 1, 'layer 0 wraps');
  // Lines into one node arrive side by side, not at one point.
  assert.strictEqual(new Set(top.edges.map((e) => e.x2)).size, wide.length);

  console.log('board-graph.test.js: all checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
