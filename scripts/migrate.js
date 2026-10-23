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

// A status cell may carry a reason after its first word: `blocked — no API docs`, `done—**retired**`.
// A blocked or done reason still says something; a needs-* reason described the old status.
const KEEPS_REASON = new Set(['planned', 'in-progress', 'blocked', 'done', 'split-pending']);
function statusCell(feature, cell) {
  const token = (/^[a-z-]+/.exec(cell) || [''])[0];
  const status = STATUS[token];
  if (!status) throw new Error(`roadmap row ${feature}: unknown status "${cell}"`);
  const reason = cell.slice(token.length).replace(/^\s*[:—–-]\s*/, '').trim();
  return reason && KEEPS_REASON.has(token) ? `${status} — ${reason}` : status;
}

function migrateRoadmap(text) {
  const lines = linesOf(text);
  const t = readTable(text);
  if (t.start >= 0) {
    const body = t.rows.map((r) => row([r.Flight, r.Feature, (r.Title || '').replace(/\s*\(\+\d+ manual checks?\)/, ''), r.Tier, statusCell(r.Feature, r.Status)]));
    lines.splice(t.start, t.end - t.start, row(COLUMNS), `|${COLUMNS.map((c) => '-'.repeat(c.length + 2)).join('|')}|`, ...body);
  }
  const stamp = `<!-- ristretto-format: ${FORMAT} -->`;
  const at = lines.findIndex((l) => STAMP_RE.test(l));
  if (at >= 0) lines[at] = lines[at].replace(STAMP_RE, stamp);
  else lines.splice(lines.findIndex((l) => /^# /.test(l)) + 1, 0, stamp);
  return lines.join(eolOf(text));
}

const indentOf = (line) => /^\s*/.exec(line)[0].length;
const flat = (s) => s.replace(/\s+/g, ' ').trim();

// manual-checks.md → per feature ID, its checks (tick, steps, the criterion each proves) and any
// prose its section holds (`note: true`). Two shapes were written over time: the instruction with a
// `proves:` line under it, and `**proves** · <criterion> · <why> · <steps>`, either one wrapping
// over indented lines.
function parseChecks(text) {
  const map = new Map();
  let id = null;
  let cur = null;
  for (const line of linesOf(text)) {
    const h = /^##\s+(\S+)/.exec(line);
    if (h) { id = h[1]; cur = null; if (!map.has(id)) map.set(id, []); continue; }
    if (!id) continue;
    const item = /^- \[( |x|X)\]\s+/.exec(line);
    if (item) { cur = { done: item[1] !== ' ', lines: [line] }; map.get(id).push(cur); continue; }
    if (cur && line.trim() && (cur.note || /^\s+\S/.test(line))) { cur.lines.push(line); continue; }
    cur = null;
    if (line.trim()) { cur = { note: true, lines: [line] }; map.get(id).push(cur); }
  }
  for (const [key, items] of map) {
    map.set(key, items.map((it) => (it.note ? { note: true, done: false, how: '', proves: null, raw: it.lines.join('\n') } : toCheck(it.done, it.lines))));
  }
  return map;
}

// One check from its lines. Its steps (`how`) keep their lines, indented relative to each other,
// and keep the why: every word but the criterion's name is carried into the plan.
function toCheck(done, lines) {
  const raw = lines.join('\n');
  const rest = lines.slice(1);
  const base = Math.min(...rest.filter((l) => l.trim()).map(indentOf));
  const body = [lines[0].replace(/^\s*-\s+(\[[ xX]\]\s+)?/, ''), ...rest.map((l) => l.slice(Math.min(base, indentOf(l))))];
  const pv = body.findIndex((l, i) => i > 0 && /^\s*proves:\s*/.test(l));
  if (pv > 0) {
    return { done, how: body.filter((_, i) => i !== pv).join('\n').trim(), proves: body[pv].replace(/^\s*proves:\s*/, '').trim(), raw };
  }
  const text = body.join('\n');
  const head = /^(\*\*)?proves(\*\*)?\s*·\s*/.exec(text);
  if (head) {
    const after = text.slice(head[0].length);
    const sep = /\s·\s/.exec(after);
    if (!sep) return { done, how: '', proves: flat(after), raw };
    return { done, how: after.slice(sep.index + sep[0].length).trim(), proves: flat(after.slice(0, sep.index)), raw };
  }
  return { done, how: text.trim(), proves: null, raw };
}

// A check names its criterion in its own words: `the [human] criterion "…"`, quotes, emphasis, a
// trailing "(Manual-Checks).", an ellipsis and case differ between the two copies, the meaning does not.
const norm = (s) => s.replace(/^the\s+`?\[human\]`?\s+criterion\s+/i, '').replace(/\[human\]/g, '').replace(/\*\*/g, '')
  .replace(/\(Manual-Checks\)/gi, '').replace(/[“”„"‚‘’'`…]/g, '').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '').toLowerCase();
const sameCriterion = (a, b) => a === b || (Math.min(a.length, b.length) >= 20 && (a.startsWith(b) || b.startsWith(a)));
const wordsOf = (s) => new Set(norm(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3));
function overlap(a, b) {
  const A = wordsOf(a);
  const B = wordsOf(b);
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return A.size && B.size ? shared / Math.min(A.size, B.size) : 0;
}

// `decision taken:` / `would-escalate:` and the lines it wraps over: deeper-indented lines under a
// bullet, or plain prose lines under a flush one — never a bullet, a heading or a `key:` line.
function entryAt(lines, i) {
  const d = /^(\s*)(- )?(decision taken|would-escalate):\s*(.*)$/.exec(lines[i]);
  if (!d) return null;
  const indented = !!d[2] || d[1].length > 0;
  let text = d[4];
  let j = i + 1;
  for (; j < lines.length; j++) {
    const l = lines[j];
    if (!l.trim() || /^\s*(#|```)/.test(l)) break;
    if (indented ? indentOf(l) <= d[1].length : /^\s*[-*]\s/.test(l) || /^[A-Za-z][\w -]{0,24}:\s/.test(l)) break;
    text += ` ${l.trim()}`;
  }
  return { kind: d[3], text, next: j };
}

function migratePlan(text, checks = []) {
  const eol = eolOf(text);
  const lines = linesOf(text);
  const out = [];
  const criteria = [];
  const decisions = [];
  let fence = false;
  let heading = false;
  let dropping = false;
  const planned = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) fence = !fence;
    if (fence || /^\s*```/.test(line)) { dropping = false; out.push(line); continue; }
    if (dropping && /^\s+\S/.test(line)) {
      // The plan's own Manual-Checks items: the steps as prep wrote them.
      if (/^\s{1,3}- /.test(line)) planned.push([line]);
      else if (planned.length) planned[planned.length - 1].push(line);
      continue;
    }
    dropping = false;
    if (!heading && /^# \S/.test(line)) { heading = true; out.push(`# ${line.slice(2).trim().split(/\s/)[0]}`); continue; }
    const mc = /^- Manual-Checks:\s*(.*)$/.exec(line);
    if (mc) {
      dropping = true;
      if (!/^(—|-|none)?$/i.test(mc[1].trim())) planned.push([`- ${mc[1].trim()}`]);
      continue;
    }
    if (/^- Flight:/.test(line) || /^status:\s*\S/.test(line)) continue;
    const entry = entryAt(lines, i);
    if (entry) {
      if (entry.kind === 'decision taken') decisions.push(entry.text.replace(/\s+[—–-]\s+not in the contract\.?\s*$/, '').trim());
      i = entry.next - 1;
      continue;
    }
    const c = /^(\s*)- \[human\]\s*(.*)$/.exec(line);
    if (c) criteria.push({ at: out.length, indent: c[1], text: c[2], check: null });
    out.push(line);
  }

  // manual-checks.md, written at close, supersedes the plan's prep-time copy of the same checks.
  if (!checks.length) checks = planned.map((p) => toCheck(false, p));
  // Each check finds the criterion it names: by its text, else by most shared words. What is left
  // pairs only when it is one open check and one open criterion — a tick never moves by position.
  const left = checks.filter((k) => !k.note && !/^\[auto\]/.test(k.proves || ''));
  const take = (k, crit) => { crit.check = k; left.splice(left.indexOf(k), 1); };
  for (const k of [...left]) {
    const crit = k.proves && criteria.find((cr) => !cr.check && sameCriterion(norm(cr.text), norm(k.proves)));
    if (crit) take(k, crit);
  }
  for (const k of [...left]) {
    if (!k.proves) continue;
    const scored = criteria.filter((cr) => !cr.check).map((cr) => ({ cr, s: overlap(k.proves, cr.text) })).sort((a, b) => b.s - a.s);
    if (scored.length && scored[0].s >= 0.6 && (scored.length === 1 || scored[1].s < scored[0].s)) take(k, scored[0].cr);
  }
  const open = criteria.filter((cr) => !cr.check);
  if (open.length === 1 && left.length === 1 && !left[0].done) take(left[0], open[0]);
  const unmatched = checks.filter((k) => !criteria.some((cr) => cr.check === k));

  for (const cr of [...criteria].reverse()) {
    out[cr.at] = `${cr.indent}- [${cr.check && cr.check.done ? 'x' : ' '}] [human] ${cr.text}`;
    if (!cr.check || !cr.check.how) continue;
    let j = cr.at + 1;
    while (j < out.length && out[j].trim() && indentOf(out[j]) > cr.indent.length) j++;
    const [first, ...more] = cr.check.how.split('\n');
    out.splice(j, 0, `${cr.indent}  how: ${first}`, ...more.map((l) => (l.trim() ? `${cr.indent}    ${l}` : l)));
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
