# `.ristretto.json` reference

Pre-flight reference for the gates config, kept to what needs a person's judgment.
Everything mechanical — a `format` gate with no scope of its own, a slow `test` gate
that was never split with a scoped one, a flag that silences a runner, a changed path
that matches no route, a scoped gate missing a flag the full gate carries, a `silence`
value over the ceiling, tool drift — is caught by running `gate.js verify` and reading
what it names. This file is what's left: the four calls verify cannot make for you.

## The five judgment rules

1. **Work out the reporter from *this* project, never from memory.** Whatever you
   believe about a runner's flags may be wrong, out of date, or right for a version this
   repo isn't on. If you cannot get a working `testReport`, write nothing and say so — a
   report that doesn't parse is strictly worse than no report at all.
2. **Leave `testChanged` empty whenever the runner cannot scope honestly.** A route that
   maps changed paths to the wrong tests reports green while proving nothing. Maven, and
   any runner that selects by class name rather than file path, is exactly this case —
   an empty `testChanged` falls back to the full `test` gate, which is slower but never
   dishonest. Prefer an explicit `{files}` substitution over a runner's own change
   detection (`--changed`, `-o`) — that reads git's diff, which skips untracked files,
   and a brand-new test is exactly what a red-first change produces.
3. **Commands documented in `CLAUDE.md` / `AGENTS.md` beat anything inferred.** A repo
   that already writes down its own test/lint/format commands has answered this; read
   those before guessing from `package.json` or a stack fingerprint.
4. **`{files}` is the files that *changed* — not the tests that cover them.** Some
   runners map one to the other for you (`vitest related`, `jest --findRelatedTests`);
   others just run whatever's *in* the paths they're given, and a change that only
   touched implementation hands them nothing to run. Check your scoped command by hand
   against a source file with no test in it — for pytest, "no tests collected" is exit
   5, a failing gate, not a clean skip.
5. **Leave a gate as `""` only if the repo genuinely has no such tool — empty gates are
   skipped.** A gate naming a tool the repo doesn't have is worse than an empty one;
   gate.js cannot judge "genuinely," so this stays a person's call.

**Everything else** — run `node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" verify` and fix
what it names.

## The shape of the file

```json
{
  "gates": {
    "format": "npx prettier --write {file}",
    "formatPaths": ["src/**/*.{ts,tsx,js,jsx,css}"],
    "lint": "npx eslint .",
    "typecheck": "npx tsc --noEmit",
    "test": "npx vitest run",
    "testChanged": "npx vitest related --run {files}"
  }
}
```

An illustration of the shape, not a template — write the commands this repo actually
uses. `{file}` (format only) is the touched file; `{files}` is the changed set; both are
repo-relative, and every gate command runs from the repo root.

On more than one stack, `testChanged` is a list of routes instead of one string — each
entry sees only the paths it matches, and an empty `cmd` claims a path and runs nothing:

```json
"testChanged": [
  { "name": "backend",  "match": ["backend/**/*.py"],        "cmd": "python -m pytest {files}" },
  { "name": "frontend", "match": ["frontend/**/*.{ts,tsx}"], "cmd": "npx vitest related --run {files}" },
  { "name": "docs",     "match": ["docs/**", "**/*.md"],     "cmd": "" }
]
```

`testReport` points at a machine-readable report your test command writes (JUnit XML, or
Flutter/Dart's own JSON reporter); once set, a run only blocks on *new* failures, not
ones already present when the feature started. Probe a candidate path with
`node "${CLAUDE_PLUGIN_ROOT}/scripts/testreport.js" --probe <path>` before writing it in.

Four keys tune the runner, each a number of seconds: `silence` (how long a gate may
print nothing before it's judged hung), `timeouts` (a hard cap on total runtime, off by
default), `lockWait` (how long a run waits for the repo-wide gate lock), `watchdog` (how
long the agent waiting on these gates may itself stay silent). Defaults hold across
stacks; touch them only when one is actually wrong for this repo.

**Two suites.** In `gates`, `test` and `testChanged` are the fast suite, the only one a gate runs.
`testSlow` is the slow suite — a browser, a model call, an upload — run only when the owner
says "run the slow tests"; a `{files}` in it runs one file alone, and `testSlowReport` is its
report. `slowPaths` (globs) says where its tests live: required with `testSlow`, it keeps those
files out of `{files}`, and the `test` command must leave them out too — a folder, a tag, a
project, as the runner allows. `slowTest` (top level, seconds, default 2): a new test in the fast suite
slower than that fails `verify`; it needs a `testReport` that records times.

`.ristretto.json` belongs in git; `.ristretto/` (transient state) belongs in
`.gitignore`.
