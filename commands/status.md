---
description: Shows the project roadmap — as a live side pane where ristretto's mod can dock one, as text with a filter. Changes nothing, apart from a project's one-time format migration.
argument-hint: '[optional filter: "open", "done", "blocked", "checks", "easy", a flight slug, or a feature ID]'
---

You are running **STATUS**. This is **read-only** — do not create, modify, or implement anything. The one exception is step 0's format migration.

Filter (optional): $ARGUMENTS

0. Check the format first: `node "${CLAUDE_PLUGIN_ROOT}/scripts/migrate.js" check`. On exit 1, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/migrate.js" apply`, print one line above the gauge — `⚙ migrated this project to ristretto format 0.22` — commit what it changed under `docs/ristretto/` as `docs(ristretto): migrate to format 0.22`, and carry on. If `apply` refuses (it names why: a dirty `docs/ristretto/`, a plan in two places), print its reason in that line and **print the status anyway** — refusing to show the roadmap would be the least helpful possible moment to stop; just don't let a stale row read as current. On exit 2, say the roadmap carries no format stamp and print it as it is. On exit 3, print one line — `⚙ this install is older than the project's format — update the plugin` — and stop; a stale install can't be trusted to read the roadmap correctly.
1. Read `docs/ristretto/roadmap.md`. If it doesn't exist, tell the user there's no roadmap yet and to run `/ristretto:prep` to start one, then stop.
2. **Brew gauge.** Lead with a 10-segment gauge of done / total, filled proportionally (round to nearest segment), e.g.:
   `☕ [█████░░░░░] 5/10 brewed`
   If any `done` feature's plan still has an open box or open findings, add one line under it: `🔧 2 waiting on you — /ristretto:status checks`.
3. Print a one-line count summary: planned / in-progress / blocked / done.
3a. **Domain facts in conflict.** If `docs/ristretto/domain/` holds entries with a `·` field starting `conflict`, print one line: `📖 <n> domain facts in conflict — /ristretto:prep facts`. Facts without a conflict are context; they are no to-do and get no line.
4. Print the roadmap rows. If a filter was given, show only matching rows:
   - `open` → everything not `done`
   - `done` → only `done`
   - `blocked` → only `blocked`, each with its recorded reason — this is the **refinement queue** after a `brew` run
   - `checks` → only `done` rows whose plan (`docs/ristretto/plans/<ID>.md`) still asks a person something, each with what it asks: its open decisions first, marked `⚠` — a question an agent answered on its own authority is the thing most worth a human's eye; then its open `[ ] [human]` boxes with their `how:` lines; then its `## Open findings`, as "open findings". This is the **your-turn queue**: say "manual checks done" or "decisions ok" in the chat once they are.
   - `easy` → only rows whose `Tier` is `easy`
   - a feature ID → just that row
   - a flight slug → only rows in that flight

   If any rows carry a `Flight`, group the output by flight (standalone `—` rows last under "Other"). Within a group, a feature still waiting on an unfinished `Depends:` prerequisite gets a small `⏳` marker so it's clear why `pull next` would skip it — only a prerequisite that is not `done` earns that marker. A `done` row whose plan still asks a person something gets a 🔧. Don't over-decorate — one marker, no analysis.

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
