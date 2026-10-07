#!/usr/bin/env node
// Self-check for research.js — run with: node scripts/research.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, 'research.js');
let pass = 0;
const ok = (name) => { pass++; console.log(`  PASS  ${name}`); };

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ristretto-research-'));
  const g = (a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@example.com']);
  g(['config', 'user.name', 'Tester']);
  g(['config', 'core.autocrlf', 'false']);
  const write = (p, body) => {
    fs.mkdirSync(path.join(dir, path.dirname(p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), body);
  };
  return {
    dir,
    write,
    read: (p) => fs.readFileSync(path.join(dir, p), 'utf8'),
    exists: (p) => fs.existsSync(path.join(dir, p)),
    commit: (files, msg) => {
      for (const [p, body] of Object.entries(files)) write(p, body);
      g(['add', '-A']);
      g(['commit', '-qm', msg]);
      return g(['rev-parse', '--short', 'HEAD']).stdout.trim();
    },
    run: (...args) => spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    }),
  };
}

function research(commit, asIs) {
  return [
    '# ECO-1 — research',
    `Researched: 2026-10-07 · at commit ${commit} · reached: code · not reached: —`,
    '', '## Why', 'Not stated.', '', '## Domain', '', '## As-is', ...asIs, '', '## Open', '',
  ].join('\n');
}

console.log('== stale ==');
{
  const r = repo();
  r.commit({ 'src/a.js': '1' }, 'init');
  const res = r.run('stale', 'ECO-1');
  assert.strictEqual(res.status, 2, `missing file must exit 2\n${res.stdout}${res.stderr}`);
  ok('no research file → exit 2');
}
{
  const r = repo();
  const c = r.commit({ 'src/a.js': '1', 'src/b.js': '1' }, 'init');
  r.write('docs/ristretto/research/ECO-1.md', research(c, ['- Exists: `src/a.js` — Bestehende Logik']));
  assert.strictEqual(r.run('stale', 'ECO-1').status, 0, 'nothing changed → fresh');
  ok('untouched path → exit 0');
  r.commit({ 'src/b.js': '2' }, 'unrelated');
  assert.strictEqual(r.run('stale', 'ECO-1').status, 0, 'an unrelated path must not make it stale');
  ok('unrelated path changed → exit 0');
  r.commit({ 'src/a.js': '2' }, 'touch a');
  const res = r.run('stale', 'ECO-1');
  assert.strictEqual(res.status, 1, 'a named path changed → stale');
  assert.ok(res.stdout.includes('src/a.js'), `the changed path must be named\n${res.stdout}`);
  ok('named path changed in a later commit → exit 1, path named');
}
{
  const r = repo();
  const c = r.commit({ 'src/a.js': '1' }, 'init');
  r.write('docs/ristretto/research/ECO-1.md', research(c, ['- Exists: src/a.js — logic']));
  r.write('src/a.js', 'uncommitted edit');
  assert.strictEqual(r.run('stale', 'ECO-1').status, 1, 'an uncommitted edit to a named path is a change too');
  ok('uncommitted edit to a named path → exit 1');
}
{
  const r = repo();
  const c = r.commit({ 'src/billing/x.js': '1' }, 'init');
  r.write('docs/ristretto/research/ECO-1.md', research(c, ['- Touches: `src/billing/` — invoices']));
  r.commit({ 'src/billing/deep/y.js': '1' }, 'add under dir');
  assert.strictEqual(r.run('stale', 'ECO-1').status, 1, 'a change under a named directory → stale');
  ok('directory in Touches: → change below it is stale');
}
{
  const r = repo();
  r.commit({ 'src/a.js': '1' }, 'init');
  r.write('docs/ristretto/research/ECO-1.md', research('deadbeef', ['- Exists: src/a.js — logic']));
  assert.strictEqual(r.run('stale', 'ECO-1').status, 1, 'a commit the repo does not know → stale');
  ok('unknown commit → exit 1');
  r.write('docs/ristretto/research/ECO-1.md', research('', ['- Exists: src/a.js — logic']).replace(' · at commit ', ' · '));
  assert.strictEqual(r.run('stale', 'ECO-1').status, 1, 'no recorded commit → stale');
  ok('no recorded commit → exit 1');
}
{
  const r = repo();
  const c = r.commit({ 'src/a.js': '1' }, 'init');
  r.write('docs/ristretto/research/ECO-1.md', research(c, ['- Besteht: `src/a.js` — Logik']));
  const res = r.run('stale', 'ECO-1');
  assert.strictEqual(res.status, 1, 'as-is lines with translated labels must not read as fresh forever');
  assert.ok(/Exists:\/Touches:/.test(res.stdout), `and must say the labels are the problem\n${res.stdout}`);
  ok('translated labels → exit 1, labels named');
}
{
  const r = repo();
  const c = r.commit({ 'src/a.js': '1' }, 'init');
  r.write('docs/ristretto/research/ECO-1.md', research(c, ['- Already settled: tenancy — none (ECO-0)']));
  assert.strictEqual(r.run('stale', 'ECO-1').status, 0, 'no paths and no path-shaped lines → nothing can go stale');
  ok('no paths recorded → exit 0');
}

console.log(`research.test.js: ${pass} checks passed`);
