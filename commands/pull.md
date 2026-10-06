---
description: Builds a planned feature — normal path, with a planner.
argument-hint: <feature ID, or "next"> [nocommit]
---

You are in the **PULL** phase of ristretto. You implement exactly one feature, directly, in auto mode — there is no approval gate. Closing the feature is **your** job at the end, never the user's.

Target: $ARGUMENTS  (a feature ID, or `next` = the top `planned` row in the roadmap; add `nocommit` to skip the commit at the end)

## 0. Check the format version

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/version.js" check
```

Exit 0 → continue. Exit 1 → follow what it printed. Exit 3 → the project is newer than this plugin: stop and report a stale install. Exit 2 → cannot tell: stop.

## 1. Resolve the target — trust the roadmap

Read `docs/ristretto/roadmap.md`; take it at its word, don't second-guess it against the code.

- **`done`** → stop, tell the user, cite the Updated date / commit. Do not re-implement.
- **`blocked`** → surface the recorded reason, ask whether to proceed anyway — the block may have been resolved outside the roadmap.
- **`needs-human`** → the code is already built and committed; read its section in `docs/ristretto/manual-checks.md`. Every `proves` line ticked `- [x]` → this is a check re-run: read `${CLAUDE_PLUGIN_ROOT}/briefs/closer.md` and follow it yourself to prove the pending criteria and close it. Still unticked lines → print them and stop.
- **`needs-review`** → `brew` built and committed it green but left findings open. Read `## Open findings` and any `decision taken:` line in `## Evidence` of `docs/ristretto/plans/archived/<FEATURE-ID>.md`; show them and ask which to fix. On your ruling, work them on a branch as an ordinary change (steps 6–12 below, treating the findings as the implementer's input), then rewrite `## Open findings` to only what remains — clearing it closes the row `done`. Findings you decide against are deleted with a one-line note why.
- **`next`** → the top `planned` row whose `Depends:` are all satisfied. `done`, `needs-human`, and `needs-review` all satisfy a dependency — their code is built, committed, and gated, only a step or an opinion is outstanding. Only `blocked` withholds. If every `planned` row is blocked, stop and say what each is waiting on. A named ID (not `next`) with an unfinished `Depends:` → warn and ask before proceeding.

## 2. Read the plan

Open `docs/ristretto/plans/<FEATURE-ID>.md`. `## Contract` is binding — acceptance criteria, `Provides:`/`Consumes:`, decisions. `## Approach` is guidance, may be stale.

## 3. Pre-flight

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" state
```

Read-only. A marker armed by another live session, a dirty tree, or a leftover build plan → show what it printed and stop. A tree it marks PROVEN GREEN is finished work, not a problem — tell the user to commit it, never discard it. `unrecognised: <n> file(s)` is informational only, never a reason to stop.

## 4. Complete the gates config

Read `.ristretto.json` — create it, or add whatever key its pre-flight later names as missing, following `${CLAUDE_PLUGIN_ROOT}/reference/config.md`. Read the repo's `CLAUDE.md` / `AGENTS.md` first; adopt whatever tooling the repo already uses, never impose new tools. `.ristretto.json` belongs in git; add `.ristretto/` to `.gitignore` if it isn't there.

## 5. Arm

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" arm
```

Exit 1 only if it cannot write its marker — stop and report if so.

## 6. Branch

Create and switch to `feature/<FEATURE-ID>`, or reuse it if you're already there. Never push, never set an upstream.

## 7. Plan against the current code

Dispatch a **planner** subagent — fresh context, capable model:

> PLANNER for ristretto feature **<FEATURE-ID>**.
> Plan: `docs/ristretto/plans/<FEATURE-ID>.md`
> Read `${CLAUDE_PLUGIN_ROOT}/briefs/planner.md` and follow it.

`blocked: <reason>` → set the roadmap row `blocked` with that reason, disarm (step 12), stop — no branch cleanup needed. `planned: ...` → continue; the implementer works from `.ristretto/build/<FEATURE-ID>.md`, never from `## Approach`.

## 8. Implement

Read `${CLAUDE_PLUGIN_ROOT}/briefs/implementer.md` and follow it yourself.

`blocked: <reason>` → set the roadmap row `blocked` with that reason, disarm (step 12), stop. `ready:` or `needs-human:` → continue to review.

## 9. Prove the whole repo

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" verify
```

The implementer's `prove` only ever proved the feature's own files — `verify` runs lint, typecheck, and the *full* test gate, ignoring the scoped shortcut and the green-tree cache. Exit 0 → continue. Exit 1 → fix until green — you are the implementer here too (read `${CLAUDE_PLUGIN_ROOT}/briefs/implementer.md`'s rules; no gate is ever weakened). A gate killed as hung is unverified, not proven broken — find what it's waiting on before going on.

## 10. Review — capped at 2 rounds, never a ping-pong

Skip only when the diff is trivial: roughly < 15 changed lines and no new logic (no new functions, branches, or loops). When in doubt, review.

Dispatch a **reviewer** subagent — fresh context, capable model:

> REVIEWER for ristretto feature **<FEATURE-ID>**.
> Diff: <files touched / branch vs merge-base>
> Read `${CLAUDE_PLUGIN_ROOT}/briefs/reviewer.md` and follow it.

- `review: clean` or `review: notes-only` → proceed to close (step 11). The notes and leans get copied verbatim into `## Open findings` there — do not fix them, do not round for them. The one exception: `test`-tagged findings get a **trim pass** first — follow `${CLAUDE_PLUGIN_ROOT}/briefs/implementer.md` as the fixer with only those findings; no review round follows, and the closer records them as trimmed, not open.
- `review: blocking (n)` → fix every block (read `${CLAUDE_PLUGIN_ROOT}/briefs/implementer.md` and follow it yourself as the fixer, findings in hand instead of a build plan; clear notes and leans in the same pass unless a fix is riskier than the win, and say which you left). Then dispatch a **second, fresh** reviewer — round 2 only — to verify the round-1 blocks and any new block the fixes introduced in files the fixer touched; a block elsewhere is reported, not a new round.
- Blocks still open after round 2 → hard stop: do **not** commit. Surface the findings to the user and leave the work in the tree — never `git restore` it, the gates are green and only an opinion is unresolved. Disarm (step 12) and stop.

  **`pull` stops here where `brew` would close `needs-review`, and the difference is you** — a question asked now is answered in seconds.

## 11. Close

Read `${CLAUDE_PLUGIN_ROOT}/briefs/closer.md` and follow it yourself. If `nocommit` was passed, skip the commit and say the changes are left uncommitted for the user to commit themselves; everything else in the brief — `Provides:`, `## Evidence`, archiving, the roadmap row — still applies.

## 12. Disarm

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" disarm
```

Always — on a normal close, a `blocked:` stop, or an open-findings stop.

## When done

Print a short summary: what changed, which criteria are satisfied, the review verdict (including any `lean` findings deliberately left open), the branch and commit (or that it's left uncommitted), and confirm the plan was archived and the roadmap updated. If manual checks are outstanding, list them and point at `docs/ristretto/manual-checks.md`:

```
🔧 1 manual check waiting — docs/ristretto/manual-checks.md
   proves · criterion 2 · Supabase SQL editor (dev) · add profiles.tier
```

End with a little cup:

```
  ( (
   ) )
  c[__]  ☕ shot pulled
```

If closing this feature left **zero** open features on the roadmap, celebrate instead with the full milestone cup:

```
   ) )  ( (
.__________.
|          |]
|          |
`----------'
ALL BREWED — roadmap clear ☕
```
