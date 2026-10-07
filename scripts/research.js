#!/usr/bin/env node
// ristretto research helpers — run with: node scripts/research.js stale <ID> | snapshot | check-domain
//
// grind researches a feature once and prep reuses the file. Whether that file is still current
// decides if a whole web-and-code research run is paid again — a fact about git, not a
// judgement, so it lives here rather than in a brief.
//
//   stale <ID>     exit 0 = fresh, 1 = stale (reason printed), 2 = no research file.
//   snapshot       copy docs/ristretto/domain/ to .ristretto/domain-snapshot/ — right before a
//                  research run, from the working tree, so a person's uncommitted confirmation counts.
//   check-domain   after the run: restore any confirmed entry it changed or deleted, and remove any
//                  entry it marked confirmed itself.
//                  exit 0 = clean, 1 = restored or removed something (named), 2 = no snapshot.
//
// Agents may add `unconfirmed` domain entries and nothing else. That rule is the whole value of
// the domain store — a confirmed entry is a person's signature — so it is checked here, not asked for.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const researchDir = path.join(projectDir, 'docs', 'ristretto', 'research');
const domainDir = path.join(projectDir, 'docs', 'ristretto', 'domain');
const snapshotDir = path.join(projectDir, '.ristretto', 'domain-snapshot');

const git = (args) => spawnSync('git', args, { cwd: projectDir, encoding: 'utf8' });

// The labels are English on purpose: the content is in the feature's language, the labels are
// what this file reads. A German "Besteht:" would leave no paths and read as fresh forever.
const COMMIT_RE = /^Researched:.*\bat commit\s+([0-9a-f]{4,40})\b/m;
const LABEL_RE = /^\s*-\s*(Exists|Touches|Already settled):\s*(.*)$/;

// null when there is no `## As-is` heading at all — a translated heading, not an empty section.
function asIsLines(text) {
  const start = text.search(/^## As-is\s*$/m);
  if (start < 0) return null;
  const rest = text.slice(start).split('\n').slice(1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).filter((l) => /^\s*-\s*\S/.test(l));
}

// `<path> — <note>`, with any dash a person or a model types as the separator.
const pathOf = (rest) => rest.split(/\s[—–-]\s/)[0].replace(/`/g, '').trim().replace(/\/+$/, '');

// A path that resolves to nothing — not at the commit, not in the tree — can never show a change,
// so it would read as current forever.
function resolves(commit, p) {
  return fs.existsSync(path.join(projectDir, p)) || git(['cat-file', '-e', `${commit}:${p}`]).status === 0;
}

function stale(id) {
  const file = path.join(researchDir, `${id}.md`);
  let text;
  try { text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); } catch {
    console.log(`research: none for ${id} — research it`);
    return 2;
  }
  const commit = (COMMIT_RE.exec(text) || [])[1];
  if (!commit) {
    console.log(`research: ${id} records no commit — research it again`);
    return 1;
  }
  if (git(['cat-file', '-e', `${commit}^{commit}`]).status !== 0) {
    console.log(`research: ${id} was read at ${commit}, which this repo does not know — research it again`);
    return 1;
  }
  const lines = asIsLines(text);
  if (lines === null) {
    console.log(`research: ${id} has no "## As-is" section — the labels stay English; research it again`);
    return 1;
  }
  const paths = new Set();
  for (const line of lines) {
    const m = LABEL_RE.exec(line);
    if (!m) {
      console.log(`research: ${id} has an as-is line that is not an Exists:/Touches:/Already settled: line — the labels stay English; research it again`);
      console.log(`  ${line.trim()}`);
      return 1;
    }
    if (m[1] !== 'Already settled') paths.add(pathOf(m[2]));
  }
  paths.delete('');
  const unresolved = [...paths].filter((p) => !resolves(commit, p));
  if (unresolved.length) {
    console.log(`research: ${id} names what is not a path in this repo: ${unresolved.join(', ')} — research it again`);
    return 1;
  }
  if (!paths.size) {
    console.log(`research: ${id} names no paths — current`);
    return 0;
  }
  // Commit against the working tree, so an uncommitted edit counts as a change too.
  const diff = git(['diff', '--name-only', commit, '--', ...paths]);
  if (diff.status !== 0) {
    console.log(`research: cannot compare ${id} against ${commit} (${diff.stderr.trim()}) — research it again`);
    return 1;
  }
  const changed = diff.stdout.split('\n').filter(Boolean);
  if (changed.length) {
    console.log(`research: ${id} is stale — changed since ${commit}: ${changed.slice(0, 10).join(', ')}`);
    return 1;
  }
  console.log(`research: ${id} current — read at ${commit}`);
  return 0;
}

const mdFiles = (dir) => { try { return fs.readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { return []; } };

// An entry is a top-level bullet plus its indented continuation lines. Everything else is a block
// of its own. Line endings are normalised so CRLF alone never reads as a change.
function blocks(text) {
  const out = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const last = out.length - 1;
    if (/^\s+\S/.test(line) && last >= 0 && out[last].startsWith('- ')) out[last] += `\n${line.trimEnd()}`;
    else out.push(line.trimEnd());
  }
  return out;
}

// The marker is a `·`-separated field that starts with "confirmed", however a person types the
// rest: "Confirmed — Jakob", "confirmed: Jakob", "confirmed by Jakob". Matching the field's start
// keeps "unconfirmed —" out, and keeps the word "confirmed" inside a statement from reading as one.
const isConfirmed = (b) => b.startsWith('- ')
  && b.split('\n').some((line) => line.split('·').some((field) => /^confirmed\b/i.test(field.trim())));

function snapshot() {
  // A snapshot only outlives its run when the run died before check-domain. Replacing it unchecked
  // would adopt whatever that run did as the new baseline — so check it first.
  if (fs.existsSync(snapshotDir)) {
    // Restore only: a confirmation added since then may be a person's, which a leftover cannot
    // tell apart from the dead run's.
    console.log('research: leftover snapshot from an unfinished research run — checking it first');
    checkDomain({ removeForged: false });
  }
  fs.mkdirSync(snapshotDir, { recursive: true });
  // Ignores itself, so it is never committed even where .ristretto/ is not in .gitignore yet.
  fs.writeFileSync(path.join(snapshotDir, '.gitignore'), '*\n');
  const files = mdFiles(domainDir);
  for (const f of files) fs.copyFileSync(path.join(domainDir, f), path.join(snapshotDir, f));
  console.log(`research: domain snapshot taken (${files.length} file(s))`);
  return 0;
}

function checkDomain({ removeForged = true } = {}) {
  if (!fs.existsSync(snapshotDir)) {
    console.error('research: no domain snapshot — run `research.js snapshot` before the research run');
    return 2;
  }
  const restored = [];
  const head = (b) => b.split('\n')[0];
  for (const f of new Set([...mdFiles(snapshotDir), ...mdFiles(domainDir)])) {
    const snap = path.join(snapshotDir, f);
    const before = fs.existsSync(snap) ? blocks(fs.readFileSync(snap, 'utf8')) : [];
    const current = path.join(domainDir, f);
    const now = fs.existsSync(current) ? blocks(fs.readFileSync(current, 'utf8')) : [];
    const missing = before.filter(isConfirmed).filter((b) => !now.includes(b));
    // A confirmation is a person's signature. One the run wrote itself is a forgery.
    const forged = removeForged ? now.filter((b) => isConfirmed(b) && !before.includes(b)) : [];
    if (!missing.length && !forged.length) continue;
    // Rebuild from the snapshot plus what the run legally added: new unconfirmed entries, minus a
    // reverted copy of an entry being restored (same first line), so nothing appears twice.
    const restoredHeads = new Set(missing.map(head));
    const added = now.filter((b) => b.trim() && !before.includes(b) && !forged.includes(b) && !restoredHeads.has(head(b)));
    const kept = [...before];
    while (kept.length && kept[kept.length - 1] === '') kept.pop();
    fs.mkdirSync(domainDir, { recursive: true });
    fs.writeFileSync(current, `${[...kept, ...added].join('\n')}\n`);
    for (const b of missing) restored.push(`${f}: restored ${head(b)}`);
    for (const b of forged.filter((b) => !restoredHeads.has(head(b)))) restored.push(`${f}: removed ${head(b)}`);
  }
  fs.rmSync(snapshotDir, { recursive: true, force: true });
  if (!restored.length) {
    console.log('research: domain clean — no confirmed entry changed');
    return 0;
  }
  console.log(`research: ${restored.length} confirmed domain change(s) the run was not allowed to make, undone:`);
  for (const line of restored) console.log(`  ${line}`);
  return 1;
}

const [mode, arg] = process.argv.slice(2);
switch (mode) {
  case 'stale':
    if (!arg) { console.error('usage: node scripts/research.js stale <ID>'); process.exit(2); }
    process.exit(stale(arg));
    break;
  case 'snapshot':
    process.exit(snapshot());
    break;
  case 'check-domain':
    process.exit(checkDomain());
    break;
  default:
    console.error('usage: node scripts/research.js stale <ID> | snapshot | check-domain');
    process.exit(2);
}
