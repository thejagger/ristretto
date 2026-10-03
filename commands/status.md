---
description: Print the project roadmap — a read-only view of what's planned, in progress, and done. Changes nothing.
argument-hint: '[optional filter: "open", "done", "blocked", "checks", "review", "easy", a flight slug, or a feature ID]'
---

You are running **STATUS**. This is **read-only** — do not create, modify, archive, or implement anything.

Filter (optional): $ARGUMENTS

0. Check the format first: `node "${CLAUDE_PLUGIN_ROOT}/scripts/version.js" check`. On exit 1, print one line above the gauge — `⚙ this project was written for an older ristretto format — the next prep/pull/brew will bring it up to date` — and then **carry on and print the status anyway**. This command is read-only and it is what people run to orient themselves; refusing to show the roadmap because of a format mismatch would be the least helpful possible moment to stop. Just don't let a stale row read as current. On exit 3, print one line — `⚙ this install is older than the project's format — update the plugin` — and stop; a stale install can't be trusted to read the roadmap correctly.
1. Read `docs/ristretto/roadmap.md`. If it doesn't exist, tell the user there's no roadmap yet and to run `/ristretto:prep` to start one, then stop.
2. **Brew gauge.** Lead with a 10-segment gauge of done / total, filled proportionally (round to nearest segment), e.g.:
   `☕ [█████░░░░░] 5/10 brewed`
   If any feature is `needs-human`, add one line under it: `🔧 2 waiting on you — /ristretto:status checks`.
   If any feature is `needs-review`, add one line under it: `👀 3 waiting on your judgement — /ristretto:status review`.
3. Print a one-line count summary: planned / in-progress / blocked / needs-human / needs-review / done.
4. Print the roadmap rows. If a filter was given, show only matching rows:
   - `open` → everything not `done` (a `needs-human` or `needs-review` row is still open — its code is built, but something is unproven or unjudged)
   - `done` → only `done`
   - `blocked` → only `blocked`, each with its recorded reason — this is the **refinement queue** after a `brew` run
   - `checks` → only `needs-human`, each with its outstanding step read from `docs/ristretto/manual-checks.md` (`- [ ]` items only) — this is the **do-it-yourself queue**, and a different job from refining a spec
   - `review` → only `needs-review`, each with its `## Open findings` read from `docs/ristretto/plans/archived/<ID>.md` and any `decision taken:` line from its `## Evidence` — this is the **judgement queue**: the code is built and green, a reviewer still objects, and you decide. Show the `decision taken:` lines first and mark them `⚠` — a question `brew` answered on its own authority is the thing most worth a human's eye, and it is the only place in ristretto where that happens. Resolve one with `/ristretto:pull <ID>`.
   - `easy` → only rows whose `Tier` is `easy`
   - a feature ID → just that row
   - a flight slug → only rows in that flight

   If any rows carry a `Flight`, group the output by flight (standalone `—` rows last under "Other"). Within a group, a feature still waiting on an unfinished `Depends:` prerequisite gets a small `⏳` marker so it's clear why `pull next` would skip it — only a `blocked` prerequisite earns that marker, since `done`, `needs-human` and `needs-review` all satisfy a dependency. A `needs-human` row itself gets a 🔧 and a `needs-review` row a 👀. Don't over-decorate — one marker, no analysis.

   Show each row's `Tier`. Mark an `easy` row plainly (e.g. a trailing `· easy`); leave `normal` unmarked, since it is the default and marking it would be noise on every row. A row that escalated reads `normal` — the ratchet rewrote it — and its `## Evidence` records what it escalated from.
5. If nothing matches the filter, say so plainly.
6. **Milestone.** If every feature is `done` (gauge full), replace the gauge with a full celebratory cup:
   ```
      ) )  ( (
   .__________.
   |          |]
   |          |
   `----------'
   ALL BREWED — roadmap clear ☕
   ```

Keep it tight — just the picture of where the project stands. No analysis unless asked.
