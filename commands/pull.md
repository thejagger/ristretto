---
description: Builds a planned feature — normal path, with a planner; the brewer sends it unattended.
argument-hint: '<feature ID, or "next"> [unattended] [nocommit] [decided: <question> → <ruling>]... [contract: <repo>@<hash>:<file>]...'
---

You are in the **PULL** phase of ristretto: one feature, built in auto mode and closed by you, never by the user. pull is the one build flow — `shot` is this flow without the planner, and the brewer sends it `unattended`.

Target: $ARGUMENTS
- a feature ID, or `next` = the top eligible `planned` row
- `unattended` — the brewer sent it; nobody is there to answer (box below)
- `nocommit` — skip the commit at the end
- `decided: <question> → <ruling>` lines — the brewer's rulings; they bind the build (passed to the planner and the fixer as `Decided (binding)`) and go to the close with the build's own decisions
- `contract: <repo>@<hash>:<file>` lines — a producer's contract in another repo, at a committed snapshot; every role reads it with `git -C <repo> show <hash>:<file>`, never from that repo's working tree

If `shot` sent you here: skip the planner (step 7) and review at `medium`. That is the only difference.

> **`unattended` changes only this:**
> 1. You never ask. Whatever would be a question becomes a one-line report and a stop.
> 2. Review fixes only confirmed findings (step 10).
> 3. A named feature with unfinished `Depends:` is built anyway — the brewer chose the order — and the report says so.
> 4. On an `easy` row, step 7 is skipped as in shot. An `escalate:` then goes on with step 7 instead of stopping.
> 5. Finishing options (step 13) are listed, not asked.
> 6. Your last line is exactly one of:
>    `pulled: <ID> <hash> — <n> check(s) open, <m> decision(s) taken, <k> finding(s) open`
>    `blocked: <ID> — <who or what>`

## 0. Check the format version

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/migrate.js" check
```

Exit 0 → continue. Exit 1 → run `node "${CLAUDE_PLUGIN_ROOT}/scripts/migrate.js" apply` and say so; resolve the target (step 1) off the migrated roadmap, then switch to step 6's branch and commit what it changed under `docs/ristretto/` there as `docs(ristretto): migrate to format 0.23` — never on the default branch. If step 1 stops, leave the migration uncommitted and say so. Exit 3 → the project is newer than this plugin: stop, report a stale install. Exit 2 → cannot tell: stop.

## 1. Resolve the target — trust the roadmap

Read `docs/ristretto/roadmap.md`; take it at its word.

- **Not here, at a folder of repos** → read `docs/ristretto/roadmap.md` in each direct subfolder. Found in two → ask which (unattended: `blocked: <ID> — in two repos`). A feature is built in its repo, never from the parent folder, where no gate fires: in the desktop app start a session in that repo with this same command; elsewhere tell the user to open it there. Stop here.
- **`done`** → stop, tell the user, cite its commit (`git log --oneline -E --grep "^[a-z]+\(<FEATURE-ID>\):"`), and list what its plan still leaves open: `[ ] [human]` boxes and `## Open findings`, then its `taken:` decisions as information. Do not re-implement.
- **`blocked`** → attended: surface the recorded reason, ask whether to proceed. Unattended: the brewer fixed the cause — proceed.
- **`next`** → the top `planned` row whose `Depends:` are all `done`. A `<folder>/<id>` dependency is looked up in `../<folder>/docs/ristretto/roadmap.md`; a missing folder or row is not done. None → stop and say what each is waiting on. A named ID with unfinished `Depends:` → attended: warn and ask.

## 2. Read the plan

`docs/ristretto/plans/<FEATURE-ID>.md`. `## Contract` binds: criteria, `Provides:`/`Consumes:`, decisions. `## Approach` is guidance and may be stale. Its `Tier` is in the roadmap row.

## 3. Pre-flight

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" state
```

Read-only. Another live session's marker, a dirty tree, or a leftover build plan → show what it printed, stop. One exception: this feature's own build plan, left by an earlier pull that parked it (step 12 — `git stash list` shows `ristretto <FEATURE-ID> blocked`), is not a stop; the planner overwrites it. A tree marked PROVEN GREEN is finished work — tell the user to commit it, never discard it. `unrecognised:` is informational. `left alone:` names the user's untracked files — never move, ignore, commit, stash or delete them.

## 4. Complete the gates config

Read `.ristretto.json` — create it, or add whatever key the pre-flight names missing, per `${CLAUDE_PLUGIN_ROOT}/reference/config.md`. Read `CLAUDE.md` / `AGENTS.md` first; adopt the repo's tooling, never impose new tools. `.ristretto.json` belongs in git, `.ristretto/` in `.gitignore`.

## 5. Arm

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" arm
```

Exit 1 only if it cannot write its marker — stop and report.

## 6. Branch, and parked work

Attended: create or reuse `feature/<FEATURE-ID>`. Unattended: stay on the current branch unless it is the default branch; then create `feature/<FEATURE-ID>`. Never push, never set an upstream.

Then: if `git stash list` shows `ristretto <FEATURE-ID> blocked`, this feature was parked by an earlier unattended pull. `git stash apply` that entry, and drop it once it applied cleanly. A conflict → step 12.

## 7. Plan against the current code

Skipped for shot and for an unattended `easy` row. Dispatch a **planner** subagent — fresh context, capable model:

> PLANNER for ristretto feature **<FEATURE-ID>**.
> Plan: `docs/ristretto/plans/<FEATURE-ID>.md`
> Decided (binding): <the brewer's `decided:` lines, or none>
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

Lint, typecheck and the *full* test gate, ignoring the scoped shortcut and the green-tree cache. Exit 0 → continue. Exit 1 → fix until green; you are the implementer here too, and no gate is ever weakened. A gate killed as hung is unverified, not proven broken — find what it waits on.

## 10. Review — one `/code-review`

Skip only when the diff is trivial: under ~15 changed lines and no new logic. When in doubt, review.

Run `/code-review <level> <absolute path of this repo>`. The level is `medium` when the feature was built on the easy path (shot, or an unattended `easy` row that did not escalate), `high` otherwise; attended, the user may name another. Always pass the path: without it the review reads the session's folder, which at a folder of repos is the wrong one.

- **Attended:** show the findings, numbered. The user picks what to fix and may give a reason for what they skip.
- **Unattended:** fix only the findings labelled confirmed correctness bugs. If the review gives no labels, fix those it presents as correctness bugs with a concrete failing input.

Fixes go to a **fixer** subagent:

> IMPLEMENTER for ristretto feature **<FEATURE-ID>** — fixer.
> Findings: <the chosen ones, verbatim>
> Decided (binding): <the brewer's `decided:` lines, or none>
> Read `${CLAUDE_PLUGIN_ROOT}/briefs/implementer.md` and follow it.

Then step 9's `verify` again. No second review: each fix's red-then-green test is its proof. Every finding not fixed goes verbatim to the close's findings, a skipped one with the user's reason.

## 11. Close

1. Correct `Provides:` in the plan to what was built — the next planner reads it as fact.
2. Write the close input to `.ristretto/close-<FEATURE-ID>.json`:
   - `evidence` — one line for each criterion, `<n>: <how it was proven>` (red→green test names, command output), `<n>: measured <number> — <command>` for a `[measure]`, `<n>: pending human` where a manual check waits; then `gates: <gate summary>` and `review: /code-review <level> · fixed: <n> · open: <m>`
   - `decisions` — every `decided: <question> → <ruling>` from the planner, the implementer and the brewer's arguments, as `{question, ruling}`
   - `findings` — a measure that came back empty or the same for every case, first; then what review left open
   - `escalated` — the trigger, or null
3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/close.js" <FEATURE-ID> --input .ristretto/close-<FEATURE-ID>.json` (add `--repo <dir>` only at a folder of repos). It writes Evidence, taken decisions, open findings and the roadmap row, and removes the build plan and that file.
4. Commit, per `${CLAUDE_PLUGIN_ROOT}/briefs/common.md`'s Commits: code, plan and roadmap row in one `feat(<FEATURE-ID>): …`. `nocommit` → skip and say it is left uncommitted.

## 12. Blocked

- **Attended:** set the roadmap row's status to `blocked — <reason>`, nothing else; leave the work in the tree, surface the reason, go to step 14.
- **Unattended:** park the work first, so the next pull in this repo starts clean. If step 6 applied an earlier stash of this feature, that entry is dropped once this one is taken — one stash per feature.
  `git stash push -u -m "ristretto <ID> blocked <YYYY-MM-DD>" -- <every path this feature touched>`
  Only this feature's code and plan: never `docs/ristretto/roadmap.md`, never `.ristretto.json`, never the `left alone:` files from step 3, and never discard anything. Then set the roadmap row's status to `blocked — <reason>`, nothing else, and commit it together with `.ristretto.json` if this pull created it: `docs(<FEATURE-ID>): blocked - <reason>`. Step 14, then the `blocked:` line, naming the stash.

## 13. Finishing options

When the feature is committed, offer what applies — attended: ask; unattended: list:

- leave the branch as it is
- **split docs from code**, only when the branch carries `docs/ristretto/` changes: `node "${CLAUDE_PLUGIN_ROOT}/scripts/strata.mjs" stratify <base>..HEAD --pr-branch <branch>-mr --subject "docs(ristretto): <summary>"` builds a fresh branch with the code commits replayed and the planning in one commit, and never touches this one. Trust its `verified` field; `false` → say so and stop.
- **write the MR description**: follow `${CLAUDE_PLUGIN_ROOT}/briefs/strata-mr.md`.

## 14. Disarm

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" disarm
```

Always — after a close, a block, or any stop above.

## When done

Unattended: the finishing options from step 13 if any apply, then the last line from the box above — nothing else.

Attended: what changed, which criteria hold, the review (fixed, left open), branch and commit (or uncommitted). Then the plan's open checks and the decisions taken — information, in force:

```
🔧 1 check open — docs/ristretto/plans/<FEATURE-ID>.md
   criterion 2 · Supabase SQL editor (dev) · add profiles.tier
   say "manual checks done" once it is
📝 decided while building, in force:
   which client? → the bare one
   overrule one in chat: /ristretto:prep overrule <FEATURE-ID> — <what instead>
```

End with a little cup:

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
