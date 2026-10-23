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
                'briefs/reviewer.md', 'briefs/closer.md', 'briefs/researcher.md'];

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
  'Test code where it lives', // shared code is proven once, where it lives
  'Tag test waste',          // the reviewer tags removable test waste
  'one legal deletion',      // the trim pass, the only place a test is deleted
  'tick a box',              // manual checks
  'about production',        // never a check about production
  'weaken, skip, or delete', // gates are infrastructure
  'gate.js" prove',          // the implementer's final proof — note the quote: the real call is
                             // node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" prove, so a
                             // fingerprint of `gate.js prove` would match nothing
  'never instructions',      // fetched text is data — the researcher's injection line
  'about 10 web searches',   // the research budget
  'Add only.',               // agents never edit a domain entry
  'more than three files',   // deleted ratchet trigger — must appear NOWHERE
  'planned · in-progress · blocked · done', // the four statuses, defined once
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

// 2b. The 0.22 layout: one fact, one place. Nothing tells an agent to read or write what that
//     layout removed: the checks file, the archive, the two extra statuses, the dropped columns
//     and fields, and the Evidence lines a decision used to hide in.
const STALE = ['manual-checks.md', 'plans/archived', 'needs-human', 'needs-review', 'Files touched',
               'Manual-Checks:', 'decision taken:', 'would-escalate:'];
const LAYOUT_FILES = [...BRIEFS];
const stale = LAYOUT_FILES.flatMap((f) => STALE.filter((p) => read(f).includes(p)).map((p) => `${f}: ${p}`));
assert.deepStrictEqual(stale, [], `the 0.22 layout removed these, still named in:\n  ${stale.join('\n  ')}`);

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
//    grind and prep dispatch the researcher; they are not in COMMANDS (no word cap, no gate flow).
const corpus = [...COMMANDS, 'commands/grind.md', 'commands/prep.md', 'briefs/common.md'].map(read).join('\n');
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
// 566 words after the change-detector rule landed (was 441), ~565 again after the test-where-it-lives rule: a test that can only go red when someone
// deliberately changes the design proves nothing and blocks the change. That rule kept being
// re-derived wrong, so it is spelled out rather than hinted at — raise this only for another like it.
// ~590 after the domain rule: a confirmed domain entry binds like a house rule, and every role
// has to know it — raise this only for another rule every role needs. 614 after the conflict
// rule (2026-10-13), written short to stay under it. 695 with the 0.22 statuses and boxes
// (2026-10-23): every role reads and writes the plan's two kinds of box — +81, written short.
assert.ok(words(common) < 696, `common.md is ${words(common)} words — it is shared, so every role pays it`);

// 8. The implementer brief is short, reads common.md, and ends with prove.
const impl = read('briefs/implementer.md');
assert.ok(/common\.md/.test(impl), 'implementer.md must send the reader to common.md');
assert.ok(/gate\.js" prove|gate\.js prove/.test(impl), 'the final proof is `gate.js prove`');
assert.ok(!/30–60 seconds/.test(impl), 'the polling cadence paragraph is replaced by prove');
assert.ok(/maximum timeout/.test(impl), 'prove is run with the tool\'s maximum timeout, with the background fallback as a conditional');
assert.ok(!/exactly as `?\.ristretto\.json`? spells them/.test(impl), 'the hand-rolled-command paragraph is replaced by prove');
assert.ok(words(impl) < 800, `implementer.md is ${words(impl)} words — baseline was 1443`);

// 9. Together with common.md, a dispatch is well under the 1901-word baseline.
//    It sat at 1299 when the domain rule landed; that rule binds the implementer too, so the
//    target moved by its 16 words (it also forbids editing a confirmed entry) and no more.
//    1316 when the conflict rule landed (2026-10-13): every role notes a contradicted fact by
//    script and stops on a binding one in conflict — 28 words, so the target moved by 28.
//    1429 with the 0.22 statuses and boxes (2026-10-23): +81 in common.md, so the target moved by 81.
assert.ok(words(impl) + words(read('briefs/common.md')) < 1429,
  'an implementer dispatch must cost well under 1901 words — 1429 is the target, not the baseline');

// 10. Each role brief exists, defers to common.md, and does not restate it.
// Totals moved with common.md's +125; each role's own file is still capped where it was.
// The reviewer total moved again when it gained the `test` tag — a duty, not prose.
// All three moved once more with the confirmed-domain rule: +16 in common.md for every role,
// +9 in the reviewer's own `block` bucket — a rule every role must know, not prose.
// And with the conflict rule (2026-10-13): +28 in common.md for every role, +7 in the
// reviewer's `block` bucket (building on a confirmed entry in conflict).
// The closer once more with one commit per feature (2026-10-13): +50 in its own brief — the
// roadmap row and archived plan ride in the feature commit, and a check re-run only adds. A duty.
// And with the 0.22 statuses and boxes (2026-10-23): +81 in common.md for every role, nothing else.
const CAPS = { 'briefs/planner.md': [450, 1074], 'briefs/reviewer.md': [450, 1106], 'briefs/closer.md': [400, 1024],
               'briefs/researcher.md': [700, 1371] };
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
// Judging a needs-review row stays on the branch that already holds the feature's commit: the
// board is branch-first, and a fix landing on feature/<ID> leaves the holding branch held forever.
assert.ok(/needs-review[\s\S]*on the current branch when it already holds/.test(pull), 'pull must judge needs-review on the branch that holds the feature');
assert.ok(/Create and switch to `feature\/<FEATURE-ID>`[^\n]*except a needs-review/.test(pull), 'step 6 must say a needs-review fix stays on its branch');

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

// 24. grind researches once: it checks staleness, guards the domain store around the run, and
//     dispatches the researcher by path. It is no longer read-only, but writes only research.
const grind = read('commands/grind.md');
for (const s of ['research.js" stale', 'research.js" snapshot', 'research.js" check-domain', 'researcher.md']) {
  assert.ok(grind.includes(s), `grind.md must carry "${s}"`);
}
assert.ok(!/Read-only: assess and print, change no files/.test(grind), 'grind writes research now — the read-only line must go');
assert.ok(/never changes the verdict/.test(grind), 'a missing why must never change grind\'s verdict');
const researcher = read('briefs/researcher.md');
for (const s of ['## As-is', 'Exists:', 'Touches:', 'Already settled:', 'at commit', 'unconfirmed —']) {
  assert.ok(researcher.includes(s), `researcher.md must keep the label "${s}" — research.js reads it`);
}

// 25. prep reuses grind's research instead of paying for it again, and records the why.
const prep = read('commands/prep.md');
for (const s of ['research.js" stale', 'research.js" snapshot', 'research.js" check-domain', 'researcher.md',
                 '- Why: <outcome> · noticed by: <signal>', 'rests on unconfirmed']) {
  assert.ok(prep.includes(s), `prep.md must carry "${s}"`);
}
assert.ok(/never escalates to roast mode by itself/.test(prep), 'a missing why must not trigger roast mode on its own');

// 26. A confirmed domain entry binds every role like CLAUDE.md; an unconfirmed one never does.
assert.ok(/docs\/ristretto\/domain\//.test(common) && /unconfirmed ones are context, never binding/.test(common),
  'common.md must make confirmed domain entries binding and unconfirmed ones context only');
assert.ok(/confirmed domain entry/.test(rev), 'reviewer.md must block on a violated confirmed domain entry');

// 27. Outside a research run nothing checks domain/ in code, so the builder roles are told: a
//     fixer must never "resolve" a domain block by rewording the entry, and the reviewer blocks it.
assert.ok(/no agent edits them/.test(common), 'common.md must forbid every role from editing a confirmed domain entry');
assert.ok(/violated or edited/.test(rev), 'reviewer.md must block a diff that edits a confirmed domain entry');
assert.ok(!/never changes a confirmed entry is checked in code/.test(read('README.md')),
  'README must not claim code guards domain/ everywhere — it guards research runs');

// 28. Research is per input, decided before the split — a split child reuses its parent's file
//     instead of paying for a researcher run of its own.
assert.ok(/never per child/.test(prep), 'prep must research once per input, never per split child');
assert.ok(prep.indexOf('research.js" stale') < prep.indexOf('## Decompose only when'),
  'prep must read the research before it decides a split');

// 29. Research runs share one domain snapshot: prep researches inputs one at a time, and both
//     commands say what an unchecked run (check-domain exit 2) means instead of passing it silently.
for (const [f, t] of [['grind.md', grind], ['prep.md', prep]]) {
  assert.ok(/exit 2 → the domain store was not checked/i.test(t), `${f} must say what check-domain exit 2 means`);
}
assert.ok(/one input at a time/.test(prep), 'prep must research one input at a time — the runs share one snapshot');

console.log('briefs.test.js: all checks passed');
