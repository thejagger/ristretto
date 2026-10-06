# Format migration

**This is not a command.** No one runs it, and it is not in the menu — a user should never have to know their project has a format. A command that finds an out-of-date project reads this file and applies it, then carries on with what it was actually asked to do.

Nothing here is a product decision. You are changing the *shape* of records, never their meaning: no criterion is added, removed, or reworded, no status is invented, no plan is re-planned. If a migration step would require deciding something, it doesn't — stop and say so instead.

## 1. Say what is about to happen

You already know the project is behind — that's why you're reading this. Announce it before touching anything. Not optional, and not a progress note: this rewrites plans the user wrote, and they should know as it happens rather than find it in a diff later.

```
⚙ ristretto: this project was written for format <old>; this is <new>.
  Bringing docs/ristretto/ up to date first — <n> plan(s), the roadmap, and .ristretto.json.
  Shape only: no criterion, decision, or status meaning changes.
```

If the working tree is dirty, say the migration will be mixed into their uncommitted work, and offer to stop so they can commit first — it is far easier to review as its own diff.

## 2. Apply every block below the project's recorded format

Each block is cumulative — an unstamped project gets all of them, in order. Do the mechanical renames with exact-match edits; never regenerate a file from scratch, because that loses everything the format doesn't know about.

### → 0.13 — contracts, one human state, and classified criteria

1. **Roadmap statuses:** `needs-ops` → `needs-human`. No other status changes.
2. **`docs/ristretto/manual-ops.md` → `docs/ristretto/manual-checks.md`** (rename the file; keep its history by using `git mv` if the file is tracked). Inside it, and in the header text:
   - `- [ ] **before** · <where> · <what>` → `- [ ] **proves** · <criterion> · <where> · <what>`
   - `- [ ] **after** · <where> · <what>` → `- [ ] **deploy** · — · <where> · <what>` (the `deploy` lane is retired in 0.15 below; a project migrating straight from 0.12 will convert these once and then park them in the same pass)
   - **Preserve every tick.** A `- [x]` stays `- [x]`. Re-ticking is the user's signature, not yours, and silently un-ticking one would make ristretto re-run work a human already did.
   - For a `proves` line, the criterion it proves is usually already recorded on its `_blocks:_` line — move it into the new slot. If it genuinely isn't recorded, write `?` and list that line in your summary rather than guessing which criterion it belongs to.
3. **Plans** in `plans/` and `plans/archived/`: `Manual-Ops:` → `Manual-Checks:`, with the same line-shape change as above.
4. **Classify every acceptance criterion** in `plans/` with `[auto]` or `[human]`. Archived plans are history — leave them alone.
   - `[human]` is anything no test or gate can prove: it needs a person to **run** something (a migration, a secret, a console switch, a signing step) or to **look at** something (a layout, an animation, copy in another language).
   - Everything else is `[auto]`. When genuinely unsure, mark `[auto]` — a criterion wrongly marked `[human]` silently stops being tested, which is the worse error.
   - **Every criterion you marked `[human]` goes in your summary, listed.** This is the one judgment in the whole migration, and the user needs to see it to correct it.
   - A `[human]` criterion with no matching line in `manual-checks.md` needs one. Add it with `?` for the "what to do" and flag it — you know a person must do something, not what.
5. **`.ristretto.json`:** add `testChanged` and `formatPaths` if absent, exactly as `pull` step 3 describes. Never change a command the user already wrote.

### → 0.14 — tests are compared, not just counted

Nothing on disk changes shape. This block exists to tell the user about one new capability, once,
rather than leaving it in a README they will never open.

Say this:

```
☕ ristretto 0.14 can tell NEW test failures from ones that were already there — which
  means brew no longer needs a fully green suite to run. Failures already present when a
  feature starts are tolerated and counted; only new ones block, and the set can never grow.
  It needs your test command to write a machine-readable report. Want me to set that up?
```

**If they say yes, find out how — do not write a flag from memory.** Follow `pull` step 3's
discovery: read what the repo already does, try it, probe the result, and write `testReport` only
once a report has actually parsed. **If it cannot be made to work, write nothing** and say what it
would take. A `testReport` naming a file that never appears makes every gate report a missing
report, forever. This is a shape migration; adding a config key that does not work is a change in
meaning, and worse than leaving the feature off.

**Also, for a project that predates `## Contract` entirely:**

6. Plans with no `## Contract` section: move `Acceptance:` under a new `## Contract`, and add `Provides:`, `Consumes:`, `Decisions:`, `Units:`, `Manual-Checks:` as `—` where unknown. **Leave them `—`.** Filling them in is `prep`'s job with the user present — inventing a `Provides:` here would poison every dependent feature's planner, which reads it as fact.
7. Move `Blockers:` from `## Approach` into `## Contract` if it's in the old place.
8. Say in your summary which plans came out with empty Contract fields, and suggest `/ristretto:prep <ID> deep` for any that are still `planned` — a thin contract is the single largest cause of an inaccurate build.

### → 0.15 — checks mean "out of reach", and review findings have somewhere to live

1. **Retire the `deploy` lane.** A `deploy` line was a rollout step — a prod backfill, a key rotation, a flag for real users. ristretto no longer tracks those at all: it is a development loop, and production is not its business. **Do not delete them** — a person wrote them and may still need to do them. Move every `- [ ] **deploy**` line (ticks preserved exactly) to the bottom of `docs/ristretto/manual-checks.md` under:

   ```markdown
   ## Retired — not tracked by ristretto
   Rollout steps from an older format. ristretto no longer reads this section;
   keep or delete it as you like.
   ```

   List them in your summary. A `- [ ] **proves**` line is untouched.

2. **Add the third field to `proves` lines** where it is obvious and leave it alone where it is not: the shape is now `- [ ] **proves** · <criterion> · <what was out of reach> · <what to do>`. The old "where a human does it" slot usually already holds it (`Supabase SQL editor`); keep the text as-is. Never invent a reason.

3. **Say this, once:**

   ```
   ☕ ristretto 0.15 narrowed what counts as a manual check. It now means one thing:
     the repo gave the agent no path to it. A migration your dev stack already applies,
     or a screen your tests can drive, is no longer a check — it's a test. Nothing about
     production is ever a check any more.

     I have NOT reclassified your existing [human] criteria. The planner re-settles each
     one against the actual code on the next pull or brew, and dropping the ones it can
     reach is now its job — so this corrects itself as you go. To settle a plan sooner,
     run /ristretto:prep <ID>.
   ```

   **Do not bulk-reclassify `[human]` → `[auto]` here.** It looks like a tidy mechanical sweep and it is not: whether a criterion is reachable depends on the code, this file's whole job is shape rather than meaning, and the planner already does it properly with HEAD in front of it. Reclassifying blind would silently stop testing things or start claiming things that cannot be proven.

4. **The `needs-review` status is additive** — nothing on disk changes. No existing row can be one, and `brew` writes them from now on.

### → 0.16 — features carry a tier

1. **Roadmap table:** add a `Tier` column between `Title` and `Status`, in both the header row and the separator row beneath it.
2. **Every existing row gets `normal`.** This is not a judgement, and you must not make one: `normal` is exactly the behaviour every existing row already had, so a migrated project builds identically to how it built yesterday. Never infer `easy` from a row's title, size, or status — inferring would be deciding something, which a migration may not do.
3. Nothing else changes. No plan file is touched, no status reinterpreted, no criterion reclassified.

### → 0.17 — every rule in one place, and gate.js owns `.ristretto/`

1. **Roadmap `Tier` cells hold one token.** A forced-easy run used to append `easy` to the cell, leaving rows that read `normal easy`. Keep the first token only. The forced label is not lost: the archived plan's `## Evidence` already records `tier: easy (forced)`, which is where it belongs.
2. Nothing else on disk changes shape. Archived plans written before 0.17 record their review verdict in prose; from 0.17 the closer writes a fixed line (`review: … · rounds: <n> · open: …`), and `brew`'s report reads that line. Older plans are left as they are — an archived plan is history.
3. **Say this, once:**

   ```
   ☕ ristretto 0.17: gate.js now owns .ristretto/. Run `gate.js state` before touching anything
     in there by hand — a marker left by a run that died no longer gates other sessions, and a
     dirty tree it reports PROVEN GREEN is finished work to commit, not to discard.
     `shot` now builds a feature `prep` already planned; it no longer writes plans itself.
   ```

### → 0.18 — the roadmap as a live side pane

1. Nothing on disk changes shape. The board reads the roadmap, the plans' `Blockers:` and `.ristretto/pulling` as they already are, and writes none of them.
2. **Say this, once:**

   ```
   ☕ ristretto 0.18: /ristretto:status now opens the roadmap as a live side pane — progress,
     the running feature's phase, review round and gate, what needs you, and a start per
     planned row. It opens by itself where the layout docks a pane; a filter still prints text.
   ```

## 3. Stamp, report, and carry on

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/version.js" stamp
```

Then report, in this order:

1. What changed, by file count: plans updated, roadmap statuses renamed, checklist lines reshaped, config keys added, rollout lines parked.
2. **Every criterion you classified `[human]`**, listed, so the user can correct any you got wrong.
3. Anything you marked `?` because the old format didn't record it.
4. Plans left with empty Contract fields, and the `prep ... deep` suggestion for the ones still `planned`.
5. That the migration is uncommitted and worth reviewing as its own commit.

Never commit the migration yourself unless the user asked you to — reviewing a rewrite of your own plans is exactly the thing that shouldn't be automatic.

Then **continue with the command the user actually ran.** The migration is not the errand; it is the thing that had to be true first.

## Hard rules

- **Shape, never meaning.** No criterion added, removed, or reworded. No status invented. No plan re-planned. No box ticked or un-ticked.
- **Archived plans are history.** Rename fields inside them so they stay readable, but never reclassify or rewrite their content — an archived plan is the evidence of what was actually built.
- **Never migrate downward.** A project newer than the plugin is a stale install; say so and stop.
- **One judgment only** — `[auto]` vs `[human]` on a project arriving from 0.12 or earlier — and it is always reported, never silent. Once a project is at 0.13 or later that classification is settled; a later block never revisits it, however much a rule change might seem to invite it.
