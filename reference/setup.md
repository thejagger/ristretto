# The setup rulebook

Read by `/ristretto:init`. It names no stack and no product, and it stays that way: init works the concrete tools out from this project, this session and this machine. Only the project's own `.ristretto/setup.md` names them.

## Four properties

Sort every tool init finds by what it can do:

- **repeatable in gates** — it lives in the repo and runs with the suite
- **runs in the background** — on its own, apart from the owner's desktop; a background builder can use it
- **visible to the owner** — the owner can watch it work
- **holds the owner's logins** — it acts as the owner, with the owner's own sessions

Establish a tool's properties by looking — its own description, its documentation, the try in init's step 4 — never from memory. A tool can have several; say which.

## Looking at the app

Whatever the app is:

| Job | Kind of tool | Why |
|---|---|---|
| A check that should hold for good | repeatable in gates, and only what stays fast: whatever the repo already calls itself with; a browser or a model serves the look and the slow suite | proof that stays |
| One look, nobody watching | runs in the background, logs in as the test user | a background builder can use it |
| One look, the owner watching | visible to the owner | the owner sees what was checked |
| Needs the owner's own login | holds the owner's logins | the only way in; it takes over the owner's tool, so never in the background |

## Login

The setup names where the test user is defined — a seed script, an example env file — never a password. Test credentials are used on a local host only. An app with no seeded test user, or not running locally, gets `login: you`: every look there is attended.

## Git and tickets

- Git: no section = never push. Otherwise `push`, or `push + merge request`, and the command-line client that opens one — one init found signed in for the repo's host.
- Tickets: the tracker and what reaches it — a client, a connector or a skill this session has. `copy: plan, report`; `when done: close` or `comment only`. No section = tickets are read, never written.

## Scoring

Each option in the overview gets a score out of 5 with its reason, and its state: `connected` (this session has it), `in the repo`, or `not installed`. A missing tool can be the recommendation; init still never installs it.

## The file

```
# ristretto setup — <repo> on this machine
<!-- written by /ristretto:init <YYYY-MM-DD> · edit freely -->

## Look at the app
tool: <name> · runs in the background: yes|no · visible to the owner: yes|no · holds the owner's logins: yes|no
start: <command> · answers at <url>
login: test user, defined in <path> | you

## Git
after a green close: push | push + merge request · client: <name>

## Tickets
tracker: <name> · through: <client, connector or skill> · copy: plan, report · when done: close | comment only

## Notes
<free prose: anything the owner wants ristretto to do or avoid here>
```

Leave out a section the owner did not ask for: an absent section is today's default. A slot the owner wants but the project cannot fill yet — no app to start, no test user, no tool that drives it — is written `none yet`, never left out: a build that adds it reports a `setup:` line, and the owner's session fills the slot after the build. Everything in the file binds every role.
