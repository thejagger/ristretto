#!/usr/bin/env node
// Self-check for hooks/board-files.mjs — run with: node scripts/board-files.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const f = await import(pathToFileURL(path.join(__dirname, '..', 'hooks', 'board-files.mjs')).href);

  // git show --numstat --format= a7928f6 (plane-spotter), trimmed; plus a rename and a binary.
  const numstat = [
    '12\t0\tpubspec.yaml',
    '-\t-\tassets/fonts/Inter.ttf',
    '40\t2\tlib/data/aircraft.dart',
    '30\t0\tlib/data/aircraft_source.dart',
    '8\t1\tlib/main.dart',
    '3\t3\tlib/{old => ui}/theme.dart',
    '1\t1\tREADME.txt => README.md',
    '',
  ].join('\n');
  const files = f.parseNumstat(numstat);
  assert.deepStrictEqual(files.map((x) => x.path), ['pubspec.yaml', 'assets/fonts/Inter.ttf', 'lib/data/aircraft.dart', 'lib/data/aircraft_source.dart', 'lib/main.dart', 'lib/ui/theme.dart', 'README.md']);
  assert.deepStrictEqual(files[1], { path: 'assets/fonts/Inter.ttf', add: 0, del: 0, bin: true });
  assert.deepStrictEqual(files[2], { path: 'lib/data/aircraft.dart', add: 40, del: 2, bin: false });
  assert.deepStrictEqual(f.parseNumstat('3\t1\tlib/{a => }/x.dart'), [{ path: 'lib/x.dart', add: 3, del: 1, bin: false }], 'a rename out of a folder');

  const tree = f.treeOf(files);
  assert.deepStrictEqual([tree.add, tree.del], [94, 7], 'the root sums everything');
  assert.deepStrictEqual(tree.dirs.map((d) => d.name), ['assets/fonts', 'lib'], 'folders sorted; a single-child chain is one row');
  assert.deepStrictEqual(tree.files.map((x) => x.name), ['pubspec.yaml', 'README.md'].sort());
  const lib = tree.dirs[1];
  assert.deepStrictEqual([lib.add, lib.del], [81, 6], 'a folder sums what is inside');
  assert.deepStrictEqual(lib.dirs.map((d) => d.path), ['lib/data/', 'lib/ui/']);

  const all = f.rowsOf(tree, () => true);
  assert.deepStrictEqual(all.map((r) => `${r.depth}${r.kind[0]} ${r.name}`), [
    '0d assets/fonts/', '1f Inter.ttf',
    '0d lib/', '1d data/', '2f aircraft.dart', '2f aircraft_source.dart', '1d ui/', '2f theme.dart', '1f main.dart',
    '0f README.md', '0f pubspec.yaml',
  ]);
  const closed = f.rowsOf(tree, () => false);
  assert.deepStrictEqual(closed.map((r) => r.name), ['assets/fonts/', 'lib/', 'README.md', 'pubspec.yaml'], 'closed folders hide what is inside');
  assert.strictEqual(closed[1].open, false);
  assert.strictEqual(f.OPEN_UP_TO, 12);

  // The plan's Files touched, before any commit: folders stay as empty, unopenable rows.
  const planned = f.rowsOf(f.treeOf(f.plannedOf(['pubspec.yaml', 'android/', 'lib/data/', 'test/data/x_test.dart'])), () => true);
  assert.deepStrictEqual(planned.map((r) => `${r.depth}${r.kind[0]} ${r.name}${r.empty ? ' (empty)' : ''}`), [
    '0d android/ (empty)', '0d lib/data/ (empty)', '0d test/data/', '1f x_test.dart', '0f pubspec.yaml',
  ]);

  // A feature's commits are found by its ID in the subject — `feat(DUAL-123): …`, `fix(DUAL-123): …`
  // — so a squash, a fix after review, and old rows all read the same; no hash in the roadmap.
  assert.deepStrictEqual(f.featureLogArgs('DUAL-123'), ['log', '--numstat', '--format=', '-E', '--grep=^[a-z]+\\(DUAL-123\\):']);
  assert.deepStrictEqual(f.featureLogArgs('a.b+c'), ['log', '--numstat', '--format=', '-E', '--grep=^[a-z]+\\(a\\.b\\+c\\):'], 'regex characters in an ID match literally');
  const pattern = new RegExp(f.featureLogArgs('DUAL-123')[4].slice('--grep='.length), 'm');
  assert.ok(pattern.test('feat(DUAL-123): first build') && pattern.test('fix(DUAL-123): review fix'));
  assert.ok(!pattern.test('feat(DUAL-1234): another') && !pattern.test('docs(ristretto): close DUAL-123'));
  // The ID back out of a subject, by the same rule: ristretto's own scope and odd shapes are never one.
  assert.strictEqual(f.featureIdOf('feat(lnw-export): x'), 'lnw-export');
  assert.strictEqual(f.featureIdOf('fix(DUAL-123): review fix'), 'DUAL-123');
  assert.strictEqual(f.featureIdOf('docs(ristretto): y'), null);
  assert.strictEqual(f.featureIdOf('feat(../x): y'), null);
  assert.strictEqual(f.featureIdOf('Merge branch main'), null);
  assert.strictEqual(f.isDocs('docs(lnw-export): manual checks passed'), true);
  assert.strictEqual(f.isDocs('feat(lnw-export): x'), false);
  // Two commits touching one file: one row, summed.
  assert.deepStrictEqual(f.sumFiles(f.parseNumstat('10\t2\tlib/a.dart\n3\t0\tlib/b.dart\n\n4\t1\tlib/a.dart\n-\t-\tlogo.png\n')), [
    { path: 'lib/a.dart', add: 14, del: 3, bin: false }, { path: 'lib/b.dart', add: 3, del: 0, bin: false }, { path: 'logo.png', add: 0, del: 0, bin: true },
  ]);

  console.log('board-files.test.js: all checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
