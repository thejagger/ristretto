---
description: Plans features into the roadmap. No code.
argument-hint: <feature IDs, pasted feature text, or short descriptions> [deep]
---

You are in the **PREP** phase of ristretto. You plan; you do **not** write or modify any implementation code. The code is written fresh later, by `pull`.

Inputs to prep: $ARGUMENTS  (add `deep` to force roast mode on every input)

Each input is one of: a **tracked feature** (has an ID like `BREW-224` — keep that ID exactly, it's how the work is tracked in git), a **raw idea** you want to build, or a **feature too big** to plan as one unit.

## 0. Check the project's format version — before anything else

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/version.js" check
```

Exit 0 → continue. Exit 1 → follow what it printed. Exit 3 → the project is newer than this plugin: stop and report a stale install. Exit 2 → cannot tell: stop.

## Setup

Work against the project roadmap at `docs/ristretto/`. Create these if missing — do not ask, just create:

- `docs/ristretto/roadmap.md`
- `docs/ristretto/plans/`
- `docs/ristretto/plans/archived/`

If `roadmap.md` is new, start it with this table:

```
# Ristretto Roadmap
<!-- ristretto-format: x.y -->

| Flight | Feature | Title | Tier | Status | Plan | Updated | Files touched | Commit |
|--------|---------|-------|------|--------|------|---------|----------------|--------|
```

Don't write the stamp by hand — create the roadmap, then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/version.js" stamp`, which fills in the version this plugin actually is. A hand-typed version is a guess, and a wrong one sends the next command into a migration the project doesn't need.

Status values: `planned` · `in-progress` · `blocked` · `needs-human` · `needs-review` · `done`.
Tier values: `easy` · `normal`. `normal` is the default and is what every feature got before 0.16.
`blocked` is set by `pull`/`brew` when a feature can't proceed without a **decision** — the row carries a one-line reason. Re-prepping a `blocked` feature (refining its plan to resolve the reason) flips it back to `planned`.
`needs-human` means the opposite kind of stuck: the spec is fine and the code is built, but the repo gave the agent **no path to something a criterion needs** (see *Manual checks* below). It is a closing status, not a blocking one.
`needs-review` is the third kind: the code is built, committed and gated **green**, but review findings are still open after three rounds. Nothing is wrong with the spec and nothing is unreachable — a reviewer simply still objects, and a person should judge it. Also a closing status. Only `brew` writes it; `pull` runs with you present, so it surfaces the findings to you instead.
Flight: a short kebab slug grouping related features, or `—` for a standalone feature.

## Decompose only when there's a real seam

Default to **one** plan per input. The ID is the git-tracking key, so don't multiply keys without cause — over-splitting is the failure mode and the opposite of what ristretto is for.

Split one input into several only when there's a genuine seam:

- independently shippable deliverables, or
- separate acceptance contracts (no shared definition of "done"), or
- it would estimate **≥ 21** (`grind`'s "too large, split it" line).

When unsure, keep it whole. Before writing any plans, **print the proposed split** — one line per resulting feature — and let the user merge or veto it. Then plan each resulting feature below.

### IDs — never drop the git-tracking number

- **Tracked feature, not split:** use its ID verbatim (`BREW-224`).
- **Split of a tracked feature:** keep the number, add a short kebab suffix — `BREW-224-otp-resend`, `BREW-224-rate-limit`. The number stays greppable in git; the suffix says which part.
- **Raw idea (no number):** mint a plain descriptive slug from the title — `login-rate-limit`, `dark-mode-toggle`. No prefix — once planned it's just a feature, and the `Source:` line records that it began as an idea. Keep it short; it must be unique in the roadmap.
- Record the origin in the plan's `Spec` (`Source:` line below) so a split or idea still points back to where it came from.

### Flights & dependencies — record the shape, don't schedule it

When inputs belong together — a split of one feature, or several features that form one deliverable — give them a shared **Flight** slug (kebab, e.g. `dpk-detail`). A lone feature with no siblings gets `—`. This is just a grouping label; it changes nothing about how a feature is planned or pulled.

When one resulting feature can't start until another lands, record it with **`Depends:`** (the prerequisite feature IDs) on the dependent plan. When two are independent and could be worked side by side, note it with **`Parallel-with:`**. Both default to `—` (no constraint). These are honest notes about the graph — `pull next` reads `Depends:` to avoid pulling a feature whose foundation isn't built yet; `Parallel-with:` is informational. ristretto stays one-feature-at-a-time; you're recording order, not running waves.

A `Depends:` is satisfied by a prerequisite that is `done`, `needs-human` **or** `needs-review` — all three have their code built and their `Provides:` present; what is outstanding is a step someone must run or an opinion someone must judge, not missing code. Only `blocked` holds dependents back.

Keep it light: only add `Depends:` where a real prerequisite exists. Most features depend on nothing.

## For each resulting feature

1. **Fast by default; deep on demand or on failure.**

   - **Fast (default):** scope clear → write the plan. Push back once on a vague criterion with a sharpened version to confirm.
   - **Deep (`deep` argument, or automatic):** enter roast mode. **Escalate automatically the moment you cannot write a checkable acceptance criterion, cannot fill `Provides:` for a feature that something else `Depends:` on, or hit a product decision the input does not settle.** Each of those used to become a silent `Blockers:` line, or worse, a decision `brew` discovered at 3am and had to stop on. Here it becomes a conversation, while you are still in the room.

   **Roast mode:**
   1. One question at a time. Always attach your **recommended answer** — your best inference — so the user confirms, corrects, or redirects rather than composing from scratch.
   2. **If the answer is in the codebase, a doc, or the ticket, read it — don't ask.** Only surface what is net-new.
   3. Resolve upstream decisions before dependent ones. Walk each branch to its end before starting the next.
   4. **Write to the plan file after every single answer, before asking the next question.** The file is the source of truth, not the conversation. Never batch.
   5. Unanswerable → one line in `Blockers:` naming **who or what can answer it**, then move on. Never stall, never invent.
   6. Before closing: "Anything we haven't touched that should be in here?"

   Exit roast mode when every acceptance criterion is checkable **and carries a proof method**, `Provides:` is filled, and every decision the feature needs has a ruling in `Decisions:` — or when what's left is genuinely blocked and recorded as such.

   **Before that, sweep the dimensions its siblings already established.** The decisions that reach `brew` unmade are almost never the ones a plan got *wrong* — they are the ones it was *silent* about, and silence reads as "nothing to decide here" right up until an implementer needs an answer at three in the morning. The reliable source of them is the flight itself: read the `Decisions:` and `Provides:` of every sibling that is already `done` or `planned`, and list what those features made **cross-cutting** — a tenancy or ownership dimension, a role or permission source, a locale, a unit, an id scheme. For each one, this contract must either rule on it or say in one line that it does not apply. Not mentioning it is not a ruling.

   This is where a `planned` feature that later blocks comes from, every time: a flight adds a dimension, and the next feature's contract simply never mentions it. Asking the question costs a line; not asking it costs a whole brew.

2. **Make every acceptance criterion checkable** — by a test, a measurement, or a binary observation. This is the contract `pull` and `brew` are held to; a vague criterion makes the gates meaningless.
   - ✗ "improve the list" → ✓ "list renders 500 items in <100ms"
   - ✗ "better error handling" → ✓ "every failed API call shows a retry action within 1s"

   Push back **once** on a vague input, offering a sharpened version to confirm. If a criterion still can't be made checkable, that is the escalation trigger in step 1 — roast it out. Only what survives the roast unanswered lands in `Blockers:`, naming who or what can answer it; `brew` will skip the feature, and the blocked row names exactly what refinement is missing. Never write an unmeasurable criterion, and never invent one the user didn't confirm.

   **A ruling is not a criterion. Roast mode produces both, and only one of them earns a test.**

   Roast mode's whole job is to settle questions, and the answers land in `Decisions:`. What must not happen is the same answer being restated in `Acceptance:` — because every `[auto]` line becomes tests, so a decision copied up there is *the user's design choice, pinned by an assertion*. Two costs, and the second is the worse one: the suite carries tests that prove nothing a user can observe, and the decision can never be revisited without a red test to argue with. Measured on a real contract: of eleven `[auto]` criteria, three were rulings in disguise — "navigation works without JavaScript" (the ruling was *server-rendered, navigated by query string*), "no more than one database query per month displayed", and a token rule already enforced repo-wide.

   The test is **who can see it**. A user can see that the previous-month link works; a user cannot see whether it works by query string or by fetch. So the criterion is the behaviour, the mechanism stays in `Decisions:`, and the implementer honours it by writing the code that way — `pull` step 7 makes that binding, and the reviewer checks it by reading. Where a ruling has a consequence a user *can* observe, write that consequence and let the ruling stay a ruling.

   **Who can see it is the first question. The second is what a red test would mean.** A ticket's acceptance list is mostly design detail — nine columns in this order, twenty rows a page, the filter above the table, the link pinned to the right edge, the date without seconds. A user can see every one of them, so the first question waves them all through, each becomes an `[auto]` line, and each becomes an assertion that can only ever go red when someone deliberately adds a column or moves a label. Measured on one real ticket: of thirteen criteria that became tests, nine were exactly that, and the fix was to delete them. The cost is a pinned ruling's cost in both directions — a suite carrying tests no user can be harmed by, and a design that cannot be changed without arguing with a red test.

   So a criterion earns a test only where **red means a user is worse off**: a wrong value, a lost record, a dead link, an unhandled error, data in the wrong order where the order is the product. A line that describes the *arrangement* of what gets built — order, position, count, wording, styling — is a build instruction, not a behaviour: write it in `Decisions:` (or as a `Units:` line), where it binds the implementer exactly as firmly and the reviewer checks it by reading. It is not dropped and not weakened; it just never becomes an assertion. Same for anything that can only be false until the diff lands — a migration that ran, a fixture that matches another fixture — where the diff is the proof and a permanent test is a tautology.

   **And when a criterion is already proven, say so instead of ordering a test.** A repo several features in has a suite that already enforces a great deal repo-wide — escaping, tokens, locale, a schema guard. A criterion those already cover is not a gap: write it with the existing test named (`already enforced by FrontendTokensTest repo-wide; must stay green`), and the implementer writes nothing new for it. This is the cheapest line in a contract and it is almost never written, because looking costs a minute and nobody is asked to look. Ask.

   **The same goes for a sibling, and here the decision comes first.** When a feature needs logic a sibling already carries — a reload on a client switch, a failed-load handler, a save step — rule in `Decisions:` where that logic lives. The default is one function or service both screens call, even when the screens themselves stay separate components: lifting the logic is not a shared base component, and a sibling that keeps its own copy pays for it twice, once in code and once in a spec copied with the names swapped. Then the criterion cites the existing proof and asks for one wiring test, plus a test for whatever this screen does differently. Never write "same guarantees as X, re-asserted on this screen": that line orders the copy. Two limits keep the lift small. Re-point only the sibling this feature would have copied from; other screens carrying the same copy are a suggestion in the report, not this feature's scope. And when the lift leaves the existing proof in that sibling's spec, cite it where it is — the tests move to the shared code's own spec only when a later change touches them anyway. Measured on four list screens: each carried its own copy of the client-switch reload and its own 160–330-line spec for it, two of them identical but for 12 lines.

   **Then give every criterion a proof method — there are exactly two, and "none" is not one of them.**

   - **`[auto]`** — a test, a gate, or a measurement the agent can run proves it. The default, and the right answer far more often than it first looks.
   - **`[human]`** — **ristretto has no way to reach the thing this criterion is about.** Every `[human]` criterion gets a matching line in `Manual-Checks:` naming what was out of reach.

   **`[human]` is a statement about reach, never about subject matter.** "It involves a database", "it involves a screen", "it involves an external service" — those are subjects, and the subject decides nothing. The only question is whether a path exists from this repo to that thing. A migration the project's own dev stack applies — docker-compose, a `migrate` script, a test harness that migrates on boot — is reachable: the agent runs it, and the criterion is `[auto]`. The same migration against a hosted console with no credentials anywhere in the environment is not reachable, and that is a real `[human]`. Two features touching the same schema in two repos get different answers, and that is correct.

   **Assume reach until you have a concrete reason to believe otherwise.** Name the reason in the check — which credential, which console, which device. If you cannot name what specifically was out of reach, it wasn't; it was a test nobody wanted to write. A repo whose migrations, fixtures, generated files and services all live in its compose file has close to zero `[human]` criteria in it, whatever its features touch.

   **Nothing about production is ever a criterion.** This is a development loop. A rollout step, a prod backfill, a flag enabled for real users, a key rotated in a live system — these are not acceptance criteria, they do not go in `Manual-Checks:`, and they are not ristretto's business. If a criterion can only be proven in production, it is written wrong: rewrite it against dev, or it is a `Blockers:` line.

   **Something to look at is `[human]` only when the repo gives the agent no way to drive it.** If the project has a browser driver, a widget test, a snapshot harness — use it; "does the dropdown open" is then an ordinary `[auto]` criterion and writing it off as human is just an untested feature with a note attached. Where there is genuinely no way to render the thing, prefer reasoning about the markup and the component over deferring to a person. What survives is the narrow residue — a physical device, a real payment terminal, a rendering only a person can judge — and it should feel like a rare exception, because it is.

   **A criterion with no proof method is still the bug this rule exists to kill.** Unclassified is what made `brew` stop dead in the night waiting on an answer no one was awake to give. **Do not drop a criterion because it can't be automated** — that loses the thing you needed and the plan quietly stops describing the feature. But the fix for "hard to prove" is a test, and `[human]` is not the escape hatch for a criterion you did not want to write one for. Over-marking has a cost the loop cannot see and you pay by hand: every false `[human]` is an item you must read, evaluate and dismiss, and a checklist that is mostly noise is one nobody reads at all — including the entry that actually mattered.

3. **Write `docs/ristretto/plans/<FEATURE-ID>.md`**:

   ```
   # <FEATURE-ID> — <title>

   ## Spec
   - Source: <tracked ID, parent ID, or "idea">
   - Flight: <slug, or —>
   - Goal: one line.

   ## Contract
   - Acceptance:
     - [auto] <criterion a test, gate, or measurement proves>
     - [human] <criterion whose subject this repo gives the agent no path to>
   - Provides: <public surface this feature exposes, at type level —
       `sendOtp(phone: string): Promise<OtpToken>` — or — >
   - Consumes: <surface from Depends: features this one calls, same form, or — >
   - Decisions: <resolved question -> the ruling, one line each>
   - Units: <the 2-6 units of work inside this feature, one line each, or — >
   - Manual-Checks: <proves · which criterion · what was out of reach · what to do,
       one line each, or — >
   - Blockers: <what could not be made checkable -> who/what can answer, or — >

   ## Approach
   - Strategy in prose.
   - Likely touchpoints: src/... (orientation, NOT exact edits)
   - Depends: <IDs, or —>
   - Parallel-with: <IDs, or —>

   status: planned
   ```

4. **Fill `Units:` whenever the feature needs more than one red→green cycle** — 2–6 lines, each an independently testable deliverable inside this one feature. Only a genuinely single-cycle feature gets `—`.

   **This is the opposite default from "Decompose only when there's a real seam" above, and the two must not be confused.** Splitting one input into several *roadmap features* is discouraged — it multiplies git-tracking IDs. Naming the *units of work inside one feature* is encouraged and costs nothing: same ID, same plan, same branch, same commit. `Units:` is what `pull`'s planner expands into per-unit file paths, signatures, and tests; a feature that arrives with `Units: —` when it plainly has several is the single most common cause of a thin build plan and inaccurate code.

5. **Fill `Manual-Checks:` — exactly one line for every `[human]` criterion, and nothing else.** Each line is:

   `proves · <the criterion it proves> · <what was out of reach> · <what a person has to do>`

   Every line is the *only* proof of one `[human]` criterion and names it. There is no second kind of line: if it does not prove a criterion, it does not belong on this list. The code is still written, gated, reviewed and committed; that one criterion just isn't proven until a person ticks the box.

   **The list has no rollout lane.** There is nowhere here to record a prod backfill, a key rotation, or a flag enabled for real users, because ristretto never asks anyone to do those — see the production rule above. A `Manual-Checks:` that mentions production is a defect in this command, not a service to the reader.

   **In roast mode, push the other way.** For every `[human]` a feature arrives with, ask what specifically is out of reach and whether this repo really has no path to it — the dev stack that already applies migrations, the driver that can already press the button. Most survive that question as `[auto]`. This is the reverse of what this rule used to say, and deliberately: an unproven criterion is a cost the loop absorbs, while a false check is a cost the human pays, and the second one is the one that made people stop reading the list.

   Don't put the SQL or the command here; `Manual-Checks:` names the step. The exact thing to run is written by `pull`/`brew` into `docs/ristretto/manual-checks.md`, against the code as it actually ends up.

   `pull`/`brew` may also find that something prep thought was out of reach is not — the planner reads HEAD and finds the compose service or the test driver. Dropping a check for that reason is expected, not a prep failure. Adding one is expected too, on the same evidence, and in both directions the planner's finding wins: it looked at the code.

6. **Check `Consumes:` against `Provides:`.** When feature B lists A in `Depends:`, B's `Consumes:` must be a subset of A's `Provides:`. Check this at prep time and say so if it isn't — a mismatch here is the cheapest bug you will ever fix. Read A's plan wherever it lives, `plans/` or `plans/archived/`.

7. **Add or update one row** in `roadmap.md` for the feature — fill the `Flight` cell with its slug (or `—`), and the `Tier` cell with `normal` or `easy`. `pull`/`brew` fill `Files touched` and `Commit` at close; leave them `—` here. Fill every cell the header declares; a row short one cell shifts every column after it, and the next reader takes a status for a tier.

   **`easy` is a claim about the contract, not about the ticket.** It means: this contract is already concrete enough that a planner subagent would add nothing to it — the file paths, the real names and signatures, and the shape of the tests that prove each criterion are all decided here. A feature is not `easy` because it feels small or sounds quick; it is `easy` because its contract is finished. That makes the label checkable by reading the contract, rather than a feeling about the ticket.

   Note what follows: an `easy` label makes **your** job harder, not easier. With no planner to expand the contract into file paths and signatures, the contract itself has to carry them.

   **Write `easy` only with a reason**, as a `Tier: easy — <one clause>` line at the top of the plan's `## Approach`. `normal` is the default and needs no justification. The asymmetry is deliberate and is the same device the review's `note` findings use: the optimistic label is the cheap one, so it should cost a sentence. **When torn, write `normal`** — the ratchet only ever escalates, so an under-optimistic label costs nothing but a planner you would have run anyway, while an over-optimistic one costs an implementer stopping mid-flight.

## Hard rules

- **A `planned` feature that blocks on a decision is a prep failure, and belongs to this command.** Not to `brew` — `brew` did the only correct thing left to it. The plan went out saying every decision was made when one was not, and the cost lands hours later on an unattended run that had to stop. When you see a row blocked for a missing decision, read it as a defect report against this command: the question existed at prep time, and something here did not go looking for it. The sibling sweep in roast mode is what stops the common case; treat any block that gets past it as evidence that sweep needs to be wider, not as ordinary traffic.
- **`planned` means every decision is already made.** This is the load-bearing rule of the whole plugin. `brew` runs unattended and must never stop on a planned feature — so a feature is only `planned` when nothing is left for a human to *decide*: every criterion checkable and classified, every ruling in `Decisions:`, `Provides:` filled. If a decision is missing, the feature is `blocked` and says which decision — it does not go out as `planned` and get discovered at 3am. **A `brew` that stops to ask a question is a prep bug, not a brew bug.** Work left for a human to *do or look at* is not a decision and does not block: that is `[human]` + `Manual-Checks:`, and it closes as `needs-human`.
- **`## Approach` is the part that rots — keep it to one screen.** `## Contract` is drift-free by construction and should be as deep as the feature deserves: a criterion, a signature, or a decision is true regardless of what the code looks like on the day it's pulled. Thin contracts are the single largest cause of inaccurate implementation. Depth here is not ceremony.
- **The repo's house rules constrain the plan.** Read `CLAUDE.md` / `AGENTS.md` before writing the `## Approach`, and don't route around a documented constraint — if the house rules rule out the obvious approach, plan the one they allow, or record the conflict in `Blockers:`. Still no code; a documented constraint is part of the destination, not turn-by-turn directions. ristretto only ever *reads* those files and never writes to them.
- **No code** still holds everywhere: no code blocks, no line edits, no shell commands. A type-level signature in `Provides:`/`Consumes:` is a contract, not code — it names what exists, never how it works. You are batch-planning; by the time `pull` runs, the code will have moved, and `pull` expands the contract into real directions against HEAD.
- **The acceptance criteria are the contract.** They must define "done" independently of how the code currently looks.

## When done

Print a short summary: which features were planned, their titles, and the path to `docs/ristretto/roadmap.md`. Do not start implementing anything.
