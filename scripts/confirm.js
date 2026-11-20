#!/usr/bin/env node
// Tick a feature's open manual checks in its plan: on the owner's word in chat ("manual checks
// done"), or for a box ristretto checked itself with the setup's tool (a walk, --by).
//
//   node confirm.js list [<ID>]
//   node confirm.js tick <ID> [--repo <dir>] [--keep <n> --note <words>]... [--date YYYY-MM-DD]
//   node confirm.js tick <ID> --by <tool> (--box <n> --saw <what>)... (--failed <n> --saw <what>)... [--repo <dir>] [--date YYYY-MM-DD]
//
// Run from the session folder: roadmaps are read in it and in its direct subfolders. Which
// feature the user meant, which box an "except …" names and what a look showed is the caller's
// call; this script only finds and writes. It never commits.
'use strict';
const fs = require('fs');
const path = require('path');
const { readTable } = require('./migrate.js');

const ROADMAP = path.join('docs', 'ristretto', 'roadmap.md');
const PLANS = path.join('docs', 'ristretto', 'plans');
const MIGRATED = '## Manual checks (migrated)';
const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n');
const USAGE = 'confirm.js list [<ID>] | tick <ID> [--repo <dir>] [--keep <n> --note <words>]... [--date YYYY-MM-DD]'
  + ' | tick <ID> --by <tool> (--box <n> --saw <what>)... (--failed <n> --saw <what>)...';

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

// The `how:` line of the box at line `i`: the first indented `how:` line before the next item.
function howOf(lines, i) {
  for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]) && !/^\s*-\s/.test(lines[j]); j++) {
    const m = /^\s+how:\s*(.*)$/.exec(lines[j]);
    if (m) return m[1].trim();
  }
  return null;
}

function openChecks(text) {
  const lines = text.split(/\r?\n/);
  return boxes(lines).filter((b) => b.open).map((b, k) => ({ n: k + 1, criterion: b.criterion, text: b.text, how: howOf(lines, b.line) }));
}

// opts.by set: a walk. Only the boxes in opts.boxes (n → what was seen) are ticked, with the note;
// those in opts.failed stay open and get a line under ## Open findings; the rest are left alone.
function tick(text, opts) {
  const keep = opts.keep || new Map();
  const walked = opts.boxes || new Map();
  const failedAt = opts.failed || new Map();
  const lines = text.split(/\r?\n/);
  const ticked = [];
  const kept = [];
  const failed = [];
  const findings = [];
  const proven = new Set();
  boxes(lines).filter((b) => b.open).forEach((b, k) => {
    const n = k + 1;
    if (opts.by) {
      if (walked.has(n)) {
        ticked.push(n);
        lines[b.line] = `${lines[b.line].replace(/\[ \]/, '[x]')} · checked by ristretto in ${opts.by}, ${opts.date}: ${walked.get(n)}`;
        if (b.criterion !== null) proven.add(b.criterion);
      } else if (failedAt.has(n)) {
        failed.push(n);
        findings.push(`- ${b.text} — not as expected in ${opts.by}, ${opts.date}: ${failedAt.get(n)}`);
      }
      return;
    }
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
    if (m && proven.has(Number(m[2]))) lines[i] = `${m[1]}${m[2]}: ${opts.by ? `seen in ${opts.by}` : 'confirmed in chat'} ${opts.date}`;
  }
  if (findings.length) {
    const { sectionRange, setSection } = require('./close.js'); // lazy: close.js requires this file
    const range = sectionRange(lines, 'Open findings');
    if (!range) setSection(lines, 'Open findings', findings.map((f) => f.slice(2)));
    else {
      let at = range[1];
      while (at > range[0] + 1 && lines[at - 1] === '') at--;
      lines.splice(at, 0, ...findings);
    }
  }
  return { text: lines.join(eolOf(text)), ticked, kept, failed };
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
      .map((f) => ({ ...f, checks: openChecks(fs.readFileSync(f.plan, 'utf8')).map(({ n, text, how }) => ({ n, text, how })) }))
      .filter((f) => f.checks.length > 0);
    process.stdout.write(`${JSON.stringify({ features }, null, 2)}\n`);
    return;
  }
  if (cmd !== 'tick' || !id) fail(2, `usage: ${USAGE}`);
  let repo = null;
  let date = today();
  let by = null;
  const keep = new Map();
  const boxes = new Map();
  const failed = new Map();
  const boxNumber = (flag, v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) fail(2, `${flag} takes a box number, got ${v}`);
    if (keep.has(n) || boxes.has(n) || failed.has(n)) fail(2, `box ${n} is named twice - nothing ticked`);
    return n;
  };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--repo') repo = path.normalize(rest[++i] || '.').replace(/[\\/]+$/, '') || '.';
    else if (rest[i] === '--date') date = rest[++i];
    else if (rest[i] === '--by') by = rest[++i];
    else if (rest[i] === '--keep') {
      const n = boxNumber('--keep', rest[++i]);
      keep.set(n, rest[i + 1] === '--note' ? rest[(i += 2)] : '');
    } else if (rest[i] === '--box' || rest[i] === '--failed') {
      const flag = rest[i];
      const n = boxNumber(flag, rest[++i]);
      if (rest[i + 1] !== '--saw' || !rest[i + 2]) fail(2, `${flag} ${n} needs --saw "<what you saw>" - nothing ticked`);
      (flag === '--box' ? boxes : failed).set(n, rest[(i += 2)]);
    } else fail(2, `unknown argument ${rest[i]}`);
  }
  if (by !== null) {
    if (!by) fail(2, '--by takes the tool ristretto looked with');
    if (keep.size) fail(2, '--keep is the owner\'s word; a walk names --box and --failed - nothing ticked');
    if (!boxes.size && !failed.size) fail(2, 'a walk names at least one --box or --failed - nothing ticked');
  } else if (boxes.size || failed.size) fail(2, '--box and --failed need --by "<tool>" - nothing ticked');
  let found = findPlans(root).filter((f) => f.id === id);
  if (repo) found = found.filter((f) => path.normalize(f.repo) === repo);
  if (found.length === 0) fail(2, `no plan for ${id}${repo ? ` in ${repo}` : ''}`);
  if (found.length > 1) fail(2, `${id} is planned in more than one repo: ${found.map((f) => f.repo).join(', ')} - pass --repo`);
  const { plan } = found[0];
  const text = fs.readFileSync(plan, 'utf8');
  const open = openChecks(text).length;
  if (open === 0) fail(1, `nothing open in ${id}`);
  const beyond = [...keep.keys(), ...boxes.keys(), ...failed.keys()].filter((n) => n > open);
  if (beyond.length) fail(2, `box ${beyond.join(', ')}: ${id} has ${open} open box(es) - nothing ticked`);
  const r = tick(text, by === null ? { keep, date } : { by, boxes, failed, date });
  fs.writeFileSync(plan, r.text);
  process.stdout.write(`${JSON.stringify(by === null ? { plan, ticked: r.ticked, kept: r.kept } : { plan, ticked: r.ticked, kept: r.kept, failed: r.failed })}\n`);
}

module.exports = { findPlans, openChecks, tick };
if (require.main === module) main(process.argv.slice(2));
