#!/usr/bin/env node
// The mechanical part of closing a feature: Evidence, taken decisions, open findings, the
// roadmap row, the build plan's removal. The model writes what goes in (the proof of each
// criterion, a corrected Provides:) and makes the one commit; this only places it.
//
//   node close.js <ID> [--repo <dir>] < input.json
//   input: {"evidence": [..], "decisions": [{"question", "ruling"}], "findings": [..], "escalated": null | "<trigger>"}
'use strict';
const fs = require('fs');
const path = require('path');
const { readTable } = require('./migrate.js');
const { findPlans } = require('./confirm.js');

const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n');
const heading = (line) => /^##\s/.test(line);

// [start, end) of a `## <title>` section: the heading up to the next `## ` heading or the end.
function sectionRange(lines, title) {
  const start = lines.findIndex((l) => l.trim() === `## ${title}`);
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !heading(lines[end])) end++;
  return [start, end];
}

// Replace a section with `items` as `- ` lines, append it when missing, drop it when empty.
function setSection(lines, title, items) {
  const range = sectionRange(lines, title);
  const block = items.length ? [`## ${title}`, ...items.map((i) => `- ${i}`), ''] : [];
  if (range) { lines.splice(range[0], range[1] - range[0], ...block); return; }
  if (!block.length) return;
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  lines.push('', ...block);
}

function addDecisions(lines, decisions) {
  if (!decisions.length) return;
  const taken = decisions.map((d) => `  - taken: ${d.question} → ${d.ruling}`);
  const at = lines.findIndex((l) => /^-\s+Decisions:/.test(l));
  if (at >= 0) {
    let end = at + 1;
    while (end < lines.length && /^\s+\S/.test(lines[end])) end++;
    lines.splice(end, 0, ...taken);
    return;
  }
  const contract = sectionRange(lines, 'Contract');
  if (!contract) { lines.push('- Decisions:', ...taken); return; }
  let last = contract[1] - 1;
  while (last > contract[0] && lines[last].trim() === '') last--;
  lines.splice(last + 1, 0, '- Decisions:', ...taken);
}

function closePlan(text, input) {
  const lines = text.split(/\r?\n/);
  addDecisions(lines, input.decisions || []);
  const evidence = [...(input.evidence || [])];
  if (input.escalated) evidence.push(`tier: normal · escalated from easy: ${input.escalated}`);
  setSection(lines, 'Evidence', evidence);
  setSection(lines, 'Open findings', input.findings || []);
  return lines.join(eolOf(text));
}

function cellsOf(line) {
  return line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
}

function closeRoadmap(text, id, opts) {
  const lines = text.split(/\r?\n/);
  const table = readTable(text);
  const status = table.header.indexOf('Status');
  const tier = table.header.indexOf('Tier');
  const feature = table.header.indexOf('Feature');
  for (let i = table.start + 2; i < table.end; i++) {
    const cells = cellsOf(lines[i]);
    if ((cells[feature] || '').replace(/[`*]/g, '') !== id) continue;
    cells[status] = 'done';
    if (opts.escalated && tier >= 0) cells[tier] = 'normal';
    lines[i] = `| ${cells.join(' | ')} |`;
  }
  return lines.join(eolOf(text));
}

function fail(code, message) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function main(argv) {
  const [id, ...rest] = argv;
  if (!id || id.startsWith('-')) fail(2, 'usage: close.js <ID> [--repo <dir>] < input.json');
  let repo = null;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--repo') repo = path.normalize(rest[++i] || '.').replace(/[\\/]+$/, '') || '.';
    else fail(2, `unknown argument ${rest[i]}`);
  }
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { fail(2, 'input must be JSON: {evidence, decisions, findings, escalated}'); }
  if (!input || !Array.isArray(input.evidence)) fail(2, 'input needs an "evidence" list');
  const root = process.cwd();
  let found = findPlans(root).filter((f) => f.id === id);
  if (repo) found = found.filter((f) => path.normalize(f.repo) === repo);
  if (found.length === 0) fail(2, `no plan for ${id}${repo ? ` in ${repo}` : ''}`);
  if (found.length > 1) fail(2, `${id} is planned in more than one repo: ${found.map((f) => f.repo).join(', ')} - pass --repo`);
  const { plan, repo: where } = found[0];
  const roadmap = path.join(root, where, 'docs', 'ristretto', 'roadmap.md');
  fs.writeFileSync(plan, closePlan(fs.readFileSync(plan, 'utf8'), input));
  fs.writeFileSync(roadmap, closeRoadmap(fs.readFileSync(roadmap, 'utf8'), id, { escalated: input.escalated || null }));
  fs.rmSync(path.join(root, where, '.ristretto', 'build', `${id}.md`), { force: true });
  process.stdout.write(`${JSON.stringify({ plan, roadmap })}\n`);
}

module.exports = { closePlan, closeRoadmap };
if (require.main === module) main(process.argv.slice(2));
