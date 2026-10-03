# Common rules

Rules more than one role applies. Every role reads this file — it is a reference, not an essay.

## House rules

Read the repo's `CLAUDE.md` / `AGENTS.md`, including any nested one near the files you touch, before you start — they bind you even where the surrounding code doesn't demonstrate them yet. Never write to those files.

## Manual checks — the reach test

- **The reach test**: a manual check exists only where this repo gives you no path to a criterion's subject — not merely because the subject is a database, a screen, or an external service. Look for a path first: a compose file, a seed script, a driver already in the dev dependencies.
- **Never a check about production** — not yours, not the user's, not on the list.
- **Never tick a box yourself** — that's the user's signature the step really happened.

## Tests

The suite is a shared cost, paid again at every stop, by every feature, for the life of the repo.

- **Red first**: write the test, run it, confirm it fails before implementing. A test that passes before implementation proves nothing.
- **One test per criterion**, unless the criterion has genuinely independent cases.
- **Prove it at the cheapest level that is still honest** — a pure function over a component, a component over an HTTP request, over a browser — and say which criterion forced you lower.
- **Reuse before writing**: cite an existing test that covers the criterion instead of adding one. A criterion enforced repo-wide earns zero tests, and saying so is a complete proof.
- **Red must mean a user is worse off** — a wrong value, a lost record, a dead link, an unhandled error. If red could only mean *someone changed the design on purpose* — a column order, a label's wording, a style, the arrangement of chrome, a fixture matching a fixture, a migration that already ran — it is a change detector: like a `Decisions:` ruling, it binds the code and is read, never asserted. Sorting that works earns its test; the default sort is a ruling.
- **Test code where it lives, once**: shared code — a component, a service, a helper — is proven in its own test; each screen using it earns one wiring test plus tests for what it does differently. A spec copied from a sibling means the logic was copied too; the copy is the finding.
- **Find it by its label or key, never by position**: a test a reorder turns red was pinning the order.

## Lean code

- **Reuse before writing**: check for an existing utility or pattern before adding new code — catching duplication later costs more than not writing it.
- **No waste in the code**: no N+1 or hoistable recomputation, no copy-pasted logic, no scaffolding nothing needs yet (YAGNI).
- **Smallest diff that meets the criteria.**

## Gates

- **Never weaken, skip, or delete** a gate or a test to get green — gates are infrastructure.
- **A hung gate is unverified, not proven broken** — find what it's waiting on before going on.

## Evidence

- **How, not that**: evidence is how each criterion was proven — red→green test names, command output, measurements.
- **"Implemented successfully" is not evidence.**
- **A criterion waiting on a manual check is `pending human: <the check>`**, never proven.
