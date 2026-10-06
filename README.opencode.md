# ristretto — OpenCode

Native TypeScript plugin (`.opencode/src/index.ts`), compiled to a pre-built ES
module (`.opencode/plugins/ristretto.mjs`) that ships in the npm package. Commands and
the gate runner are shared with the Claude Code plugin — single source of truth.

## Install

The npm package ships the verbatim **source layout** — `commands/`, `scripts/`,
`briefs/`, `reference/`, `docs/`, `.claude-plugin/`, `.opencode/`, `bin/` — the same
bytes the Claude Code plugin consumes. The OpenCode installer performs every
OpenCode-specific adaptation: the `ristretto-` command-prefix rename, the
`/ristretto:` → `/ristretto-` namespace rewrite, `${CLAUDE_PLUGIN_ROOT}` baking to
absolute installed paths, the version.js layout patch, and the manifest relocation.

```json
// opencode.json
{ "plugin": ["ristretto@0.17.0"] }
```

**Via npx** — copies the plugin, commands, and gate runner into the OpenCode config
dir and registers it (idempotent):

```bash
npx ristretto --opencode            # default: this repo's .opencode/
npx ristretto --opencode --global   # shared config dir (~/.config/opencode), -g works
npx ristretto --opencode --local    # redundant alias for the default
```

The default flipped to **repo-local** (`<cwd>/.opencode/`): per-repo tooling lives
with the repo by default, and a shared-config install across projects is an
explicit `--global`/`-g`. Behavior change from 0.x, where the installer silently
preferred an existing global config — flagless runs now always target the repo,
and the printed `Installing ristretto into <prefix>` line names the resolved
prefix either way. `OPENCODE_CONFIG_DIR=<dir>` pins the local target (overrides
`<cwd>/.opencode`, itself overridden by `--global`). The installer registers the
plugin in `opencode.jsonc` (preferred by OpenCode; falls back to `opencode.json`,
creating it if neither exists). `opencode.jsonc` is edited structurally with
`jsonc-parser`, so comments and formatting are preserved. Layout written:

```
<prefix>/plugins/ristretto.mjs             # the plugin
<prefix>/ristretto/skills/ristretto-*.md   # slash-command prompts (prefixed, /ristretto: → /ristretto-)
<prefix>/ristretto/gate.js                 # gate runner
<prefix>/ristretto/gate-lsp.mjs            # LSP server (per-edit format)
<prefix>/ristretto/plugin.json             # installed manifest (version stamp for migrations)
```

Installed command files are prefixed `ristretto-<name>.md` and their bodies have
`/ristretto:` rewritten to `/ristretto-` (OpenCode command keys are flat). The plugin
skips the prefix when already present and the rewrite is idempotent, so installed files
load as-is.

The plugin resolves its root from its own file's installed geometry, so it finds
`ristretto/skills/` and `ristretto/gate.js` under the install prefix. The plugin
bundle rebuilds via `bun run build`.

Restart OpenCode, then confirm the menu with `/ristretto-help`.

## Build & package

The plugin is compiled to `.opencode/plugins/ristretto.mjs` with Bun. `prepack` rebuilds
it automatically before every `npm pack`/`publish`, so the shipped artifact is always
fresh — no committed-drift risk.

`jsonc-parser` (a dependency of the installer) is pulled from `node_modules` when the
installer runs via `npx`; it ships in the published package's dependency graph.

```bash
# rebuild the plugin bundle
bun run build

# gate runner self-check (plain Node)
node scripts/gate.test.js

# OpenCode adapter, install, package, and README tests (Bun)
bun test .opencode/src/adapter.test.ts bin/install.test.ts .opencode/src/package.test.ts .opencode/src/README.opencode.test.ts

# or all of the above at once
npm test

# confirm exactly what ships — the SOURCE layout: commands/ (unprefixed), scripts/,
# briefs/, reference/, docs/, .claude-plugin/, .opencode/, bin/install.mjs — and that
# tests, fixtures, and docs/ristretto/ are excluded
npm pack --dry-run

# publish (prepack rebuilds the artifact first)
bun publish   # or: npm publish
```

Pin version: OpenCode resolves `latest` once and caches it, so bump the `@0.17.0`
pin in `package.json` on every release.

## Usage

Commands are namespaced `/ristretto-` in OpenCode (Claude Code used `/ristretto:`) — the bodies reference each other through that namespace, rewritten at load.

```
/ristretto-grind BREW-224                     # honest review before committing to it
/ristretto-prep BREW-224 BREW-210 ROAST-150  # plan a batch of features
/ristretto-prep add rate-limiting to login   # plan a raw idea (→ login-rate-limit plan)
/ristretto-prep BREW-224 deep                 # force grill mode — one question at a time
/ristretto-pull BREW-224                      # implement one (branch + commit)
/ristretto-pull BREW-224 nocommit             # implement, but leave the commit to you
/ristretto-pull next                          # implement the top planned feature
/ristretto-brew                              # brew every eligible feature, unattended
/ristretto-brew [easy]                       # brew, forcing every feature through the easy path
/ristretto-status                             # see the whole roadmap
/ristretto-status open                        # only what's not done yet
/ristretto-status blocked                     # the refinement queue after a brew
/ristretto-shot ROAST-150 rename the menu item # plan + do a trivial one in one pass
/ristretto-tamp                               # review the changes I just made
/ristretto-tamp src/auth                      # green-up pass on existing code
/ristretto-tamp BREW-224 fix                  # review a feature's diff and apply the top fixes
/ristretto-help                              # the menu — commands, workflow, house rules
```

## OpenCode hooks

Four hooks, four responsibilities:

| Claude Code        | OpenCode                          | Effect                          |
| ------------------ | --------------------------------- | ------------------------------- |
| —                  | `tool.execute.before` (write/edit) | `gate.js guard` — **throws on exit 2** → blocks writes to CLAUDE.md / AGENTS.md while a run is armed |
| `PostToolUse`      | `tool.execute.after` (write/edit) | `gate.js quick` (LSP, per-edit) — formats, never blocks |
| `SubagentStop`     | `tool.execute.after` (task)       | `gate.js full` — **throws on exit 2** → blocks the subagent |
| `Stop`             | `event` + `session.idle`          | `gate.js full` — **active re-prompt via `promptAsync`** on exit 2 |

`guard` keeps house-rule files (CLAUDE.md / AGENTS.md) out of agent reach while a
ristretto run is armed — a write/edit that targets one throws before the tool
executes, so the file is never touched. The LSP-driven format runs on every
didOpen/didChange. Subagent-stop blocks any subagent whose tree is red. Session.idle
is **active**: a red tree at session end fires `promptAsync` to tell the model to fix
the failures and retry, capped per session. No `.ristretto.json` or outside a pull →
gates exit immediately, unchanged.
