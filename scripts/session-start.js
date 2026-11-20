#!/usr/bin/env node
// ristretto SessionStart hook — run by hooks/hooks.json, or by hand: node scripts/session-start.js
//
// Looks at the session folder and its direct subfolders and speaks only when something there needs
// the model's attention: today, a roadmap whose format is not this plugin's. Silent otherwise, and
// it exits 0 on every path, so it can never fail a session start.
'use strict';
const fs = require('fs');
const path = require('path');

const LINE = {
  behind: (found, format) => `behind (${found} → ${format})`,
  newer: (found, format) => `newer (${found}, this plugin writes ${format}): update the plugin`,
  unstamped: () => 'unstamped',
};

function repos(dir) {
  let subs = [];
  try {
    subs = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.'))
      .map((e) => e.name).sort();
  } catch { /* unreadable folder: only dir itself */ }
  return [['this folder', dir], ...subs.map((name) => [name, path.join(dir, name)])];
}

// Every line the hook has to say about `dir`, in a stable order.
// The require is here, not at the top, so a missing migrate.js is caught by main's try.
function notes(dir) {
  const { FORMAT, formatState } = require('./migrate.js');
  const out = [];
  for (const [where, repoDir] of repos(dir)) {
    const { state, found } = formatState(repoDir);
    if (LINE[state]) out.push(`ristretto format notice: ${where} — ${LINE[state](found, FORMAT)}`);
  }
  return out;
}

function main() {
  try {
    const lines = notes(process.env.CLAUDE_PROJECT_DIR || process.cwd());
    if (lines.length) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } }) + '\n');
    }
  } catch { /* never fail a session start */ }
  process.exitCode = 0; // not process.exit(): that can cut a piped stdout short
}

module.exports = { notes };
if (require.main === module) main();
