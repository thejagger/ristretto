# ristretto

Lean feature implementation for Claude Code. A restricted shot: less ceremony, more concentration.

A small set of commands following the lifecycle **review → plan → build**, plus `tamp` to keep the built code lean. The two core ones split the way you actually work — plan a stack of features in one sitting, implement them later as the code shifts underneath:

- **`/ristretto:grind <feature>`** — honest refinement review: researches the feature (what the repo already knows, what the code does, sourced facts it is missing), then a plain-language summary, story-point estimate, the problems it actually has, and a Ready / Not-Ready verdict. Read-only.
- **`/ristretto:prep <features | ideas | refactors>`** — the part you are there for. It looks first — the repo, earlier plans, the ticket, the web — and opens with an **overview**: what exists, each open point with its options scored (price, links, best practice where they matter) and a recommendation. You steer from there; it makes what fits the work — an artifact for UI, a parts list for hardware, approaches side by side for architecture. It asks only where answers lead to materially different work, and leaves routine calls to the builder. When the points are settled it writes a short plan — goal, why, acceptance, the decisions you made with their sources — and ends with **"build it now?"**: yes starts the build in the background, no leaves it for the next brew. No implementation code.
- **`/ristretto:pull <feature | next> [unattended]`** — the one way a feature gets built: against the *current* code, in auto mode, closed by `scripts/close.js` and one `feat(<ID>)` commit. A **planner** subagent first maps the Contract onto HEAD in a throwaway one-page build plan — real paths, real signatures, test names, no code — and the implementer writes the code and the tests. Tests come first, the full suite is proven, then **one `/code-review`** of the diff (`high`; `medium` on the easy path): you pick what gets fixed, each fix proven by a test that goes red first. `unattended` is how the brewer sends it: it never asks, fixes only confirmed bugs, records the rest, and parks a blocked feature's work in a named stash. When it's committed it offers to write the MR description.
- **`/ristretto:brew`** — the **brewer**: it keeps the overview so you don't have to. It reads the roadmaps of this folder and its direct subfolders, works out the order (dependencies first, across repos too), and when a feature's turn comes it starts a **fresh builder subagent** for it, so a builder knows its one feature and nothing of the last. The builder runs `/ristretto:pull <ID> unattended` on a `feature/brew-<date>` branch (or the branch you are on), and its return, the pull's one line, wakes the brewer; one feature at a time per repo, repos in parallel. You talk only to the brewer's chat. It never builds, but it knows its folder: it learns how the project runs, decides what a plan left open and sends the ruling with the pull, and a pull that comes back blocked is its to solve first — it fixes the thing (a stack that is down, a stale image) or rules on the question, an acceptance line that reality contradicts included, and sends the same pull again with a new builder. A ruling lands in the plan as `taken:`, where you can overrule it; a feature stays `blocked` only when a person is needed. While it runs it shows one small progress block — the last two done, what is building, the next two — and nothing else. At the end it reports per feature what was built, how to test it, what was decided for you and what is open, then the problems it met, questions for the product owner, and the finishing options.
- **`/ristretto:status [filter]`** — read-only view of the roadmap: what's planned, in progress, and done. Changes nothing. Bare, where the layout docks a side pane (the desktop app, the fullscreen terminal), it opens the roadmap as a **live board** instead of printing it, drawn in Claude's own side-pane language: hairline cards whose titles fold them, one line per feature. **Branch** comes first: the branch you're on, its features by state, what still holds it from shipping (checks to tick, findings to judge, a red full suite) and, underneath, whether the last full `verify` proved this code (`suite green`, or `suite unproven`) and when it last brewed; nothing holding it and the suite green reads `ready to ship`. Then **Needs you** (blocked rows say who they wait on), **Up next** (what brew takes next, then the queue), **Done** (each row with where its time went — plan / code / review / close, its own proportions, never compared). While a run is active, **Brewing** leads: the feature at work with its running time, the effort bar across its phases, which role works on which model for how long, the rest of this brew, and its tally. A row presses anywhere on its line and opens the feature's page — goal, acceptance with each criterion's proof once done, what it depends on, blockers, findings or manual checks, its files as a folder tree, the review and gate lines and the commit (no dollars: on a subscription a per-token price says nothing). The board has no action buttons: each page says what to run in the chat (`/ristretto:pull <ID>` to judge, `/ristretto:prep <ID>` to settle a block). Only runs the board saw are measured, per machine, in Claude Code's own store; nothing is written to the repo. The pane opens only when asked: a band above the prompt keeps the main thing in view — what runs and its step on a small effort bar, or how many features are open, and how many need you — with **board / hide board** for the pane. With a filter, or without mods, it prints the roadmap as text.
- **`/ristretto:help`** — the menu: every command, the workflow, and the house rules as a CLI-style card. Read-only, instant.
- **`/ristretto:tamp [path | feature | nothing]`** — honest lean-code review: finds runtime waste, duplication, dead/over-built code, and readability drag in a diff or file, ranked and capped at the few that matter. Read-only; pass `fix` to apply the top findings. The code-analogue of `grind`.
- **`/ristretto:shot <feature>`** — the easy path against a plan `prep` already wrote: builds it fast, in auto mode, with no planner subagent — the contract itself has to already carry the file paths and signatures. No plan yet, or any status but `planned` → stop and point at `prep`. Can't finish on the spot → escalates to `/ristretto:pull <feature>`, never silently, and never rewrites the roadmap `Tier` cell.

## A short plan, a fresh build plan

Plans that bake in file edits and literal code rot when you batch-plan and build days later. Drift never touches an acceptance criterion, a signature, or a decision — so that is all a ristretto plan holds:

- **The plan — written by `prep`, from the conversation.** Goal, why, acceptance criteria said so that they could turn out false, the decisions you made (each with its source), `Depends:`, and `Provides:` at type level when another feature depends on it. No paths, no code. What was never discussed is the builder's to decide, recorded as `taken:` for you to overrule.
- **The build plan — generated at pull time, then thrown away.** `pull` dispatches a **planner** subagent that reads the plan, takes each dependency's `Provides:` as fact, reads the code as it is right now, and writes `.ristretto/build/<FEATURE-ID>.md`: real file paths, real names and signatures, the name and level of each test. It lives in `.ristretto/` (gitignored) and is deleted at close.

A planner that can't satisfy the plan against the current code returns `blocked` and **no implementer ever runs** — the cheapest place for a bad spec to fail.

## The roadmap solves drift

State lives in files, not the conversation — clearing the chat never loses it.

- `roadmap.md` is the fast-read index; `pull` boots from it instead of re-scanning the repo.
- **`Provides:` closes type drift across a Flight** — when B depends on A, `prep` checks that A's `Provides:` covers what B needs, and at close `pull` corrects `Provides:` in the plan to whatever was actually built, because that's what the next feature's planner reads as fact.
- **Flight grouping + `Depends:` give honest ordering without a scheduler** — `/ristretto:pull next` skips any feature still waiting on an unfinished prerequisite, so you can't pull work whose foundation isn't built yet. A prerequisite counts as finished when it's `done`, even while a box in its plan still waits on you; `blocked` holds dependents back. ristretto stays one-feature-at-a-time; the graph is recorded, not run as parallel waves.
- **Closing is `pull`'s job, every time** — it archives the plan and flips the roadmap row automatically. You never close by hand, so "forgot to close" can't happen.
- The roadmap is trusted as written. Keeping it honest is yours — but since closing is automatic, it stays honest with almost no effort, and it doubles as a plain-language view of what's done and what's next.

## Facts live where they are used

`prep` and `grind` research in the open, in the conversation — no hidden research file, no domain store. A fact a decision rests on is written on that decision with its source. A fact that should bind every feature belongs in the repo's `CLAUDE.md` or docs, written by you; ristretto only reads those. **The why comes from a person**: a stated one is copied, a missing one gets proposals, never a pick. Git is the channel: everything is a file you commit. A Jira or Notion page is read when the session has a connector for it; nothing depends on one.

## Deterministic gates, not vibes

`pull` and `shot` don't self-report "tests pass" — the plugin ships hooks that enforce it:

- On the first pull in a repo, a `.ristretto.json` is created at the root with the repo's own `format` / `lint` / `typecheck` / `test` / `testChanged` commands (stack auto-detected; existing tooling adopted, never replaced). Commit it.
- While a pull is active (marker file `.ristretto/pulling`), a **Stop hook** (and a **SubagentStop hook** plus a hook on the subagent's **hand-back**, so each of brew's per-feature subagents is gated individually: a subagent that finishes by handing back ends its turn on a tool result, where Claude Code discards a stop block, so the hand-back itself is refused until green) runs lint + typecheck + test and blocks the agent (exit 2) until they're green. Red gate = not done — the agent can't rationalize past it, and it's instructed never to weaken or delete gates or tests to get there. After 3 forced retries it surfaces the failure to you instead of looping.
- **A hang is caught by silence, not by a stopwatch — and a hang is not a red gate.** A suite that never returns used to take the whole session with it: `execSync` had no timeout at all, so the hook was eventually killed with nothing to report, and the next stop hit the same wall. The obvious fix — cap total runtime — is the wrong one, because it can't tell a wedged suite from a slow one and murders the slow one at an arbitrary number. So the gate watches the *output stream* instead: a gate that has printed nothing for its `silence` budget is hung and gets killed (along with its whole process group, so forked workers don't survive holding the port that caused it); a gate that keeps printing is working and is left alone however long it takes. A hard duration cap still exists as `timeouts`, but it's **off by default**. A hang is reported as *unverified* — neither failed nor green — and **surfaced immediately rather than retried**, since retrying a hang only hangs again.

  Defaults are per gate, in seconds: `lint` and `typecheck` get 600 because tools like `eslint .` and `tsc --noEmit` legitimately print nothing until they finish, so their silence carries no information; test runners stream progress, so 300 of silence from one is a much stronger signal. Budgets then calibrate themselves from what each gate is measured to do — including from a kill, when the gate printed *nothing at all*, which is the signature of buffering rather than of hanging. That case doubles the rope and tries again, up to a cap. Without it the calibration had a hole exactly where it was needed most: only a green run counted as evidence, and a buffering tool is killed before it can ever produce one, so it was killed identically forever. One stack escaped that by having `PYTHONUNBUFFERED=1` set for it; the rest now get there by measurement, which is the whole point of not keeping a table of runners.
- **A red gate can say whose fault it is.** A gate that produces one bit cannot tell a regression from a flaky test, a database that restarted, or a runner that found no tests to run — so it called all of them "your work is not done" and sent the agent hunting a defect that was not in its diff. Point `testReport` at the machine-readable report your test command writes and the gate compares results instead: failures already there are tolerated and counted, and only *new* ones block. That is what lets ristretto work in a repo whose suite is not fully green, which previously locked it out of the repository entirely. **The tolerated set only ever shrinks** — a fixed test leaves it for good, no unattended run may add to it, and the escape hatch for "this test is now wrong" stays a human decision. JUnit XML and Dart/Flutter's JSON reporter are both read, and the plugin carries no table of runner flags: setup works out how *your* project emits results, proves it parses, and only then writes it down.
- **The gates and the agent waiting on them spend one budget, not two.** An agent that goes silent for about ten minutes is killed by its own harness, and a killed agent doesn't report a failure — it reports *nothing*, losing everything it did. The queue wait and the gate run both come out of that same window, so the lock wait is capped at what's left of it after the last measured run rather than at a number chosen on its own, and a pass that eats more than half of it says so with numbers while there is still someone alive to read the message. **The `silence` budget is bounded the same way, and for a while it wasn't** — which is the more expensive half, because it is the budget a slow repo is invited to raise. A gate allowed to stay quiet for longer than the agent waiting on it gets that agent killed first, and the result is not a red gate but a green one nobody receives: the log says the suite passed while the orchestrator is told the subagent stalled. Both roads there are now capped — a `silence` somebody typed, and the self-calibration that can widen on its own — and a budget that came from the config and is being ignored says so by name rather than sitting there inviting the next increase. The whole-repo `verify` run is exempt, because nothing is waiting on it. Tell it the truth about your environment with `watchdog` if ten minutes isn't right.
- A **PostToolUse hook** formats each touched file as the agent writes — a convenience that never blocks, but does report. "Never block" was once implemented as "never say anything", and a `format` command that failed on *every single edit* produced no evidence at all: the work simply went unformatted for months. A failing formatter is now named once — and again if the failure changes or returns after a run that worked — without ever blocking the agent. Paths substituted into a gate are repo-relative throughout (`{file}`, `{files}`, and `formatPaths` all agree), so a command can't quietly compose itself into a path that doesn't exist.
- Outside a pull, the hooks exit immediately: no nagging in casual sessions, and repos without a `.ristretto.json` are never touched.
- **Your house rules bind, and the review enforces them**: `CLAUDE.md` / `AGENTS.md` is read when detecting gate commands, when planning, and when implementing — a rule written there holds even where the surrounding code doesn't demonstrate it yet — and a documented rule the diff violates is a `block` finding in the review gate, not a style nit. ristretto only ever *reads* those files; it never writes to them, because a hand-curated memory file that an agent appends to stops being worth reading — and while a run is armed that is enforced by a hook rather than asked for in a brief, since prose held right up until one subagent read it differently. Staleness a reviewer notices is reported to you, never fixed behind your back. Anything you want mechanically enforced belongs in a lint rule, where the existing gate already catches it.
- **One gate run at a time, repo-wide.** Two suites sharing a database, a port, or a fixture produce failures that belong to neither run — a red that is pure artifact and indistinguishable from a real one. A run that can't get the lock reports *unverified* and never blocks: a collision must not look like a defect. In `brew`, a builder subagent shares the brewer's session, so it arms with `gate.js arm builder`: the brewer's own Stop is not gated (it writes no source, and its turns end while a builder is mid-edit), while the builder's stops and hand-backs are. At a folder of repos the hooks watch only that folder, so a builder's stops there are not gated at all; the pull's own `gate.js verify`, run in the repo, is the proof.
- **The formatter stays where it belongs.** `gates.formatPaths` scopes the format hook to the paths your formatter is canonical for. Unscoped, it reflows documentation nobody asked it to touch, and because every attempted fix re-triggers it, that churn can eat whole review rounds before anyone realises the gate is what keeps changing the file.
- **Tests come first, red first**: acceptance criteria are transcribed into tests *before* implementation, and the failing run is the proof the tests test something. A test that passes before any code is written proves nothing.
- **And the suite is a shared cost, which is a thing no actor used to own.** Every test written for one feature is paid again by every later feature at every stop, and nobody was ever asked to weigh that — so contracts grew, each individually defensible, until a primary-school website carried 704 tests and a seventeen-minute gate. Measured: 11 acceptance criteria became 31 tests that each booted a web server, and two features added 2.6 minutes of gate apiece. The rules that follow from it are all about waste, never about testing less: one test per criterion unless the criterion has genuinely independent cases; prove it at the cheapest level that is still honest, a pure function over a component over an HTTP request over a browser; **cite an existing test rather than writing a second one** — a criterion already enforced repo-wide earns zero, and saying so is a complete proof; and **a ruling in `Decisions:` is never an assertion.** That last one is the sharpest: roast mode exists to settle questions, and a decision copied up into `Acceptance:` becomes the user's own design choice pinned by a test — proving nothing a user can see, and freezing the choice so it cannot be revisited without a red test to argue with. The reviewer's `lean` bucket names test waste now too, which is the one direction it never looked.
- **And a test earns its place by what a red run would mean.** The rule above catches a ruling copied into `Acceptance:`; it does not catch a ticket's own acceptance list, which is mostly design detail — nine columns in this order, twenty rows a page, the filter label above the table, the link frozen to the right edge. Those are checkable, and a user can see every one of them, so they sail through as criteria and become assertions that can only ever go red when someone deliberately adds a column or moves a label. Measured on one real ticket: thirteen such tests, of which nine were later deleted by hand and four merged; what survived was the data found by label, the request the paging control sends, the status variants, and the link's href. So the question is now what red would mean. If the only answer is *someone changed the design on purpose*, it is a change detector — it binds the code and is checked by reading, exactly like a ruling, and `prep` writes it into `Decisions:` rather than `Acceptance:`. Sorting that actually works stays behaviour and keeps its test; which column sorts by default is a ruling. The same goes for anything that can only be false until the diff lands — a migration that ran, a fixture asserted against another fixture — where the diff is the proof and a permanent test is a tautology.
- **A test belongs to the code that can break, not to every screen that shows it.** The change-detector rule emptied the column-order tests out of the next features, and the suite kept growing anyway, now with copies: one ticket wrote the same fourteen save-and-lock tests into three sibling detail screens, and four list screens each carried their own copy of the client-switch reload with its own 160–330-line spec, two of them identical but for twelve lines. The copies in the specs came from copies in the code, and those came from a prep decision — "the screens stay separate siblings" — that never separated a shared *component* from shared *logic*. So `prep` now rules on where repeated logic lives before it orders a test: one function or service both screens call is the default, the criterion cites the existing proof, and the new screen earns one wiring test plus tests for what it does differently.
- **One review, by Claude Code's own `/code-review`, gates every commit**: after the gates are green, pull runs it once on the repo's path — `high` for a normal feature, `medium` on the easy path. In a pull you sit in on, you pick which findings get fixed and why you skip the rest; unattended, only the findings it labels as confirmed bugs are fixed. Each fix is proven by a test that goes red first and then green, and the gates run again — no second review, no rounds. What isn't fixed is copied verbatim into the plan under `## Open findings`. Trivial diffs (a few lines, no new logic) skip the review.
- **A feature carries a tier**: `normal` (the default — plan, build, review, close) or `easy`, which **skips the planner and nothing else**. `easy` is a claim about the *contract*, not the ticket: it means the contract is already concrete enough that a planner would add nothing to it, so the label is checkable by reading the contract rather than guessing at the work. `prep` sets it and must give a one-clause reason for `easy`; `normal` needs none. **The ratchet is one-way** — any agent that reads the code may escalate `easy` → `normal` (the contract doesn't survive contact with the code, it needs a migration, a criterion is `[human]`), and nothing may ever lower a tier. A wrong `easy` costs one implementer stopping before it writes code; a right one saves the planner.
- Closing a feature also records **Evidence** in its plan, by criterion number: how each acceptance criterion was proven — red→green test names, output, measurements — plus the gate summary and the review verdict. "Implemented successfully" is not evidence.

## Versioning: the project records the format it was written for

The commands read and write a real on-disk format — statuses, plan fields, checklist line shapes. That format changes between releases, and a project prepped under an older one isn't broken so much as *misread*: a status this version doesn't recognise gets interpreted as something else, silently, and the first sign is a wrong decision much further down.

So `roadmap.md` carries `<!-- ristretto-format: 0.23 -->`, and it is compared against the plugin once when a session starts, by a hook, and again inside `gate.js state` for a builder — a fact established in code rather than eyeballed. No command runs the check itself. Behind means the command runs `node scripts/migrate.js apply` first — one deterministic rewrite of `docs/ristretto/`, committed as `docs(ristretto): migrate to format 0.23` — says so, then carries on with what you actually asked for. You should never have to know your project has a format. Ahead means your *install* is stale, and it refuses to migrate rather than rewrite your files into an older shape. Re-running the migration on a current project changes nothing. Check it with `node scripts/migrate.test.js`.

0.23 adds one thing: a `Depends:` on a sibling repo's feature is written `<folder>/<id>` (`api/api-order-title`), and the migration turns prep's older `(cross-repo: after …)` notes into that form.

0.22 is **one fact, one place**: the roadmap holds order and status (`Flight | Feature | Title | Tier | Status`) and nothing else, because git already holds the dates, the files and the commit (`feat(<ID>): …`). Everything else about a feature lives in `docs/ristretto/plans/<ID>.md`, which never moves.

The gate runner is plain Node (`scripts/gate.js`) — no bash, no jq — so it works the same on Windows, macOS, and Linux. It fingerprints a green working tree and skips re-running gates while the tree is unchanged, so review/close subagents don't pay a full test run at every stop. Check it with `node scripts/gate.test.js`.

## Fast loop, honest end

On a repo whose suite takes ten minutes, gating every subagent stop on the full suite doesn't make a batch slow — it makes it impossible. So the test gate has two speeds:

- **During the loop: `gates.testChanged`** — only the tests affected by what this feature touched. `{files}` is substituted with every modified *and untracked* path — except untracked files already there when the run armed, which are yours and stay out of every gate: `vitest related --run {files}`, `jest --findRelatedTests {files}`, `pytest {files}`. Prefer that over a runner's own change detection (`vitest --changed`, `jest -o`) — those read git's diff, which excludes untracked files, and a brand-new test file is exactly what red-first produces. Lint and typecheck stay repo-wide; they're cheap next to a suite, and a scoped typecheck is a contradiction in terms.
- **Once at the end: `node scripts/gate.js verify`** — lint + typecheck + the *whole* suite, ignoring both the scoped shortcut and the green-tree cache. `brew` runs it twice: as pre-flight (a red tree is the cheapest possible failure, and it's caught before a single subagent is dispatched) and after the last feature closes.

That trade is explicit: scoped runs can't see cross-feature breakage, so the end-of-batch run is where it shows up. When it goes red, `brew` reports it loudly and first — and does **not** amend or revert the commits. Nothing was pushed, the branch is yours to review, and a fast batch with one honest red beats a batch too slow to finish. What isn't acceptable is a quiet one.

On a repo with more than one stack, `testChanged` takes a **list of routes** rather than one command — `backend/**/*.py` to pytest, `frontend/**/*.{ts,tsx}` to vitest, `docs/**` to nothing. Each route sees only its own files and a route with nothing to do never starts, so a frontend-only feature doesn't pay for the backend suite. Anything matching no route falls back to the full suite and says so, because an unrecognised path might be the one that breaks everything.

If `testChanged` is empty, the loop just runs the full suite as before — nothing changes for repos where that's already fast, and that's the right setting until a suite is slow enough to hurt.

## Manual checks: criteria no agent can prove

Some criteria can't be proven by anything the agent can run. Applying a migration, setting a secret, enabling an API in someone's console — and just as often, *looking at the thing*: does the dropdown open, does the layout hold at 375px, does the German copy read right. A plan that needed one used to collapse into `blocked`, which is the wrong word. `blocked` means *the spec is broken, go refine it*. "Run this migration" and "check this screen" are not spec gaps; the spec is fine and a person has to do something. So a manual check is not a status at all:

- **`blocked`** — the feature cannot proceed. `/ristretto:status blocked` is the refinement queue; fix it with `prep`. **The only status that holds dependents back.**
- **An open box in a `done` feature's plan** — a manual check the repo gave the agent no path to, or review findings nobody fixed. `/ristretto:status checks` is your queue; say "manual checks done" in the chat.

The rule is upstream, in `prep`: acceptance is what the user gets, said so that it could turn out false, and a criterion is `[human]` only when this repo gives ristretto no path to its subject. How the thing is built is a ruling in `Decisions:`; what only a real run can tell is measured and recorded, never asserted. A criterion is never *dropped* for being hard to automate — the plan would quietly stop describing the feature.

`prep` marks suspected checks as `[human]` criteria, but **the planner settles them against HEAD** — it is the first actor that has read the code, so it turns the ones this repo can reach into `[auto]` and adds the ones it genuinely cannot. A prep line saying "apply the migration by hand" against a repo whose compose file migrates on boot is simply wrong, and the planner drops it. What survives is the criterion itself, as an open box in the plan with what was out of reach and what to do:

```markdown
- Acceptance:
  - a paying user sees no upgrade banner
  - [ ] [human] a free user sees the upgrade banner
    how: hosted Supabase project — no service-role key in this environment ·
      run `alter table profiles add column tier text not null default 'free';`
```

One entry, because one is a realistic number. The same feature's "does the banner overlap the nav at 375px" is *not* here — the repo can drive a browser, so that is a test.

**The feature still gets built.** The code is written, gated, reviewed, and committed exactly as always; only the tests that need the live environment are written *skipped*, each naming the check that unblocks it. The feature closes `done` — the commit is made, and its Evidence records which criteria are `pending human` instead of proven.

The part that matters for an unattended `brew`: **an open box never holds up another feature.** A `Depends:` is satisfied by `done`, because the prerequisite's `Provides:` exist in the code — what's outstanding is in a database console or on a screen, not in the repo. Only `blocked` stops dependents. One pending `alter table` can't stall a whole flight.

Run the check, then say "manual checks done" in the chat, with the feature's ID if more than one has open checks. Your word is the signature that it really happened: ristretto ticks the boxes, writes `confirmed in chat <date>` into the Evidence, and commits the plan. You never edit a file. Say "except the banner one — still overlaps" and that box stays open with your note. Nothing else ticks a box, not even another agent.

**The bar for getting on this list is reach, not subject.** A check exists only where the repo gives the agent no path to the thing — a hosted console with no credential in the environment, a device that isn't there. A migration the dev stack already applies is run, not delegated; a screen the repo can drive is tested, not eyeballed. And **nothing on this list is ever about production**: no backfills, no prod flags, no key rotations. This is a development loop, and a checklist that fills up with things you could have automated is one you stop reading — including the entry that mattered.

## Open findings: the pot never stops

A finding nobody fixed is not a reason to stop. The gates are **green** at that point: the tests pass and the code works, and what's outstanding is an opinion. So the feature closes `done`, the findings go **verbatim** into its plan under `## Open findings`, and it still satisfies `Depends:`, so the features behind it keep brewing. `/ristretto:status checks` lists it; say what to fix in chat.

**And where a build meets a question the plan never answered, it takes the reading the plan's goal implies rather than stalling** — then says so: when a user could see the answer, a `- taken: <question> → <ruling>` line under the plan's `Decisions:`, listed in the run's report. It is information, not a question — already in force, no box to tick. Leave it and it stands; disagree and say so in chat, `/ristretto:prep overrule <ID> — <what instead>`, and prep plans the change as a follow-up. Naming, file placement, internal structure and test mechanics never reach you: they are build-plan detail. A stall costs the whole night; a default you can overrule costs nothing until you want it changed.

## Git: branch & commit, never push

`pull`, `shot`, and `brew` handle git for you, with one firm boundary — **they never push.**

- `pull` and `shot` work on a `feature/<FEATURE-ID>` branch (created from a clean tree, or your current feature branch is reused). The brewer puts each repo on one `feature/brew-<date>` branch, or keeps the branch you are on, one commit per feature, so you review the batch linearly.
- At close they stage only the files touched and commit `feat(<FEATURE-ID>): …`, then write the real hash into the roadmap row.
- Committing locally is reversible; pushing is the one team-visible, irreversible step — so that stays with you. They never push, set an upstream, force, amend, reset, or open a PR.
- Pass `nocommit` to skip the commit and leave the changes in your working tree: `/ristretto:pull BREW-224 nocommit`.

## Flavor

The coffee metaphor carries real signal, not just decoration — and nothing animated sits in the work path, so there's no latency cost:

- `grind` signs off with a **tasting note** that mirrors the verdict (Ready → "clean extraction"; Not Ready → "under-extracted").
- `status` leads with a **brew gauge** — `☕ [█████░░░░░] 5/10 brewed` — and shows a full **milestone cup** when the roadmap clears.
- `tamp` closes with a **tasting note** mirroring its verdict — `clean shot` (nothing channeling) or `channeling` (real waste found).
- `pull` and `shot` end with a little cup when a feature lands, and the milestone cup when it was the last one.
- `brew` reports per repo when the pot is empty, and the milestone cup comes with the pull that cleared the roadmap.

## Layout it generates (per project)

```
.ristretto.json         # gate commands + hang budgets for this repo (committed)
.ristretto/             # transient pull state — marker, lock, retry counter, green cache,
                        #   measured silence/run budgets (gitignored)
  build/
    BREW-224.md         # throwaway build plan, written at pull time, deleted at close
docs/ristretto/
  roadmap.md            # order and status of every feature, nothing else
  plans/
    BREW-224.md         # every fact about a feature: goal, why, acceptance (its boxes too),
                        #   decisions, and once built ## Evidence — the file never moves
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
/ristretto:pull BREW-224                      # implement one (branch + commit)
/ristretto:pull BREW-224 nocommit             # implement, but leave the commit to you
/ristretto:pull next                          # implement the top planned feature
/ristretto:brew                               # the brewer: a builder subagent per feature, pulls unattended
/ristretto:status                             # see the whole roadmap
/ristretto:status open                        # only what's not done yet
/ristretto:status blocked                     # the refinement queue after a brew
/ristretto:status checks                      # your turn: open checks and findings
/ristretto:shot ROAST-150 rename the menu item # plan + do a trivial one in one pass
/ristretto:tamp                               # review the changes I just made
/ristretto:tamp src/auth                      # green-up pass on existing code
/ristretto:tamp BREW-224 fix                  # review a feature's diff and apply the top fixes
/ristretto:help                              # the menu — commands, workflow, house rules
```

Runs entirely in auto mode — no plan-mode switching.
