#!/usr/bin/env node
// One question — which tests ran, and which of them failed — asked of whatever format this
// project already produces.
//
// JUnit XML is the widest answer, not the only one. Flutter offers no junit reporter at all (its
// reporters are compact, expanded, github, json, silent), so a JUnit-only reader would send every
// Flutter project off to install a converter in order to satisfy the plugin's taste rather than
// its own. Dispatching on content costs a few lines and means a stack that already emits
// machine-readable results is simply supported.
//
// Every reader returns the identical shape, or null. null always means "fall back to the exit
// code" — never a guess.
'use strict';
const fs = require('fs');
const junit = require('./junit');

// dart test / flutter test --file-reporter json:<path>
// Newline-delimited events. `testStart` carries the name, `testDone` the verdict, joined on the
// test id; the suite path comes from the `suite` event. `hidden` marks the runner's own
// bookkeeping entries (a "loading <file>" pseudo-test), which are not tests anyone wrote.
function readDartJson(text) {
  const names = new Map();
  const suites = new Map();
  const testSuite = new Map();
  const executed = new Set();
  const failing = new Set();
  const started = new Map();
  const times = new Map();
  let sawEvent = false;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let e;
    try { e = JSON.parse(t); } catch { continue; }
    if (!e || typeof e.type !== 'string') continue;
    sawEvent = true;
    if (e.type === 'suite' && e.suite) suites.set(e.suite.id, e.suite.path || '');
    if (e.type === 'testStart' && e.test) {
      names.set(e.test.id, e.test.name);
      testSuite.set(e.test.id, e.test.suiteID);
      if (typeof e.time === 'number') started.set(e.test.id, e.time);
    }
    if (e.type === 'testDone') {
      if (e.hidden || e.skipped) continue; // bookkeeping, or did not run
      const name = names.get(e.testID);
      if (name === undefined) continue;
      const id = `${suites.get(testSuite.get(e.testID)) || ''}::${name}`;
      executed.add(id);
      if (e.result !== 'success') failing.add(id);
      const from = started.get(e.testID);
      if (typeof e.time === 'number' && from !== undefined) times.set(id, Math.max(times.get(id) ?? 0, e.time - from));
    }
  }
  return sawEvent ? { executed, failing, times } : null;
}

function readReport(absPath) {
  let text;
  try { text = fs.readFileSync(absPath, 'utf8'); } catch { return null; }
  if (/<testsuites?\b/.test(text)) return junit.readReport(absPath);
  // No content sniff for the JSON form: a regex looking for `"type": "testDone"` matches any file
  // that merely mentions it — this very source among them. Let the reader answer instead; it
  // returns null unless it actually parsed events, which is the only honest test of a format.
  return readDartJson(text);
}

module.exports = { readReport };

// `node scripts/testreport.js --probe <path>` — exit 0 and print a one-line summary when that
// file is a report this reader understands, exit 1 otherwise. This is what setup uses to find out
// whether a reporter flag ACTUALLY worked, rather than believing that it did.
if (require.main === module && process.argv[2] === '--probe') {
  const r = readReport(process.argv[3] || '');
  if (!r) { console.error('not a readable test report'); process.exit(1); }
  console.log(`report ok: ${r.executed.size} executed, ${r.failing.size} failing`);
  process.exit(0);
}
