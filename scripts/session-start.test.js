#!/usr/bin/env node
// Self-check for scripts/session-start.js — run with: node scripts/session-start.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, 'session-start.js');
const s = require('./session-start.js');
const { FORMAT } = require('./migrate.js');

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'session-start-'));
// The hook reads CLAUDE_PROJECT_DIR; `cwd` must be a real folder or node never starts.
const run = (dir, cwd = dir) => spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
// <parent>/<name>/docs/ristretto/roadmap.md, stamped `stamp` ('.' is the folder itself, null no stamp).
function repo(parent, name, stamp) {
  const dir = path.join(parent, name, 'docs', 'ristretto');
  fs.mkdirSync(dir, { recursive: true });
  const head = stamp ? [`<!-- ristretto-format: ${stamp} -->`] : [];
  fs.writeFileSync(path.join(dir, 'roadmap.md'),
    [...head, '# Ristretto Roadmap', '', '| Flight | Feature | Title | Tier | Status |', '|---|---|---|---|---|', ''].join('\n'));
}

test('silentWithoutRoadmap', () => { const r = run(tmp()); assert.strictEqual(r.status, 0); assert.strictEqual(r.stdout, ''); });
test('silentWhenCurrent', () => { const d = tmp(); repo(d, '.', FORMAT); repo(d, 'api', FORMAT); assert.strictEqual(run(d).stdout, ''); });
test('behindHere', () => {
  const d = tmp(); repo(d, '.', '0.22');
  assert.deepStrictEqual(s.notes(d), [`ristretto format notice: this folder — behind (0.22 → ${FORMAT})`]);
  const out = JSON.parse(run(d).stdout);
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.ok(out.hookSpecificOutput.additionalContext.includes('this folder — behind (0.22'));
});
test('namesTheSubfolder', () => {
  const d = tmp(); repo(d, 'api', '0.22'); repo(d, 'web', FORMAT);
  assert.deepStrictEqual(s.notes(d), [`ristretto format notice: api — behind (0.22 → ${FORMAT})`]);
});
test('newerAndUnstamped', () => {
  const d = tmp(); repo(d, 'a', '9.9'); repo(d, 'b', null);
  assert.deepStrictEqual(s.notes(d), [
    `ristretto format notice: a — newer (9.9, this plugin writes ${FORMAT}): update the plugin`,
    'ristretto format notice: b — unstamped']);
});
test('skipsDotAndNodeModules', () => { const d = tmp(); repo(d, '.cache', '0.22'); repo(d, 'node_modules', '0.22'); assert.deepStrictEqual(s.notes(d), []); });
test('unreadableIsSilent', () => {
  const d = tmp(); fs.mkdirSync(path.join(d, 'x', 'docs', 'ristretto', 'roadmap.md'), { recursive: true });
  const r = run(path.join(d, 'does-not-exist'), d); assert.strictEqual(r.status, 0); assert.strictEqual(r.stdout, '');
  assert.deepStrictEqual(s.notes(d), []);
});
test('manySubfolders', () => {
  const d = tmp(); for (let i = 0; i < 200; i++) fs.mkdirSync(path.join(d, `r${i}`, 'src', 'deep'), { recursive: true });
  repo(d, 'r7', '0.22'); const t = Date.now();
  assert.strictEqual(s.notes(d).length, 1); assert.ok(Date.now() - t < 1000, 'one file per subfolder, nothing deeper');
});
test('missingModuleStillExitsZero', () => {
  // A half-synced plugin cache: session-start.js with no migrate.js beside it.
  const d = tmp(); const lone = path.join(d, 'session-start.js');
  fs.copyFileSync(SCRIPT, lone); repo(d, '.', '0.22');
  const r = spawnSync(process.execPath, [lone], { cwd: d, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: d } });
  assert.strictEqual(r.status, 0, r.stderr); assert.strictEqual(r.stdout, '');
});
// <parent>/<name>/.ristretto/setup.md holding `text`.
function setup(parent, name, text) {
  fs.mkdirSync(path.join(parent, name, '.ristretto'), { recursive: true });
  fs.writeFileSync(path.join(parent, name, '.ristretto', 'setup.md'), text);
}
test('noSetupNoOutput', () => { const d = tmp(); repo(d, '.', FORMAT); const r = run(d); assert.strictEqual(r.status, 0); assert.strictEqual(r.stdout, ''); });
test('setupHere', () => {
  const d = tmp(); repo(d, '.', FORMAT); setup(d, '.', '# s\n## Git\npush\n');
  const ctx = JSON.parse(run(d).stdout).hookSpecificOutput.additionalContext;
  assert.ok(ctx.includes('ristretto setup: this folder — binds every role in it:'), ctx);
  assert.ok(ctx.includes('## Git\npush'), ctx);
});
test('setupPerSubfolder', () => {
  const d = tmp(); repo(d, 'a', '0.22'); setup(d, 'a', 'A-ONLY'); setup(d, 'b', 'B-ONLY');
  const n = s.notes(d);
  assert.strictEqual(n.length, 3, JSON.stringify(n));
  assert.ok(n[0].startsWith('ristretto format notice: a — behind'));
  assert.strictEqual(n[1], 'ristretto setup: a — binds every role in it:\nA-ONLY');
  assert.strictEqual(n[2], 'ristretto setup: b — binds every role in it:\nB-ONLY');
});
test('setupIsCapped', () => {
  const d = tmp(); setup(d, '.', 'x'.repeat(10000));
  const [block] = s.notes(d); const body = block.split('\n').slice(1);
  assert.strictEqual(body[0].length, 4000);
  assert.strictEqual(body[1], '… cut at 4000 characters — read .ristretto/setup.md');
});
test('setupTotalIsCapped', () => {
  // Review I4: a folder of repos must not grow the session's context without bound.
  const d = tmp(); for (const n of ['a', 'b', 'c', 'd', 'e']) setup(d, n, n.repeat(4000));
  const n = s.notes(d);
  assert.strictEqual(n.length, 5);
  assert.ok(n.slice(0, 3).every((b, i) => b.includes('abc'[i].repeat(4000))), 'the first three fit');
  assert.strictEqual(n[3], 'ristretto setup: d — not printed (session start prints 12000 characters of setups at most): read d/.ristretto/setup.md');
  assert.ok(n.join('\n').length < 13000, `total ${n.join('\n').length}`);
});
test('emptySetupIsSilent', () => { const d = tmp(); setup(d, '.', '  \n\n '); assert.strictEqual(run(d).stdout, ''); });

test('hooksJsonRunsIt', () => {
  const h = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf8')).hooks.SessionStart;
  assert.ok(h && h[0].hooks[0].command.includes('scripts/session-start.js'));
  assert.strictEqual(h[0].matcher, 'startup|resume|clear|compact');
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
