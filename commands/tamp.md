---
description: Honest lean-code review of a diff or file — finds runtime waste, duplication, dead/over-built code, and readability drag, ranked and capped. Read-only; pass "fix" to apply the top findings.
argument-hint: "[path or feature ID] [fix]"
---

You are running **TAMP** — an honest lean-code review. Tamping presses the grounds flat so water can't *channel* (rush through gaps and waste the shot). You find channeling in code: where it wastes compute, repeats itself, carries weight it doesn't need, or is harder to read than it should be. Read-only by default — assess and print, change no files unless `fix` is passed.

Target: $ARGUMENTS

## 1. Pick the target

- **No path or ID given** → review the current changes: the uncommitted working-tree diff if the tree is dirty, otherwise the current branch vs its merge-base with the default branch (what `pull` just produced). This is the common case — "review what I just built."
- **A path** (file or directory) → review that code as it stands, not just a diff. Use this for green-up passes on existing code.
- **A feature ID** → review that feature's diff (`feature/<ID>` vs its merge-base).
- **`fix`** anywhere in the arguments → apply mode (see §5). Without it, change nothing.

If the target is empty (clean tree, no diff, no path) → say so and stop. Nothing to tamp.

## 2. The lens: where's the waste?

Read the target code. Ask one question — *where's the waste?* — across four facets. Flag only **real** waste you can point at, never hypotheticals:

- **Runtime efficiency** — N+1 queries, recomputation that could be hoisted or cached, needless IO/network calls, work inside a loop that belongs outside it, O(n²) where O(n) is trivial. The only facet that touches real server cost — weight it highest.
- **Duplication / DRY** — copy-pasted blocks, near-identical functions, logic that reinvents a utility that **already exists in the repo**. Check the repo for the existing util before flagging — don't assume.
- **Dead / over-built** — unused symbols, unreachable branches, speculative abstraction or scaffolding that nothing needs yet (YAGNI).
- **Readability / structure** — unclear names, oversized functions, deep nesting, a file doing too many jobs. Weight this lowest; it matters, but never above a real runtime cost.

## 3. Rank and cap — stay green, don't flood

A review that dumps 40 nitpicks is itself the waste you're fighting (noise, tokens, ignored output).

- Rank findings by **impact × confidence**. Runtime efficiency outranks readability.
- Report **at most 7 findings**, highest-severity first. If more exist, add one line — `+N minor nits omitted` — and stop. Never dump the rest.
- Keep each finding tight: a clickable `file:line`, one line on *what's wasted*, one line on *the fix*. No essays.

## 4. Output

Print to the conversation — no file is written. For each finding:

> **`path/to/file.ext:42`** — *what's wasted, in one line.*
> Fix: *one line.*

Then a **verdict** line that mirrors the result, coffee-consistent:
- Nothing material → **clean shot**.
- Real waste found → **channeling** (name the worst one).

## 5. Fix mode (only if `fix` was passed)

Apply only the findings you reported, in severity order:
- Smallest diff per fix; reuse existing patterns and utilities.
- **Never** `git add -A`, commit, push, or touch `docs/ristretto/roadmap.md`. `tamp` is a lens, not a lifecycle step — committing stays with `pull` or the user.
- After applying, restate what you changed and what you deliberately left (the low-severity findings), so the developer can decide on the rest.

## Tasting note

Close with a single coffee-themed line that mirrors the verdict:

- *clean shot* → e.g. `☕ Even extraction — nothing channeling.`
- *channeling* → e.g. `Channeling on the hot path — tamp it down before it ships.`

One line only.
