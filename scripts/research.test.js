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

console.log('== stale: paths that match nothing never read as fresh ==');
{
  const r = repo();
  const c = r.commit({ 'src/a.js': '1' }, 'init');
  const text = research(c, ['- Exists: src/a.js — logic']).replace('## As-is', '## Ist-Zustand');
  r.write('docs/ristretto/research/ECO-1.md', text);
  assert.strictEqual(r.run('stale', 'ECO-1').status, 1, 'a translated As-is heading must not read as "no paths — current"');
  ok('translated As-is heading → exit 1');
}
{
  const r = repo();
  const c = r.commit({ 'src/a.js': '1' }, 'init');
  r.write('docs/ristretto/research/ECO-1.md', research(c, ['- Besteht: src/a.js — Logik', '- Already settled: x — ECO-0']));
  assert.strictEqual(r.run('stale', 'ECO-1').status, 1, 'one translated label among English ones still means unreadable');
  ok('mixed labels → exit 1');
}
{
  const r = repo();
  const c = r.commit({ 'src/a.js': '1' }, 'init');
  r.write('docs/ristretto/research/ECO-1.md', research(c, ['- Exists: src/a.js - Logik', '- Touches: `src/a.js` – Risiko']));
  assert.strictEqual(r.run('stale', 'ECO-1').status, 0, 'ASCII hyphen and en dash separate the path too');
  r.commit({ 'src/a.js': '2' }, 'touch a');
  assert.strictEqual(r.run('stale', 'ECO-1').status, 1, 'and the path they separate is still watched');
  ok('hyphen / en-dash separators → path parsed and watched');
}
{
  const r = repo();
  const c = r.commit({ 'src/a.js': '1' }, 'init');
  r.write('docs/ristretto/research/ECO-1.md', research(c, ['- Touches: billing area — invoices']));
  const res = r.run('stale', 'ECO-1');
  assert.strictEqual(res.status, 1, 'a path that resolves to nothing can never go stale, so it is not a path');
  assert.ok(res.stdout.includes('billing area'), `and it is named\n${res.stdout}`);
  ok('unresolvable path → exit 1, named');
}

console.log('== snapshot / check-domain ==');
const CONFIRMED = '- **Hauptobjekt** is the unit a contract is about\n  source: § 2 WEG · confirmed — Jakob, 2026-10-09\n';
const PROPOSED = '- **Stellplatz** is a full Wohnungseigentumsobjekt\n  source: § 2 Abs 2 WEG · unconfirmed — proposed by grind ECO-1, 2026-10-07\n';
{
  const r = repo();
  r.commit({ 'src/a.js': '1' }, 'init');
  const res = r.run('check-domain');
  assert.strictEqual(res.status, 2, 'no snapshot → exit 2, nothing touched');
  ok('check-domain without a snapshot → exit 2');
}
{
  const r = repo();
  r.commit({ 'src/a.js': '1' }, 'init');
  assert.strictEqual(r.run('snapshot').status, 0, 'snapshot with no domain dir yet must succeed');
  r.write('docs/ristretto/domain/weg.md', `# WEG\n\n${PROPOSED}`);
  assert.strictEqual(r.run('check-domain').status, 0, 'a new unconfirmed entry is the legal change');
  assert.ok(r.read('docs/ristretto/domain/weg.md').includes('Stellplatz'), 'and it is kept');
  assert.ok(!r.exists('.ristretto/domain-snapshot'), 'the snapshot is removed when done');
  ok('added unconfirmed entry → exit 0, kept, snapshot removed');
}
{
  const r = repo();
  r.commit({ 'docs/ristretto/domain/weg.md': `# WEG\n\n${CONFIRMED}` }, 'init');
  r.run('snapshot');
  r.write('docs/ristretto/domain/weg.md', `# WEG\n\n${CONFIRMED.replace('the unit', 'any unit')}${PROPOSED}`);
  const res = r.run('check-domain');
  assert.strictEqual(res.status, 1, 'an edited confirmed entry must be restored');
  const now = r.read('docs/ristretto/domain/weg.md');
  assert.ok(now.includes(CONFIRMED.trimEnd()), 'the confirmed wording is back');
  assert.ok(!now.includes('any unit'), 'and the edit is gone');
  assert.ok(now.includes('Stellplatz'), 'while the run\'s addition survives');
  assert.ok(res.stdout.includes('Hauptobjekt'), `the restore is named\n${res.stdout}`);
  ok('confirmed entry edited → restored, addition kept, exit 1');
}
{
  const r = repo();
  r.commit({ 'docs/ristretto/domain/weg.md': `# WEG\n\n${CONFIRMED}` }, 'init');
  r.run('snapshot');
  fs.rmSync(path.join(r.dir, 'docs/ristretto/domain/weg.md'));
  assert.strictEqual(r.run('check-domain').status, 1, 'a deleted file holding a confirmed entry must come back');
  assert.ok(r.read('docs/ristretto/domain/weg.md').includes('Hauptobjekt'), 'with the entry in it');
  ok('file with confirmed entry deleted → restored, exit 1');
}
{
  const r = repo();
  r.commit({ 'docs/ristretto/domain/weg.md': `# WEG\n\n${PROPOSED}` }, 'init');
  // A person confirms before the run, and has not committed yet. HEAD still says unconfirmed.
  const confirmedByPerson = PROPOSED.replace('unconfirmed — proposed by grind ECO-1, 2026-10-07', 'confirmed - Jakob, 2026-10-09');
  r.write('docs/ristretto/domain/weg.md', `# WEG\n\n${confirmedByPerson}`);
  r.run('snapshot');
  r.write('docs/ristretto/domain/weg.md', `# WEG\n\n${PROPOSED}`);
  assert.strictEqual(r.run('check-domain').status, 1, 'an uncommitted confirmation (ASCII hyphen) is protected');
  const now = r.read('docs/ristretto/domain/weg.md');
  assert.ok(now.includes('confirmed - Jakob'), 'the person\'s confirmation is back');
  assert.strictEqual(now.split('**Stellplatz**').length - 1, 1, 'and the reverted copy is not appended next to it');
  ok('confirmation made before the snapshot, "confirmed -" → protected, no duplicate');
}
{
  const r = repo();
  r.commit({ 'docs/ristretto/domain/weg.md': '# WEG\n' }, 'init');
  r.run('snapshot');
  r.write('docs/ristretto/domain/weg.md', `# WEG\n\n${CONFIRMED}${PROPOSED}`);
  r.write('docs/ristretto/domain/new.md', `# New\n\n${CONFIRMED}`);
  const res = r.run('check-domain');
  assert.strictEqual(res.status, 1, 'an agent may not add an entry that claims to be confirmed');
  assert.ok(!r.read('docs/ristretto/domain/weg.md').includes('Hauptobjekt'), 'the forged confirmation is removed');
  assert.ok(r.read('docs/ristretto/domain/weg.md').includes('Stellplatz'), 'the honest proposal stays');
  assert.ok(!r.read('docs/ristretto/domain/new.md').includes('Hauptobjekt'), 'also in a file the snapshot never had');
  ok('forged confirmed entry added by the run → removed, exit 1');
}
{
  const r = repo();
  r.commit({ 'docs/ristretto/domain/weg.md': `# WEG\n\n${PROPOSED}` }, 'init');
  r.run('snapshot');
  r.write('docs/ristretto/domain/weg.md', '# WEG\n');
  assert.strictEqual(r.run('check-domain').status, 0, '"unconfirmed —" is not "confirmed —"');
  ok('unconfirmed entry is not mistaken for a confirmed one');
}
{
  const r = repo();
  const crlf = `# WEG\r\n\r\n${CONFIRMED.replace(/\n/g, '\r\n')}`;
  r.commit({ 'docs/ristretto/domain/weg.md': crlf }, 'init');
  r.run('snapshot');
  r.write('docs/ristretto/domain/weg.md', `${crlf}${PROPOSED.replace(/\n/g, '\r\n')}`);
  assert.strictEqual(r.run('check-domain').status, 0, 'CRLF alone must not count as a change');
  assert.strictEqual(r.read('docs/ristretto/domain/weg.md').includes('\r\n'), true, 'and the file is left as it is');
  ok('CRLF file, confirmed entry untouched → exit 0, file untouched');
}
{
  const r = repo();
  r.commit({ 'docs/ristretto/domain/weg.md': `# WEG\n\n${CONFIRMED}` }, 'init');
  r.run('snapshot');
  fs.writeFileSync(path.join(r.dir, '.ristretto/domain-snapshot/weg.md'), '# stale leftover\n');
  r.run('snapshot');
  assert.ok(fs.readFileSync(path.join(r.dir, '.ristretto/domain-snapshot/weg.md'), 'utf8').includes('Hauptobjekt'),
    'a second snapshot replaces a leftover one');
  ok('leftover snapshot is replaced');
  const gate = fs.readFileSync(path.join(__dirname, 'gate.js'), 'utf8');
  assert.ok(!gate.includes("known.add('domain-snapshot')"), 'gate.js state must not hide a leftover snapshot — one only survives a crash');
  ok('gate.js state reports a leftover snapshot');
}
{
  // A run that crashed after editing a confirmed entry, before check-domain. The next snapshot
  // must not adopt the edit as its baseline.
  const r = repo();
  r.commit({ 'docs/ristretto/domain/weg.md': `# WEG\n\n${CONFIRMED}` }, 'init');
  r.run('snapshot');
  r.write('docs/ristretto/domain/weg.md', `# WEG\n\n${CONFIRMED.replace('the unit', 'any unit')}`);
  const res = r.run('snapshot');
  assert.strictEqual(res.status, 0, 'the new snapshot is still taken');
  assert.ok(r.read('docs/ristretto/domain/weg.md').includes('the unit'), 'after the crashed run\'s edit is undone');
  assert.ok(/leftover/.test(res.stdout), `and the leftover is reported\n${res.stdout}`);
  assert.ok(fs.readFileSync(path.join(r.dir, '.ristretto/domain-snapshot/.gitignore'), 'utf8').trim() === '*',
    'a snapshot ignores itself, so it is never committed even where .ristretto/ is not ignored yet');
  ok('leftover snapshot is checked before it is replaced; snapshot ignores itself');
}
{
  const r = repo();
  const variants = ['Confirmed — Jakob, 2026-10-09', 'confirmed: Jakob', 'confirmed by Jakob', 'confirmed—Jakob'];
  const body = variants.map((v, i) => `- **T${i}** rule ${i}\n  source: § ${i} · ${v}\n`).join('');
  r.commit({ 'docs/ristretto/domain/weg.md': `# WEG\n\n${body}` }, 'init');
  r.run('snapshot');
  r.write('docs/ristretto/domain/weg.md', '# WEG\n');
  assert.strictEqual(r.run('check-domain').status, 1, 'every way a person writes the marker is protected');
  const now = r.read('docs/ristretto/domain/weg.md');
  for (let i = 0; i < variants.length; i++) assert.ok(now.includes(`**T${i}**`), `"${variants[i]}" must be restored`);
  ok('marker variants (capital, colon, "by", no space) → protected');
}
{
  const r = repo();
  r.commit({ 'docs/ristretto/domain/b.md': '# B\n' }, 'init');
  r.run('snapshot');
  const honest = '- **Buchung** a booking is confirmed - then invoiced\n  source: § 1 · unconfirmed — proposed by grind ECO-1, 2026-10-07\n';
  r.write('docs/ristretto/domain/b.md', `# B\n\n${honest}`);
  assert.strictEqual(r.run('check-domain').status, 0, 'the word "confirmed" in the statement is not a marker');
  assert.ok(r.read('docs/ristretto/domain/b.md').includes('Buchung'), 'and the honest proposal stays');
  ok('"confirmed -" inside a statement is not a forged marker');
}

console.log(`research.test.js: ${pass} checks passed`);
