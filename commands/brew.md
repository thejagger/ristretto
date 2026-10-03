---
description: Builds every open feature in sequence, unattended.
argument-hint: [easy]
---

You are running **BREW** — an autonomous loop over the roadmap. The user batch-planned with `prep`; judgment is front-loaded into the plans. You make **zero product decisions**: acceptance criteria define "done", the gates decide when a feature may close, and anything undecidable becomes `blocked` — never a guess.

Arguments: $ARGUMENTS  (add `easy` to force every feature through the easy path — see below)

**You are the orchestrator, not the implementer.** Each feature runs through fresh subagents — planner, implementer, reviewer, closer; your context holds only bookkeeping and one-line results. Do not read the codebase, plans, or diffs yourself. One narrow lane: a reviewer finding that states the exact one-or-two-line, single-file fix, you may apply directly instead of paying a fixer round-trip — you're typing, not deciding. Anything larger goes to a fixer; say which findings you applied yourself.

**Never stop to ask the user anything** — a question here is a `prep` bug, answered `blocked`. A missing decision blocks; unreachable is `briefs/common.md`'s reach test, not a block. A dead subagent is never the user changing their mind — see below.

## `easy` — the forced-easy experiment lane

`easy` treats **every** eligible feature as `easy`, whatever its `Tier` cell says, to measure the tier design.

- **Rewrites nothing** — `Tier` cells stay exactly as `prep` set them; an experiment must never quietly become a data change.
- **Implementer on the capable model**, same as any easy feature — see Models below.
- **Escalation recorded, ignored.** The ratchet in `briefs/implementer.md` still fires, but a forced-easy run has no `escalate:` — it writes `would-escalate: <trigger>` and builds anyway. Tell it this is a forced-easy run.
- **Labelled forever, never on the row** — the closer records `tier: easy (forced)` and every `would-escalate:` line in `## Evidence`; nothing edits `Tier`.
- **Gates and review untouched** — worst case, more blocks and rounds, the measurement itself, not unproven code.

## 0. Check the project's format version

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/version.js" check
```

Exit 0 → continue. Exit 1 → follow what it printed. Exit 3 → the project is newer than this plugin: stop and report a stale install. Exit 2 → cannot tell: stop.

## 1. Read the roadmap

Read `docs/ristretto/roadmap.md` — the one file you read yourself. Missing → tell the user to run `/ristretto:prep` first, stop. No feature *eligible* (below) → print the empty-pot cup and stop, naming what's `blocked` and why, and separately which `needs-human` / `needs-review` rows wait on the user.

```
      ) )
     ( (
   .________.
   |        |]
   |        |
   `--------'
   ☕ ristretto: nothing to brew.
```

## 2. Pre-flight

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" state
```

Read-only. Another live session's marker, a dirty tree, or a leftover build plan → show what it printed, stop. A tree marked PROVEN GREEN is finished work — tell the user to commit it, never discard. `unrecognised: <n> file(s)` is informational only.

## 3. Complete the gates config

Read `.ristretto.json` — create it, or add whatever key the next step names missing, per `${CLAUDE_PLUGIN_ROOT}/reference/config.md`. Adopt the repo's own tooling (`CLAUDE.md` / `AGENTS.md` first), never impose new tools. `.ristretto.json` belongs in git, `.ristretto/` in `.gitignore`.

## 4. Prove the tree once

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" verify cached
```

`cached` returns the stored verdict on a byte-identical tree, full suite otherwise. **Run it bare** — nothing prepended to PATH, no substituted toolchain — since the hooks inherit none of that and any environment you add proves a tree they can't reproduce. Exit 0 → continue. Exit 1 → stop, nothing armed, nothing dispatched:

```
⛔ ristretto: repo is not green — nothing brewed.
   <gate>: <the failure, one line>
   (with "testReport" set, this means NEW failures since the baseline was captured.)
```

A gate **killed as hung** is neither red nor green — say so and stop, before it repeats at every stop for the whole run.

## 5. Arm as orchestrator

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" arm orchestrator
```

Arms both markers: `.ristretto/pulling` gates every subagent's stop (lint + typecheck + the scoped test gate, `testChanged` in `reference/config.md`); `.ristretto/orchestrating` exempts *your* turns, which end mid-edit, not at a proven-green point. Exit 1 only if it couldn't write its marker — stop, report.

## 6. Branch

Create and switch to `feature/brew-<YYYY-MM-DD>`, or reuse it if already there. Every feature lands here as its own commit. Never push, set an upstream, open a PR, or rewrite existing commits — `--amend` only repairs the message of the commit you just made, nothing since, disclosed when used.

## The loop

A feature is **eligible** when `planned`, all `Depends:` satisfied, `Blockers:` is `—`. **`Depends:` is satisfied by `done`, `needs-human`, or `needs-review`** — all three have code built, committed, gated green; only a console step or an opinion remains. Only `blocked` withholds. Also eligible: a `needs-human` row whose `manual-checks.md` boxes are now all ticked — a **check re-run**.

While an eligible feature exists:

1. **Pick** the topmost eligible feature (re-read the roadmap each pass, subagents update it). A check re-run needs only the closer, cheap model: un-skip the tests naming its ticked checks, run them, on green replace the pending lines with real proof and flip the row `done`, on red set `blocked` with that reason. Read `${CLAUDE_PLUGIN_ROOT}/briefs/closer.md` and follow it. Record the result (step 7), next feature.
2. **Read the `Tier` cell — first token only** (a polluted `normal easy` cell reads as `normal`). `easy` on the command line overrides the cell for every feature.
   - `easy` → no planner, dispatch the implementer directly, capable model:
     > IMPLEMENTER for ristretto feature **<FEATURE-ID>** — easy path (**forced-easy run** if `easy` was passed).
     > Contract: `docs/ristretto/plans/<FEATURE-ID>.md` — no build plan, expand it inline. (Forced-easy: record `would-escalate:`, never `escalate:`.)
     > Read `${CLAUDE_PLUGIN_ROOT}/briefs/implementer.md` and follow it.
   - `normal` (or no cell) → dispatch the planner first, capable model:
     > PLANNER for ristretto feature **<FEATURE-ID>**.
     > Plan: `docs/ristretto/plans/<FEATURE-ID>.md`
     > Read `${CLAUDE_PLUGIN_ROOT}/briefs/planner.md` and follow it.

     `blocked: <reason>` → row `blocked`, no implementer runs, next feature. `planned: ...` → dispatch the implementer, cheap model:
     > IMPLEMENTER for ristretto feature **<FEATURE-ID>** — normal path.
     > Build plan: `.ristretto/build/<FEATURE-ID>.md`
     > Read `${CLAUDE_PLUGIN_ROOT}/briefs/implementer.md` and follow it.
3. **Act on the implementer's result.**
   - `blocked: <reason>` → row `blocked`, next feature; the roadmap is yours, never the implementer's.
   - `escalate: <trigger>` (easy only, never forced-easy) → dispatch the planner (above), then a fresh implementer off its plan, cheap model; closer flips `Tier` to `normal` and records `escalated from easy: <trigger>`.
   - `ready:` or `needs-human:` → review.
4. **Review**, unless the diff is trivial (< 15 lines, no new logic) — capable model:
   > REVIEWER for ristretto feature **<FEATURE-ID>**.
   > Diff: <files touched / branch vs merge-base>
   > Read `${CLAUDE_PLUGIN_ROOT}/briefs/reviewer.md` and follow it.
5. **Act on the verdict — capped at 3 rounds:**
   - `review: clean` or `review: notes-only` → closer, status `done`, notes/leans copied verbatim into `## Open findings`. `test`-tagged findings first get a **trim pass**: the fixer below, given only those; no review after.
   - `review: blocking (n)` → a fixer, cheap model:
     > IMPLEMENTER for ristretto feature **<FEATURE-ID>** — fixer.
     > Findings: <the reviewer's block/note/lean list, verbatim>
     > Read `${CLAUDE_PLUGIN_ROOT}/briefs/implementer.md` and follow it.

     A fixer's `blocked:` is handled like an implementer's, unless it turns on a decision the plan never made — see `decision taken:` below. Otherwise a fresh reviewer, round 2, scoped as in `pull`: round-1 blocks plus any new block in files the fixer touched — elsewhere reported, not a new round; no new notes/leans. Clean → closer, `done`, `review: resolved`.
   - **Round 3**, if blocks remain: a fresh implementer one model tier up, given the plan, the open findings, the diff, and which criterion has failed review twice — never the failed diffs, which anchor it. If the findings turn on a decision the plan never made, take the recommended reading, implement it, record `decision taken: <question> → <ruling> — not in the contract`, carried into the result line. One final scoped re-review; clean → `done` · `review: resolved`.
   - **Still open after round 3** → closer, status `needs-review`, findings copied verbatim. Never `git restore` — `gate.js state` first: PROVEN GREEN means finished work, an open opinion, not a failure. Downstream features keep brewing; name every one built on that foundation in the report.
6. **Dispatch the closer**, cheap model, told the status and the verdict fields its Evidence line needs — you tracked them; it never guesses:
   > CLOSER for ristretto feature **<FEATURE-ID>** — close **<done | needs-human | needs-review>**.
   > Record: review <clean | notes-only | resolved | needs-review> · rounds <n> · open <b> block, <n> note, <l> lean · trimmed <t>; <open findings / decision taken: / would-escalate: / escalated from easy:, as applicable>
   > Read `${CLAUDE_PLUGIN_ROOT}/briefs/closer.md` and follow it.
7. **Record the result, print nothing else.** `☕ <FEATURE-ID> brewed (n/m)`, `🔧 <FEATURE-ID> brewed, needs a human check — <check> (n/m)`, `👀 <FEATURE-ID> brewed, needs review — <count> finding(s) open (n/m)`, or `⛔ <FEATURE-ID> blocked — <reason> (n/m)`. `n` is features finished in any terminal state, up by one each line; `m` is every `planned` row when the loop started, fixed. A round-3 decision adds `· decision taken: <ruling>`. **That line, a blocker, and the final report are the whole of what the main chat gets** — nothing about which subagent runs or which round.
8. **Hygiene.** `git status --short` must be clean before the next feature starts — dirty means a subagent died mid-work; handle it via "When a subagent dies" below (`gate.js state` before any restore), then delete any leftover `.ristretto/build/<FEATURE-ID>.md` for a row that blocked.
9. Next eligible feature.

## Models — always name one

Planner and reviewer: capable. Implementer: cheap on the normal path (a build plan exists), capable on easy or forced-easy (no plan — it plans and builds in one pass). Closer: cheap. An omitted model silently inherits the session's, defeating this.

## When a subagent dies

Not the user. A killed, disconnected, or malformed-result subagent looks like an interrupt from where you sit — treat it as what you can verify: the subagent failed.

1. `git status --short` — the only evidence of what it managed.
2. **Clean tree**, closer died → first `git log --oneline -1`: already names this feature's commit → it committed and only failed to report; record that result, move on. Otherwise (any role) → dispatch the same brief again, once, fresh context.
3. **Dirty tree** → one fresh subagent, same brief, plus: reconcile the partial work a previous attempt left against the build plan, finish the feature, verify all of it as your own.
4. **A second death ends it.** First `gate.js state` — PROVEN GREEN → closer commits it `needs-review`, never discard. Otherwise `git restore` the tracked files, delete the untracked ones it created, row `blocked` ("implementation aborted twice — no verifiable result"), next feature. Never a third attempt.

Print `⛔ <FEATURE-ID> blocked — subagent died twice`. Deaths across *different* features name an environment problem in the report — diagnosing it isn't this run's job.

## When you stop — for any reason

Runs on every stop, not just a clean finish — a blocked feature, a death, a believed interrupt, or running out of room. First `git status --short`; describe only what it printed, never memory.

1. Full suite once, over everything the scoped per-feature gates never proved together:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" verify
   ```
   Exit 0 → record it. Exit 1 → say so first and loudly; do not amend, revert, or reset the commits — already made, nothing pushed. Hung → report the batch unverified, name the gate.
2. **Disarm — not optional, not last if step 1 couldn't run:**
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" disarm
   ```
   Removes the markers and retry/stall state, never `.ristretto/build/`. Keep a build plan for a feature planned but not implemented, and say so — a re-plan from HEAD would otherwise silently redo paid-for work.
3. **Report — read off the archived plans, never off memory.** Read the roadmap rows this run touched and the `## Evidence` of every archived plan — the record, written at the time with the diff in hand. Cover: the full-suite verdict; features brewed, with hashes; `needs-human` rows with their checks; `needs-review` rows with their findings, any `decision taken:`, and every feature built on that foundation; `blocked` rows with their spec gaps; each feature's review verdict, rounds, and open counts; how many ran `easy`, how many escalated, the `would-escalate:` ratio; the branch; subagent suggestions (report only, never fix or add to the roadmap).

   Outstanding manual checks:
   ```
   🔧 3 manual checks waiting — docs/ristretto/manual-checks.md
      run them, tick the boxes, then /ristretto:brew again to verify what was pending.
   ```

   Every eligible feature brewed with zero blocks and the full suite green → lead with `☕ perfectly dialed in — every spec held end to end.` Never when anything blocked or the suite is red; outstanding manual checks don't disqualify it.
4. Roadmap fully `done` → the milestone cup:
   ```
      ) )  ( (
   .__________.
   |          |]
   |          |
   `----------'
   ALL BREWED — roadmap clear ☕
   ```
   Otherwise the little cup and `☕ pot empty — N blocked feature(s) waiting on you.` (`needs-human` and `needs-review` get their own lines above, not this count.)
