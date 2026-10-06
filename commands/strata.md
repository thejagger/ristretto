---
description: Collapse a branch's docs/ristretto planning trail into one docs(ristretto) commit, keeping non-docs commits intact — deterministic and non-destructive.
argument-hint: <range> [--ticket ID] [--mr] [--fold]
---

☕ strata — collapse the docs/ristretto planning trail on a branch into one clean `docs(ristretto)` commit, keeping the rest of each commit's changes intact. The result is history stratified into clean, reviewable layers — one docs stratum apart from the intact code strata, like the layered glass of a latte macchiato.

You are running **STRATA**. It builds a fresh PR branch (never rewrites the source branch) with `stratify` — a deterministic helper, not a workflow of written git steps. There is no mode to choose: one behavior, non-destructive by construction.

Target: `$ARGUMENTS`  (`<range>` plus `--ticket ID`, `--mr`, `--fold`)

## 0. Check the format version — before anything else

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/version.js" check
```

Exit 0 → continue. Exit 1, 2, or 3 → follow what it printed.

## 1. Resolve the range

- No range given → run `check-branch`:

  ```
  node "${CLAUDE_PLUGIN_ROOT}/scripts/strata.mjs" check-branch
  ```

  On a non-default branch, offer its `suggested_range` (a resolved-merge-base hash `..HEAD`, safe to feed straight back); let the user confirm or override. On the default branch, never invent a range — ask for one (and note it would mean capturing the whole branch).
- Range given → validate it:

  ```
  node "${CLAUDE_PLUGIN_ROOT}/scripts/strata.mjs" validate-range <range>
  ```

  Any non-zero exit / stderr → reject and stop (bad hash, end-before-start, malformed range). A valid range reporting `commits_in_range: 0` (or the start==end note) → nothing to fold; stop.

## 2. Analyze

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/strata.mjs" analyze <range> [--ticket T]
```

Read its output, in order:

1. `== Commits in <range> relevant to docs/ristretto ==` — `docs-only` / `MIXED` / `type-3` / `non-docs` classification.
2. `== Type-3 retitle proposals ==` — for each type-3 commit, the deterministic `derived_type` and the `type_candidates` from its touched paths. The script strips the `docs(ristretto)` scope and derives the type; the subject is grounded in this output. If you want a feature-slug scope (`gate`, `auth`) the paths do not name, draft it here and pass it through `--retitle`.
3. `== Coalesce-hint ==` / `== Fold-runs (machine-readable) ==` — runs of contiguous same-scope non-docs commits.
4. `== Draft subject ==` and `== PR branch ==`.

When a coalesce run is reported, surface it to the user and **ASK**. Do NOT auto-coalesce — it is a suggestion. If the user says yes (or `--fold` was passed up front), `stratify` folds it in the same invocation.

## 3. Stratify (the work)

Confirm the PR branch name with the user (the `pr_branch:` from `analyze`, or `--ticket`-supplied), then run the helper verb directly:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/strata.mjs" stratify <range> --pr-branch <name> \
  [--subject "<docs(ristretto): summary>"] [--retitle <hash>=<subject>]... [--fold]
```

`stratify` is the single authority for the git surgery: it builds the branch inside a throwaway `git worktree`, replays each non-docs commit oldest-first (pure code kept, MIXED replayed with its docs hunk excluded, docs-only skipped, type-3 retitled), appends one `docs(ristretto)` commit from the original tip's docs tree, and proves the result with `git diff --quiet <orig-tip> <new-tip>`. The main checkout is never touched — its HEAD and index are identical afterward. `--retitle` is an optional override for a type-3 hash whose derived subject you want to replace.

The verb prints JSON: `{ pr_branch, base, pr_tip, verified }`.

### Refusals (exit 2, stderr — nothing built)

- a **merge commit** anywhere in the range (a linear replay cannot handle merges);
- a **dirty working tree**;
- the target **PR branch already exists**;
- a **non-docs conflict** — a replayed commit's non-docs hunk cannot apply to the worktree. (A MIXED commit's docs hunk is excluded from the replay, so it can never cause a conflict; the docs tree comes wholesale from the original tip.) The verb removes the temp worktree and names the conflicting hash and path. The main checkout is undisturbed and no PR branch is left behind.

Every refusal leaves no temp worktree (`git worktree list` shows only the main tree).

## 4. Verify

Trust the verb's `verified` field: it is `git diff --quiet <orig-tip> <new-tip>`, so `true` means the PR branch's tip tree is byte-identical to the source branch's. If `verified` is `false`, do not proceed — surface it and stop; the main checkout is still untouched and no PR branch is left half-built.

On success, tell the user the branch is ready to push and open a PR from. Do **not** push.

## 5. `--mr` (optional)

If `--mr` was passed, after a `verified: true` result write a ticket-named `<TICKET>.md` at the repo root from the cleaned history — **do NOT commit it**. See `${CLAUDE_PLUGIN_ROOT}/briefs/strata-mr.md`.

---

## Which commits in the range matter

Detect by **path OR subject** — a commit matters if it touches `docs/ristretto/` **or** its subject is `docs(ristretto)`-scoped. Classify the ones that matter into:

1. **Docs-only commit** — touched only `docs/ristretto/` files. The whole commit's content folds into the single appended `docs(ristretto)` commit.
2. **Mixed commit** — touched `docs/ristretto/` **and** other files. The docs portion is stripped; the rest replays as its own commit.
3. **Type-3 commit** — subject is `docs(ristretto)`-scoped but the diff touches **no** `docs/ristretto/` path. There is no docs content to fold: the commit replays with its real (derived) type and the `docs(ristretto)` scope stripped.
4. **Non-docs** — touches neither; left untouched.

A commit is ignored only when it neither touches `docs/ristretto/` **nor** carries the `docs(ristretto)` scope. Note: only the exact `docs(ristretto)` scope counts — `docs(api):` does not; and only a path under `docs/ristretto/` counts — `docs/ristretto-old/` does not.

## Commit message

The appended commit uses `docs(ristretto): <summary>` — pass it via `--subject`, or let the verb use its default. The `<summary>` is a short phrase capturing what the collapsed planning edits did, e.g. `docs(ristretto): plan the auth and rate-limit features`. Derive it from the content being squashed, not from one arbitrary member commit.

**Describe the docs outcome, never the git surgery.** The message reads as "what this commit does", not "what the author did to history". Retitled type-3 commits keep a body describing their real change.

## The helper script

`scripts/strata.mjs` is platform-agnostic (node). It exposes five verbs:

- `check-branch` — prints `current`, `default`, `is_default`, and (off the default branch) a resolvable `suggested_range`. **Run this first** to decide how to handle a missing range.
- `validate-range <range>` — checks both endpoints resolve, end is not before start, and prints `valid`, the resolved endpoints, and `commits_in_range`. Treat any non-zero exit / stderr as input to reject. `commits_in_range: 0` or the start==end note means nothing to fold.
- `authors <range>` — lists the range's distinct authors and the configured identity, plus `distinct_authors`. Used by the `--mr` attribution step.
- `analyze <range> [--ticket T]` — classifies the relevant commits, derives type-3 retitles, reports fold-runs, and suggests a PR branch. Refuses a range containing a merge.
- `stratify <range> --pr-branch <name> [--subject S] [--retitle <hash>=<subject>]... [--fold] [--ticket T]` — the only mutating verb; builds the cleaned PR branch worktree-isolated and prints JSON `{ pr_branch, base, pr_tip, verified }`.

## Tests

`scripts/strata.test.js` exercises the reporting verbs against a fake `git` shim (`scripts/strata.fixtures/fake-git.mjs`, selected by `$STRATA_GIT` — no PATH shim, portable to Windows) and `stratify` against real temporary repositories:

```
node scripts/strata.test.js
```

## Banners — literal strings embedded in this file

This file's body prints the success macchiato glass when `stratify` returns `verified: true`, and the murky macchiato glass on every refusal (merge, dirty tree, branch-exists, non-docs conflict, or `verified: false`). The two are **mutually exclusive** — only one is ever printed in a run.

### Success macchiato glass — print this when `verified: true`

```
_________________________________________
\_______________________________________/
 \..................................../
  \.................................../
   \         docs(ristretto)         /
    \-------------------------------/
     \#############################/
      \###########################/
       \#########################/
        \         feats         /
         \---------------------/
          \~~~~~~~~~~~~~~~~~~~/
           \~~~~~~~~~~~~~~~~~/
            \ base commits  /
             \-------------/
             /             \
             |_____________|
              ☕ stratified
```

### Murky macchiato glass — print this on every refusal

```
_________________________________________
\_______________________________________/
 \·^▒*?=▒+;=:~;░^~%?^!+?·:+*░:▒%░=!%;·!/
  \▒+;=:~;░^~%?^!+?·:+*░:▒%░=!%;·!~*·^/
   \;░^~%?^!+?·:+*░:▒%░=!%;·!~*·^▒*?=/
    \^!+?·:+*░:▒%░=!%;·!~*·^▒*?=▒+;=/
     \+*░:▒%░=!%;·!~*·^▒*?=▒+;=:~;░/
      \░=!%;·!~*·^▒*?=▒+;=:~;░^~%?/
       \!~*·^▒*?=▒+;=:~;░^~%?^!+?/
        \*?=▒+;=:~;░^~%?^!+?·:+*/
         \=:~;░^~%?^!+?·:+*░:▒%/
          \~%?^!+?·:+*░:▒%░=!%/
           \?·:+*░:▒%░=!%;·!~/
            \:▒%░=!%;·!~*·^▒/
             \-------------/
             /             \
             |_____________|
              ☕ murky — stratify refused
```
