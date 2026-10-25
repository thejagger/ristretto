---
description: Builds a planned feature fast — easy path, no planner.
argument-hint: <feature ID> [nocommit]
---

You are running **SHOT** — the easy path against a plan `prep` already wrote, in one pass, auto mode. Closing is **your** job, never the user's. Real scope → `/ristretto:prep` then `/ristretto:pull`.

Target: $ARGUMENTS  (a feature ID; add `nocommit` to skip committing)

## 0. Check the format version

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/migrate.js" check
```

Exit 0 → continue. Exit 1 → switch to step 5's branch first, never the default; then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/migrate.js" apply`, say so, commit what it changed under `docs/ristretto/` as `docs(ristretto): migrate to format 0.22`, continue. Exit 3 → stop, report a stale install. Exit 2 → cannot tell, stop.

## 1. Resolve the target

Read `docs/ristretto/roadmap.md`. No row, or no plan at `docs/ristretto/plans/<FEATURE-ID>.md` → tell the user to run `/ristretto:prep <FEATURE-ID>` first, stop. Any status but `planned` → point at `/ristretto:pull <FEATURE-ID>` instead.

## 2. Read the plan

Open `docs/ristretto/plans/<FEATURE-ID>.md`. `## Contract` is binding — criteria, `Provides:`/`Consumes:`, decisions. `## Approach` may be stale.

## 3. Pre-flight

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" state
```

Read-only. Another session's marker, a dirty tree, or a leftover build plan → show what it printed, stop. PROVEN GREEN → finished work, tell the user to commit it. `unrecognised:` and `left alone:` (the user's untracked files — never touch) are informational only.

## 4. Complete the gates config

Read `.ristretto.json` — create it, or add whatever key the pre-flight names missing, per `${CLAUDE_PLUGIN_ROOT}/reference/config.md`. Adopt the repo's tooling (`CLAUDE.md` / `AGENTS.md` first), never new tools. `.ristretto.json` belongs in git, `.ristretto/` in `.gitignore`.

## 5. Arm and branch

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" arm
```

Exit 1 only if it cannot write its marker — stop and report. Create and switch to `feature/<FEATURE-ID>`, or reuse it. Never push or set an upstream.

## 6. Implement — no planner

No build plan gets written: `briefs/implementer.md`'s easy path applies whenever `.ristretto/build/<FEATURE-ID>.md` is missing — it expands `## Contract` against the current code first. Read `${CLAUDE_PLUGIN_ROOT}/briefs/implementer.md` and follow it yourself.

- `blocked: <reason>` → set the roadmap row `blocked`, disarm, stop.
- `escalate: <trigger>` → not finished by the easy path. Disarm, point the user at `/ristretto:pull <FEATURE-ID>` — never the reverse, never flip the roadmap `Tier` cell.
- `ready:` → continue, keeping its `decided:` lines for the closer.

## 7. Prove the whole repo

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" verify
```

The implementer's `prove` only proved the feature's own files — `verify` runs lint, typecheck, and the *full* test gate, ignoring the scoped shortcut and the green-tree cache. Exit 0 → continue. Exit 1 → fix until green, you're the implementer here too (no gate is ever weakened). A gate killed as hung is unverified, not proven broken.

## 8. Review — capped at 2 rounds

Skip only if trivial (< 15 lines, no new logic); when in doubt, review. Dispatch a **reviewer** subagent — fresh context, capable model:

> REVIEWER for ristretto feature **<FEATURE-ID>**.
> Diff: <files touched / branch vs merge-base>
> Read `${CLAUDE_PLUGIN_ROOT}/briefs/reviewer.md` and follow it.

- `clean` / `notes-only` → close; copy notes/leans verbatim into `## Open findings`. `test`-tagged findings first get a **trim pass**: follow `${CLAUDE_PLUGIN_ROOT}/briefs/implementer.md` as the fixer with only those, no review after; the closer records them trimmed, not open.
- `blocking (n)` → fix every block, following `${CLAUDE_PLUGIN_ROOT}/briefs/implementer.md` as the fixer, findings in hand. Then dispatch a **second, fresh** reviewer — round 2 only — scoped to verify the round-1 blocks and any new block the fixes introduced in files the fixer touched; a block elsewhere is reported, not fixed, and goes to `## Open findings` — it does not start a round 3. Round 2 reports no new notes or leans.
- Blocks still open after round 2 → hard stop: do not commit. Surface the findings to the user and leave the tree as is — never `git restore` it. Disarm, stop.

## 9. Close and disarm

Read `${CLAUDE_PLUGIN_ROOT}/briefs/closer.md` and follow it yourself. `nocommit` → skip the commit, say they're left uncommitted; everything else — `Provides:`, `## Evidence`, the roadmap row — still applies. Always — here and on every stop above:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" disarm
```

## When done

Summarize: what changed, criteria satisfied, review verdict, branch and commit (or uncommitted), plan closed, roadmap updated. Open checks, then taken decisions:

```
🔧 1 check open — docs/ristretto/plans/<FEATURE-ID>.md
   criterion 2 · Supabase SQL editor (dev) · add profiles.tier
   say "manual checks done" once it is
📝 decided, in force:
   which client? → the bare one
   overrule one in chat: /ristretto:prep overrule <FEATURE-ID> — <what instead>
```

Cup:

```
  ( (
   ) )
  c[__]  ☕ shot pulled
```

Zero open features left → the milestone cup instead:

```
   ) )  ( (
.__________.
|          |]
|          |
`----------'
ALL BREWED — roadmap clear ☕
```
