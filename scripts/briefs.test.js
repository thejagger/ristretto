#!/usr/bin/env node
// Structural guard for ristretto's commands and briefs — run with: node scripts/briefs.test.js
//
// It does not judge what the rules say. It checks the one property that broke: that a rule
// lives in exactly one file, and that a command hands out a path rather than a pasted brief.
'use strict';
// Every failing pin is reported, not only the first: several tasks may each own a red pin.
const failures = [];
const hard = require('assert');
const assert = new Proxy(hard, {
  apply: (target, self, args) => { try { target(...args); } catch (e) { failures.push(e.message); } },
  get: (target, key) => (typeof target[key] === 'function'
    ? (...args) => { try { return target[key](...args); } catch (e) { failures.push(e.message); } }
    : target[key]),
});
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const words = (s) => s.split(/\s+/).filter(Boolean).length;

const COMMANDS = ['commands/brew.md', 'commands/pull.md', 'commands/shot.md'];
const BRIEFS = ['briefs/common.md', 'briefs/planner.md', 'briefs/implementer.md'];

// 1. Every brief file exists.
for (const b of BRIEFS) {
  assert.ok(fs.existsSync(path.join(ROOT, b)), `${b} must exist`);
}

// 2. No rule in two places. Each fingerprint is a phrase distinctive to one rule; it may appear
//    in exactly one file across commands + briefs. Add a fingerprint whenever a rule is moved.
const FINGERPRINTS = [
  'git add -A',              // stage only what you touched
  'plain ASCII',             // commit subject safety
  'per behaviour',           // test proportionality: a behaviour, not a plan line (2026-11-21)
  'cheapest level',          // prove it at the cheapest honest level
  'a user is worse off',     // what red has to mean before a test is written
  'label or key',            // find the value by meaning, never by position
  'Test code where it lives', // shared code is proven once, where it lives
  'ticked by whoever did the check', // who ticks a manual check
  'about production',        // never a check about production
  'weaken, skip, or delete', // gates are infrastructure
  'gate.js" prove',          // the implementer's final proof — note the quote: the real call is
                             // node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" prove, so a
                             // fingerprint of `gate.js prove` would match nothing
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
               'Manual-Checks:', 'decision taken:', 'would-escalate:', 'version.js', 'format-migration.md'];
const LAYOUT_FILES = [...BRIEFS, ...fs.readdirSync(path.join(ROOT, 'commands')).filter((c) => c.endsWith('.md')).map((c) => `commands/${c}`), 'README.md'];
const stale = LAYOUT_FILES.flatMap((f) => STALE.filter((p) => read(f).includes(p)).map((p) => `${f}: ${p}`));
assert.deepStrictEqual(stale, [], `the 0.22 layout removed these, still named in:\n  ${stale.join('\n  ')}`);

// 3. A command hands out a path, it does not paste a brief. The regression this whole cleanup
//    exists to prevent is a brief creeping back inline, so bound the file instead of trusting it.
for (const c of COMMANDS) {
  assert.ok(words(read(c)) < 2500, `${c} is ${words(read(c))} words — a command is a flow, not a brief`);
}

// 4. No command spends a call on the format check: the session-start hook runs it once, and pull
//    reads it from the state call it already makes — before it reads the roadmap.
for (const c of ['commands/pull.md', 'commands/prep.md', 'commands/status.md', 'commands/grind.md']) {
  assert.ok(!/migrate\.js" check/.test(read(c)), `${c} must not run the format check itself`);
}
{
  const p = read('commands/pull.md');
  assert.ok(p.indexOf('gate.js" state') > 0 && p.indexOf('gate.js" state') < p.search(/^## 1\. /m), 'pull runs state before it reads the roadmap');
  assert.strictEqual((p.match(/gate\.js" state/g) || []).length, 1, 'pull runs state once');
  assert.ok(/`format:`/.test(p) && /migrate\.js" apply/.test(p), 'pull migrates on what state says');
  for (const c of ['commands/prep.md', 'commands/status.md', 'commands/grind.md']) {
    assert.ok(/format notice/.test(read(c)), `${c} acts on the session-start notice`);
    assert.ok(/has not already migrated/.test(read(c)), `${c} acts on a notice once, not again after a migration`);
  }
  const st = read('commands/status.md');
  assert.ok(st.includes('the next prep/pull/brew there') && !st.includes('cd <folder>'), 'status never migrates a subfolder: it names it and points at the next prep/pull/brew there');
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
for (const fp of ['ticked by whoever did the check', 'about production', 'cheapest level', 'per behaviour',
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
// 750 with the git rules moved in from the deleted closer brief (2026-11-09): the feature commit
// is made by whoever closes, and pull, shot and the fixer all may — so every role reads them.
// 2026-11-20: the setup widens the reach test and who ticks — every role needs it (+81, so +85).
// 2026-11-21: one test per behaviour, the obvious and intent filtered first, slow tests out of
// the gates — a rule every role needs (+47 after cutting the duplicated reuse bullet, so +35).
assert.ok(words(common) < 870, `common.md is ${words(common)} words — it is shared, so every role pays it`);

// 7b. The setup widens the reach test (2026-11-20): a tool the setup names is a path, and what
//     ristretto saw with it is the proof.
assert.ok(common.includes('.ristretto/setup.md') && common.includes('seen in <tool>'), 'common.md counts the setup in the reach test');
assert.ok(!read('briefs/planner.md').includes('Where the repo can drive the UI'), 'the planner counts the setup too');
assert.ok(read('commands/pull.md').includes('seen in <tool>'), 'pull records a look as evidence');

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
//    1483 with the git rules moved into common.md (2026-11-09): +54, the closer's own rules.
//    2026-11-20: the setup widens the reach test and who ticks — every role needs it (+81, so +85).
//    2026-11-21: behaviour tests (+47 in common.md) and the slow test on request (+61 here), so +115.
assert.ok(words(impl) + words(read('briefs/common.md')) < 1683,
  'an implementer dispatch must cost well under 1901 words — 1683 is the target, not the baseline');

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
// The reviewer and closer briefs went in 2026-11-09: review is /code-review, closing is close.js.
// Totals moved by the +54 of git rules common.md took over from the closer.
// 2026-11-20: the setup widens the reach test and who ticks — every role needs it (+81, so +85).
const CAPS = { 'briefs/planner.md': [450, 1295] }; // 2026-11-21: behaviours and the look (+20 here, +47 in common.md), so +72. // +5, +5 more with the push rule and the builder line in Commits (2026-11-20)
for (const [b, [own, total]] of Object.entries(CAPS)) {
  const t = read(b);
  assert.ok(/common\.md/.test(t), `${b} must send the reader to common.md`);
  assert.ok(words(t) < own, `${b} is ${words(t)} words (cap ${own})`);
  assert.ok(words(t) + words(read('briefs/common.md')) < total, `${b} + common.md exceeds ${total} — no role may pay more than today`);
}

// 11. Review is /code-review and closing is a script: the reviewer and closer briefs are gone.
for (const gone of ['briefs/reviewer.md', 'briefs/closer.md']) {
  assert.ok(!fs.existsSync(path.join(ROOT, gone)), `${gone} was replaced (review: /code-review, close: close.js)`);
}

// 12. The git rules every closing role needs live in common.md.
assert.ok(common.includes('git add -A') && common.includes('plain ASCII'), 'the git rules live in common.md');

// 31. A fix is proven by a test that went red first, and the gates again — no reviewer re-checks it.
const fixer = impl.slice(impl.indexOf('dispatched as a fixer'));
assert.ok(impl.includes('dispatched as a fixer'), 'implementer.md keeps the fixer role');
assert.ok(/red/.test(fixer) && /verify|prove/.test(fixer), 'the fixer proves each fix red→green and re-runs the gates');
assert.ok(!/trim pass/i.test(impl), 'the trim pass went with the reviewer');

// 13. The config reference keeps only what gate.js cannot detect.
const cfg = read('reference/config.md');
// 2026-11-21: the two suites and their four keys need judgment gate.js cannot make (+112).
assert.ok(words(cfg) < 820, `reference/config.md is ${words(cfg)} words — pull.md carried ~2500`);
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

// 15. pull is the one build flow: it hands out paths, arms through gate.js, reviews once with
//     /code-review, closes through close.js, and runs attended or unattended.
const pull = read('commands/pull.md');
// +24 more on 2026-11-21 (cap 1975): the no-test evidence forms and the unrun slow suite.
// +38 on 2026-11-21 (cap +50): the report's `setup:` line, and that a build never edits the setup itself.
assert.ok(words(pull) < 1975, `pull.md is ${words(pull)} words — was 8961`);
assert.ok(/implementer\.md/.test(pull), 'pull must read the implementer brief, not restate it');
assert.ok(/gate\.js" arm/.test(pull) && /gate\.js" disarm/.test(pull), 'pull must arm and disarm through gate.js');
assert.ok(/gate\.js" state/.test(pull) && /gate\.js" verify/.test(pull), 'pull must run the state pre-flight and verify');
assert.ok(!/\.ristretto\/gate-retries/.test(pull), 'pull must not know gate.js state filenames any more');
for (const s of ['close.js', '/code-review', 'unattended', 'pulled: <ID>', 'blocked: <ID>']) {
  assert.ok(pull.includes(s), `pull.md must carry "${s}"`);
}
for (const gone of ['reviewer.md', 'closer.md', 'round 2']) {
  assert.ok(!pull.includes(gone), `pull.md must not name "${gone}" — review is one /code-review`);
}
const step = (re) => pull.search(re);
assert.ok(step(/^## \d+\. Prove/m) < step(/^## \d+\. Review/m) && step(/^## \d+\. Review/m) < step(/^## \d+\. Close/m),
  'verify, then review, then close');
// pullEffortByTier
assert.ok(pull.includes('`/code-review medium') || /medium/.test(pull), 'easy features review at medium');
assert.ok(/\/code-review <level> <absolute path/.test(pull) && /`high`/.test(pull) && /`medium`/.test(pull), 'the review names its level by tier and the repo path');
// pullStashNamesPaths — a blocked unattended pull parks only its own files, never the user's.
assert.ok(/git stash push/.test(pull) && /ristretto <ID> blocked/.test(pull) && /left alone/.test(pull),
  'a blocked unattended pull parks its own paths in a named stash, never the left-alone files');
assert.ok(!/git restore/.test(pull), 'pull never restores work away');
// pullTakesBrewerRulings — the brewer's decided: lines reach close.js with the build's own.
assert.ok(/decided:[^\n]*(arguments|brewer)/i.test(pull) && /decisions/.test(pull), 'the brewer\'s decided: lines go to close.js');
// A done feature is never re-built: pull names its commit and what its plan still leaves open.
assert.ok(/\*\*`done`\*\* → stop[^\n]*\[ \] \[human\][^\n]*Do not re-implement/.test(pull), 'pull on a done row lists its open boxes and stops');
// A decision a build took is information in force, never a box or a question: the user only ever
// overrules one in chat. Twelve boxes for one feature — renames, test harnesses — is how this began.
assert.ok(/- taken: \$\{d\.question\} → \$\{d\.ruling\}/.test(read('scripts/close.js')), 'close.js writes a taken: line, not a box');
assert.ok(!/- \[ \] <question>/.test(read('briefs/common.md')), 'no decision box anywhere');
for (const f of ['briefs/planner.md', 'briefs/implementer.md']) {
  assert.ok(/only if a user could see/.test(read(f)), `${f} reports only user-visible decisions`);
}
for (const f of [...COMMANDS, 'commands/status.md', 'commands/help.md', 'README.md']) {
  assert.ok(!read(f).includes('decisions ok'), `${f} must not ask the user to confirm decisions`);
}
assert.ok(/## Overrule/.test(read('commands/prep.md')), 'prep takes an overrule');

// 16. shot is the easy path against an existing plan — it no longer writes one.
const shot = read('commands/shot.md');
assert.ok(shot.split(/\r?\n/).length < 40, `shot.md is ${shot.split(/\r?\n/).length} lines — it follows pull's flow`);
assert.ok(/\/ristretto:pull <this target> shot/.test(shot) && /skips the planner/.test(shot), 'shot invokes pull as shot and skips the planner');
assert.ok(/^- `shot` — /m.test(read('commands/pull.md')), 'pull takes `shot` as an argument');

// 16b. One command hands over to another by invoking its skill, never by reading its file: after a
//      summary Claude Code re-attaches invoked skills only, and a brew that had read brew.md with cat
//      followed prep's text instead for the rest of the run (durchhaus, 2026-11-19).
for (const f of fs.readdirSync(path.join(ROOT, "commands")).filter((n) => n.endsWith(".md"))) {
  assert.ok(!/commands\/[a-z-]+\.md`? and follow it/.test(read(`commands/${f}`)), `${f} hands over by reading a command file — invoke its skill instead`);
}

// 16c. The brewer's every message while builders run is the block, whatever woke it: a rule tied to
//      a builder's return left a "waiting on its own background work" notice to improvised prose.
assert.ok(/Whatever wakes you while builders run/.test(read('commands/brew.md')), 'brew.md ties the block to every message, not to one event');
assert.ok(!/Add a `planned` row|in prep's format/.test(shot), 'shot no longer writes plans — prep always runs first');
assert.ok(/prep/.test(shot), 'shot must say prep runs first');

// 17. brew is the brewer: a goal, not a loop. It keeps the overview and builds each feature with
//     a fresh builder subagent when its turn comes, so a builder knows one feature (one per repo
//     filled its context with every feature it had built, 2026-11-11); it never builds, never arms a
//     gate, never dispatches a role.
const brew = read('commands/brew.md');
assert.ok(brew.split(/\r?\n/).length <= 45, `brew.md is ${brew.split(/\r?\n/).length} lines — the brewer is a goal of at most 45`);
for (const s of ['/ristretto:pull', 'unattended', 'fresh general-purpose subagent', 'feature/brew-', 'never builds', 'decided:']) {
  assert.ok(brew.includes(s), `brew.md must carry "${s}"`);
}
// Builder sessions opened up front sat idle, seven at once (2026-11-12): the builder is a subagent.
assert.ok(!/SendMessage|one session for every/.test(brew), 'brew.md starts no builder sessions');
for (const gone of ['PLANNER for', 'arm orchestrator', 'reviewer.md', 'implementer.md']) {
  assert.ok(!brew.includes(gone), `brew.md must not carry "${gone}" — the brewer does not build`);
}

// 18. The green-tree rule is honoured everywhere: nothing a run built is ever restored away.
assert.ok(!/git restore/.test(brew), 'the brewer never restores work away');

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

// 32. help fits a screen; pull's one finishing option is the MR description — the docs/code split
//     was never used (cut 2026-11-20); prep has no deep flag; status reads the same folders as the
//     brewer; nothing names what slim-core phases 3–5 cut.
assert.ok(read('commands/help.md').split(/\r?\n/).length <= 25, 'help.md fits a screen — 25 lines at most');
assert.ok(!fs.existsSync(path.join(ROOT, 'scripts/strata.mjs')), 'the docs/code split is gone');
assert.ok(/briefs\/mr\.md/.test(pull), 'pull offers the MR description');
assert.ok(!/deep/.test((read('commands/prep.md').match(/^argument-hint:.*$/m) || [''])[0]), 'prep has no deep flag');
// v1 board (spec 2026-11-20): prep's marker lines are what the pane pins (hooks/board-pins.mjs).
for (const marker of ['`decided: <topic> → <ruling>`', '`open: <topic> — <the question>`', '`found: <one fact>`']) {
  assert.ok(read('commands/prep.md').includes(marker), `prep writes the ${marker} line the board pins`);
}
assert.ok(/direct subfolders/.test(read('commands/status.md')), 'status reads this folder and its direct subfolders');
{
  const named = ['commands', 'briefs'].flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.md')).map((f) => `${d}/${f}`)).concat('README.md');
  for (const f of named) {
    for (const gone of ['reviewer.md', 'closer.md', 'strata', 'arm orchestrator', 'notes-only', 'round 2']) {
      assert.ok(!read(f).includes(gone), `${f} still names "${gone}"`);
    }
  }
}

// 33. The unattended block-and-resume cycle holds (final review, 2026-11-09): the brewer's
//     rulings and contract snapshots reach the planner and fixer; a parked feature's own build plan
//     doesn't stop its resume; the stash is taken before the row is set and never holds the
//     roadmap or .ristretto.json; a dead session's dirty tree goes to a person.
{
  assert.ok((pull.match(/Decided \(binding\)/g) || []).length >= 2, 'the brewer\'s rulings bind the planner and the fixer');
  assert.ok(/contract: <repo>@<hash>:<file>/.test(pull) && /git -C <repo> show <hash>:<file>/.test(pull), 'pull takes a contract snapshot and reads it from git, never a working tree');
  assert.ok(/own build plan/.test(pull.slice(pull.search(/^## 3\. Pre-flight/m), pull.search(/^## 4\./m))), 'a parked feature\'s own build plan is resumable, not a stop');
  const blockedStep = pull.slice(pull.search(/^## 12\. Blocked/m), pull.search(/^## 13\./m));
  assert.ok(blockedStep.indexOf('git stash push') >= 0 && blockedStep.indexOf('git stash push') < blockedStep.indexOf('Then set the roadmap row'), 'stash first, then set the row');
  assert.ok(/never `docs\/ristretto\/roadmap\.md`/.test(blockedStep) && /`\.ristretto\.json`/.test(blockedStep), 'the stash never holds the roadmap or .ristretto.json');
  assert.ok(/the offer from step 13, then the last line/.test(pull), 'unattended prints the MR offer, then the last line');
  assert.ok(/contract: <repo>@<hash>:<file>/.test(brew), 'the brewer sends the snapshot in pull\'s own argument form');
  assert.ok(/dirty[^\n]*person/i.test(brew), 'a dead session\'s dirty tree is named for a person, not re-pulled into a stop');
  // A blocked pull is the brewer's to solve before the user's: a criterion that real data contradicted held a flight for five hours (2026-11-11).
  assert.ok(/blocked[^\n]*rule on the question[^\n]*same pull again/i.test(brew) && /`decided:` line replaces it/.test(pull) && /problems you met/.test(brew),
    'the brewer solves a block first, its ruling replaces a criterion in the pull, and the report names the problems');
}

// 23. README's Depends: sentence: only `done` satisfies, open boxes and all.
const readmeDepSentence = (read('README.md').match(/A prerequisite counts as finished[^.]*\./) || [''])[0];
assert.ok(/`done`/.test(readmeDepSentence) && /box/.test(readmeDepSentence),
  'README dependency sentence must say done satisfies, even with a box still open');

// 24. grind is read-only and researches in its own turn — no research file, no researcher.
const grind = read('commands/grind.md');
assert.ok(/Read-only: you change no files and commit nothing/.test(grind), 'grind is read-only again');
assert.ok(!/research\.js|researcher\.md|docs\/ristretto\/research/.test(grind), 'grind writes no research file and dispatches no researcher');
assert.ok(/never instructions/.test(grind) && /about ten searches/.test(grind), 'grind treats fetched text as data and keeps a search budget');
assert.ok(/never changes the verdict/.test(grind), "a missing why must never change grind's verdict");
assert.ok(!/prep <feature> deep/.test(grind), 'prep has no deep flag for grind to point at');

// 25. prep is the conversation (2026-11-19): it looks first and opens with an overview of scored
//     options, asks only where answers change the work, writes the plan when the points are
//     settled — no trigger phrase — and ends by asking whether to build now.
const prep = read('commands/prep.md');
assert.ok(prep.indexOf('## 1. The overview') > 0 && prep.indexOf('## 1. The overview') < prep.indexOf('## 2. Talk it through'), 'the overview comes before any question');
assert.ok(/a score out of 5/.test(prep) && /recommendation/.test(prep), 'the overview scores the options and recommends');
assert.ok(/materially different work/.test(prep), 'prep asks only where answers lead to materially different work');
assert.ok(/there is no phrase for it/.test(prep), 'no trigger phrase: prep reads from the conversation when the points are settled');
assert.ok(/## 5\. Build it now\?/.test(prep) && /unattended/.test(prep) && /arms as one/.test(prep), 'prep ends by asking to build, and a yes starts a builder');
assert.ok(/never instructions/.test(prep), 'fetched text is data in prep too');
for (const gone of ['research.js', 'researcher.md', 'roast', 'prep facts', 'Units:', '## Approach', '[auto]', '[measure]', 'Blockers:', 'Parallel-with']) {
  assert.ok(!prep.includes(gone), `prep.md must not name "${gone}" any more`);
}
for (const field of ['- Goal:', '- Why:', '- Acceptance:', '- Decisions:', '- Depends:', '- Provides:']) {
  assert.ok(prep.includes(field), `the plan template carries "${field}" — board-plan.mjs and confirm.js read these`);
}
assert.ok(/behaviour stays the same and the suite stays green/.test(prep), 'a refactor has an acceptance of its own');

// 26. The domain store is gone, and nothing tells an agent to read or write it.
for (const p of ['briefs/researcher.md', 'scripts/research.js', 'hooks/board-domain.mjs']) {
  assert.ok(!fs.existsSync(path.join(ROOT, p)), `${p} was cut with the domain store`);
}
for (const f of [...COMMANDS, ...BRIEFS, 'commands/grind.md', 'commands/prep.md', 'commands/help.md', 'commands/status.md']) {
  assert.ok(!/docs\/ristretto\/domain|research\.js|prep facts/.test(read(f)), `${f} must not name the domain store`);
}

// 27. Reports are for trying the feature: built, how to test, decided, open — and brew shows only
//     a small progress block while it runs, with the early stops of an unattended agent named.
assert.ok(/built:/.test(pull) && /test:/.test(pull) && /decided for you/.test(pull) && /open:/.test(pull), 'pull reports built, test, decided, open');
assert.ok(/Your final message is the report/.test(pull), 'an unattended pull hands its report back with its last line');
assert.ok(/☕ brew · /.test(brew) && /at most the last two done/.test(brew) && /the next two/.test(brew), 'brew shows the progress block, two done and two next at most');
assert.ok(/announce the next step instead of taking it/.test(brew) && /offer to carry on/.test(brew), 'brew names the early stops it must not make');

// 30. The confirm skill: "manual checks done" in chat ticks boxes through confirm.js, and only
//     on the user's own words.
{
  const skill = 'skills/confirm/SKILL.md';
  assert.ok(fs.existsSync(path.join(ROOT, skill)), `${skill} must exist`);
  const s = read(skill);
  const front = (/^---\r?\n([\s\S]*?)\r?\n---/.exec(s) || [])[1] || '';
  assert.ok(/^name: confirm$/m.test(front), 'the confirm skill must be named confirm');
  assert.ok(/^description:.*manual checks done/m.test(front), 'its description must name "manual checks done"');
  assert.ok(/^user-invocable: false$/m.test(front), 'nobody types /ristretto:confirm — it acts on what the user says, so it stays out of the / menu');
  for (const cmd of ['confirm.js" list', 'confirm.js" tick']) assert.ok(s.includes(cmd), `the skill must run ${cmd}`);
  assert.ok(s.includes("only the user's own words in chat"), "the skill must act on only the user's own words in chat");
}

// 34. After a build (2026-11-20): the session the owner started walks the boxes the setup reaches,
//     pushes and posts as the setup says — one brief, read by attended pull, prep and the brewer;
//     a builder never pushes. "run the checks" in chat walks them any time.
{
  const ab = 'briefs/after-build.md';
  assert.ok(fs.existsSync(path.join(ROOT, ab)), `${ab} must exist`);
  const t = fs.existsSync(path.join(ROOT, ab)) ? read(ab) : '';
  for (const c of ['commands/pull.md', 'commands/prep.md', 'commands/brew.md']) assert.ok(read(c).includes('after-build.md'), `${c} points at ${ab}`);
  for (const s of ['confirm.js" tick', '--by', 'never the default branch', 'a builder never', 'ticket not updated:', 'draft']) {
    assert.ok(t.includes(s), `${ab} must carry "${s}"`);
  }
  const walk = 'skills/walk/SKILL.md';
  const w = fs.existsSync(path.join(ROOT, walk)) ? read(walk) : '';
  const front = (/^---\r?\n([\s\S]*?)\r?\n---/.exec(w) || [])[1] || '';
  assert.ok(/^name: walk$/m.test(front) && /^user-invocable: false$/m.test(front) && /^description:.*run the checks/m.test(front), `${walk} is a hidden skill that acts on "run the checks"`);
  const help = read('commands/help.md');
  assert.ok(help.includes('never push unless the setup says so') && help.includes('"run the checks"'), 'help names the push rule and "run the checks"');
  const bare = ['commands', 'briefs'].flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.md')).map((f) => `${d}/${f}`))
    .filter((f) => /Never push[.,]/.test(read(f)));
  assert.deepStrictEqual(bare, [], 'a bare "Never push" is gone: the setup decides');
  assert.ok(read('commands/status.md').includes('run the checks'), 'status names "run the checks" beside "manual checks done"');
  // Final review (2026-11-20): only a branch ristretto created is pushed — never one the owner was
  // already on, which may be shared; a repo with no setup never pays for reading the brief; a
  // builder is told where it reads the rules that it never pushes.
  assert.ok(t.includes('a branch ristretto created'), 'after-build pushes only a branch ristretto created');
  assert.ok(/only where a setup was printed[^\n]*after-build\.md/.test(read('commands/pull.md')), 'pull reads after-build only where a setup was printed');
  assert.ok(/has a `## Tickets`[^\n]*after-build\.md/.test(read('commands/prep.md')) && /where this repo has a setup, follow `after-build\.md`/.test(read('commands/prep.md')), 'prep reads after-build only where there is a setup');
  assert.ok(/after-build\.md` there, where that repo has a setup/.test(read('commands/brew.md')), 'the brewer reads after-build only where there is a setup');
  assert.ok(common.includes('a builder never does'), 'common.md tells every builder it never pushes');
}

// 35. /ristretto:init (2026-11-20) writes the per-machine setup from a scored overview, and its
//     rulebook describes tools by what they can do. No stack, framework, product or client is named
//     in the plugin's own text: an example once became the rule, and the plugin quietly turned into
//     a tool for that one stack. Only a project's own .ristretto/setup.md names concrete tools.
{
  const has = (p) => fs.existsSync(path.join(ROOT, p));
  assert.ok(has('commands/init.md') && has('reference/setup.md'), 'init and its rulebook exist');
  const init = has('commands/init.md') ? read('commands/init.md') : '';
  const book = has('reference/setup.md') ? read('reference/setup.md') : '';
  for (const s of ['reference/setup.md', 'reference/config.md', '.ristretto/setup.md', 'settings.local.json']) assert.ok(init.includes(s), `init names ${s}`);
  assert.ok(!init.includes('.claude/settings.json'), 'init never writes the shared settings.json');
  for (const s of ['repeatable in gates', 'runs in the background', 'visible to the owner', "holds the owner's logins"]) assert.ok(book.includes(s), `the rulebook names "${s}"`);
  assert.ok(words(book) < 700, `reference/setup.md is ${words(book)} words`);
  const NAMES = ['Flutter', 'Dart', 'Playwright', 'Puppeteer', 'Selenium', 'Cypress', 'Chrome', 'Chromium', 'Firefox', 'Safari',
    'React', 'Angular', 'Vue', 'Svelte', 'Spring', 'Django', 'Rails', 'Laravel', 'Docker', 'Kubernetes', 'GitLab', 'GitHub',
    'glab', 'gh', 'Notion', 'Jira', 'Linear', 'Supabase', 'Postgres', 'Java', 'Kotlin', 'Swift', 'Python', 'JavaScript',
    'TypeScript', 'Gradle', 'Maven', 'npm', 'pnpm', 'yarn', 'pytest', 'Jest', 'Vitest'];
  for (const f of ['commands/init.md', 'reference/setup.md', 'briefs/after-build.md', 'skills/walk/SKILL.md', 'skills/slow/SKILL.md'].filter(has)) {
    const hits = NAMES.filter((n) => new RegExp(`\\b${n}\\b`).test(read(f)));
    assert.deepStrictEqual(hits, [], `${f} names a stack or product: ${hits.join(', ')}`);
  }
  assert.ok(read('commands/help.md').includes('/ristretto:init'), 'help lists init');
  assert.strictEqual((read('commands/prep.md').match(/\/ristretto:init/g) || []).length, 1, 'prep mentions init exactly once');
}

// 36. The setup keeps up with the repo (2026-11-21). A project started bare has nothing to look
//     at; its first features add a start command, a test user, a tool that drives the app, and a
//     setup written on day one goes stale. A builder never edits the setup — it is the owner's,
//     per machine — it reports a `setup:` line; the owner's session applies it in after-build,
//     before the walk, so the walk already uses it. A filled `none yet` slot is applied and said;
//     a change to what the owner chose is asked. Init writes a slot it cannot fill yet as
//     `none yet`, and prep and status name such a slot in one line.
{
  const pull = read('commands/pull.md');
  const ab = read('briefs/after-build.md');
  const book = read('reference/setup.md');
  assert.ok(/setup: +<[^\n]*>/.test(pull), 'the pull report has a `setup:` line');
  assert.ok(/never edit[^\n]*\.ristretto\/setup\.md/i.test(pull), 'a build never edits the setup itself');
  assert.ok(/\/ristretto:init would record it/.test(pull), 'with no setup, the line says init would record it — after-build is not read there');
  const refresh = ab.indexOf('## 0. Refresh the setup');
  assert.ok(refresh > -1 && refresh < ab.indexOf('## 1. Walk the boxes'), 'after-build refreshes the setup before the walk');
  assert.ok(ab.includes('`none yet`') && ab.includes('setup updated:'), 'after-build fills `none yet` slots and reports `setup updated:`');
  assert.ok(/owner chose[^\n]*ask/i.test(ab), 'a change to what the owner chose is asked, never applied silently');
  assert.ok(book.includes('`none yet`'), 'the rulebook writes an unfillable slot as `none yet`');
  assert.ok(read('commands/init.md').includes('`none yet`'), 'init writes `none yet` slots on a bare project');
  assert.ok(read('commands/prep.md').includes('`none yet`') && read('commands/status.md').includes('`none yet`'), 'prep and status name a `none yet` slot');
  assert.ok(read('commands/brew.md').includes('setup updated:'), "the brewer's final report carries after-build's `setup updated:` lines");
}

// 37. Behaviour tests and a fast suite by construction (2026-11-21, design
//     docs/superpowers/specs/2026-11-21-behaviour-tests-design.md). Tests mirrored the plan: a
//     crema build wrote three tests that each asserted the same 378 cents, one per acceptance
//     line. A test is for a behaviour — when a user does X, they get Y — never for a plan line,
//     for what is obvious, or for intent. Slow tests (a browser, a model, an upload) run when the
//     owner asks in the chat, never in a gate; a new test over the limit fails verify.
{
  const common = read('briefs/common.md');
  const tests = common.slice(common.indexOf('## Tests'));
  assert.ok(tests.indexOf('a user is worse off') < tests.indexOf('per behaviour'), 'the worse-off filter comes before the behaviour rule');
  assert.ok(/when a user does/i.test(common) && /rows of that test/.test(common), 'a behaviour is when → then, its variants are rows');
  assert.ok(/obvious/.test(tests) && /change detector/.test(tests), 'no test for what is obvious or for intent');
  assert.ok(/a real run can tell[^\n]*assert nothing/.test(common), 'a number only a real run can tell still gets no test');
  assert.ok(!/over a browser/.test(common), 'a browser is no level a builder picks');
  assert.ok(/path to look/.test(common), 'a driver in the dev dependencies is a path to look, not a kept test');
  const planner = read('briefs/planner.md');
  assert.ok(/behaviours that prove/.test(planner) && !/one test for each criterion/.test(planner), 'the planner lists behaviours');
  assert.ok(/a look, not a test/.test(planner), "the planner's manual checks look instead of keeping a browser test");
  const impl = read('briefs/implementer.md');
  assert.ok(/behaviours that prove the criteria/.test(impl), 'the easy path lists behaviours too');
  assert.ok(/only asks for a test/.test(impl), 'a fixer leaves a finding that only asks for a test of the obvious');
  assert.ok(/slow test only where the owner asked/i.test(impl) && impl.includes('gate.js" slow --only'), 'a slow test only on request, run once');
  const prep = read('commands/prep.md');
  assert.ok(!/Every line becomes a test/.test(prep) && /proven by the build/.test(prep), 'prep no longer turns every line into a test');
  assert.ok(prep.includes('make sure →'), 'prep names how the owner asks for a slow test');
  const pull = read('commands/pull.md');
  for (const f of ['no test — <what already guarantees it>', 'a ruling — read in <file>']) assert.ok(pull.includes(f), `pull's evidence has the form "${f}"`);
  assert.ok(pull.includes('run the slow tests'), "pull's report names an unrun slow suite");
  const cfg = read('reference/config.md');
  for (const k of ['testSlow', 'slowPaths', 'slowTest']) assert.ok(cfg.includes(`\`${k}\``), `config.md names ${k}`);
  assert.ok(/stays fast/.test(read('reference/setup.md')), "setup.md's gates row keeps only what stays fast");
  assert.ok(/slow t(ests|ail)/.test(read('commands/init.md')), "init's overview shows the slow tail");
  assert.ok(read('commands/status.md').includes('slow tests:'), 'status prints the slow-suite line');
  assert.ok(read('commands/help.md').includes('"run the slow tests"'), 'help names "run the slow tests"');
  const slow = 'skills/slow/SKILL.md';
  assert.ok(fs.existsSync(path.join(ROOT, slow)), `${slow} exists`);
  if (fs.existsSync(path.join(ROOT, slow))) {
    const t = read(slow);
    assert.ok(/user-invocable: false/.test(t) && t.includes('gate.js" slow'), 'the slow skill runs gate.js slow and is not typed');
    assert.ok(/own words/.test(t) && /armed/.test(t), "the slow skill acts on the owner's words only and refuses while a build is armed");
  }
}

if (failures.length) {
  for (const m of failures) console.log(`FAIL ${m.split(/\r?\n/)[0]}`);
  console.log(`briefs.test.js: ${failures.length} failed`);
  process.exit(1);
}
console.log('briefs.test.js: all checks passed');
