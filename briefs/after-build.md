# After a build

What the session the owner started does once a feature is closed: bring the setup up to date, walk the boxes the setup reaches, push, post to the tracker. It is a reference; do each part only where the setup asks for it.

## Who reads this

The session the owner started, at these moments only: an attended pull after its commit; prep after its builder returns; the brewer once per repo, before its final report; the walk skill, when the owner says "run the checks". Not a builder: a builder never reads this, and never pushes, posts or walks.

Read `.ristretto/setup.md` (session start printed it). A section it lacks means nothing to do for that part — no walk without `## Look at the app`, no push without `## Git`, tickets read only without `## Tickets`. No setup file: stop here. `CLAUDE.md` / `AGENTS.md` win over the setup: a house rule against pushing means no push.

## 0. Refresh the setup

The setup is the owner's: a builder never edits it, it reports a `setup:` line instead — a start command, a test user, a tool that drives the app, added by its build. Take those lines from the reports of the features closed here: your own, your builder's, or every builder's in this repo. For each, work out the edit to `.ristretto/setup.md` in the shape `${CLAUDE_PLUGIN_ROOT}/reference/setup.md` gives, never with a password:

- **It fills a `none yet` slot** in a section the setup has → make the edit, add ` · updated <YYYY-MM-DD> after <ID>` to the header comment, and report `setup updated: <slot> → <value>`.
- **It changes or drops what the owner chose**, or needs a section the setup lacks → never edit; ask, with your recommended answer: in this session if the owner is here, in the brewer's final report otherwise. On a yes, edit as above.

`.ristretto/` is not in git: nothing to commit. The walk below already uses the updated setup.

## 1. Walk the boxes

1. `node "${CLAUDE_PLUGIN_ROOT}/scripts/confirm.js" list <ID>` from the session folder: the open boxes with their `how:` lines.
2. Walk each box the setup's look tool reaches. Start the app the way the setup's `start:` says, if it isn't running. Log in only as the setup's test user, and only on a local host. `login: you`, or a tool that holds the owner's logins: only while the owner is in this session — the brewer leaves those boxes for the owner.
3. Do what the `how:` says, look, and decide:
   - **as expected** → `node "${CLAUDE_PLUGIN_ROOT}/scripts/confirm.js" tick <ID> --by "<tool>" --box <n> --saw "<what you saw>"`
   - **not as expected** → the same with `--failed <n> --saw "<what you saw>"`: the box stays open and a line goes under `## Open findings`. Never tick a look that failed.
   - **could not do it** → leave the box for the owner, untouched.
   The number is the box's `box` from `list`; it stays put after a tick, so one call per look is fine. `--saw` is one line — what you saw, not what you expected: a number, a text on screen, a state.
4. Commit the plan file only, in its repo: `docs(<ID>): checks walked`.
5. Report line: `checked for you: <ID> — <n> ticked, <m> not as expected, <k> left for you`.

## 2. Push

Only when the setup's `## Git` says `push` or `push + merge request`, and only after the last feature on the branch is closed and its boxes are walked: an attended pull after its walk, prep after its builder, the brewer once per repo at the end.

- Push only a branch ristretto created for this work — `feature/<ID>` or `feature/brew-<date>` — with its upstream (`-u`). A branch the owner was already on may be shared: it is never pushed, and the report says so — and never the default branch (`origin/HEAD`, then `main`, then `master`), never force, never merge.
- A branch with nothing closed green on it is not pushed.
- `push + merge request`: one per branch, so a brew's features share one. Its description comes from `${CLAUDE_PLUGIN_ROOT}/briefs/mr.md`; open it with the client the setup names. A box still waiting for the owner is normal: list it in the description. A look you did yourself that came back not as expected is a known defect: open the merge request as a **draft**, with that finding at the top of the description.
- Report line: `pushed: <branch>` and the merge request's link.

## 3. Tickets

Git stays the source of every plan; the tracker gets a copy, one way, through whatever the setup's `## Tickets` names. Never read a plan back from the tracker.

- **After prep writes a plan**, once the owner has agreed it, built now or not: post it to the feature's ticket as a comment. An idea with no ticket gets one — title from the roadmap row, body the plan — and the plan records it as a `- Ticket: <link>` line under `- Why:`. A re-prep posts a comment headed "plan updated", or rewrites the body of a ticket ristretto created.
- **After a close:** the feature's report as a comment — built, how to test, decided for you, checked for you, open checks — posted after the walk, so its open checks are true.
- **Done with nothing open:** what the setup's `when done:` says, `close` or `comment only`.
- Never edit a ticket's own description unless ristretto created the ticket.
- A post that fails never stops anything: one report line, `ticket not updated: <why>`.
