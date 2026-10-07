#!/usr/bin/env node
// Self-check for version.js — run with: node scripts/version.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const VERSION = path.join(__dirname, 'version.js');
const PLUGIN = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'plugin.json'), 'utf8'));
const FORMAT_DECL = /const FORMAT = '(\d+\.\d+)';/.exec(fs.readFileSync(VERSION, 'utf8'));
assert.ok(FORMAT_DECL, "version.js must declare the format as `const FORMAT = 'x.y';`");
const CURRENT = FORMAT_DECL[1];
const PLUGIN_MINOR = /^(\d+)\.(\d+)/.exec(PLUGIN.version).slice(1, 3).join('.');

function run(dir, mode) {
  return spawnSync(process.execPath, [VERSION, mode], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
}

function project(roadmap) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ristretto-ver-'));
  if (roadmap !== undefined) {
    fs.mkdirSync(path.join(dir, 'docs', 'ristretto'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'ristretto', 'roadmap.md'), roadmap);
  }
  return dir;
}

const read = (d) => fs.readFileSync(path.join(d, 'docs', 'ristretto', 'roadmap.md'), 'utf8');

// 1. No roadmap → nothing to migrate. prep creates it already stamped, so this must not be
//    treated as a problem; a fresh repo would otherwise be told to migrate before it has state.
let dir = project();
let r = run(dir, 'check');
assert.strictEqual(r.status, 0, 'a project with no roadmap must not demand a migration');
assert.ok(r.stdout.includes('nothing to migrate'), 'and must say why it is fine');

// 2. An unstamped roadmap predates versioning entirely → migration needed.
dir = project('# Ristretto Roadmap\n\n| Flight | Feature |\n');
r = run(dir, 'check');
assert.strictEqual(r.status, 1, 'an unstamped roadmap must report a migration is needed');
assert.ok(r.stdout.includes('UNSTAMPED'), 'the report must name the actual condition');
assert.ok(r.stdout.includes('0.12 or earlier'), 'and say what that implies about its age');

// 3. Stamping is idempotent, keeps the title first, and satisfies a later check.
r = run(dir, 'stamp');
assert.strictEqual(r.status, 0, 'stamping must succeed');
let text = read(dir);
assert.ok(text.startsWith('# Ristretto Roadmap\n'), 'the title must stay the first line a human reads');
assert.ok(text.includes(`<!-- ristretto-format: ${CURRENT} -->`), 'the stamp must record the current format');
assert.strictEqual(run(dir, 'check').status, 0, 'a stamped roadmap must check clean');
run(dir, 'stamp');
assert.strictEqual((read(dir).match(/ristretto-format/g) || []).length, 1,
  'stamping twice must not accumulate stamps');

// 4. An older stamp needs migrating, and both versions are named so the report is actionable.
dir = project(`# Ristretto Roadmap\n<!-- ristretto-format: 0.9 -->\n`);
r = run(dir, 'check');
assert.strictEqual(r.status, 1, 'an older format must report a migration is needed');
assert.ok(r.stdout.includes('project 0.9'), 'the project version must be named');
assert.ok(r.stdout.includes(CURRENT), 'the plugin version must be named');

// 5. THE ONE THAT MATTERS FOR ORDERING. 0.9 is OLDER than 0.13 — a string compare says the
//    opposite, and would send a current project through a pointless "migration" that rewrites
//    it into an older shape.
assert.ok(r.stdout.includes('migration needed'), '0.9 must be treated as older than 0.13, not newer');

// 6. A project NEWER than the plugin must refuse, not migrate. That is a stale install, and
//    "migrating" it would mean discarding whatever the newer format records. This gets its own
//    exit code (3) rather than sharing 1 with "migration needed" — see check 9.
dir = project('# Ristretto Roadmap\n<!-- ristretto-format: 99.0 -->\n');
r = run(dir, 'check');
assert.strictEqual(r.status, 3, 'a newer project must exit 3, not 1');
assert.ok(r.stdout.includes('PROJECT IS NEWER'), 'the direction of the mismatch must be unmistakable');
assert.ok(r.stdout.includes('Do not migrate'), 'and it must say plainly not to migrate');
assert.ok(r.stdout.includes('Update the ristretto plugin'), 'and name the actual remedy');

// 7. Stamping without a roadmap is a clear error, not a silently created file in the wrong place.
dir = project();
r = run(dir, 'stamp');
assert.strictEqual(r.status, 2, 'stamping a project with no roadmap must fail');
assert.ok(r.stderr.includes('nothing to stamp'), 'and say so');

// 8. A patch release must never trigger a migration — the format version is MAJOR.MINOR, and
//    patches change behaviour, never what is written to disk.
assert.ok(/^\d+\.\d+$/.test(CURRENT), 'the format version must be MAJOR.MINOR, with no patch component');


// A project stamped 0.13 must be told to migrate, because 0.14 adds a .ristretto.json key the
// commands now look for. Asserted against CURRENT rather than a literal "0.14", so this keeps
// testing the right thing after the next bump instead of becoming a chore.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ristretto-version-'));
  fs.mkdirSync(path.join(dir, 'docs', 'ristretto'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'ristretto', 'roadmap.md'),
    '# Roadmap\n<!-- ristretto-format: 0.13 -->\n');
  const r = run(dir, 'check');
  assert.strictEqual(r.status, 1, 'a 0.13 project must be migrated once the plugin is past 0.13');
  assert.ok(r.stdout.includes('0.13') && r.stdout.includes(CURRENT), 'both versions must be named');
}

// 9. "Project is newer" must be its own exit code. It shared exit 1 with "migration needed",
//    and the commands told them apart by grepping for PROJECT IS NEWER in the output — so
//    rewording the message would have migrated a newer project backwards.
{
  dir = project('<!-- ristretto-format: 99.0 -->\n');
  r = run(dir, 'check');
  assert.strictEqual(r.status, 3, 'a newer project must exit 3, not 1');
}

// 10. An unmigrated project still exits 1, and now says what to do without the command
//     having to carry the paragraph.
{
  dir = project('# Roadmap\n');
  r = run(dir, 'check');
  assert.strictEqual(r.status, 1, 'an unstamped roadmap must exit 1');
  assert.ok(/format-migration\.md/.test(r.stdout + r.stderr),
    'exit 1 must name the migration doc itself — got: ' + (r.stdout + r.stderr).slice(0, 300));
  assert.ok(/then continue|come back|resume/i.test(r.stdout + r.stderr),
    'it must say to come back and continue, not treat migration as the errand');
}

// 11. The stamped-but-older branch must carry the same remediation as the unstamped branch —
//     both are "migration needed", and the reader should not have to guess why one paragraph
//     is missing from the other.
{
  dir = project('# Ristretto Roadmap\n<!-- ristretto-format: 0.9 -->\n');
  r = run(dir, 'check');
  assert.strictEqual(r.status, 1, 'an older format must still exit 1');
  assert.ok(/format-migration\.md/.test(r.stdout + r.stderr),
    'the older-format branch must also name the migration doc');
}

// 12. The format has its own version. It used to be the plugin's MAJOR.MINOR, and three
//     releases in a row (0.18, 0.19, 0.20) changed nothing on disk yet still stamped — a dirty
//     tree that stops brew's pre-flight. A release that changes no file shape must not migrate.
{
  const [fMaj, fMin] = CURRENT.split('.').map(Number);
  const [pMaj, pMin] = PLUGIN_MINOR.split('.').map(Number);
  assert.ok(fMaj < pMaj || (fMaj === pMaj && fMin <= pMin),
    `FORMAT ${CURRENT} is newer than the plugin ${PLUGIN.version} — a format ships with a release, never ahead of it`);
  const migration = fs.readFileSync(path.join(__dirname, '..', 'docs', 'format-migration.md'), 'utf8');
  assert.ok(migration.includes(`### → ${CURRENT} `),
    `docs/format-migration.md must carry a "### → ${CURRENT} " block — a format bump without its migration is a project misread`);
  assert.ok(!/plugin\.json/.test(fs.readFileSync(VERSION, 'utf8')),
    'version.js must not derive the format from plugin.json any more');
}

console.log('version.test.js: all checks passed');
