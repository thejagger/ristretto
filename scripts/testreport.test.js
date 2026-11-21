#!/usr/bin/env node
// Self-check for testreport.js — run with: node scripts/testreport.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const { readReport } = require('./testreport');

const fixture = (n) => path.join(__dirname, 'junit.fixtures', n);

// 1. JUnit XML still reads exactly as it did — dispatch must not change the answer.
let r = readReport(fixture('pytest.xml'));
assert.ok(r);
assert.deepStrictEqual([...r.failing].sort(), ['test_sample::test_errors', 'test_sample::test_fails']);

// 2. Dart/Flutter JSON, which has no junit reporter at all. `hidden` entries are the runner's own
//    bookkeeping and are not tests; a skipped test did not execute.
r = readReport(fixture('dart.jsonl'));
assert.ok(r, 'the dart reporter must be readable without a converter');
assert.deepStrictEqual([...r.executed].sort(),
  ['test/sample_test.dart::fails', 'test/sample_test.dart::passes']);
assert.deepStrictEqual([...r.failing], ['test/sample_test.dart::fails']);

// 2c. Per-test times from the Dart JSON reporter: testDone.time − testStart.time, in ms.
r = readReport(path.join(__dirname, 'junit.fixtures', 'dart.jsonl'));
assert.strictEqual(r.times.get('test/sample_test.dart::passes'), 13);
assert.strictEqual(r.times.get('test/sample_test.dart::fails'), 13);
assert.ok(!r.times.has('test/sample_test.dart::ignored'), 'a skipped test has no time');

// 3. Neither format → null, so the caller falls back to the exit code.
assert.strictEqual(readReport(path.join(__dirname, 'testreport.js')), null);
assert.strictEqual(readReport(path.join(__dirname, 'nope.nothing')), null);

console.log('testreport.test.js: all checks passed');
