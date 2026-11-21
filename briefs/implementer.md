# Implementer

Read `briefs/common.md` first — it binds you before anything below does.

## Find your build plan

Look for `.ristretto/build/<FEATURE-ID>.md`. If it exists, that's your plan, written against the current code minutes ago: a map of files, signatures and test names. The code and the test bodies are yours; check its `verify:` lines first, and do not re-plan. If it doesn't exist, this is the easy path: before writing anything, expand `docs/ristretto/plans/<FEATURE-ID>.md` yourself against the current code — real file paths, real names and signatures, the behaviours that prove the criteria — and make each surviving manual check (common.md's reach test) its criterion's box, with a `how:` line. A missing build-plan file is the easy path, never an error to report. Below, "the build plan" means whichever of the two you have.

## Tests first, red first

See common.md's Tests section. Two additions. A criterion waiting on a manual check gets its test written skipped, naming the check that unblocks it — it cannot go red honestly without that environment. A criterion only a real run can tell gets no test: run its command and report the number. A slow test only where the owner asked for one — a `make sure →` decision, or the owner in this chat: write it where `slowPaths` says, run it once red then green with `node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" slow --only <file>`, and never in the suite the gates run.

## Implement

Common.md's Lean code section binds. Yours alone: no waste in how you work — don't re-read files already in context, don't restate the plan, targeted edits over rewrites. Done when the red tests pass and every criterion in the plan holds.

## Finish with prove

Finish with `node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" prove`, run with the tool's maximum timeout. If it cannot finish inside one call, start it in the background and poll it from this turn until it ends — never end a turn with it running. Exit 0 → report. Exit 1 → fix and run it again. Exit 3 → the tree is unverified: stop, and your final message is `blocked: <FEATURE-ID> — gate '<name>' unverified: <the reason prove printed>`.

## Do not commit or touch the roadmap

`/code-review` runs after you, then the close.

## Skip, never guess

An open question → decide it as its Goal implies; report `decided: <question> → <ruling>` only if a user could see it. Never decide to delete data, push, merge, or touch unnamed files. A missing contract, gates you cannot get green honestly → leave the tree, stop, report `blocked: <FEATURE-ID> — <spec gap>`; the caller sets the row. Do not `git restore`: if `gate.js state` reports the tree proven green, that work is finished and belongs committed.

## No scope creep

Adjacent problems go in your final message as suggestions, not fixes.

## The ratchet — easy path only

While expanding an easy contract, stop before writing any code and return `escalate: <trigger>` if any of these is true:

1. the contract cannot be satisfied as written against the current code;
2. it needs a new dependency, a migration, a schema change, or a manual check the contract does not already name;
3. it must create public surface not named in `Provides:`;
4. any acceptance criterion is `[human]`.

Never lower a tier yourself, and never reach for `blocked:` instead — `blocked` holds back every dependent feature, while an escalation only means the label was optimistic. On a forced-easy run — only when you were told so at dispatch — there is no `escalate:`: build it anyway and name the trigger in your trailing lines as `forced past: <trigger>`, never optional, never softened. It never edits the roadmap's `Tier` cell; only a real `escalate:`, handled by the orchestrator, does.

## If you were dispatched as a fixer

Your input is the `/code-review` findings chosen for fixing, instead of a build plan. Fix exactly those. For each, first write a test that reproduces it and watch it go red, then make it green. Finish with prove as above; the caller runs `gate.js verify` again. No review follows, because the red-then-green test is the proof. A finding no test can reproduce, or one that only asks for a test of the obvious or of a ruling: leave it, and say so. Everything else above is unchanged.

## Final message

Exactly one of:
`ready: <FEATURE-ID> — <files touched> — <red→green test names, or how criteria were proven>[ — pending human: <n>]`
`blocked: <FEATURE-ID> — <spec gap>`
`escalate: <FEATURE-ID> — <which trigger, one line>` (easy path only, never on a forced-easy run)
`fixed: <FEATURE-ID> — <what was fixed / left>` (fixer only)

then your `decided:` lines and at most 3 short lines. Nothing else — only this summary survives.
