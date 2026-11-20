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
  'per criterion',           // test proportionality
  'cheapest level',          // prove it at the cheapest honest level
  'a user is worse off',     // what red has to mean before a test is written
  'label or key',            // find the value by meaning, never by position
  'Test code where it lives', // shared code is proven once, where it lives
  'tick a box',              // manual checks
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
// 750 with the git rules moved in from the deleted closer brief (2026-11-09): the feature commit
// is made by whoever closes, and pull, shot and the fixer all may — so every role reads them.
assert.ok(words(common) < 750, `common.md is ${words(common)} words — it is shared, so every role pays it`);

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
assert.ok(words(impl) + words(read('briefs/common.md')) < 1483,
  'an implementer dispatch must cost well under 1901 words — 1483 is the target, not the baseline');

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
const CAPS = { 'briefs/planner.md': [450, 1128] };
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

// 15. pull is the one build flow: it hands out paths, arms through gate.js, reviews once with
//     /code-review, closes through close.js, and runs attended or unattended.
const pull = read('commands/pull.md');
assert.ok(words(pull) < 1900, `pull.md is ${words(pull)} words — was 8961`);
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

if (failures.length) {
  for (const m of failures) console.log(`FAIL ${m.split(/\r?\n/)[0]}`);
  console.log(`briefs.test.js: ${failures.length} failed`);
  process.exit(1);
}
console.log('briefs.test.js: all checks passed');
