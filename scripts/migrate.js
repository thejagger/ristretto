#!/usr/bin/env node
// ristretto format migration — run with: node scripts/migrate.js check | apply
//
// The commands read and write docs/ristretto/. When that layout changes shape, a project prepped
// under an older plugin is misread quietly, so the roadmap carries a stamp of the format it was
// written for and every command checks it before touching anything. "Is this project current"
// and "rewrite it to current" are facts and transforms, so they live in code, not in a prompt.
//
//   check   exit 0 = current (or no roadmap yet), 1 = migration needed, 2 = can't tell (unstamped
//           roadmap: it predates 0.13), 3 = project is newer than the plugin (update the plugin).
//   apply   Rewrite docs/ristretto/ in place to the current format. Never commits, refuses on a
//           dirty docs/ristretto/, prints one line per file it changed.
//
// 0.22 is "one fact, one place": the roadmap holds order and status only, every other fact about
// a feature lives in plans/<ID>.md (which never moves), and manual checks and the agent's
// decisions are checkboxes in that plan. There is no manual-checks.md and no plans/archived/.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FORMAT = '0.22';
const STAMP_RE = /<!--\s*ristretto-format:\s*(\d+\.\d+)\s*-->/;
const COLUMNS = ['Flight', 'Feature', 'Title', 'Tier', 'Status'];
// Every status any earlier format wrote, onto the four 0.22 has. What used to be a status of its
// own (waiting on a person, a review, a release) is now an open box in the plan.
const STATUS = {
  'needs-human': 'done', 'needs-review': 'done', 'awaits-release': 'done', 'split-pending': 'blocked',
  planned: 'planned', 'in-progress': 'in-progress', blocked: 'blocked', done: 'done',
};

const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n');
const linesOf = (text) => text.split(/\r?\n/);

// Cells between unescaped pipes; `\|` stays in its cell as written.
function splitRow(line) {
  const s = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '\\|'; i++; continue; }
    if (s[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

const row = (cells) => `| ${cells.join(' | ')} |`;

// The first markdown table in the text, its cells read by header name. start/end are line indexes.
function readTable(text) {
  const lines = linesOf(text);
  const start = lines.findIndex((l, i) => l.trim().startsWith('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || ''));
  if (start < 0) return { header: [], rows: [], start: -1, end: -1 };
  const header = splitRow(lines[start]);
  const rows = [];
  let end = start + 2;
  for (; end < lines.length && lines[end].trim().startsWith('|'); end++) {
    const cells = splitRow(lines[end]);
    rows.push(Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])));
  }
  return { header, rows, start, end };
}

function migrateRoadmap(text) {
  const lines = linesOf(text);
  const t = readTable(text);
  if (t.start >= 0) {
    const body = t.rows.map((r) => {
      const status = STATUS[r.Status];
      if (!status) throw new Error(`roadmap row ${r.Feature}: unknown status "${r.Status}"`);
      return row([r.Flight, r.Feature, (r.Title || '').replace(/\s*\(\+\d+ manual checks?\)/, ''), r.Tier, status]);
    });
    lines.splice(t.start, t.end - t.start, row(COLUMNS), `|${COLUMNS.map((c) => '-'.repeat(c.length + 2)).join('|')}|`, ...body);
  }
  const stamp = `<!-- ristretto-format: ${FORMAT} -->`;
  const at = lines.findIndex((l) => STAMP_RE.test(l));
  if (at >= 0) lines[at] = lines[at].replace(STAMP_RE, stamp);
  else lines.splice(lines.findIndex((l) => /^# /.test(l)) + 1, 0, stamp);
  return lines.join(eolOf(text));
}

// manual-checks.md → per feature ID, each check with its tick, its steps and the criterion it
// proves. Two shapes were written over time: the instruction with a `proves:` line under it, and
// one line `**proves** · <criterion> · <why> · <steps>`.
function parseChecks(text) {
  const map = new Map();
  let id = null;
  let cur = null;
  for (const line of linesOf(text)) {
    const h = /^##\s+(\S+)/.exec(line);
    if (h) { id = h[1]; cur = null; if (!map.has(id)) map.set(id, []); continue; }
    if (!id) continue;
    const item = /^- \[( |x|X)\]\s+(.*)$/.exec(line);
    if (item) { cur = { done: item[1] !== ' ', text: item[2], lines: [line] }; map.get(id).push(cur); continue; }
    if (cur && /^\s+\S/.test(line)) cur.lines.push(line);
    else if (line.trim()) cur = null;
  }
  for (const [key, items] of map) map.set(key, items.map(({ done, text, lines }) => toCheck(done, text, lines)));
  return map;
}

function toCheck(done, text, lines) {
  const raw = lines.join('\n');
  const pv = lines.slice(1).map((l) => /^\s*proves:\s*(.*)$/.exec(l)).find(Boolean);
  if (pv) return { done, how: text.trim(), proves: pv[1].trim(), raw };
  if (/^(\*\*)?proves(\*\*)?\s*·/.test(text)) {
    const seg = text.split(' · ').map((s) => s.trim());
    return { done, how: seg.length > 2 ? seg[seg.length - 1] : '', proves: seg[1] || null, raw };
  }
  return { done, how: text.trim(), proves: null, raw };
}

// A check names its criterion in its own words: quotes, emphasis, a trailing "(Manual-Checks)."
// and case differ between the two copies, the meaning does not.
const norm = (s) => s.replace(/\[human\]/g, '').replace(/\*\*/g, '').replace(/\(Manual-Checks\)/gi, '')
  .replace(/[“”„"‚‘’'`]/g, '').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '').toLowerCase();
const sameCriterion = (a, b) => a === b || (Math.min(a.length, b.length) >= 20 && (a.startsWith(b) || b.startsWith(a)));
const indentOf = (line) => /^\s*/.exec(line)[0].length;

function migratePlan(text, checks = []) {
  const eol = eolOf(text);
  const out = [];
  const criteria = [];
  const decisions = [];
  let fence = false;
  let heading = false;
  let dropping = false;
  const planned = [];
  for (const line of linesOf(text)) {
    if (/^\s*```/.test(line)) fence = !fence;
    if (fence || /^\s*```/.test(line)) { dropping = false; out.push(line); continue; }
    if (dropping && /^\s+\S/.test(line)) {
      // The plan's own Manual-Checks items: the steps as prep wrote them.
      if (/^\s{1,3}- /.test(line)) planned.push({ text: line.replace(/^\s+- /, ''), lines: [line] });
      else if (planned.length) planned[planned.length - 1].lines.push(line);
      continue;
    }
    dropping = false;
    if (!heading && /^# \S/.test(line)) { heading = true; out.push(`# ${line.slice(2).trim().split(/\s/)[0]}`); continue; }
    const mc = /^- Manual-Checks:\s*(.*)$/.exec(line);
    if (mc) {
      dropping = true;
      if (!/^(—|-|none)?$/i.test(mc[1].trim())) planned.push({ text: mc[1].trim(), lines: [line] });
      continue;
    }
    if (/^- Flight:/.test(line)) continue;
    if (/^status:\s*\S/.test(line) || /^\s*(- )?would-escalate:/.test(line)) continue;
    const d = /^\s*(?:- )?decision taken:\s*(.*)$/.exec(line);
    if (d) { decisions.push(d[1].replace(/\s+[—–-]\s+not in the contract\.?\s*$/, '').trim()); continue; }
    const c = /^(\s*)- \[human\]\s*(.*)$/.exec(line);
    if (c) criteria.push({ at: out.length, indent: c[1], text: c[2], check: null });
    out.push(line);
  }

  // manual-checks.md, written at close, supersedes the plan's prep-time copy of the same checks.
  if (!checks.length) checks = planned.map((p) => toCheck(false, p.text, p.lines));
  // Each check finds its criterion; one criterion and one check left over are the same check.
  const left = checks.filter((k) => !/^\[auto\]/.test(k.proves || ''));
  for (const k of [...left]) {
    const crit = k.proves && criteria.find((cr) => !cr.check && sameCriterion(norm(cr.text), norm(k.proves)));
    if (crit) { crit.check = k; left.splice(left.indexOf(k), 1); }
  }
  const open = criteria.filter((cr) => !cr.check);
  if (open.length === 1 && left.length === 1) open[0].check = left.pop();
  const unmatched = checks.filter((k) => !criteria.some((cr) => cr.check === k));

  for (const cr of [...criteria].reverse()) {
    out[cr.at] = `${cr.indent}- [${cr.check && cr.check.done ? 'x' : ' '}] [human] ${cr.text}`;
    if (!cr.check || !cr.check.how) continue;
    let j = cr.at + 1;
    while (j < out.length && out[j].trim() && indentOf(out[j]) > cr.indent.length) j++;
    out.splice(j, 0, `${cr.indent}  how: ${cr.check.how}`);
  }

  if (decisions.length) {
    const boxes = decisions.map((q) => `  - [ ] ${q}`);
    const at = out.findIndex((l) => /^- Decisions:/.test(l));
    if (at >= 0) {
      let j = at + 1;
      while (j < out.length && /^\s+\S/.test(out[j])) j++;
      out.splice(j, 0, ...boxes);
    } else {
      const contract = out.findIndex((l) => /^## Contract/.test(l));
      let j = contract < 0 ? out.length : out.findIndex((l, i) => i > contract && /^## /.test(l));
      if (j < 0) j = out.length;
      while (j > 0 && !out[j - 1].trim()) j--;
      out.splice(j, 0, '- Decisions:', ...boxes);
    }
  }

  const ended = /\r?\n$/.test(text);
  while (out.length && !out[out.length - 1].trim()) out.pop();
  if (unmatched.length) {
    out.push('', '## Manual checks (migrated)');
    for (const k of unmatched) out.push('', ...linesOf(k.raw));
  }
  if (ended) out.push('');
  return out.join(eol);
}

// -1 / 0 / 1, MAJOR.MINOR numerically: "0.9" is older than "0.13".
function compare(a, b) {
  const [aMaj, aMin] = a.split('.').map(Number);
  const [bMaj, bMin] = b.split('.').map(Number);
  if (aMaj !== bMaj) return aMaj < bMaj ? -1 : 1;
  if (aMin !== bMin) return aMin < bMin ? -1 : 1;
  return 0;
}

function apply(dir, roadmapText) {
  const root = path.join(dir, 'docs', 'ristretto');
  const plans = path.join(root, 'plans');
  const archived = path.join(plans, 'archived');
  const rel = (p) => path.relative(dir, p).replace(/\\/g, '/');
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const mdIn = (d) => { try { return fs.readdirSync(d).filter((f) => f.endsWith('.md')); } catch { return []; } };
  const fail = (msg) => { console.error(`ristretto: ${msg}`); process.exit(1); };

  const dupes = mdIn(archived).filter((f) => fs.existsSync(path.join(plans, f)));
  if (dupes.length) {
    fail(dupes.map((f) => `${f.slice(0, -3)} has two plans, ${rel(path.join(plans, f))} and ${rel(path.join(archived, f))}`).join('; ')
      + '. Keep one, then migrate.');
  }
  let inGit = false;
  try { inGit = git('rev-parse', '--is-inside-work-tree').trim() === 'true'; } catch { /* not a repo */ }
  if (inGit && git('status', '--porcelain', '--', rel(root)).trim()) {
    fail(`${rel(root)}/ has uncommitted changes. Commit or stash them, then migrate.`);
  }
  let roadmap;
  try { roadmap = migrateRoadmap(roadmapText); } catch (err) { fail(err.message); }
  const checksPath = path.join(root, 'manual-checks.md');
  const checksText = fs.existsSync(checksPath) ? fs.readFileSync(checksPath, 'utf8') : null;
  const checks = checksText ? parseChecks(checksText) : new Map();

  for (const f of mdIn(archived)) {
    const from = path.join(archived, f);
    const to = path.join(plans, f);
    try { if (!inGit) throw new Error(); git('mv', rel(from), rel(to)); } catch { fs.renameSync(from, to); }
    console.log(`moved: ${rel(from)} → ${rel(to)}`);
  }
  try { fs.rmdirSync(archived); } catch { /* absent, or holds something that is not a plan */ }

  const planned = new Set();
  for (const f of mdIn(plans)) {
    const id = f.slice(0, -3);
    planned.add(id);
    const p = path.join(plans, f);
    const text = fs.readFileSync(p, 'utf8');
    const next = migratePlan(text, checks.get(id));
    if (next !== text) { fs.writeFileSync(p, next); console.log(`rewritten: ${rel(p)}`); }
  }
  fs.writeFileSync(path.join(root, 'roadmap.md'), roadmap);
  console.log(`rewritten: ${rel(path.join(root, 'roadmap.md'))} (format ${FORMAT})`);

  if (checksText !== null) {
    // Sections whose feature has a plan moved into it; the rest has nowhere to go and stays.
    const lines = linesOf(checksText);
    const keep = [];
    const orphans = [];
    let id = null;
    for (const line of lines) {
      const h = /^##\s+(\S+)/.exec(line);
      if (h) { id = h[1]; if (!planned.has(id)) orphans.push(id); }
      if (id === null || !planned.has(id)) keep.push(line);
    }
    if (orphans.length) {
      fs.writeFileSync(checksPath, keep.join(eolOf(checksText)));
      console.log(`rewritten: ${rel(checksPath)}, kept for features with no plan: ${orphans.join(', ')}`);
    } else {
      fs.unlinkSync(checksPath);
      console.log(`removed: ${rel(checksPath)} (every check is now a box in its plan)`);
    }
  }
}

function main() {
  const mode = process.argv[2] || 'check';
  if (mode !== 'check' && mode !== 'apply') {
    console.error('usage: node scripts/migrate.js check | apply');
    process.exit(2);
  }
  const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let text = null;
  try { text = fs.readFileSync(path.join(dir, 'docs', 'ristretto', 'roadmap.md'), 'utf8'); } catch { /* no roadmap yet */ }
  if (text === null) {
    console.log(`format: ${FORMAT} (no roadmap yet — nothing to migrate)`);
    process.exit(0);
  }
  const found = STAMP_RE.exec(text);
  if (!found) {
    console.error('ristretto: the roadmap carries no format stamp, so it predates 0.13 and its shape cannot be told. '
      + `Bring it to the ${FORMAT} layout by hand, then add <!-- ristretto-format: ${FORMAT} --> under its title.`);
    process.exit(2);
  }
  const cmp = compare(found[1], FORMAT);
  if (cmp > 0) {
    console.error(`ristretto: this project is on format ${found[1]}, newer than this plugin's ${FORMAT}. Update the plugin; do not migrate.`);
    process.exit(3);
  }
  if (cmp === 0) {
    console.log(`format: ${FORMAT} (current)`);
    process.exit(0);
  }
  if (mode === 'check') {
    console.log(`format: ${found[1]} → ${FORMAT}: run node scripts/migrate.js apply`);
    process.exit(1);
  }
  apply(dir, text);
}

module.exports = { FORMAT, readTable, migrateRoadmap, parseChecks, migratePlan };
if (require.main === module) main();
