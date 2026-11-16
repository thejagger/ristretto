# Decisions

This file is read by people, not by any ristretto dispatch — no command or brief
references it, and none should. It exists so the reasoning behind a rule survives after
the rule itself moved into code or shrank to a phrase nobody unpacks anymore. Each entry:
what happened, the rule it produced, where that rule lives now.

## The 16.8-minute silent gate

A commit titled "speed up gates" added `--no-progress` to this repo's own test command.
Hang detection reads a gate's output to tell a live suite from a wedged one; the flag
deleted that signal, so a suite that was working the whole time looked identical to a
hang for its entire 16.8-minute run. Three subagents were killed waiting on it, each with
its work already finished and proven green.

**Rule produced:** never give a `test` / `testChanged` command a flag that silences the
runner — `-q`, `--no-progress`, `--quiet`, a dots-only or summary-only reporter.

**Where it lives now:** `gate.js verify` detects a silencing flag on a `test` /
`testChanged` command itself (Task 5's audits) — it is no longer text anyone has to
remember to write or to read.

## The 289-second gate

An implementer verifying its own work typed `pytest -q` instead of copying the repo's
configured `pytest -q -n auto` — the same suite, but on one core instead of all of them.
What was a 289-second gate when run as configured took forty minutes of a subagent
sitting still when hand-rolled, and it proved something slightly different from what the
Stop hook was about to check.

**Rule produced:** verify by running the gate commands exactly as `.ristretto.json`
spells them — copy the string, substitute nothing, invent nothing.

**Where it lives now:** `gate.js prove` (Task 5) runs the exact configured command
itself, so there is no longer a hand-rolled command for an implementer to get wrong.
`briefs/implementer.md`'s "Finish with prove" section is where the implementer is told
to call it, in place of the old copy-it-yourself instruction.

## The 2.6-minute suite growth

Measured on a real feature: 11 acceptance criteria became 31 tests, each booting a web
server, and the suite went from 641 tests to 704 across two features — about
+2.6 minutes of gate, permanently, per feature. Nothing in that came from a criterion
nobody had thought of; it came from proving the same criterion three times.

**Rule produced:** one test per criterion is the default; prove it at the cheapest level
that is still honest; reuse an existing test before writing a new one; a decision is
never a test.

**Where it lives now:** `briefs/common.md`'s Tests section.

## The abandoned wait

Reaching for a wait-for-completion tool — `Monitor`, any other notification helper, or
the sentence "I'll wait for it and continue when it lands" — reads like a plan and
executes as a death: the turn ends, the subagent is killed for going silent, and the run
it started finishes for nobody. Three subagents in one batch died exactly this way, each
having politely announced it would wait; that batch lost about an hour to re-running one
of them from a half-finished tree and to killing two more that woke later and collided
with their own replacements.

**Rule produced:** never end a turn with a run still in flight — poll it with your own
checks from the turn you are already in, or run it in the foreground with a generous
timeout.

**Where it lives now:** `briefs/implementer.md`'s prove step, the background-and-poll
conditional ("start it in the background and poll it from this turn until it ends —
never end a turn with it running").

Source: `commands/brew.md:138`.

## Three improvisations on `git restore`

The old rule for a block still open after round 3 was `git restore` on every touched
file. Every subagent that ever actually met that rule declined it: one ignored the
findings and carried on, one took a disallowed fourth round, one invented
`.ristretto/stranded/` to park work the command gave it nowhere else to keep. Three
improvisations, one diagnosis — and they were right: the gates were green, the code
worked, and what remained open was an advisory opinion from an actor that runs no gates
and changes no files. Deleting a green tree over that was disproportionate.

**Rule produced:** still open after round 3 → commit it as `needs-review`, with the open
findings copied verbatim into the archived plan; never `git restore`. `needs-review`
still satisfies `Depends:`, so the features behind it keep brewing.

**Where it lives now:** `briefs/closer.md`'s status rules (the `needs-review` status and
its verbatim-open-findings requirement) and `commands/brew.md`'s verdict step ("Still
open after round 3 → commit it as `needs-review`. Never `git restore`.").

Source: `commands/brew.md:175`.

## The nine deleted table tests

A ticket whose acceptance list described a table — nine columns in this order, twenty rows
a page, the filter label in its own row above it, a header prefix per column, the link
frozen to the right edge, no sort control — produced a test per line. Every one passed,
none could ever catch a defect, and adding a tenth column would turn four of them red.
Reviewed afterwards by hand, thirteen tests came out as nine deletions and four merges;
what survived was the data (values found by label), the request the paging control sends,
the status variants, and the link's href. What died was order, position, styling, static
labels, a fixture asserted against another fixture, and a one-time migration check.

The rule already in place — *a `Decisions:` ruling is never an assertion* — did not catch
any of it, because these lines were not rulings smuggled into `Acceptance:`. They were
ordinary acceptance criteria, checkable, and visible to a user, which is what the old test
("who can see it") asked. A user can see the column order. That is why the question had to
change.

**Rule produced:** ask what a red run would mean before writing the test. If the only
answer is *someone changed the design on purpose*, it is a change detector, not a test —
it binds the code and is checked by reading, like a ruling. Find a value by its label or
key, never by its position; leave a shared component's rendering to that component's own
tests; and anything that can only be false until the diff lands (a migration that ran, a
fixture matching a fixture) is proven by the diff, not by a permanent test.

**Where it lives now:** `briefs/common.md`'s Tests section, `commands/prep.md`'s criterion
rules (where such a line is written into `Decisions:` instead of `Acceptance:`), and the
reviewer's `lean` bucket.

## The copies that came after

Two weeks after the change-detector rule, the column-order tests were gone and the suite was
growing anyway. In one repo, one ticket wrote the same fourteen save-and-lock tests into three
sibling detail screens, and four list screens each carried their own copy of the client-switch
reload with its own 160–330-line spec — two of them identical but for twelve lines. The spec
copies came from code copies: every list component had its own `reloadOnClientSwitch` effect.
And the code copies came from prep, whose contract said "the two screens stay separate
siblings" and "same guarantees as DGS-162, re-asserted on this screen" — never separating a
shared component from shared logic.

The reviewer had seen it. DGS-151's review filed "the same fail path tested six times across
three suites" as a `lean`, and a `lean` never costs a round, so it went into `## Open findings`
and shipped with the rest.

**Rules produced:** test code where it lives, once — shared code in its own test, one wiring
test per consumer, and prep rules on where repeated logic lives before it orders a test (one
function both screens call is the default; re-point only the sibling being copied). And test
waste is removed rather than recorded: the reviewer tags it `test` only when the fix is a
deletion or a merge into a test it names, and a trim pass applies those on the green tree
before the commit, with no review round after it. The closer records `trimmed: <t>`.

**Where they live now:** `briefs/common.md` (test code where it lives), `commands/prep.md`
(the sibling decision), `briefs/reviewer.md` (the tag), `briefs/implementer.md` (the trim
pass), the three flows (routing tagged findings to it), `briefs/closer.md` (the count).

**Replayed against ui-angs before landing:** a prep replay of DGS-163 under the new rules lifted
the client-switch and failed-load logic into one shared helper, cited the sibling's existing
tests, and ordered one component spec with five new tests where the original had four spec
files. A reviewer replay of DGS-151 tagged four findings `test`, covering 22 test blocks, each
naming the test that still proves the case, and left the one fix that needs new test code
untagged. A trim pass on a cheap model, given only those four findings, applied all of them:
22 test blocks removed or merged and 278 spec lines deleted. The user specs went from 95 tests to 71, and
`prove` passed on the full suite with only the four failures the repo baseline already tolerated.

## The 87 KB build plan and the five-hour threshold

One unattended brew of a new repo (five features, 2026-11-10/11) showed two costs that every
feature paid.

**The planner was a second implementer.** Its build plans ran 41, 72 and 87 KB, about three
quarters of each inside code fences, implementation included; one planner compiled a spike to
check a library. Planning took 24-40 minutes of each 49-63 minute pull, the implementer then
needed 13-19 minutes to transcribe it, and the plans were too large for the pull session to
implement itself. The brief had asked for it: exact signatures, test code, no placeholders.

**A criterion was doing three jobs** - spec, test order and done-definition. Criteria averaged 37
words and 2.3 sentences; fifteen of them became 39 tests and 1,061 test lines beside 1,178 lines
of source. A limit written before any data existed ("at most 10 % loud") met 23.6 % and held the
flight for five hours, and was then moved to 30 %. A range ("1-3 versions, unless merged") passed
while every real case returned one. The ruling-versus-criterion rule was already in prep, as
about 1,400 words of prose, and every plan still carried arrangement and copy as criteria.

**The wording, not rules:** the first version answered each incident with a rule - one sentence,
at most five, a number names its source, fail on the empty answer, no spikes, a 150-line cap.
The same day they were replaced by one paragraph that says what an acceptance line is and what it
costs: it is what the user gets, said so that it could turn out false; every line becomes tests
that run for the life of the repo; how it is built is a decision; what only a real run can tell
is measured and reported, never promised in advance. A `[measure]` is run and recorded, asserts
nothing and never blocks; one that comes back empty or the same for every case is the first
finding. The build plan is a one-page map - paths, signatures, test names - with no code.

**Where they live now:** `commands/prep.md` step 2, `briefs/planner.md`, `briefs/common.md`
(Tests), `briefs/implementer.md`, `commands/pull.md` step 11. No format change: `[auto]` and
`[human]` plans stay valid, and no script reads `[measure]`.

**The builder that knew every feature.** The same brew fed every pull of a repo to one
long-lived session, which built each feature in its own context; after a handful of features it sat at
47 % of its window, carrying every earlier feature's code and review into the next. brew now
starts one session per open feature in the turn it is started - a woken brewer cannot start one -
and sends each its pull when its turn comes. Not yet run: whether the app starts that many
sessions in one turn shows on the first brew.

**Not replayed before landing.** The first prep and the first pull under these rules are the
test: count criteria per feature, build-plan size, and planner minutes against the numbers above.

**The orchestrator's goal, restored.** The goal the brewer was written from (2026-10-23) said: solve
questions and blockages, if something is blocked unblock it, and afterwards write down which
decisions you made and what the problem was. Three parts of it had never reached `commands/brew.md`:
a pull that came back blocked on a question went straight to the user (the 10 % line above), the
brewer was told to read roadmaps and plans and nothing else, and its report listed decisions but
not problems. brew now says a block is the brewer's to solve first - fix the thing or rule on the
question, an acceptance line that reality contradicts included, and send the same pull again -
that it may learn its folder and look at what a pull left, at the price of its own context, and
that the report names each problem and how it was solved. pull honours it: a `decided:` line on a
criterion replaces that criterion for the planner, the build and Evidence, and the close records
it as `taken:`. Said as purpose and cost, no cases. Not yet run in a real brew.

**Builders are subagents, not sessions (2026-11-16).** The first brew under the session model
opened seven sessions up front, and they sat idle, waiting for their pull; the owner talks only to
the main chat and found them unmanageable. They existed only because a woken session cannot start
another one. Now the brewer starts a fresh builder subagent when a feature's turn comes, and the
builder's return, the pull's one line, wakes it; a builder still knows one feature. The cost: a
builder shares the brewer's session id, so `pull` arms it with `gate.js arm builder`, under which
Stop (the brewer's own turn) is not gated and SubagentStop and the hand-back are; a plain `arm`
takes that back, so a pull that is a session's main agent gates as before. At a folder of repos the
hooks watch only the folder, so a builder's stops there are not gated at all; it runs every command
in its repo, and `verify` and `prove` with no `.ristretto.json` now fail instead of passing, so
running them from the wrong folder cannot read as green. Run for real: one subagent ran
`/ristretto:pull` end to end in a scratch repo (planner, `/code-review high`, fixer, close, commit),
with the hooks silent because the session's folder was elsewhere, as at a folder of repos. Then
one headless `/ristretto:brew` of two dependent features in that repo: the brewer put it on
`feature/brew-<date>`, started a builder in the background, ended its turn, was woken by the
builder's line, started the second with two `decided:` rulings, and reported; both built,
committed, green. The builders armed with `arm builder`, and their planner and review subagents
were gated. Not shown by it: no brewer turn ended while a builder was armed (each ended in the ten
seconds before its builder armed), so the Stop exemption is proven by `gate.test.js` alone; nor was
a folder of repos brewed. Not run: the desktop app's board, which at a folder of repos shows no
feature at work now that no session at work writes its repo's record.
