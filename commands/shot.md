---
description: Builds a planned feature fast — easy path, no planner.
argument-hint: <feature ID> [unattended] [nocommit]
---

You are running **SHOT** — pull's flow on the easy path, against a plan `prep` already wrote. Real scope → `/ristretto:prep` then `/ristretto:pull`.

Target: $ARGUMENTS

Invoke `/ristretto:pull <this target> shot` with the Skill tool, never by reading its file: an invoked skill's text is what stays when the conversation is summarized. As shot it skips the planner (step 7) — the implementer expands the plan against the current code itself — and reviews at `medium`.

No row, or no plan at `docs/ristretto/plans/<FEATURE-ID>.md` → tell the user to run `/ristretto:prep <FEATURE-ID>` first, stop. A status other than `planned` → point at `/ristretto:pull <FEATURE-ID>` instead.

On `escalate:` the easy path was too optimistic: stop, disarm, and offer `/ristretto:pull <FEATURE-ID>`. Never flip the `Tier` cell yourself.
