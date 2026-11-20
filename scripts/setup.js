// The per-machine setup file, `.ristretto/setup.md`, as the session-start hook and `gate.js state`
// print it: every role reads it from there instead of making a call of its own. Written by
// /ristretto:init; absent means today's defaults. Never throws.
'use strict';
const fs = require('fs');
const path = require('path');

const SETUP_CAP = 4000;

// The file's text, trimmed and cut to SETUP_CAP characters; null when missing, unreadable or empty.
function readSetup(repoDir) {
  let text;
  try { text = fs.readFileSync(path.join(repoDir, '.ristretto', 'setup.md'), 'utf8'); } catch { return null; }
  text = text.replace(/\r\n/g, '\n').trimEnd();
  if (!text.trim()) return null;
  return text.length > SETUP_CAP
    ? `${text.slice(0, SETUP_CAP)}\n… cut at ${SETUP_CAP} characters — read .ristretto/setup.md`
    : text;
}

module.exports = { SETUP_CAP, readSetup };
