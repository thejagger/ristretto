# ristretto

Lean feature implementation for Claude Code. A restricted shot: less ceremony, more concentration.

A small set of commands following the lifecycle **review → plan → build**, plus `tamp` to keep the built code lean. The two core ones split the way you actually work — plan a stack of features in one sitting, implement them later as the code shifts underneath:

- **`/ristretto:grind <feature>`** — honest refinement review: plain-language summary, story-point estimate, the problems it actually has, and a Ready / Not-Ready verdict. Read-only.
- **`/ristretto:prep <features | ideas> [deep]`** — turns features *or* raw ideas into plans and adds them to the project roadmap. Each plan carries a deep, durable **`## Contract`** (checkable acceptance criteria, `Provides:` / `Consumes:` at type level, resolved decisions, the units of work) and a one-screen **`## Approach`**. Splits an input into sub-features only when there's a real seam (independent deliverables, separate "done", or too big for one sprint) — otherwise keeps it whole. Features that belong together get a shared `Flight` slug, and a real prerequisite is recorded as `Depends:` so ordering is explicit. Fast by default; **escalates into roast mode** — one question at a time, each with a recommended answer, checkpointed to the plan file after every answer — the moment a criterion can't be made checkable or `Provides:` can't be filled. `deep` forces it. Planning only, no code.
- **`/ristretto:pull <feature | next>`** — implements one feature against the *current* code, in auto mode, then closes it by archiving the plan and updating the roadmap. A **planner** subagent first expands the Contract into a throwaway build plan against HEAD — real paths, real signatures, real test code — so the implementer transcribes rather than re-plans. Tests come first (the build plan's cases become failing tests, then code to green), and before any commit the diff passes an **independent review** by a fresh subagent — bugs must be fixed, two rounds max.
- **`/ristretto:brew`** — brew the whole pot: autonomously pulls every eligible planned feature in sequence — same gates, evidence, review, and close as `pull`, one commit per feature on a single `feature/brew-<date>` session branch. **Each feature runs through fresh subagents** — planner, implementer, independent reviewer, closer: the main conversation stays a small orchestrator no matter how big the batch, every implementation sees exactly one spec, and nothing is committed unreviewed. A planner that can't satisfy the Contract blocks the feature before an implementer ever runs. Anything needing a **decision** gets status `blocked` with a one-line reason instead of a guess; anything needing a **human to run something** gets `needs-human`, a line in `manual-checks.md`, and still gets built; anything still carrying review findings after three rounds gets `needs-review` — committed green, findings recorded verbatim, never deleted. None of the three stalls the features behind it. You walk through `status blocked`, `status checks` and `status review` afterward, refine or run or judge, and re-brew. It never stops to ask you anything: `planned` means every decision was already made in `prep`, so a question at 3am is a prep bug, not a pause. Tests are scoped to each feature during the loop and the full suite is proven once at the end, so a slow suite doesn't make a batch impossible. For when you've prepped a batch and don't want to babysit the roadmap.
- **`/ristretto:status [filter]`** — read-only view of the roadmap: what's planned, in progress, and done. Changes nothing. Bare, where the layout docks a side pane (the desktop app, the fullscreen terminal), it opens the roadmap as a **live pane** instead of printing it: a summary with progress, the running feature's phase, review round and gate as they happen, what needs you (blocked rows say why), what's next grouped by flight with a `start` per row (`shot` for an easy row, `pull` otherwise) and `brew all`; a row whose `Depends:` is not built says what it waits on and has no start. Any row opens (▸) to a card: its acceptance criteria, what it depends on, its blockers (with `refine`), its open findings (with `judge`) or its manual checks; a done row adds each criterion's proof, the review and gate lines, the commit, and what its run took — time, cost, tokens, gate time. The Done list is newest first with a gate-time trend. Only runs the pane saw are measured, per machine, in Claude Code's own store — older rows show `—`; nothing is written to the repo. The pane also opens by itself in any repo with a roadmap. With a filter, or without mods, it prints the roadmap as text.
- **`/ristretto:help`** — the menu: every command, the workflow, and the house rules as a CLI-style card. Read-only, instant.
- **`/ristretto:tamp [path | feature | nothing]`** — honest lean-code review: finds runtime waste, duplication, dead/over-built code, and readability drag in a diff or file, ranked and capped at the few that matter. Read-only; pass `fix` to apply the top findings. The code-analogue of `grind`.
- **`/ristretto:shot <feature>`** — the easy path against a plan `prep` already wrote: builds it fast, in auto mode, with no planner subagent — the contract itself has to already carry the file paths and signatures. No plan yet, or any status but `planned` → stop and point at `prep`. Can't finish on the spot → escalates to `/ristretto:pull <feature>`, never silently, and never rewrites the roadmap `Tier` cell.

## Why the plan splits in two

Most plan workflows bake exact file edits and literal code into the plan. That's fine if you execute immediately — but if you batch-plan ten features and implement them over days, the early plans rot, because the code moved out from under them.

The usual fix is to keep plans thin. That trades one problem for another: a one-screen plan omits the things that *don't* rot, and thin contracts are the single largest cause of inaccurate implementation. Drift kills turn-by-turn directions — exact paths, line numbers, literal code. It never touches an acceptance criterion, an interface signature, or a decision.

So ristretto puts depth in both places, at the moment each one is true:

- **`## Contract` — durable, written by `prep`, as deep as the feature deserves.** Checkable acceptance criteria, `Provides:` (the public surface this feature exposes, at type level), `Consumes:` (what it calls from its `Depends:`), the decisions that were resolved, and the units of work inside it. Still zero code, so still drift-free — a signature is a contract, it names what exists, never how it works.
- **`## Approach` — the part that rots, so it stays to one screen.** Strategy and likely touchpoints, for orientation only.
- **The build plan — generated at pull time, then thrown away.** `pull` and `brew` dispatch a **planner** subagent that reads the Contract, takes each dependency's `Provides:` as fact, reads the code as it exists right now, and writes `.ristretto/build/<FEATURE-ID>.md`: real file paths, real names and signatures, real test code in this repo's style. The implementer transcribes it instead of re-planning. It lives in `.ristretto/` (gitignored) and is deleted at close — it cannot rot because it doesn't live long enough to, and it's reproducible from (plan + HEAD) anyway.

A planner that can't satisfy the Contract against the current code returns `blocked` and **no implementer ever runs** — the cheapest place for a bad spec to fail. Same drift-resistance as before, none of the thinness.

`prep` stays fast by default so you can batch-plan ten ideas in one sitting. It escalates into **roast mode** — one question at a time, each with a recommended answer, written to the plan file after every answer — exactly when it can't write a checkable criterion or can't fill `Provides:`. Force it with `/ristretto:prep <feature> deep`.

## The roadmap solves drift

State lives in files, not the conversation — clearing the chat never loses it.

- `roadmap.md` is the fast-read index; `pull` boots from it instead of re-scanning the repo.
- **`Provides:` / `Consumes:` close type drift across a Flight** — when B depends on A, B's `Consumes:` must be a subset of A's `Provides:`; `prep` checks it, and at close `pull` corrects `Provides:` in the archived plan to whatever was actually built, because that's what the next feature's planner reads as fact.
- **Flight grouping + `Depends:` give honest ordering without a scheduler** — `/ristretto:pull next` skips any feature still waiting on an unfinished prerequisite, so you can't pull work whose foundation isn't built yet. A prerequisite counts as finished when it's `done`, `needs-human`, **or** `needs-review`; only `blocked` holds dependents back. ristretto stays one-feature-at-a-time; the graph is recorded, not run as parallel waves.
- **Closing is `pull`'s job, every time** — it archives the plan and flips the roadmap row automatically. You never close by hand, so "forgot to close" can't happen.
- The roadmap is trusted as written. Keeping it honest is yours — but since closing is automatic, it stays honest with almost no effort, and it doubles as a plain-language view of what's done and what's next.

## Deterministic gates, not vibes

`pull` and `shot` don't self-report "tests pass" — the plugin ships hooks that enforce it:

- On the first pull in a repo, a `.ristretto.json` is created at the root with the repo's own `format` / `lint` / `typecheck` / `test` / `testChanged` commands (stack auto-detected; existing tooling adopted, never replaced). Commit it.
- While a pull is active (marker file `.ristretto/pulling`), a **Stop hook** (and a **SubagentStop hook**, so each of brew's per-feature subagents is gated individually) runs lint + typecheck + test and blocks the agent (exit 2) until they're green. Red gate = not done — the agent can't rationalize past it, and it's instructed never to weaken or delete gates or tests to get there. After 3 forced retries it surfaces the failure to you instead of looping.
- **A hang is caught by silence, not by a stopwatch — and a hang is not a red gate.** A suite that never returns used to take the whole session with it: `execSync` had no timeout at all, so the hook was eventually killed with nothing to report, and the next stop hit the same wall. The obvious fix — cap total runtime — is the wrong one, because it can't tell a wedged suite from a slow one and murders the slow one at an arbitrary number. So the gate watches the *output stream* instead: a gate that has printed nothing for its `silence` budget is hung and gets killed (along with its whole process group, so forked workers don't survive holding the port that caused it); a gate that keeps printing is working and is left alone however long it takes. A hard duration cap still exists as `timeouts`, but it's **off by default**. A hang is reported as *unverified* — neither failed nor green — and **surfaced immediately rather than retried**, since retrying a hang only hangs again.

  Defaults are per gate, in seconds: `lint` and `typecheck` get 600 because tools like `eslint .` and `tsc --noEmit` legitimately print nothing until they finish, so their silence carries no information; test runners stream progress, so 300 of silence from one is a much stronger signal. Budgets then calibrate themselves from what each gate is measured to do — including from a kill, when the gate printed *nothing at all*, which is the signature of buffering rather than of hanging. That case doubles the rope and tries again, up to a cap. Without it the calibration had a hole exactly where it was needed most: only a green run counted as evidence, and a buffering tool is killed before it can ever produce one, so it was killed identically forever. One stack escaped that by having `PYTHONUNBUFFERED=1` set for it; the rest now get there by measurement, which is the whole point of not keeping a table of runners.
- **A red gate can say whose fault it is.** A gate that produces one bit cannot tell a regression from a flaky test, a database that restarted, or a runner that found no tests to run — so it called all of them "your work is not done" and sent the agent hunting a defect that was not in its diff. Point `testReport` at the machine-readable report your test command writes and the gate compares results instead: failures already there are tolerated and counted, and only *new* ones block. That is what lets ristretto work in a repo whose suite is not fully green, which previously locked it out of the repository entirely. **The tolerated set only ever shrinks** — a fixed test leaves it for good, no unattended run may add to it, and the escape hatch for "this test is now wrong" stays a human decision. JUnit XML and Dart/Flutter's JSON reporter are both read, and the plugin carries no table of runner flags: setup works out how *your* project emits results, proves it parses, and only then writes it down.
- **The gates and the agent waiting on them spend one budget, not two.** An agent that goes silent for about ten minutes is killed by its own harness, and a killed agent doesn't report a failure — it reports *nothing*, losing everything it did. The queue wait and the gate run both come out of that same window, so the lock wait is capped at what's left of it after the last measured run rather than at a number chosen on its own, and a pass that eats more than half of it says so with numbers while there is still someone alive to read the message. **The `silence` budget is bounded the same way, and for a while it wasn't** — which is the more expensive half, because it is the budget a slow repo is invited to raise. A gate allowed to stay quiet for longer than the agent waiting on it gets that agent killed first, and the result is not a red gate but a green one nobody receives: the log says the suite passed while the orchestrator is told the subagent stalled. Both roads there are now capped — a `silence` somebody typed, and the self-calibration that can widen on its own — and a budget that came from the config and is being ignored says so by name rather than sitting there inviting the next increase. The whole-repo `verify` run is exempt, because nothing is waiting on it. Tell it the truth about your environment with `watchdog` if ten minutes isn't right.
- **The pre-flight and the hook must run the same toolchain, and now they can prove it.** The hooks run in their own environment and don't inherit a PATH you exported in your shell — so a pre-flight run with a workaround SDK prepended proves a green tree the hook will never reproduce, and the hook's red looks like a repo problem rather than two installs of the same tool. `verify` prints and records which binary each gate resolved to; when a hook resolves a different one it names the mismatch instead of surfacing a mystery failure on an untouched tree. The fix is still to not let them differ: put the intended path *inside* `.ristretto.json` rather than around the command.
- A **PostToolUse hook** formats each touched file as the agent writes — a convenience that never blocks, but does report. "Never block" was once implemented as "never say anything", and a `format` command that failed on *every single edit* produced no evidence at all: the work simply went unformatted for months. A failing formatter is now named once — and again if the failure changes or returns after a run that worked — without ever blocking the agent. Paths substituted into a gate are repo-relative throughout (`{file}`, `{files}`, and `formatPaths` all agree), so a command can't quietly compose itself into a path that doesn't exist.
- Outside a pull, the hooks exit immediately: no nagging in casual sessions, and repos without a `.ristretto.json` are never touched.
- **Your house rules bind, and the review enforces them**: `CLAUDE.md` / `AGENTS.md` is read when detecting gate commands, when planning, and when implementing — a rule written there holds even where the surrounding code doesn't demonstrate it yet — and a documented rule the diff violates is a `block` finding in the review gate, not a style nit. ristretto only ever *reads* those files; it never writes to them, because a hand-curated memory file that an agent appends to stops being worth reading — and while a run is armed that is enforced by a hook rather than asked for in a brief, since prose held right up until one subagent read it differently. Staleness a reviewer notices is reported to you, never fixed behind your back. Anything you want mechanically enforced belongs in a lint rule, where the existing gate already catches it.
- **One gate run at a time, repo-wide.** Two suites sharing a database, a port, or a fixture produce failures that belong to neither run — a red that is pure artifact and indistinguishable from a real one. A run that can't get the lock reports *unverified* and never blocks: a collision must not look like a defect. In `brew`, the orchestrator is exempt from its own Stop gate (it writes no source, and its turns end while subagents are mid-edit); the subagents are gated individually, one at a time.
- **The formatter stays where it belongs.** `gates.formatPaths` scopes the format hook to the paths your formatter is canonical for. Unscoped, it reflows documentation nobody asked it to touch, and because every attempted fix re-triggers it, that churn can eat whole review rounds before anyone realises the gate is what keeps changing the file.
- **Tests come first, red first**: acceptance criteria are transcribed into tests *before* implementation, and the failing run is the proof the tests test something. A test that passes before any code is written proves nothing.
- **And the suite is a shared cost, which is a thing no actor used to own.** Every test written for one feature is paid again by every later feature at every stop, and nobody was ever asked to weigh that — so contracts grew, each individually defensible, until a primary-school website carried 704 tests and a seventeen-minute gate. Measured: 11 acceptance criteria became 31 tests that each booted a web server, and two features added 2.6 minutes of gate apiece. The rules that follow from it are all about waste, never about testing less: one test per criterion unless the criterion has genuinely independent cases; prove it at the cheapest level that is still honest, a pure function over a component over an HTTP request over a browser; **cite an existing test rather than writing a second one** — a criterion already enforced repo-wide earns zero, and saying so is a complete proof; and **a ruling in `Decisions:` is never an assertion.** That last one is the sharpest: roast mode exists to settle questions, and a decision copied up into `Acceptance:` becomes the user's own design choice pinned by a test — proving nothing a user can see, and freezing the choice so it cannot be revisited without a red test to argue with. The reviewer's `lean` bucket names test waste now too, which is the one direction it never looked.
- **And a test earns its place by what a red run would mean.** The rule above catches a ruling copied into `Acceptance:`; it does not catch a ticket's own acceptance list, which is mostly design detail — nine columns in this order, twenty rows a page, the filter label above the table, the link frozen to the right edge. Those are checkable, and a user can see every one of them, so they sail through as criteria and become assertions that can only ever go red when someone deliberately adds a column or moves a label. Measured on one real ticket: thirteen such tests, of which nine were later deleted by hand and four merged; what survived was the data found by label, the request the paging control sends, the status variants, and the link's href. So the question is now what red would mean. If the only answer is *someone changed the design on purpose*, it is a change detector — it binds the code and is checked by reading, exactly like a ruling, and `prep` writes it into `Decisions:` rather than `Acceptance:`. Sorting that actually works stays behaviour and keeps its test; which column sorts by default is a ruling. The same goes for anything that can only be false until the diff lands — a migration that ran, a fixture asserted against another fixture — where the diff is the proof and a permanent test is a tautology.
- **A test belongs to the code that can break, not to every screen that shows it.** The change-detector rule emptied the column-order tests out of the next features, and the suite kept growing anyway, now with copies: one ticket wrote the same fourteen save-and-lock tests into three sibling detail screens, and four list screens each carried their own copy of the client-switch reload with its own 160–330-line spec, two of them identical but for twelve lines. The copies in the specs came from copies in the code, and those came from a prep decision — "the screens stay separate siblings" — that never separated a shared *component* from shared *logic*. So `prep` now rules on where repeated logic lives before it orders a test: one function or service both screens call is the default, the criterion cites the existing proof, and the new screen earns one wiring test plus tests for what it does differently.
- **And test waste is removed before the commit instead of being written down.** The reviewer had been catching exactly these duplicates — "the same fail path tested six times across three suites" — and filing them as `lean`, which never costs a round, so every one of them shipped into `## Open findings` and stayed. The reviewer now tags removable test waste `test`, and only when the fix is a deletion or a merge into a test it names. Before the commit, a **trim pass** applies exactly those findings on the already-green tree and runs `prove`; no review round follows, because deleting a test it names as duplicated changes no product code. The closer records the count as `trimmed`, so the suite shrinking is measured as well as the suite growing.
- **An independent review gates every commit**: after the gates are green, a fresh subagent that never saw the implementation reasoning judges the diff into three buckets — `block` (the shipped product misbehaves: a criterion genuinely unmet, data loss, a security hole, a documented house rule violated, a reachable unhandled edge case), `note` (the product is right but the proof is weaker than it claims: a vacuously passing test, a docblock overstating what it proves), and `lean` (tamp's facets). **Only a `block` costs a round.** Notes and leans are fixed for free when a round is already happening and otherwise recorded in the archived plan, because a finding that cannot harm a user should not cost an hour. Every note must say in one clause why no user can be harmed by it — which is what stops a real bug being quietly downgraded. Two rounds in `pull` and `shot`, then it surfaces instead of looping; round 2 is a confirmation pass over the blocks and anything the fixer broke while mending, never skipped — a fix is code no reviewer has seen, and fixing one thing is exactly when you break another. `brew` gets a third: blocks still open after round 2 go to a **fresh implementer on a model one tier up**, given the plan, the findings, and which criterion has now failed twice — not the failed attempts. Still open after that closes `needs-review` with the findings copied in verbatim: the gates are green and the work is kept. Trivial diffs (a few lines, no new logic) skip the review.
- **A feature carries a tier**: `normal` (the default — plan, build, review, close) or `easy`, which **skips the planner and nothing else**. `easy` is a claim about the *contract*, not the ticket: it means the contract is already concrete enough that a planner would add nothing to it, so the label is checkable by reading the contract rather than guessing at the work. `prep` sets it and must give a one-clause reason for `easy`; `normal` needs none. **The ratchet is one-way** — any agent that reads the code may escalate `easy` → `normal` (the contract doesn't survive contact with the code, it needs a migration, a criterion is `[human]`), and nothing may ever lower a tier. A wrong `easy` costs one implementer stopping before it writes code; a right one saves the planner. `/ristretto:brew easy` forces every feature through the easy path and records what *would* have escalated without acting on it — an experiment lane, labelled `tier: easy (forced)` on the record forever. Gates and review run identically at every tier: tiering changes ceremony, never proof.
- Closing a feature also records **Evidence** in the archived plan: how each acceptance criterion was proven — red→green test names, output, measurements — plus the gate summary and the review verdict. "Implemented successfully" is not evidence.

## Versioning: the project records the format it was written for

The commands read and write a real on-disk format — statuses, Contract fields, checklist line shapes. That format changes between releases, and a project prepped under an older one isn't broken so much as *misread*: a status this version doesn't recognise gets interpreted as something else, silently, and the first sign is a wrong decision much further down.

So `roadmap.md` carries `<!-- ristretto-format: 0.13 -->`, and every command begins by comparing it against the plugin — `node scripts/version.js check`, a fact established in code rather than eyeballed. Behind means the command brings the project up to date first — announcing itself before it touches anything, then carrying on with what you actually asked for. There is no migrate command to remember; you should never have to know your project has a format. Ahead means your *install* is stale, and it refuses to migrate rather than rewrite your files into an older shape. The format version is the plugin's MAJOR.MINOR, so a patch release never triggers a migration. Check it with `node scripts/version.js check` and `node scripts/version.test.js`.

The gate runner is plain Node (`scripts/gate.js`) — no bash, no jq — so it works the same on Windows, macOS, and Linux. It fingerprints a green working tree and skips re-running gates while the tree is unchanged, so review/close subagents don't pay a full test run at every stop. Check it with `node scripts/gate.test.js`.

## Fast loop, honest end

On a repo whose suite takes ten minutes, gating every subagent stop on the full suite doesn't make a batch slow — it makes it impossible. So the test gate has two speeds:

- **During the loop: `gates.testChanged`** — only the tests affected by what this feature touched. `{files}` is substituted with every modified *and untracked* path: `vitest related --run {files}`, `jest --findRelatedTests {files}`, `pytest {files}`. Prefer that over a runner's own change detection (`vitest --changed`, `jest -o`) — those read git's diff, which excludes untracked files, and a brand-new test file is exactly what red-first produces. Lint and typecheck stay repo-wide; they're cheap next to a suite, and a scoped typecheck is a contradiction in terms.
- **Once at the end: `node scripts/gate.js verify`** — lint + typecheck + the *whole* suite, ignoring both the scoped shortcut and the green-tree cache. `brew` runs it twice: as pre-flight (a red tree is the cheapest possible failure, and it's caught before a single subagent is dispatched) and after the last feature closes.

That trade is explicit: scoped runs can't see cross-feature breakage, so the end-of-batch run is where it shows up. When it goes red, `brew` reports it loudly and first — and does **not** amend or revert the commits. Nothing was pushed, the branch is yours to review, and a fast batch with one honest red beats a batch too slow to finish. What isn't acceptable is a quiet one.

On a repo with more than one stack, `testChanged` takes a **list of routes** rather than one command — `backend/**/*.py` to pytest, `frontend/**/*.{ts,tsx}` to vitest, `docs/**` to nothing. Each route sees only its own files and a route with nothing to do never starts, so a frontend-only feature doesn't pay for the backend suite. Anything matching no route falls back to the full suite and says so, because an unrecognised path might be the one that breaks everything.

If `testChanged` is empty, the loop just runs the full suite as before — nothing changes for repos where that's already fast, and that's the right setting until a suite is slow enough to hurt.

## Manual checks: criteria no agent can prove

Some criteria can't be proven by anything the agent can run. Applying a migration, setting a secret, enabling an API in someone's console — and just as often, *looking at the thing*: does the dropdown open, does the layout hold at 375px, does the German copy read right. A plan that needed one used to collapse into `blocked`, which is the wrong word. `blocked` means *the spec is broken, go refine it*. "Run this migration" and "check this screen" are not spec gaps; the spec is fine and a person has to do something. Same status, opposite remedy — so they're two statuses:

- **`blocked`** — a missing decision. `/ristretto:status blocked` is the refinement queue; fix it with `prep`. **The only status that holds dependents back.**
- **`needs-human`** — something the repo gave the agent no path to. `/ristretto:status checks` is the do-it-yourself queue; fix it with your hands.
- **`needs-review`** — built, committed, gated green, and a reviewer still objects after three rounds. `/ristretto:status review` is the judgement queue; fix it with your opinion.

The rule that makes this work is upstream, in `prep`: **every acceptance criterion carries a proof method, `[auto]` or `[human]`, and unclassified is not an option.** That is the whole fix. An unclassified criterion is what used to stop an unattended run dead — the loop reached something no test could settle, had no state for it, and waited on an answer from someone asleep. Classifying costs one word. And the criterion is never *dropped* for being unautomatable: dropping it loses the migration you needed to run and the screen you needed to look at, which is worse than any stall, because the plan quietly stops describing the feature.

`prep` declares suspected checks in the Contract's `Manual-Checks:`, but **the planner settles them against HEAD** — it is the first actor that has read the code, so it deletes the ones this repo can reach and adds the ones it genuinely cannot. A prep line saying "apply the migration by hand" against a repo whose compose file migrates on boot is simply wrong, and the planner drops it. What survives lands in `docs/ristretto/manual-checks.md` as a ticked-by-you checklist item, naming both the criterion it proves and what was out of reach:

```markdown
## BREW-224 — user tiers
- [ ] **proves** · criterion 2 · hosted Supabase project — no service-role key in this
      environment, so the agent cannot apply this itself · add the column the code reads
      ```sql
      alter table profiles add column tier text not null default 'free';
      ```
      _criterion:_ "a free user sees the upgrade banner" · _test:_ `tier banner renders` (skipped)
```

One entry, because one is a realistic number. The same feature's "does the banner overlap the nav at 375px" is *not* here — the repo can drive a browser, so that is a test.

**The feature still gets built.** The code is written, gated, reviewed, and committed exactly as always; only the tests that need the live environment are written *skipped*, each naming the check that unblocks it. `needs-human` is a **closing** status, not a blocking one — the plan is archived, the commit is made, and the row records which criteria are `pending human check` instead of proven.

The part that matters for an unattended `brew`: **`needs-human` never holds up another feature.** A `Depends:` is satisfied by `done` *or* `needs-human`, because the prerequisite's `Provides:` exist in the code either way — what's outstanding is in a database console or on a screen, not in the repo. Only `blocked` stops dependents. One pending `alter table` can't stall a whole flight.

Run the check, tick the box, and `/ristretto:pull <ID>` (or the next `brew`) un-skips those tests, proves the pending criteria, and flips the row to `done`. ristretto never ticks a box itself; that check is your signature that it really happened.

**The bar for getting on this list is reach, not subject.** A check exists only where the repo gives the agent no path to the thing — a hosted console with no credential in the environment, a device that isn't there. A migration the dev stack already applies is run, not delegated; a screen the repo can drive is tested, not eyeballed. And **nothing on this list is ever about production**: no backfills, no prod flags, no key rotations. This is a development loop, and a checklist that fills up with things you could have automated is one you stop reading — including the entry that mattered.

## `needs-review`: the pot never stops

Review runs in rounds — findings, a fixer, a fresh reviewer to check the fix. Three rounds, and then something has to happen. `brew` used to `git restore` the work and mark the row `blocked`.

That was wrong twice over. The gates are **green** at that moment: the tests pass, the code works, and what's outstanding is an advisory opinion from an actor that runs no gates and changes no files — so deleting a working tree over it is disproportionate. And `blocked` is the one status that holds dependents back, so a single unresolved finding didn't cost one feature, it cost that feature and every feature behind it in the flight. One objection at feature 4 could empty a pot of 15, and the final line still read `pot empty`, which looks like a clean finish.

Every subagent that ever met that rule declined it. One ignored the findings and carried on; one took an unsanctioned fourth round; one invented a `.ristretto/stranded/` directory to park work the command gave it nowhere to keep. Three improvisations, one diagnosis: **the loop had no resting state for "built, green, still argued about."** They were right, so now it has one.

Round 3 commits. The status is `needs-review`, the open findings are copied **verbatim** into the archived plan under `## Open findings` — not summarised, not resolved — and the loop moves to the next feature. Like `needs-human`, it satisfies `Depends:`, so the features behind it keep brewing; unlike `blocked`, nothing about it is a spec problem. `/ristretto:status review` is the queue, `/ristretto:pull <ID>` works it, and the worst case overnight is a longer morning queue rather than a half-empty pot.

**And where the findings turn on a question the contract never answered, `brew` takes the recommended reading rather than stalling** — then says so, loudly: `decision taken: <question> → <ruling>` in the Evidence, on the result line as it happens, and first in the review queue with a `⚠`. It's the one place in ristretto the loop may settle a question the spec left open, it is never allowed to be quiet about it, and it stays fixable for as long as it takes you to disagree. A stall costs the whole night; a flagged default costs a minute in the morning.

## Git: branch & commit, never push

`pull`, `shot`, and `brew` handle git for you, with one firm boundary — **they never push.**

- `pull` and `shot` work on a `feature/<FEATURE-ID>` branch (created from a clean tree, or your current feature branch is reused); `brew` puts the whole session on one `feature/brew-<date>` branch, one commit per feature, so you review the batch linearly.
- At close they stage only the files touched and commit `feat(<FEATURE-ID>): …`, then write the real hash into the roadmap row.
- Committing locally is reversible; pushing is the one team-visible, irreversible step — so that stays with you. They never push, set an upstream, force, amend, reset, or open a PR.
- Pass `nocommit` to skip the commit and leave the changes in your working tree: `/ristretto:pull BREW-224 nocommit`.

## Flavor

The coffee metaphor carries real signal, not just decoration — and nothing animated sits in the work path, so there's no latency cost:

- `grind` signs off with a **tasting note** that mirrors the verdict (Ready → "clean extraction"; Not Ready → "under-extracted").
- `status` leads with a **brew gauge** — `☕ [█████░░░░░] 5/10 brewed` — and shows a full **milestone cup** when the roadmap clears.
- `tamp` closes with a **tasting note** mirroring its verdict — `clean shot` (nothing channeling) or `channeling` (real waste found).
- `pull` and `shot` end with a little cup when a feature lands, and the milestone cup when it was the last one.
- `brew` prints a `☕ <ID> brewed (n/m)` line per feature, and closes with the milestone cup when the roadmap clears — invoked with nothing to brew, it just prints the classic cup and a barista quip (the original easter egg lives on).

## Layout it generates (per project)

```
.ristretto.json         # gate commands + hang budgets for this repo (committed)
.ristretto/             # transient pull state — marker, lock, retry counter, green cache,
                        #   measured silence/run budgets, resolved toolchain (gitignored)
  build/
    BREW-224.md         # throwaway build plan, written at pull time, deleted at close
docs/ristretto/
  roadmap.md            # always-current index of every feature
  manual-checks.md      # the SQL, migrations & secrets only you can run — tick a box when done
  plans/
    BREW-224.md         # active plans — durable ## Contract + one-screen ## Approach
    archived/
      BREW-202.md       # closed → moved here, with Evidence and a corrected Provides:
```

## Install (local, no GitHub needed)

```
/plugin marketplace add /path/to/ristretto
/plugin install ristretto@ristretto-dev
```

To share with the team, push this folder to a Git repo and `/plugin marketplace add <user>/<repo>` instead.

## Usage

```
/ristretto:grind BREW-224                     # honest review before committing to it
/ristretto:prep BREW-224 BREW-210 ROAST-150  # plan a batch of features
/ristretto:prep add rate-limiting to login   # plan a raw idea (→ login-rate-limit plan)
/ristretto:prep BREW-224 deep                 # force roast mode — one question at a time
/ristretto:pull BREW-224                      # implement one (branch + commit)
/ristretto:pull BREW-224 nocommit             # implement, but leave the commit to you
/ristretto:pull next                          # implement the top planned feature
/ristretto:brew                              # brew every eligible feature, unattended
/ristretto:status                             # see the whole roadmap
/ristretto:status open                        # only what's not done yet
/ristretto:status blocked                     # the refinement queue after a brew
/ristretto:status checks                         # the do-it-yourself queue: SQL, migrations
/ristretto:status review                      # the judgement queue: open review findings
/ristretto:shot ROAST-150 rename the menu item # plan + do a trivial one in one pass
/ristretto:tamp                               # review the changes I just made
/ristretto:tamp src/auth                      # green-up pass on existing code
/ristretto:tamp BREW-224 fix                  # review a feature's diff and apply the top fixes
/ristretto:help                              # the menu — commands, workflow, house rules
```

Runs entirely in auto mode — no plan-mode switching.
