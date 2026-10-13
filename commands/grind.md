---
description: Honest refinement review of a feature — researches it once, then a plain-language summary, story-point estimate, the problems it actually has, and a Ready / Not-Ready verdict.
argument-hint: "<feature: paste text/ACs, or an ID + description> [fresh]"
---

You are running **GRIND** — an honest refinement review of one feature, for use in a refinement session. You research the feature once and write that down; beyond `docs/ristretto/research/<ID>.md` and new `unconfirmed` entries in `docs/ristretto/domain/`, you change no files, and you commit nothing — the user commits the research with the rest of refinement.

Feature: $ARGUMENTS  (add `fresh` to research again even when the research is current)

Match the feature's language (German input → German output).

## 0. Format

`node "${CLAUDE_PLUGIN_ROOT}/scripts/version.js" check`. Exit 1 → print one line, `⚙ this project was written for an older ristretto format — the next prep/pull/brew will bring it up to date`, and carry on: research does not depend on the roadmap's shape. Exit 3 → `⚙ this install is older than the project's format — update the plugin`, and stop.

## 1. Research — once

The ID is the tracked ID, verbatim. A raw idea has none: mint the slug `prep` would (a short kebab slug from the title) and print it, so `prep` finds the same file.

`node "${CLAUDE_PLUGIN_ROOT}/scripts/research.js" stale <ID>`

- Exit 0 and no `fresh` → reuse it: say `research from <date>, at <commit>`, and read `docs/ristretto/research/<ID>.md`.
- Otherwise → `node "${CLAUDE_PLUGIN_ROOT}/scripts/research.js" snapshot`, then dispatch a **researcher** subagent — fresh context, capable model:

  > Feature: <the feature text>. ID: <ID>. Write `docs/ristretto/research/<ID>.md`.
  > Read `${CLAUDE_PLUGIN_ROOT}/briefs/researcher.md` and follow it.

  When it returns, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/research.js" check-domain`. Exit 1 → it undid domain changes the run was not allowed to make; name them under *Problems & risks*. Exit 2 → the domain store was not checked (no snapshot — another research run took it); say so there too. Then read the research file.

  Entries the research touched that carry a `conflict —` field: list them under *Problems & risks* with `settle with /ristretto:prep facts` — grind changes nothing.

## Don't guess at what you can't see

If the research lists something under `not reached` that the feature depends on — a ticket, an internal page (Jira, Notion, NGS knowledge base), a screenshot, an attachment — **stop and ask the user to paste the content**, naming exactly what you need. Don't invent acceptance criteria or scope from an inaccessible link — a review built on guesses is worse than no review.

## Be honest

This is the whole point of the command. Don't rubber-stamp. Call out vague acceptance criteria, hidden scope, undefined approach, and risky assumptions plainly. If it isn't ready, say so and say why.

## Output

**Summary** — 2–3 sentences, plain language: what the feature delivers and why. Written so it can be read aloud in refinement. Then one line: `Why: <the stated why>` — or `Why: not stated`, followed by the research's candidates, labelled as proposals for a person to pick or rewrite.

**Story points** — one Fibonacci number with a one-line reason. Scale: `1` trivial · `2` small · `3` small-medium · `5` medium, some unknowns · `8` complex / multiple components · `13` large, big unknowns or cross-team deps · `21` too large, split it · `?` can't estimate, discuss first. Points measure cognitive/reasoning complexity, not hours. When torn, estimate up or use `?`.

**Problems & risks** — the honest part. Concrete items only: missing or vague ACs (missing ACs usually mean hidden scope), undefined approach, open architectural decisions, dependencies / blockers, edge cases and regression risk, anything likely to double the work. A missing why goes here — it never changes the verdict. Cite domain facts with their source. Anything the research lists as `Already settled` is cited, not asked again.

**Verdict — Ready / Not Ready**
- *Ready*: clear goal, at least 2–3 meaningful ACs, no blocking unknowns, dependencies identified, fits one sprint (≤ 13).
- *Not Ready*: list the questions to ask in refinement — including every blocking item under the research's `## Open` — and what has to change to reach Ready. **Name the specific `Contract` fields that can't be filled yet** — `Acceptance` (no checkable criterion), `Provides` (the public surface isn't decided), `Decisions` (an open ruling) — so the output drops straight into `/ristretto:prep <feature> deep` as an agenda.

Call out **manual checks** in *Problems & risks* wherever the feature implies one: a schema change, a migration, a secret or env var, a switch in a third-party console. These don't make a feature Not Ready — they belong in `Contract.Manual-Checks` and get built around — but a refinement session is the cheapest place to notice that someone will need database access on the day it ships.

Acknowledge what was given versus what you inferred, and flag any inferred acceptance criteria as inferred.

## Tasting note

Close with a single coffee-themed line that mirrors the verdict — make it fit the specific feature where you can:

- *Ready* → e.g. `☕ Clean extraction — ready to serve.`
- *Not Ready* → e.g. `Under-extracted — back on the grind before it's ready.`
- `?` / too large → e.g. `Beans unweighed — can't pull a shot from this one yet.`

One line only.
