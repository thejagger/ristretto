---
description: Print the ristretto menu — every command, the workflow, and the house rules. Read-only, instant, changes nothing.
---

You are running **HELP**. Do **no** work — no file reads, no git, no roadmap, no tools. Just print the menu below verbatim (it is the complete output), then stop.

```
☕ ristretto — spec-driven features, lean extraction
═══════════════════════════════════════════════════

THE WORKFLOW
  1. /ristretto:grind <feature>     honest refinement review — story points,
                                    problems, Ready / Not-Ready. read-only.
  2. /ristretto:prep <features>     batch-plan into a durable ## Contract
     …or /ristretto:prep <f> deep   (checkable criteria, Provides/Consumes,
                                    decisions, units) + a one-screen ## Approach.
                                    fast by default; escalates into roast mode
                                    when a criterion can't be made checkable.
                                    "deep" forces the roast.
  3. /ristretto:brew [easy]         brew the whole pot: implements every
                                    eligible feature unattended, one gated
                                    commit each, on feature/brew-<date>.
                                    planner → implementer → reviewer → closer,
                                    each a fresh subagent — the main context
                                    stays lean, batches scale.
                                    ambiguity → status "blocked", never a guess.
                                    scoped tests during the loop, full suite once
                                    at the end.
     …or /ristretto:pull <ID|next>  pull exactly one feature, human between shots.
        [nocommit]                  its tier comes from the roadmap row.
  4. /ristretto:status blocked      your refinement queue after a brew —
                                    each row names its spec gap. refine via
                                    prep (flips it back to planned), re-brew.
     /ristretto:status checks          your do-it-yourself queue — the SQL, migrations
                                    and secrets ristretto had no path to. tick the
                                    box in docs/ristretto/manual-checks.md, re-brew.
     /ristretto:status review          your judgement queue — built, committed and
                                    green, but a reviewer still objects. read the
                                    open findings, then /ristretto:pull <ID>.

THE REST OF THE MENU
  /ristretto:shot <feature>         the easy path against a plan prep already
                                    wrote — builds it fast, no planner. no
                                    plan yet → prep first; can't finish on
                                    the spot → escalates to pull.
  /ristretto:status [filter]        roadmap view. bare: the live side pane
                                    where it docks; a filter prints text.
                                    filters: open | done | blocked | checks | ID | flight
  /ristretto:tamp [target] [fix]    lean-code review of a diff/file: waste,
                                    duplication, over-build. "fix" applies.
  /ristretto:help                   this menu.

HOUSE RULES
  • specs first — nothing is built that isn't planned with checkable criteria.
  • the roadmap records the format it was written for. a project older
    than the plugin is brought up to date automatically, and says so —
    a renamed status read as something else is a silent wrong answer.
  • planned means DECIDED — brew never stops to ask. every ruling is made in
    prep (roast mode roasts them out), so a question at 3am is a prep bug.
    brew goes as far as it possibly can, every time.
  • your house rules bind — CLAUDE.md / AGENTS.md is read when planning and
    implementing, and a rule the diff violates is a "block" finding in review.
    ristretto reads it; it never writes to it.
  • the plan splits in two — the ## Contract is durable and deep; the
    directions are generated against HEAD at pull time into
    .ristretto/build/<ID>.md and deleted at close. neither can rot.
  • tests first — the build plan's test cases become failing tests before any
    implementation. red proves the test tests something; then code to green.
    one test per criterion, at the cheapest level that still proves it; a
    criterion an existing test already covers is cited, not re-tested. red has
    to mean a user is worse off: an assertion only a deliberate design change
    could turn red — a column order, a label, a style, a ruling — detects a
    change, not a defect, and binds the code by being read instead. a test
    belongs to the code that can break: shared logic is proven once where it
    lives, and a sibling screen gets one wiring test, not a renamed copy. the
    suite is charged to every later feature at every stop.
  • test waste is removed, not recorded — the reviewer tags it "test", and a
    trim pass deletes or merges exactly what it names before the commit, on a
    green tree, with no extra review round. the closer counts it "trimmed".
  • deterministic gates — while implementing, a Stop hook runs your repo's
    lint + typecheck + test (.ristretto.json) and blocks until green.
    enforced, not self-reported. evidence is recorded, not claimed.
    a gate that stops PRINTING is hung and gets killed; a slow one that keeps
    printing is left to finish. hangs are surfaced, never retried.
    one gate run at a time, repo-wide — two suites sharing a database invent
    failures that belong to neither. brew's orchestrator isn't gated on its
    own stops; its subagents are, one at a time.
  • fast loop, honest end — the loop tests only what the feature touched
    (gates.testChanged); the full suite runs once at the end and its verdict
    goes in the report. red there is loud, never quiet.
  • every criterion is [auto] or [human] — never unclassified. [human] means
    ONE thing: this repo gave the agent no path to it. a migration the dev
    stack applies is run; a screen the repo can drive is tested. only what
    survives that — a console with no credential, a device that isn't here —
    becomes a line in docs/ristretto/manual-checks.md. never production.
  • three closing queues, three remedies. a missing DECISION blocks (go refine
    it) and is the ONLY status that holds dependents back. something genuinely
    OUT OF REACH closes "needs-human" (go run it). review findings still open
    after 3 rounds close "needs-review" (go judge it) — built, committed,
    gated green, never deleted. dependent features brew on through all three;
    nothing stalls a flight behind one alter table or one open opinion.
  • brew never stops the pot — 15 features means 15 attempted. where it must
    settle a question the contract left open it takes the recommended reading
    and says so loudly, rather than costing you the night.
  • tiers — a feature is "normal" (plan, build, review, close) or "easy",
    which skips the planner only. easy is a claim about the contract being
    concrete, not about the ticket being small. any agent may escalate
    easy → normal; nothing ever lowers a tier. "brew easy" forces every
    feature easy and records what would have escalated — an experiment,
    labelled forever. gates and review never change with the tier.
  • independent review — before any commit, a fresh subagent that never saw
    the implementation judges the diff into block / note / lean. only a
    block (the product actually misbehaves) costs a round; notes and leans
    ride along a round already happening, else they go in the plan. 2
    rounds (brew gets a 3rd on a stronger model), then it surfaces instead
    of looping. trivial diffs skip. round 2 confirms the blocks and what
    the fixer broke — never nothing. a fix is code no one reviewed yet.
  • skip, never guess — undecidable → blocked with the spec gap named.
  • git: feature branches, one commit per feature, NEVER pushes. reviewing
    and pushing is yours.
  • state lives in files (docs/ristretto/) — clearing the chat loses nothing.

full docs: README.md in the plugin repo.
```
