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
