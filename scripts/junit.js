#!/usr/bin/env node
// Reads JUnit XML into "what ran", "what failed" and how long each took. Nothing else.
//
// JUnit XML is the one result format nearly every runner can already emit — pytest --junitxml,
// vitest --reporter=junit, jest-junit, Gradle and Maven surefire natively, and most others with a
// package. Depending on it keeps the per-runner part in the project's own config instead of as a
// table of runners in here, which is a table that only ever covers the five stacks somebody
// thought of. It is not the only format worth reading — see testreport.js — but it is the widest.
//
// Hand-written because gate.js has no dependencies and should keep it that way. That is only
// defensible because the job is narrow: find <testcase> elements, read two attributes, and check
// which kind of child they have. Body content is NEVER interpreted — a failure message can hold
// anything at all, and everything this reader needs is in the structure.
'use strict';
const fs = require('fs');

const SEP = '::';

// XML entities, including numeric and hex character references. vitest writes `>` in a test name
// as `&gt;`, so skipping this produces IDs that can never match a baseline written elsewhere.
// Ampersand is resolved LAST so that "&amp;gt;" decodes to "&gt;" and not to ">".
function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

const ATTR_RE = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
function attrs(tagBody) {
  const out = {};
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(tagBody)) !== null) {
    out[m[1]] = decodeEntities(m[3] !== undefined ? m[3] : m[4]);
  }
  return out;
}

const TESTCASE_RE = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase\s*>)/g;

function readReport(absPath) {
  let xml;
  try { xml = fs.readFileSync(absPath, 'utf8'); } catch { return null; }
  // The opening tag proper — the element name must be followed by whitespace, `>` or `/`, not by
  // any old character. A looser guard matches a file that merely MENTIONS the tag (a log, a
  // source file, this project's own reader), and such a file parses to zero testcases: a report
  // saying "nothing ran, nothing failed", which attributes to no new failures and passes the
  // gate. An empty report is a legitimate answer — pytest writes one on exit 5 — so it cannot be
  // rejected by counting testcases. It has to be rejected here, by not being a report at all.
  if (!/<testsuites?[\s>/]/.test(xml)) return null; // not a JUnit report — say so, don't guess

  // A CDATA section may contain literal "</testcase>" and would otherwise end the element it
  // sits inside. Blank them out first; nothing here ever reads a body's text.
  const flat = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');

  const executed = new Set();
  const failing = new Set();
  // Per-test time in ms, for the test-time guard. A repeated id keeps its largest time.
  const times = new Map();
  let m;
  TESTCASE_RE.lastIndex = 0;
  while ((m = TESTCASE_RE.exec(flat)) !== null) {
    const a = attrs(m[1]);
    const name = a.name;
    if (name === undefined) continue;
    const id = `${a.classname === undefined ? '' : a.classname}${SEP}${name}`;
    const body = m[3] || '';
    if (/<skipped\b/.test(body)) continue; // did not run — carries no information either way
    executed.add(id);
    if (/<(failure|error)\b/.test(body)) failing.add(id);
    const secs = a.time === undefined || a.time.trim() === '' ? NaN : Number(a.time);
    if (Number.isFinite(secs)) times.set(id, Math.max(times.get(id) ?? 0, Math.round(secs * 1000)));
  }
  return { executed, failing, times };
}

module.exports = { readReport, decodeEntities, SEP };
