#!/usr/bin/env node
// Structural guard for ristretto's commands and briefs — run with: node scripts/briefs.test.js
//
// It does not judge what the rules say. It checks the one property that broke: that a rule
// lives in exactly one file, and that a command hands out a path rather than a pasted brief.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const words = (s) => s.split(/\s+/).filter(Boolean).length;

const COMMANDS = ['commands/brew.md', 'commands/pull.md', 'commands/shot.md'];
const BRIEFS = ['briefs/common.md', 'briefs/planner.md', 'briefs/implementer.md',
                'briefs/reviewer.md', 'briefs/closer.md'];

// 1. Every brief file exists.
for (const b of BRIEFS) {
  assert.ok(fs.existsSync(path.join(ROOT, b)), `${b} must exist`);
}

// 2. No rule in two places. Each fingerprint is a phrase distinctive to one rule; it may appear
//    in exactly one file across commands + briefs. Add a fingerprint whenever a rule is moved.
const FINGERPRINTS = [
  'git add -A',              // stage only what you touched
  'plain ASCII',             // commit subject safety
  'per criterion',           // test proportionality
  'cheapest level',          // prove it at the cheapest honest level
  'a user is worse off',     // what red has to mean before a test is written
  'label or key',            // find the value by meaning, never by position
  'tick a box',              // manual checks
  'about production',        // never a check about production
  'weaken, skip, or delete', // gates are infrastructure
  'gate.js" prove',          // the implementer's final proof — note the quote: the real call is
                             // node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" prove, so a
                             // fingerprint of `gate.js prove` would match nothing
  'more than three files',   // deleted ratchet trigger — must appear NOWHERE
];
const FILES = [...COMMANDS, ...BRIEFS, 'reference/config.md'];
for (const fp of FINGERPRINTS) {
  const hits = FILES.filter((f) => fs.existsSync(path.join(ROOT, f)) && read(f).includes(fp));
  if (fp === 'more than three files') {
    assert.strictEqual(hits.length, 0, `ratchet trigger 4 was deleted — "${fp}" still in: ${hits.join(', ')}`);
  } else {
    assert.strictEqual(hits.length, 1, `"${fp}" must live in exactly one file — found in: ${hits.join(', ') || '(nowhere)'}`);
  }
}

// 3. A command hands out a path, it does not paste a brief. The regression this whole cleanup
//    exists to prevent is a brief creeping back inline, so bound the file instead of trusting it.
for (const c of COMMANDS) {
  assert.ok(words(read(c)) < 2500, `${c} is ${words(read(c))} words — a command is a flow, not a brief`);
}

// 4. Every command reads the version check and hands off to briefs by path.
for (const c of COMMANDS) {
  assert.ok(/version\.js" check/.test(read(c)), `${c} must run the version check`);
}

// 5. Every brief is reachable: each one is named by at least one command or by common.md.
const corpus = [...COMMANDS, 'briefs/common.md'].map(read).join('\n');
for (const b of BRIEFS.filter((b) => b !== 'briefs/common.md')) {
  assert.ok(corpus.includes(path.basename(b)), `${b} is never referenced — nothing would read it`);
}

// 6. The anecdote archive exists and no command reads it.
assert.ok(fs.existsSync(path.join(ROOT, 'docs/decisions.md')), 'docs/decisions.md must exist');
for (const c of COMMANDS) {
  assert.ok(!read(c).includes('decisions.md'), `${c} must not send anyone to the anecdote archive`);
}

// 7. common.md carries what more than one role needs, and stays a reference not an essay.
const common = read('briefs/common.md');
for (const fp of ['tick a box', 'about production', 'cheapest level', 'per criterion',
                  'weaken, skip, or delete', 'a user is worse off', 'change detector',
                  'never by position']) {
  assert.ok(common.includes(fp), `common.md must carry "${fp}"`);
}
// 566 words after the change-detector rule landed (was 441): a test that can only go red when someone
// deliberately changes the design proves nothing and blocks the change. That rule kept being
// re-derived wrong, so it is spelled out rather than hinted at — raise this only for another like it.
assert.ok(words(common) < 590, `common.md is ${words(common)} words — it is shared, so every role pays it`);

// 8. The implementer brief is short, reads common.md, and ends with prove.
const impl = read('briefs/implementer.md');
assert.ok(/common\.md/.test(impl), 'implementer.md must send the reader to common.md');
assert.ok(/gate\.js" prove|gate\.js prove/.test(impl), 'the final proof is `gate.js prove`');
assert.ok(!/30–60 seconds/.test(impl), 'the polling cadence paragraph is replaced by prove');
assert.ok(/maximum timeout/.test(impl), 'prove is run with the tool\'s maximum timeout, with the background fallback as a conditional');
assert.ok(!/exactly as `?\.ristretto\.json`? spells them/.test(impl), 'the hand-rolled-command paragraph is replaced by prove');
assert.ok(words(impl) < 800, `implementer.md is ${words(impl)} words — baseline was 1443`);

// 9. Together with common.md, a dispatch is well under the 1901-word baseline.
assert.ok(words(impl) + words(read('briefs/common.md')) < 1300,
  'an implementer dispatch must cost well under 1901 words — 1300 is the target, not the baseline');

// 10. Each role brief exists, defers to common.md, and does not restate it.
// Totals moved with common.md's +125; each role's own file is still capped where it was.
const CAPS = { 'briefs/planner.md': [450, 960], 'briefs/reviewer.md': [450, 920], 'briefs/closer.md': [400, 850] };
for (const [b, [own, total]] of Object.entries(CAPS)) {
  const t = read(b);
  assert.ok(/common\.md/.test(t), `${b} must send the reader to common.md`);
  assert.ok(words(t) < own, `${b} is ${words(t)} words (cap ${own})`);
  assert.ok(words(t) + words(read('briefs/common.md')) < total, `${b} + common.md exceeds ${total} — no role may pay more than today`);
}

// 11. The reviewer's three buckets and its fixed final line survive intact.
const rev = read('briefs/reviewer.md');
for (const s of ['block', 'note', 'lean', 'review: clean', 'review: notes-only', 'review: blocking']) {
  assert.ok(rev.includes(s), `reviewer.md must keep "${s}"`);
}

// 12. The closer records the round count — a verdict without it is a measurement thrown away.
const closer = read('briefs/closer.md');
assert.ok(closer.includes('rounds: <n>') && closer.includes('open: <b> block'), 'closer.md must give the Evidence review line as a fixed template');
assert.ok(closer.includes('git add -A') && closer.includes('plain ASCII'), 'the git rules live in closer.md');

// 13. The config reference keeps only what gate.js cannot detect.
const cfg = read('reference/config.md');
assert.ok(words(cfg) < 700, `reference/config.md is ${words(cfg)} words — pull.md carried ~2500`);
assert.ok(/gate\.js" verify|gate\.js verify/.test(cfg), 'it must point at verify for everything detectable');
for (const gone of ['--no-progress', 'formatPaths must', 'route them instead']) {
  assert.ok(!cfg.includes(gone), `"${gone}" is detected by gate.js now — it must not be text`);
}

// 14. The anecdotes are archived, out of every dispatch path.
const dec = read('docs/decisions.md');
for (const a of ['16.8', '289', '2.6 minutes']) {
  assert.ok(dec.includes(a), `docs/decisions.md must keep the "${a}" incident`);
}
for (const f of [...COMMANDS, ...BRIEFS]) {
  for (const a of ['16.8', '289-second']) {
    assert.ok(!read(f).includes(a), `${f} must not carry the "${a}" anecdote`);
  }
}

// 15. pull is a flow: it hands out paths, arms through gate.js, and carries no tier branch.
const pull = read('commands/pull.md');
assert.ok(words(pull) < 1400, `pull.md is ${words(pull)} words — was 8961`);
assert.ok(/implementer\.md/.test(pull), 'pull must read the implementer brief, not restate it');
assert.ok(/gate\.js" arm/.test(pull) && /gate\.js" disarm/.test(pull), 'pull must arm and disarm through gate.js');
assert.ok(/gate\.js" state/.test(pull), 'pull must run the state pre-flight');
assert.ok(!/\.ristretto\/gate-retries/.test(pull), 'pull must not know gate.js state filenames any more');
assert.ok(!/`easy`\s*→|Tier.*easy.*→/.test(pull), 'pull is the normal path — no tier branch');

// 16. shot is the easy path against an existing plan — it no longer writes one.
const shot = read('commands/shot.md');
assert.ok(words(shot) < 800, `shot.md is ${words(shot)} words`);
assert.ok(/implementer\.md/.test(shot), 'shot must read the implementer brief');
assert.ok(!/Add a `planned` row|in prep's format/.test(shot), 'shot no longer writes plans — prep always runs first');
assert.ok(/prep/.test(shot), 'shot must say prep runs first');

// 17. brew is an orchestrator: it dispatches by path and keeps its own rules only.
const brew = read('commands/brew.md');
assert.ok(words(brew) < 2200, `brew.md is ${words(brew)} words — was 9220`);
for (const b of ['planner.md', 'implementer.md', 'reviewer.md', 'closer.md']) {
  assert.ok(brew.includes(b), `brew must dispatch ${b} by path`);
}
assert.ok(/gate\.js" arm .*orchestrator|arm orchestrator/.test(brew), 'brew must arm as orchestrator');
assert.ok(!/You are the independent REVIEW gate/.test(brew), 'the review brief must not be pasted back in');
assert.ok(/3 rounds|capped at 3/.test(brew), 'brew keeps its 3-round cap');
assert.ok(!/append.*easy|appended with/.test(brew), 'the forced-easy lane must never edit the Tier cell');

// 18. The green-tree rule is honoured everywhere, not contradicted twelve lines later.
assert.ok(!/`git restore`/.test(brew) || /gate\.js" state|proven green/.test(brew),
  'any git restore in brew must be gated on the tree not being proven green');

// 19. The roadmap cell rule lives where rows are written.
assert.ok(read('commands/prep.md').includes('every cell'), 'prep.md must carry the cell rule — it writes the rows');
assert.ok(!read('commands/shot.md').includes('every cell'), 'shot.md no longer writes rows');

// 20. Descriptions say when to use, not how it works.
for (const [f, must] of [['commands/pull.md', 'normal'], ['commands/shot.md', 'easy'],
                         ['commands/brew.md', 'unattended']]) {
  const desc = (read(f).match(/^description:\s*(.*)$/m) || [])[1] || '';
  assert.ok(desc.length < 120, `${f} description is ${desc.length} chars — it should discriminate, not summarise`);
  assert.ok(desc.toLowerCase().includes(must), `${f} description must say "${must}"`);
}

// 21. prep's version paragraph is a one-liner like the other three — no literal exit-code text left.
assert.ok(!/PROJECT IS NEWER/.test(read('commands/prep.md')), 'prep.md must not quote the literal "PROJECT IS NEWER" string — one line like the other three');

// 22. help.md and README.md no longer describe shot as prep + pull in one pass.
assert.ok(!/prep \+ pull/i.test(read('commands/help.md')), 'help.md must not describe shot as "prep + pull"');
assert.ok(!/prep \+ pull/i.test(read('README.md')), 'README.md must not describe shot as "prep + pull"');

// 23. README's Depends: sentence names all three closing statuses, needs-review included.
const readmeDepSentence = (read('README.md').match(/A prerequisite counts as finished[^.]*\./) || [''])[0];
assert.ok(/needs-review/.test(readmeDepSentence) && /needs-human/.test(readmeDepSentence) && /`done`/.test(readmeDepSentence),
  'README dependency sentence must name done, needs-human, and needs-review');

console.log('briefs.test.js: all checks passed');
