---
description: Sets ristretto up for this project on this machine — how to look at the app, git, tickets. Optional, rerunnable.
---

You are running **INIT**: a guided conversation, attended only, that writes this project's setup on this machine to `.ristretto/setup.md`. ristretto works without it; the setup only tells every role what to use, so nobody picks a tool at random and the owner stops repeating it. Read `${CLAUDE_PLUGIN_ROOT}/reference/setup.md` first — the four properties, the job table, the login rule and the file's shape are there.

At a folder of repos, go one repo at a time, and offer the previous repo's git and ticket answers as the default for the next.

Init installs nothing and changes nothing unasked. It never writes `CLAUDE.md` or `AGENTS.md`, and it reads them first: their house rules win over anything the setup says.

## 1. Scan

- **The repo:** what it is built with, how it is tested, what can drive or call it, how it starts, where test data and a test user come from. Gates go through `${CLAUDE_PLUGIN_ROOT}/reference/config.md`, as pull's step 4 does, now with the owner present; pull's step 4 stays the fallback.
- **This session:** which tools it has for looking at a running app and for reaching a tracker. Read each one's own description, never from memory.
- **This machine:** which command-line clients for the repo's host are installed and signed in.
- On a rerun: read the existing `.ristretto/setup.md` and compare.

## 2. The overview

One block per point: gates and tests · running the app · looking at the app · login · git · tickets · notes. Each option gets a score out of 5 with its reason and its state (`connected`, `in the repo`, `not installed`), then your recommendation in a clause. A recommendation may be something missing; show it even when everything already works. Under gates and tests, show the slow tail: the tests over `slowTest` and their share of the suite's time, from its report — where there is one, recommend splitting them into a slow suite, as a refactor to prep. On a rerun, show only what changed — a tool gone, a new one — and what you would change.

## 3. Talk it through

The owner picks, overrules, adds prose for `Notes`. Ask only where the answer changes what the setup says, always with your recommended answer.

The board shows init's points as it shows prep's. End a turn in which a point moved with one line per point, named as in the overview: `open: <point> — <the question>`, then `decided: <point> → <the choice>` once it is, and `found: <one fact>` for what the scan found that a choice rests on.

## 4. Prove the path once

Start the app the chosen way, open it with the chosen tool, log in as the test user; a `none yet` slot has nothing to prove. What failed is said, and written into the file — never papered over.

## 5. Write `.ristretto/setup.md`

In the shape `reference/setup.md` gives; only the sections the owner chose. No password, ever. On a bare project — nothing to start, look at or log in to yet — still write the sections the owner wants, with `none yet` in each slot that cannot be filled, so the builds that add them fill them. On a rerun keep `Notes` as it is.

## 6. Offer, never do unasked

- **An allow-list** for `.claude/settings.local.json`, per machine and not committed: the gate commands, the app's start, the plugin's scripts, the chosen clients. Two options, the first recommended: **leave it out** — auto mode runs these without asking, and builds run in auto mode; or **add it**, for sessions in another permission mode. On add, show it first and merge it into what is there.
- **Each recommended improvement** as a feature to prep: `/ristretto:prep <idea>`.
- **The open boxes now within reach** — boxes of `done` features the new setup's tool reaches: "3 open checks here are within reach now — walk them?" A yes walks them as section 1 of `${CLAUDE_PLUGIN_ROOT}/briefs/after-build.md` says.

## 7. What init changed in the repo

At most `.ristretto.json` and the `.ristretto/` line in `.gitignore`, both of which belong in git. Show them and ask once whether to commit them on the current branch as `chore(ristretto): gates config`. On a no, say that the next pull stops on a dirty tree until they are committed. In a repo ristretto already runs in, there is usually nothing to commit.

## When done

One line per section written, the path proven (or what failed), and what was offered and taken.
