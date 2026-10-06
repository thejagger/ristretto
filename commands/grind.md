---
description: Honest refinement review of a feature — plain-language summary, story-point estimate, the problems it actually has, and a Ready / Not-Ready verdict. Read-only.
argument-hint: "<feature: paste text/ACs, or an ID + description>"
---

You are running **GRIND** — an honest refinement review of one feature, for use in a refinement session. Read-only: assess and print, change no files.

Feature: $ARGUMENTS

Match the feature's language (German input → German output).

## Don't guess at what you can't see

If the feature references links, internal pages (Jira, NGS knowledge base), screenshots, or attachments you can't access, **stop and ask the user to paste the content**, naming exactly what you need. Don't invent acceptance criteria or scope from an inaccessible link — a review built on guesses is worse than no review.

## Be honest

This is the whole point of the command. Don't rubber-stamp. Call out vague acceptance criteria, hidden scope, undefined approach, and risky assumptions plainly. If it isn't ready, say so and say why.

## Output

**Summary** — 2–3 sentences, plain language: what the feature delivers and why. Written so it can be read aloud in refinement.

**Story points** — one Fibonacci number with a one-line reason. Scale: `1` trivial · `2` small · `3` small-medium · `5` medium, some unknowns · `8` complex / multiple components · `13` large, big unknowns or cross-team deps · `21` too large, split it · `?` can't estimate, discuss first. Points measure cognitive/reasoning complexity, not hours. When torn, estimate up or use `?`.

**Problems & risks** — the honest part. Concrete items only: missing or vague ACs (missing ACs usually mean hidden scope), undefined approach, open architectural decisions, dependencies / blockers, edge cases and regression risk, anything likely to double the work.

**Verdict — Ready / Not Ready**
- *Ready*: clear goal, at least 2–3 meaningful ACs, no blocking unknowns, dependencies identified, fits one sprint (≤ 13).
- *Not Ready*: list the questions to ask in refinement and what has to change to reach Ready. **Name the specific `Contract` fields that can't be filled yet** — `Acceptance` (no checkable criterion), `Provides` (the public surface isn't decided), `Decisions` (an open ruling) — so the output drops straight into `/ristretto:prep <feature> deep` as an agenda.

Call out **manual checks** in *Problems & risks* wherever the feature implies one: a schema change, a migration, a secret or env var, a switch in a third-party console. These don't make a feature Not Ready — they belong in `Contract.Manual-Checks` and get built around — but a refinement session is the cheapest place to notice that someone will need database access on the day it ships.

Acknowledge what was given versus what you inferred, and flag any inferred acceptance criteria as inferred.

## Tasting note

Close with a single coffee-themed line that mirrors the verdict — make it fit the specific feature where you can:

- *Ready* → e.g. `☕ Clean extraction — ready to serve.`
- *Not Ready* → e.g. `Under-extracted — back on the grind before it's ready.`
- `?` / too large → e.g. `Beans unweighed — can't pull a shot from this one yet.`

One line only.
