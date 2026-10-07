#!/usr/bin/env node
// ristretto research helpers — run with: node scripts/research.js stale <ID> | snapshot | check-domain
//
// grind researches a feature once and prep reuses the file. Whether that file is still current
// decides if a whole web-and-code research run is paid again — a fact about git, not a
// judgement, so it lives here rather than in a brief.
//
//   stale <ID>     exit 0 = fresh, 1 = stale (reason printed), 2 = no research file.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const researchDir = path.join(projectDir, 'docs', 'ristretto', 'research');

const git = (args) => spawnSync('git', args, { cwd: projectDir, encoding: 'utf8' });

// The labels are English on purpose: the content is in the feature's language, the labels are
// what this file reads. A German "Besteht:" would leave no paths and read as fresh forever.
const COMMIT_RE = /^Researched:.*\bat commit\s+([0-9a-f]{4,40})\b/m;
const PATH_LINE_RE = /^\s*-\s*(?:Exists|Touches):\s*(.+?)\s*(?:—.*)?$/gm;

function asIsSection(text) {
  const start = text.search(/^## As-is\s*$/m);
  if (start < 0) return '';
  const rest = text.slice(start).split('\n').slice(1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
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
  const asIs = asIsSection(text);
  const paths = [...new Set([...asIs.matchAll(PATH_LINE_RE)].map((m) => m[1].replace(/`/g, '').trim()))]
    .filter(Boolean);
  if (!paths.length) {
    if (/^\s*-\s*\S/m.test(asIs) && !/^\s*-\s*Already settled:/m.test(asIs)) {
      console.log(`research: ${id} has as-is lines but no Exists:/Touches: labels — the labels stay English; research it again`);
      return 1;
    }
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

const [mode, arg] = process.argv.slice(2);
switch (mode) {
  case 'stale':
    if (!arg) { console.error('usage: node scripts/research.js stale <ID>'); process.exit(2); }
    process.exit(stale(arg));
    break;
  default:
    console.error('usage: node scripts/research.js stale <ID> | snapshot | check-domain');
    process.exit(2);
}
