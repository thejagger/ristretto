---
description: Builds a planned feature — normal path, with a planner; the brewer sends it unattended.
argument-hint: '<feature ID, or "next"> [unattended] [nocommit] [decided: <question> → <ruling>]... [contract: <repo>@<hash>:<file>]...'
---

You are in the **PULL** phase of ristretto: one feature, built in auto mode and closed by you, never by the user.

Target: $ARGUMENTS
- a feature ID, or `next` = the top eligible `planned` row
- `unattended` — the brewer sent it; nobody is there to answer (box below)
- `nocommit` — skip the commit at the end
- `decided: <question> → <ruling>` lines — the brewer's rulings; they bind the build (passed to the planner and the fixer as `Decided (binding)`) and go to the close with the build's own decisions
- `contract: <repo>@<hash>:<file>` lines — a producer's contract in another repo, at a committed snapshot; every role reads it with `git -C <repo> show <hash>:<file>`, never from that repo's working tree
- `shot` — shot sent it: skip the planner (step 7) and review at `medium`; nothing else differs.

> **`unattended` changes only this:**
> 1. You never ask. Whatever would be a question becomes a one-line report and a stop.
> 2. Review fixes only confirmed findings (step 10).
> 3. A named feature with unfinished `Depends:` is built anyway — the brewer chose the order — and the report says so.
> 4. On an `easy` row, step 7 is skipped as in shot. An `escalate:` then goes on with step 7 instead of stopping.
> 5. The MR description (step 13) is offered, not asked.
> 6. Your final message is the report from **When done**, then a last line that is exactly one of:
>    `pulled: <ID> <hash> — <n> check(s) open, <m> decision(s) taken, <k> finding(s) open`
>    `blocked: <ID> — <who or what>`

## 0. Find the repo, then its state

- **Not here, at a folder of repos** → read `docs/ristretto/roadmap.md` in each direct subfolder. Found in two → ask which (unattended: `blocked: <ID> — in two repos`). Found in one → that repo is where you build: run every command there (`cd <repo> && …`: a subagent's shell forgets a `cd`) and give every subagent you start its path. Hooks watch only the session's folder, so no stop is gated here: step 9's `verify` is the proof.

Then, in that repo:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" state
```

Read-only. Its `format:` line first. `current` or `no roadmap` → continue. `behind` → run `node "${CLAUDE_PLUGIN_ROOT}/scripts/migrate.js" apply` and say so; resolve the target (step 1) off the migrated roadmap, then switch to step 6's branch and commit what it changed under `docs/ristretto/` there as `docs(ristretto): migrate to format 0.23` — never on the default branch. If step 1 stops, leave the migration uncommitted and say so. `newer` → the project is newer than this plugin: stop, report a stale install. `unstamped` → cannot tell: stop. The rest of the output is step 3's.

## 1. Resolve the target — trust the roadmap

Read `docs/ristretto/roadmap.md`; take it at its word.

- **`done`** → stop, tell the user, cite its commit (`git log --oneline -E --grep "^[a-z]+\(<FEATURE-ID>\):"`), and list what its plan still leaves open: `[ ] [human]` boxes and `## Open findings`, then its `taken:` decisions as information. Do not re-implement.
- **`blocked`** → attended: show the reason, ask whether to proceed. Unattended: proceed — the brewer fixed it or ruled on it.
- **`next`** → the top `planned` row whose `Depends:` are all `done`. A `<folder>/<id>` dependency is looked up in `../<folder>/docs/ristretto/roadmap.md`; a missing folder or row is not done. None → stop and say what each is waiting on. A named ID with unfinished `Depends:` → attended: warn and ask.

## 2. Read the plan

`docs/ristretto/plans/<FEATURE-ID>.md`. Its acceptance, decisions and `Provides:` bind — except a criterion the brewer ruled on: its `decided:` line replaces it, for the plan, the build and Evidence. The rest is the build's to decide; an older plan's `## Approach` may be stale. Its `Tier` is in the roadmap row.

## 3. Pre-flight

Read the rest of what step 0's `state` printed — it does not run again.

Read-only. Another live session's marker, a dirty tree, or a leftover build plan → show what it printed, stop. Not a stop: this feature's own build plan from an earlier parked pull (`git stash list` shows `ristretto <FEATURE-ID> blocked`); the planner overwrites it. A tree marked PROVEN GREEN is finished work — tell the user to commit it, never discard it. `left alone:` names the user's untracked files — never move, commit, stash or delete them.

## 4. Complete the gates config

Read `.ristretto.json` — create it, or add whatever key the pre-flight names missing, per `${CLAUDE_PLUGIN_ROOT}/reference/config.md`. Read `CLAUDE.md` / `AGENTS.md` first; adopt the repo's tooling, never impose new tools. `.ristretto.json` belongs in git, `.ristretto/` in `.gitignore`.

## 5. Arm

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" arm
```

A builder subagent — one that brew or prep started — runs `gate.js arm builder` instead: it shares its starter's session, whose own turn-ends must not be gated against its half-built tree. Exit 1 only if it cannot write its marker — stop and report.

## 6. Branch, and parked work

Attended: create or reuse `feature/<FEATURE-ID>`. Unattended: stay on the current branch unless it is the default branch; then create `feature/<FEATURE-ID>`. Push only in step 13.

Then: if `git stash list` shows `ristretto <FEATURE-ID> blocked`, this feature was parked by an earlier unattended pull. `git stash apply` that entry, and drop it once it applied cleanly. A conflict → step 12.

## 7. Plan against the current code

Skipped for shot and for an unattended `easy` row. Dispatch a **planner** subagent — fresh context, capable model:

> PLANNER for ristretto feature **<FEATURE-ID>**.
> Plan: `docs/ristretto/plans/<FEATURE-ID>.md`
> Decided (binding): <the brewer's `decided:` lines, or none> — a ruling on a criterion replaces it
> Contracts: <each `contract: <repo>@<hash>:<file>` — read with `git -C <repo> show <hash>:<file>`, or none>
> Read `${CLAUDE_PLUGIN_ROOT}/briefs/planner.md` and follow it.

`blocked: <reason>` → step 12. `planned: …` → continue; keep its `decided:` lines.

## 8. Implement

Read `${CLAUDE_PLUGIN_ROOT}/briefs/implementer.md` and follow it yourself. The brewer's `decided:` lines bind you as they bind the planner, and a `contract:` is read from its snapshot, never a working tree.

- `blocked: <reason>` → step 12.
- `escalate: <trigger>` (easy path only) → attended (shot): stop, disarm, and offer `/ristretto:pull <FEATURE-ID>`; never touch the `Tier` cell. Unattended: go to step 7, then implement again; the trigger goes to the close as `escalated`.
- `ready:` → continue. Keep its `decided:` lines.

## 9. Prove the whole repo

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" verify
```

Lint, typecheck and the *full* test gate, ignoring the scoped shortcut and the green-tree cache. Exit 0 → continue. Exit 1 → fix until green; you are the implementer here too.

## 10. Review — one `/code-review`

Skip only when the diff is trivial: under ~15 changed lines and no new logic. When in doubt, review.

Run `/code-review <level> <absolute path of this repo>`. The level is `medium` when the feature was built on the easy path (shot, or an unattended `easy` row that did not escalate), `high` otherwise; attended, the user may name another. Always pass the path: the session's folder may not be this repo.

- **Attended:** show the findings, numbered. The user picks what to fix and may give a reason for what they skip.
- **Unattended:** fix only the findings labelled confirmed correctness bugs. If the review gives no labels, fix those it presents as correctness bugs with a concrete failing input.

Fixes go to a **fixer** subagent:

> IMPLEMENTER for ristretto feature **<FEATURE-ID>** — fixer.
> Findings: <the chosen ones, verbatim>
> Decided (binding): <the brewer's `decided:` lines, or none> — a ruling on a criterion replaces it
> Read `${CLAUDE_PLUGIN_ROOT}/briefs/implementer.md` and follow it.

Then step 9's `verify` again. No second review: each fix's red-then-green test is its proof. Every finding not fixed goes verbatim to the close's findings, a skipped one with the user's reason.

## 11. Close

1. Correct `Provides:` in the plan to what was built — the next planner reads it as fact.
2. Write the close input to `.ristretto/close-<FEATURE-ID>.json`:
   - `evidence` — one line for each criterion (a ruled one as ruled), `<n>: <how it was proven>` (red→green test names, command output), `<n>: measured <number> — <command>` for a `[measure]`, `<n>: pending human` where a manual check waits, `<n>: seen in <tool> — <what>` for a setup tool's look, `<n>: no test — <what already guarantees it>`, `<n>: a ruling — read in <file>`; several lines may cite one test; then `gates: <gate summary>` and `review: /code-review <level> · fixed: <n> · open: <m>`
   - `decisions` — every `decided: <question> → <ruling>` from the planner, the implementer and the brewer's arguments, as `{question, ruling}`
   - `findings` — a measure that came back empty or the same for every case, first; then what review left open
   - `escalated` — the trigger, or null
3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/close.js" <FEATURE-ID> --input .ristretto/close-<FEATURE-ID>.json`. It writes Evidence, taken decisions, open findings and the roadmap row, and removes the build plan and that file.
4. Commit, per `${CLAUDE_PLUGIN_ROOT}/briefs/common.md`'s Commits: code, plan and roadmap row in one `feat(<FEATURE-ID>): …`. `nocommit` → skip and say it is left uncommitted.

## 12. Blocked

- **Attended:** set the roadmap row's status to `blocked — <reason>`, nothing else; leave the work in the tree, surface the reason, go to step 14.
- **Unattended:** park the work first, so the next pull in this repo starts clean. If step 6 applied an earlier stash of this feature, that entry is dropped once this one is taken — one stash per feature.
  `git stash push -u -m "ristretto <ID> blocked <YYYY-MM-DD>" -- <every path this feature touched>`
  Only this feature's code and plan: never `docs/ristretto/roadmap.md`, never `.ristretto.json`, never the `left alone:` files from step 3, and never discard anything. Then set the roadmap row's status to `blocked — <reason>`, nothing else, and commit it together with `.ristretto.json` if this pull created it: `docs(<FEATURE-ID>): blocked - <reason>`. Step 14, then the `blocked:` line, naming the stash.

## 13. MR description

Attended, once committed, and only where a setup was printed: follow `${CLAUDE_PLUGIN_ROOT}/briefs/after-build.md` first; a merge request it opened replaces the offer.

When the feature is committed, offer to write the MR description — attended: ask; unattended: list it. Yes → follow `${CLAUDE_PLUGIN_ROOT}/briefs/mr.md`.

## 14. Disarm

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" disarm
```

Always — after a close, a block, or any stop above.

## When done

The report is for trying the feature: short lines, nothing around them.

```
✓ <FEATURE-ID> <hash> — <title> · <branch>
  built:  <two or three lines: what the user can do now>
  test:   <the exact steps — URL, button, command — and what they should see>
  decided for you: <question> → <ruling>; …  (overrule: `/ristretto:prep overrule`)
  open:   <each manual check with its how:, each finding left open, anything unfinished; a slow test this build touched: `say "run the slow tests"`> — or —
  setup:  <a start command, test user or tool that drives the app this build added> — only then
```

Never edit `.ristretto/setup.md`; the `setup:` line changes it. No setup printed → end that line `— /ristretto:init would record it`.

Blocked: `⏸ <FEATURE-ID> — <what it needs, from whom>`, and its stash.

Unattended: the report, the offer from step 13, then the last line from the box above — nothing else.

Attended: the report, then the offer from step 13, then a little cup:

```
  ( (
   ) )
  c[__]  ☕ shot pulled
```

If this left **zero** open features on the roadmap, the milestone cup instead:

```
   ) )  ( (
.__________.
|          |]
|          |
`----------'
ALL BREWED — roadmap clear ☕
```
