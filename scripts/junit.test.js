#!/usr/bin/env node
// Self-check for junit.js — run with: node scripts/junit.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readReport, decodeEntities } = require('./junit');

const fixture = (n) => path.join(__dirname, 'junit.fixtures', n);

// 1. Entity decoding. vitest writes `>` in a test name as `&gt;`, so a reader that skips this
//    produces IDs that can never match a baseline written by any other run.
assert.strictEqual(decodeEntities('a &gt; b'), 'a > b');
assert.strictEqual(decodeEntities('&lt;x&gt; &amp; &quot;y&quot; &apos;z&apos;'), '<x> & "y" \'z\'');
assert.strictEqual(decodeEntities('line&#10;break'), 'line\nbreak');
assert.strictEqual(decodeEntities('hex&#x41;'), 'hexA');
assert.strictEqual(decodeEntities('&amp;gt;'), '&gt;', 'decoding must not run twice');

// 2. pytest: four testcases, one of each kind.
let r = readReport(fixture('pytest.xml'));
assert.ok(r, 'the pytest fixture must parse');
assert.deepStrictEqual([...r.executed].sort(), [
  'test_sample::test_errors',
  'test_sample::test_fails',
  'test_sample::test_passes',
], 'a skipped test did not execute and must not appear');
assert.deepStrictEqual([...r.failing].sort(), [
  'test_sample::test_errors',
  'test_sample::test_fails',
], 'both <failure> and <error> mean the test did not pass');

// 3. vitest: a self-closing-free testcase, and a name carrying an encoded `>`.
r = readReport(fixture('vitest.xml'));
assert.ok(r, 'the vitest fixture must parse');
assert.deepStrictEqual([...r.executed], [
  'tests/components/settings-notifications-mirroring.test.tsx::settings card and bell toggle over one hook instance > reflects a toggle made in either view within one render',
]);
assert.strictEqual(r.failing.size, 0);

// 4. A CDATA body may contain anything at all, including text that looks like markup. It must
//    never be mistaken for the end of the testcase it sits in.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ristretto-junit-'));
const cdata = path.join(dir, 'cdata.xml');
fs.writeFileSync(cdata,
  '<testsuites><testsuite><testcase classname="c" name="a">' +
  '<failure message="x"><![CDATA[</testcase><testcase classname="c" name="ghost"/>]]></failure>' +
  '</testcase><testcase classname="c" name="b"/></testsuite></testsuites>');
r = readReport(cdata);
assert.ok(r, 'CDATA must not defeat the reader');
assert.deepStrictEqual([...r.executed].sort(), ['c::a', 'c::b'],
  'a test named inside a CDATA body does not exist');
assert.deepStrictEqual([...r.failing], ['c::a']);

// 5. An empty but valid report is a real answer: nothing ran, nothing failed. This is what
//    `pytest` writes on exit 5, and it is why exit 5 stops being a fake red.
const empty = path.join(dir, 'empty.xml');
fs.writeFileSync(empty, '<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest" errors="0" failures="0" skipped="0" tests="0" time="0.01" /></testsuites>');
r = readReport(empty);
assert.ok(r, 'an empty report is still a report');
assert.strictEqual(r.executed.size, 0);
assert.strictEqual(r.failing.size, 0);

// 6. Missing file, and content that is not JUnit at all → null. The caller falls back to the
//    exit code rather than inventing a verdict from nothing.
assert.strictEqual(readReport(path.join(dir, 'nope.xml')), null, 'a missing file is not a report');
const junk = path.join(dir, 'junk.xml');
fs.writeFileSync(junk, 'Traceback (most recent call last):\n  ValueError');
assert.strictEqual(readReport(junk), null, 'output that is not JUnit XML is not a report');


// 7. THE DISHONEST GREEN THIS NEARLY SHIPPED. A file that merely MENTIONS the tag — a log, a
//    source file, this reader itself — must not read as a report. It would parse to zero
//    testcases, which is "nothing ran, nothing failed", which attributes to no new failures and
//    PASSES the gate. An empty report is a legitimate answer (pytest writes one on exit 5), so
//    this cannot be caught by counting testcases; it has to be rejected as not-a-report.
const mentions = path.join(dir, 'mentions.txt');
fs.writeFileSync(mentions, "if (!/<testsuites?\b/.test(xml)) return null; // a source file, not a report\n");
assert.strictEqual(readReport(mentions), null, 'mentioning the tag is not being a report');
assert.strictEqual(readReport(path.join(__dirname, 'junit.js')), null, 'and the reader is not its own input');

// 8. But a real opening tag still reads, self-closing or not, with or without attributes.
for (const open of ['<testsuites>', '<testsuites name="x">', '<testsuite tests="0"/>']) {
  const f = path.join(dir, `open-${Buffer.from(open).toString('hex').slice(0, 8)}.xml`);
  fs.writeFileSync(f, open);
  assert.ok(readReport(f), `a real opening tag must still parse: ${open}`);
}

// 9. Per-test times (2026-11-21): the test-time guard reads each testcase's `time` (seconds) as
//    ms; a testcase without one has no entry; a repeated id keeps its largest time; a skipped test
//    has none, since it did not run.
r = readReport(fixture('pytest.xml'));
assert.ok(r.times instanceof Map, 'a report carries a times map');
assert.strictEqual(r.times.get('test_sample::test_passes'), 1, 'seconds become ms');
assert.ok(!r.times.has('test_sample::test_skipped'), 'a skipped test has no time');
{
  const f = path.join(dir, 'times.xml');
  fs.writeFileSync(f, '<testsuites><testsuite>' +
    '<testcase classname="a" name="twice" time="0.5"/><testcase classname="a" name="twice" time="2.25"/>' +
    '<testcase classname="a" name="untimed"/><testcase classname="a" name="bad" time="soon"/></testsuite></testsuites>');
  const t = readReport(f).times;
  assert.strictEqual(t.get('a::twice'), 2250, 'a repeated id keeps the largest time');
  assert.ok(!t.has('a::untimed') && !t.has('a::bad'), 'no time, or no number, means no entry');
}

console.log('junit.test.js: all checks passed');
