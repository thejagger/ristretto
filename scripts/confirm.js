#!/usr/bin/env node
// "manual checks done" in chat: tick a feature's open manual checks in its plan.
//
//   node confirm.js list [<ID>]
//   node confirm.js tick <ID> [--repo <dir>] [--keep <n> --note <words>]... [--date YYYY-MM-DD]
//
// Run from the session folder: roadmaps are read in it and in its direct subfolders. Which
// feature the user meant and which box an "except …" names is the skill's call; this script
// only finds and ticks. It never commits.
'use strict';
const fs = require('fs');
const path = require('path');
const { readTable } = require('./migrate.js');

const ROADMAP = path.join('docs', 'ristretto', 'roadmap.md');
const PLANS = path.join('docs', 'ristretto', 'plans');
const MIGRATED = '## Manual checks (migrated)';
const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n');

// The same boxes hooks/board-plan.mjs parseChecks counts: a [human] criterion, or a flush box
// under the migrated section.
function boxOf(line, migrated) {
  if (migrated) {
    const m = /^-\s+\[([ xX])\]\s+(?:\*\*proves\*\*\s*·\s*)?(.*)$/.exec(line);
    if (m) return { open: m[1] === ' ', text: m[2].trim() };
  }
  const b = /^\s*-\s+\[([ xX])\]\s+\[human\]\s*(.*)$/.exec(line);
  return b ? { open: b[1] === ' ', text: b[2].trim() } : null;
}

// Every box with its line index and criterion number (1-based among the Acceptance items, as
// parsePlan numbers them; null outside Acceptance).
function boxes(lines) {
  const out = [];
  let migrated = false;
  let inAcc = false;
  let criterion = 0;
  lines.forEach((line, i) => {
    if (/^##\s/.test(line)) { migrated = line.trim() === MIGRATED; inAcc = false; }
    else if (/^-\s+Acceptance:/.test(line)) { inAcc = true; criterion = 0; }
    else if (inAcc && !/^\s+\S/.test(line)) inAcc = false;
    else if (inAcc && /^\s+-\s+/.test(line) && !/^\s+how:\s/.test(line)) criterion++;
    const box = boxOf(line, migrated);
    if (box) out.push({ ...box, line: i, criterion: inAcc && !migrated ? criterion : null });
  });
  return out;
}

function openChecks(text) {
  return boxes(text.split(/\r?\n/)).filter((b) => b.open).map((b, k) => ({ n: k + 1, criterion: b.criterion, text: b.text }));
}

function tick(text, opts) {
  const keep = opts.keep || new Map();
  const lines = text.split(/\r?\n/);
  const ticked = [];
  const kept = [];
  const proven = new Set();
  boxes(lines).filter((b) => b.open).forEach((b, k) => {
    const n = k + 1;
    if (keep.has(n)) {
      kept.push(n);
      const note = keep.get(n);
      if (note && !lines[b.line].endsWith(` — ${note}`)) lines[b.line] += ` — ${note}`;
      return;
    }
    ticked.push(n);
    lines[b.line] = lines[b.line].replace(/\[ \]/, '[x]');
    if (b.criterion !== null) proven.add(b.criterion);
  });
  let evidence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { evidence = lines[i].trim() === '## Evidence'; continue; }
    const m = evidence && /^(\s*-\s+)(\d+):\s*pending human\s*$/.exec(lines[i]);
    if (m && proven.has(Number(m[2]))) lines[i] = `${m[1]}${m[2]}: confirmed in chat ${opts.date}`;
  }
  return { text: lines.join(eolOf(text)), ticked, kept };
}

function findPlans(root) {
  const dirs = ['.', ...fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()];
  const out = [];
  for (const repo of dirs) {
    const roadmap = path.join(root, repo, ROADMAP);
    if (!fs.existsSync(roadmap)) continue;
    for (const row of readTable(fs.readFileSync(roadmap, 'utf8')).rows) {
      const id = (row.Feature || '').replace(/[`*]/g, '').trim();
      const plan = path.join(path.resolve(root, repo), PLANS, `${id}.md`);
      if (id && fs.existsSync(plan)) out.push({ id, repo, plan });
    }
  }
  return out;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fail(code, message) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function main(argv) {
  const [cmd, id, ...rest] = argv;
  const root = process.cwd();
  if (cmd === 'list') {
    const features = findPlans(root)
      .filter((f) => !id || f.id === id)
      .map((f) => ({ ...f, checks: openChecks(fs.readFileSync(f.plan, 'utf8')).map(({ n, text }) => ({ n, text })) }))
      .filter((f) => f.checks.length > 0);
    process.stdout.write(`${JSON.stringify({ features }, null, 2)}\n`);
    return;
  }
  if (cmd !== 'tick' || !id) fail(2, 'usage: confirm.js list [<ID>] | tick <ID> [--repo <dir>] [--keep <n> --note <words>]... [--date YYYY-MM-DD]');
  let repo = null;
  let date = today();
  const keep = new Map();
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--repo') repo = path.normalize(rest[++i] || '.').replace(/[\\/]+$/, '') || '.';
    else if (rest[i] === '--date') date = rest[++i];
    else if (rest[i] === '--keep') {
      const n = Number(rest[++i]);
      if (!Number.isInteger(n) || n < 1) fail(2, `--keep takes a box number, got ${rest[i]}`);
      keep.set(n, rest[i + 1] === '--note' ? rest[(i += 2)] : '');
    } else fail(2, `unknown argument ${rest[i]}`);
  }
  let found = findPlans(root).filter((f) => f.id === id);
  if (repo) found = found.filter((f) => path.normalize(f.repo) === repo);
  if (found.length === 0) fail(2, `no plan for ${id}${repo ? ` in ${repo}` : ''}`);
  if (found.length > 1) fail(2, `${id} is planned in more than one repo: ${found.map((f) => f.repo).join(', ')} - pass --repo`);
  const { plan } = found[0];
  const text = fs.readFileSync(plan, 'utf8');
  const open = openChecks(text).length;
  if (open === 0) fail(1, `nothing open in ${id}`);
  const beyond = [...keep.keys()].filter((n) => n > open);
  if (beyond.length) fail(2, `--keep ${beyond.join(', ')}: ${id} has ${open} open box(es) - nothing ticked`);
  const r = tick(text, { keep, date });
  fs.writeFileSync(plan, r.text);
  process.stdout.write(`${JSON.stringify({ plan, ticked: r.ticked, kept: r.kept })}\n`);
}

module.exports = { findPlans, openChecks, tick };
if (require.main === module) main(process.argv.slice(2));
