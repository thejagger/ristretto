# MR description

Write a merge-request description for the branch: a ticket-named `<TICKET>.md` at the repo root, from its committed history — **do NOT commit it** (it's a working artifact for the PR, not part of the branch history).

## Resolve `<TICKET>` and `<BASE_BRANCH>`

- `<TICKET>` — the ticket key in the current branch name (e.g. `feature/ABC-123-...` → `ABC-123`) or in commit subjects. If neither yields a confident match, ask the user.
- `<BASE_BRANCH>` — the repo's default branch: `origin/HEAD`, then `main`, then `master`. Ask if none exists.

If `git log --format='%an' <BASE_BRANCH>..HEAD | sort -u` names more than one author, name them in the description so reviewers know whose work the branch carries.

## Summarize the committed range

Scope is **committed changes only** — never include uncommitted working-tree state.

1. List commits: `git log --oneline --reverse <BASE_BRANCH>..HEAD`.
2. Get the file-level diff: `git diff <BASE_BRANCH>...HEAD --stat` (three-dot range: merge-base to the PR branch).
3. For each changed area that isn't self-explanatory from the stat line alone, read the actual diff (`git diff <BASE_BRANCH>...HEAD -- <path>`) to understand *what* changed and *why* — enough to describe the resulting behavior, not the mechanics of how it was edited.
4. Group the changes into a small number of areas (feature/page work, bug fixes, theme/styling, i18n, tests, config) — don't organize by commit or by chronology; don't narrate back-and-forth iteration; describe the end state.

## Write `<TICKET>.md` at the repo root

Shape:

- `# <TICKET>: <one-line title>` — title is a short description of the overall change, not the ticket number restated.
- `## Summary` — 1-3 sentences. What this branch does and why, in plain language a reviewer unfamiliar with the details can follow.
- `## Changes` — bullet list grouped by area (bold area label, then terse description). Mention concrete behavior changes and any non-obvious technical reasoning (e.g. "X instead of Y because Z browser/engine doesn't support it"). Skip implementation trivia that doesn't affect reviewers' understanding.
- `## Known gaps` (only if applicable) — anything explicitly deferred/out-of-scope, especially if called out in a code comment or commit message.
- No fluff: no "this MR...", no restating the ticket title, no emoji.

### Style

- Terse. Prefer one bullet per area over a paragraph.
- Describe the *result*, not the editing process — a reviewer cares that "the label column no longer stretches," not that three different CSS approaches were tried.
- Preserve genuinely useful technical rationale (cross-browser quirks, deliberate tradeoffs, deferred work) since that's exactly what a reviewer needs and won't get from the diff alone.
- Skip changes that are purely internal tooling/process unless the user asks for full coverage.

## Do NOT commit `<TICKET>.md`

The MR description file is a working artifact for the PR, not part of the branch history. If it would be swept into a `git commit` (e.g. a broad `git add .`), leave it staged or excluded on purpose, and say so. After writing the file, report its path (e.g. `ABC-123.md` at the repo root).
