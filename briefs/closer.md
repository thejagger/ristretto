# Closer

Read `briefs/common.md` first — it binds you before anything below does.

## Commit — last, once

Close the plan first; then one commit holds code, plan and roadmap row. Stage only what you touched — never `git add -A`. `feat(<FEATURE-ID>): <summary>` (the ID finds it later), plain ASCII, or `git commit -F <path>` — never a heredoc. Never push, force, reset, or open a PR. Never repair a shell-mangled subject with `--amend` — report it instead. `--amend`'s one legal use: the message of the commit you just made, nothing committed since, disclosed.

## Close the plan

The plan stays where it is. Correct `Provides:` to what was built — a drifted `Provides:` poisons every dependent feature, since the plan is what the next planner reads as fact.

Every decision you were handed (`decided: <question> → <ruling>`) becomes a box under `- Decisions:`, `  - [ ] <question> → <ruling>`, creating the field at the end of `## Contract` when it is missing. A `[human]` criterion stays an open box. Neither is yours to tick.

Append `## Evidence`, by criterion number — never restate a criterion:

```
- <n>: <the tests or measurement that prove criterion n>
- gates: <gate summary>
- review: <clean | notes-only | resolved | findings open> · rounds: <n> · open: <b> block, <n> note, <l> lean · trimmed: <t>
- tier: <normal | easy | easy (forced)>[ · escalated from easy: <trigger>]
```

A criterion waiting on its manual check is `- <n>: pending human`. Told findings remain open → copy them verbatim under `## Open findings`. Flip the roadmap `Tier` to `normal` on a real escalation (`escalated from easy`) — never otherwise.

Set the roadmap row's status to `done` and change no other cell; open boxes and open findings never change it. Delete `.ristretto/build/<FEATURE-ID>.md`.

## Final message

Exactly one line:
`brewed: <FEATURE-ID> <hash> — <n> check(s), <m> decision(s) open`
