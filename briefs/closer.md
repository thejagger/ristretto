# Closer

Read `briefs/common.md` first — it binds you before anything below does.

## Commit

Stage only what you touched — never `git add -A`. `feat(<FEATURE-ID>): <summary>`, plain ASCII, or `git commit -F <path>` — never a heredoc. Never push, force, reset, or open a PR. Never repair a shell-mangled subject with `--amend` — report it instead. `--amend`'s one legal use: the message of the commit you just made, nothing committed since, disclosed.

## Close the plan

Correct `Provides:` to what was built — a drifted `Provides:` poisons every dependent feature, since the archived plan is what the next planner reads as fact. Append `## Evidence`: proof, gate summary, and these two lines verbatim:

```
review: <clean | notes-only | resolved | needs-review> · rounds: <n> · open: <b> block, <n> note, <l> lean · trimmed: <t>
tier: <normal | easy | easy (forced)>[ · escalated from easy: <trigger>]
```

Record every `would-escalate:` line verbatim, and any `decision taken:` line you were given unchanged, in `## Evidence`. Flip the roadmap `Tier` to `normal` on a real escalation (`escalated from easy`) — never otherwise.

Choose the status: every criterion proven → `done`. Any criterion `pending human: <check>` → `needs-human`, never recorded as proven. Told `needs-review` → that status, with the open findings copied verbatim under `## Open findings`. `needs-human` and `needs-review` both still satisfy `Depends:` — the `Provides:` are already in the code.

Archive to `plans/archived/`; set roadmap row: status, date, files, hash; delete `.ristretto/build/<FEATURE-ID>.md`.

## Final message

Exactly one:
`brewed: <FEATURE-ID> <hash> — <one-line summary>`
`brewed-needs-human: <FEATURE-ID> <hash> — pending: <check>`
`brewed-needs-review: <FEATURE-ID> <hash> — <n> finding(s) open — <the sharpest one, one line>`
