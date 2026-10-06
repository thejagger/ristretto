// adapter.test.ts, top section — loader + installed-geometry tests. This file keeps the
// existing lifecycle tests; the helpers below rehome anything that used to read the staged
// ristretto/ tree (deleted by opencode-source-layout-packaging) onto installed-layout mirrors.
import { test, expect } from "bun:test"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, statSync, copyFileSync, cpSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { loadCommands } from "./commands.ts"

const REPO = path.join(import.meta.dir, "..", "..")

// --- installed-geometry helpers (opencode-source-layout-packaging) --------------------
// The plugin anchors its root at dirname(dirname(its own file dir)): an installed
// <cfgDir>/plugins/ristretto.mjs anchors at <cfgDir>. To exercise real geometry (GATE_JS,
// COMMANDS_DIR) the bundle must be imported FROM a copy installed at <tmpCfgDir>/plugins/.
// Each mirror gets its own path, so module records are distinct per test; a query-string
// cache-bust inside one cfgDir busts Bun's loader cache for repeat imports.
async function mkInstalled(cfgDir: string) {
  mkdirSync(path.join(cfgDir, "plugins"), { recursive: true })
  copyFileSync(path.join(REPO, ".opencode", "plugins", "ristretto.mjs"),
    path.join(cfgDir, "plugins", "ristretto.mjs"))
  return (await import(`file://${path.join(cfgDir, "plugins", "ristretto.mjs")}?installed=${Date.now()}-${Math.random()}`)) as any
}

// A tmp installed prefix: skills/ristretto-*.md from the SOURCE commands/, plus the
// scripts the hooks spawn. Source-named commands/ copies ride along ONLY in the loader
// poison test, to prove the loader never looks there.
function mirrorInstalled(tmp: string, opts: { gateScripts?: boolean; gateLsp?: boolean } = {}) {
  mkdirSync(path.join(tmp, "ristretto", "skills"), { recursive: true })
  const src = path.join(REPO, "commands")
  for (const f of readdirSync(src).filter((f) => f.endsWith(".md"))) {
    copyFileSync(path.join(src, f), path.join(tmp, "ristretto", "skills", `ristretto-${f}`))
  }
  if (opts.gateScripts) {
    // The full required install set the factory probes: gate runner + its require graph
    // (testreport→junit, baseline) + version.js. A "healthy" mirror must carry all of them
    // or the probe reports it incomplete.
    for (const name of ["gate.js", "testreport.js", "junit.js", "baseline.js", "version.js"]) {
      copyFileSync(path.join(REPO, "scripts", name), path.join(tmp, "ristretto", name))
    }
  }
  if (opts.gateLsp) {
    copyFileSync(path.join(REPO, ".opencode", "scripts", "gate-lsp.mjs"),
      path.join(tmp, "ristretto", "gate-lsp.mjs"))
  }
}

function tmpProject(config: string, armed: boolean) {
  const dir = mkdtempSync(path.join(tmpdir(), "ristretto-adapter-"))
  writeFileSync(path.join(dir, ".ristretto.json"), config)
  if (armed) {
    mkdirSync(path.join(dir, ".ristretto"), { recursive: true })
    writeFileSync(path.join(dir, ".ristretto", "pulling"), "")
  }
  return dir
}

// Loader tests run loadCommands over installed-shaped dirs (ristretto-<name>.md).
// loadCommands is pure over a dir — the installer does the prefixing in prod; here a
// mirror helper does it so the frontmatter/fold/rewrite properties are exercised on
// the real source bodies, not on the deleted staged tree.
function mkInstalledShim(dir: string): string {
  mkdirSync(dir, { recursive: true })
  for (const f of readdirSync(path.join(REPO, "commands")).filter((f) => f.endsWith(".md"))) {
    copyFileSync(path.join(REPO, "commands", f), path.join(dir, `ristretto-${f}`))
  }
  return dir
}

test("every installed skill registers as ristretto-<name> with template + description", () => {
  const shim = mkInstalledShim(mkdtempSync(path.join(tmpdir(), "ristretto-adapter-skills-")))
  const cmds = loadCommands(shim)
  expect(cmds.length).toBe(8)
  for (const c of cmds) {
    expect(c.key).toMatch(/^ristretto-[a-z]+$/)
    expect(c.template.length).toBeGreaterThan(0)
    expect(c.description.length).toBeGreaterThan(0)
  }
})

test("argument-hint folds into description on the installed status.md", () => {
  // The installed status.md has both `description:` and `argument-hint:`. The loader
  // must prepend the hint with " — " so OpenCode's palette surfaces both.
  const shim = mkInstalledShim(mkdtempSync(path.join(tmpdir(), "ristretto-adapter-fm-")))
  const [cmd] = loadCommands(shim).filter((c) => c.key === "ristretto-status")
  expect(cmd).toBeDefined()
  expect(cmd.description).toMatch(/^[\[]{1}/) // hint starts with [
  expect(cmd.description).toContain(" — ")
  expect(cmd.description).toContain("Print the project roadmap")
  expect(cmd.description).toContain("roadmap")
})

test("namespace /ristretto: is rewritten to /ristretto- in bodies", () => {
  const shim = mkInstalledShim(mkdtempSync(path.join(tmpdir(), "ristretto-adapter-ns-")))
  const [cmd] = loadCommands(shim).filter((c) => c.key === "ristretto-help")
  expect(cmd).toBeDefined()
  expect(cmd.template).not.toContain("/ristretto:")
  expect(cmd.template).toContain("/ristretto-help")
})

test("malformed/missing frontmatter falls back to the default description", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ristretto-fm-"))
  writeFileSync(path.join(dir, "ristretto-no-fm.md"), "Just a body, no frontmatter")
  const [cmd] = loadCommands(dir)
  expect(cmd.description).toBe("ristretto command")
  expect(cmd.template).toBe("Just a body, no frontmatter")
})

test("CRLF frontmatter parses (description + hint fold, body intact)", () => {
  // A command file saved on Windows is `---\r\n…\r\n---\r\nbody`. An LF-only fence
  // match would treat the entire file as frontmatter-less body and lose the description.
  const dir = mkdtempSync(path.join(tmpdir(), "ristretto-fm-crlf-"))
  writeFileSync(path.join(dir, "ristretto-crlf.md"),
    "---\r\ndescription: Print the roadmap.\r\nargument-hint: [easy]\r\n---\r\nbody line\r\n")
  const [cmd] = loadCommands(dir)
  expect(cmd.description).toBe("[easy] — Print the roadmap.")
  expect(cmd.template).toBe("body line\r\n")
})

test("argument-hint prepends to description with em-dash separator", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ristretto-fold-"))
  writeFileSync(path.join(dir, "ristretto-status.md"),
    "---\n" +
    "description: Print the project roadmap.\n" +
    'argument-hint: [optional filter: "open", "done", "blocked"]\n' +
    "---\n" +
    "body\n")
  const [cmd] = loadCommands(dir)
  expect(cmd.description).toBe('[optional filter: "open", "done", "blocked"] — Print the project roadmap.')
})

test("argument-hint alone (no description) yields the hint as description", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ristretto-fold-"))
  writeFileSync(path.join(dir, "ristretto-brew.md"),
    "---\n" +
    "argument-hint: [easy]\n" +
    "---\n" +
    "body\n")
  const [cmd] = loadCommands(dir)
  expect(cmd.description).toBe("[easy]")
})

test("description alone (no argument-hint key) is unchanged", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ristretto-fold-"))
  writeFileSync(path.join(dir, "ristretto-help.md"),
    "---\n" +
    "description: Print the ristretto menu.\n" +
    "---\n" +
    "body\n")
  const [cmd] = loadCommands(dir)
  expect(cmd.description).toBe("Print the ristretto menu.")
})

test("inner-colon argument-hint survives the regex", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ristretto-fold-"))
  writeFileSync(path.join(dir, "ristretto-status.md"),
    "---\n" +
    "description: Print the project roadmap.\n" +
    'argument-hint: [optional filter: "open", "done", "blocked", "checks", "review", a flight slug, or a feature ID]\n' +
    "---\n" +
    "body\n")
  const [cmd] = loadCommands(dir)
  expect(cmd.description).toBe('[optional filter: "open", "done", "blocked", "checks", "review", a flight slug, or a feature ID] — Print the project roadmap.')
})

test("loadCommands reads only ristretto-*.md files (other-plugin .md are ignored)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ristretto-mixed-"))
  writeFileSync(path.join(dir, "ristretto-foo.md"), "---\ndescription: foo\n---\nfoo body\n")
  writeFileSync(path.join(dir, "gsd-help.md"), "---\ndescription: gsd-help\n---\ngsd body\n")
  writeFileSync(path.join(dir, "caveman.md"), "---\ndescription: caveman\n---\ncaveman body\n")
  const cmds = loadCommands(dir)
  expect(cmds.length).toBe(1)
  expect(cmds[0].key).toBe("ristretto-foo")
  expect(cmds[0].description).toBe("foo")
})

// --- loader reads installed COMMANDS_DIR only (opencode-source-layout-packaging) ------

test("missing installed skills dir yields zero commands, no throw (broken install)", () => {
  // The loader must tolerate a broken install: no <cfgDir>/ristretto/ skills dir →
  // empty registration, never an exception out of the config hook.
  const dir = mkdtempSync(path.join(tmpdir(), "ristretto-missing-"))
  expect(() => loadCommands(path.join(dir, "ristretto", "skills"))).not.toThrow()
  expect(loadCommands(path.join(dir, "ristretto", "skills"))).toEqual([])
})

test("loader ignores an adjacent source tree: a commands/ dir under cfgDir is never probed", () => {
  // Poisoned neighbor: a real SOURCE-LAYOUT commands/ dir (unprefixed names) sits inside
  // the cfgDir — exactly where a checkout fallback would look. The loader is installed-only:
  // it must return zero, not read it.
  const cfg = mkdtempSync(path.join(tmpdir(), "ristretto-poison-"))
  // Source tree adjacent: commands/brew.md etc. (unprefixed names)
  cpSync(path.join(REPO, "commands"), path.join(cfg, "commands"), { recursive: true })
  expect(readdirSync(path.join(cfg, "commands")).length).toBe(8)
  expect(loadCommands(path.join(cfg, "ristretto", "skills"))).toEqual([])
})

test("loader has no source-tree fallback string (grep-level, contract)", () => {
  // grep the SOURCE files: commands.ts's only dir is its argument; index.ts must derive
  // COMMANDS_DIR from the cfgDir anchor and never name a "commands" fallback.
  const commandsTs = readFileSync(path.join(REPO, ".opencode", "src", "commands.ts"), "utf8")
  const indexTs = readFileSync(path.join(REPO, ".opencode", "src", "index.ts"), "utf8")
  // Strip comments so prose that names the layout cannot fake a fail or fake a pass.
  const code = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")
  const commandsCode = code(commandsTs)
  const indexCode = code(indexTs)
  expect(commandsCode).not.toMatch(/["'`]commands["'`]/)
  expect(indexCode).not.toMatch(/["'`]commands["'`]/)
  expect(indexCode).not.toContain("commandDir")
  // The anchor is the deterministic one-dirname resolver — no walk-up probe remains.
  expect(indexCode).not.toMatch(/while\s*\(/) // deleted walk-up loop
  // Anchored root: the plugin file dir is <root>/plugins, so the root is dirname once.
  expect(indexCode).toContain('const PLUGIN_ROOT = path.dirname(import.meta.dir)')
})

test("config hook registers 8 commands from an installed mirror (installed geometry)", async () => {
  const cfg = mkdtempSync(path.join(tmpdir(), "ristretto-instmk-"))
  mirrorInstalled(cfg, { gateScripts: true })
  const mod = await mkInstalled(cfg)
  const plugin = await mod.RistrettoPlugin({ directory: cfg, worktree: cfg } as any)
  const config: any = {}
  await plugin.config(config)
  for (const name of ["brew", "grind", "help", "prep", "pull", "shot", "status", "tamp"]) {
    expect(config.command[`ristretto-${name}`]).toBeDefined()
  }
  expect(Object.keys(config.command).length).toBe(8)
})

test("config hook registers zero commands on a broken install (no skills dir, no throw)", async () => {
  const cfg = mkdtempSync(path.join(tmpdir(), "ristretto-instnone-"))
  const mod = await mkInstalled(cfg)
  // The factory now warns on this broken install; capture it so the suite's stderr stays
  // clean. Criterion 16's zero-commands + no-throw assertions are unchanged.
  const { result: plugin } = await withConsoleError<any>(() =>
    mod.RistrettoPlugin({ directory: cfg, worktree: cfg } as any))
  const config: any = {}
  await plugin.config(config)
  expect(Object.keys(config.command).filter((k) => k.startsWith("ristretto-")).length).toBe(0)
})

const PASS = `node -e "process.exit(0)"`
const FAIL = `node -e "console.error('boom'); process.exit(1)"`

// Phase 1 removed the write/edit tool.execute.after branch — per-edit format now
// flows through the LSP server (ristretto/gate-lsp.mjs), not a subprocess per edit.
test("write/edit no longer spawns gate.js quick (LSP owns per-edit format)", async () => {
  const dir = tmpProject(JSON.stringify({ gates: { format: `node -e "require('fs').appendFileSync(process.argv[1] + '.fmt', '')" {file}` } }), false)
  const touched = path.join(dir, "a.txt")
  writeFileSync(touched, "x")
  const plugin = await RistrettoPluginInstalled({ directory: dir, worktree: dir } as any)
  await plugin["tool.execute.after"]!({ tool: "write", args: { filePath: touched } } as any, {} as any)
  // The quick gate must NOT have run — no .fmt sidecar.
  expect(existsSync(touched + ".fmt")).toBe(false)
})

// Lifecycle tests below mirror an installed prefix — plugins imported at installed geometry
// resolve GATE_JS inside the mirror, so hooks spawn the mirrored gate runner.
async function RistrettoPluginInstalled(ctx: any) {
  const cfgDir = ctx.installedIn ?? mkdtempSync(path.join(tmpdir(), "ristretto-lifec-"))
  mirrorInstalled(cfgDir, { gateScripts: true, gateLsp: true })
  const mod = await mkInstalled(cfgDir)
  return mod.RistrettoPlugin({ directory: ctx.directory, worktree: ctx.worktree, client: ctx.client })
}

test("task gate throws on gate.js exit 2 (blocks the subagent)", async () => {
  const dir = tmpProject(JSON.stringify({ gates: { lint: FAIL, typecheck: FAIL, test: FAIL } }), true)
  const plugin = await RistrettoPluginInstalled({ directory: dir, worktree: dir } as any)
  await expect(
    plugin["tool.execute.after"]!({ tool: "task", args: {} } as any, {} as any),
  ).rejects.toThrow(/work is not done/)
})

test("task gate passes when gates are green (does not throw)", async () => {
  const dir = tmpProject(JSON.stringify({ gates: { lint: PASS, typecheck: PASS, test: PASS } }), true)
  const plugin = await RistrettoPluginInstalled({ directory: dir, worktree: dir } as any)
  await plugin["tool.execute.after"]!({ tool: "task", args: {} } as any, {} as any)
})

// --- gateTimeoutMs: the timer path is UNVERIFIED, never red --------------------------
// A 660s default would make a timeout test crawl, so these drive the timer through
// `gateTimeoutMs` in ristretto.jsonc (the config surface the fix exposes). Both the
// timeout marking (`timedOut: true`) and the idle path's refusal to re-prompt on a
// timeout are covered.

// A gate that takes far longer than the test's own patience — but its result (dead or
// red) doesn't matter, only that the kill fired and no session was dropped.
const SLOW = `sleep 30`

test("gateTimeoutMs is honored by runGate (config key reaches the timer)", async () => {
  const cfgDir = mkdtempSync(path.join(tmpdir(), "ristretto-timeout2-"))
  const logPath = path.join(cfgDir, "debug.log")
  // 2s timer on a gate that sleeps 90s (past lint's 600s silence budget, so gate.js
  // waits for it): the timeout path must fire near 2s, not the gate's own duration.
  writeFileSync(path.join(cfgDir, "ristretto.jsonc"),
    JSON.stringify({ gateTimeoutMs: 2000, debug: { logPath } }))
  await withConfigEnv(cfgDir, async () => {
    const dir = tmpProject(JSON.stringify({ gates: { lint: `sleep 90` } }), true)
    const calls: any[] = []
    const client = { session: { promptAsync: async (o: any) => { calls.push(o) } } }
    const plugin = await RistrettoPluginInstalled({ directory: dir, worktree: dir, client } as any)
    const start = Date.now()
    await expect(plugin["tool.execute.after"]!({ tool: "task", args: {} } as any, {} as any))
      .rejects.toThrow(/work is not done/)
    const took = Date.now() - start
    expect(took).toBeLessThan(8000) // killed at the config's budget, not the gate's tail
    expect(took).toBeGreaterThan(1500) // genuinely the timer, not an instant spawn error
  })
})

test("session.idle gates run concurrently across sessions (no shared advancing flag)", async () => {
  // The old single `advancing` boolean spanned the gate run: session B idling
  // while session A's gate ran was silently dropped — an ungated stop. Now the
  // gate runs for every idle; only promptAsync is serialized. Two gates started
  // together are both spawned before either resolves — assert both spawn lines in
  // the debug log. (gate.js itself serialises the runs behind its repo-wide lock;
  // gateTimeoutMs: 400 ends both quickly, since a full timeout here is UNVERIFIED,
  // never red, and prompts nothing.)
  const cfgDir = mkdtempSync(path.join(tmpdir(), "ristretto-concurrent-"))
  const logPath = path.join(cfgDir, "debug.log")
  writeFileSync(path.join(cfgDir, "ristretto.jsonc"),
    JSON.stringify({ gateTimeoutMs: 400, debug: { logPath } }))
  await withConfigEnv(cfgDir, async () => {
    const dir = tmpProject(JSON.stringify({ gates: { lint: SLOW } }), true)
    const calls: any[] = []
    const client = { session: { promptAsync: async (o: any) => { calls.push(o) } } }
    const plugin = await RistrettoPluginInstalled({ directory: dir, worktree: dir, client } as any)
    const p1 = plugin.event!({ event: { type: "session.idle", properties: { sessionID: "s1" } } as any })
    const p2 = plugin.event!({ event: { type: "session.idle", properties: { sessionID: "s2" } } as any })
    await Promise.all([p1, p2])
    const log = readDebugLog(logPath)
    const spawns = (log.match(/runGate spawn/g) || []).length
    expect(spawns).toBe(2) // BOTH started — the old advancing flag dropped the second
    expect(calls.length).toBe(0) // timed out — UNVERIFIED, no fix-loop
    expect(log).toMatch(/timed out — UNVERIFIED/)
  })
})

test("session.idle re-prompts the model when gates are red (promptAsync)", async () => {
  const dir = tmpProject(JSON.stringify({ gates: { lint: FAIL } }), true)
  const calls: any[] = []
  const client = { session: { promptAsync: async (o: any) => { calls.push(o) } } }
  const plugin = await RistrettoPluginInstalled({ directory: dir, worktree: dir, client } as any)
  await plugin.event!({ event: { type: "session.idle", properties: { sessionID: "s1" } } as any })
  expect(calls.length).toBe(1)
  expect(calls[0].path.id).toBe("s1")
  expect(calls[0].body.parts[0].type).toBe("text")
})

test("session.idle does not re-prompt when gates are green", async () => {
  const dir = tmpProject(JSON.stringify({ gates: { lint: PASS, typecheck: PASS, test: PASS } }), true)
  const calls: any[] = []
  const client = { session: { promptAsync: async (o: any) => { calls.push(o) } } }
  const plugin = await RistrettoPluginInstalled({ directory: dir, worktree: dir, client } as any)
  await plugin.event!({ event: { type: "session.idle", properties: { sessionID: "s1" } } as any })
  expect(calls.length).toBe(0)
})

test("session.idle stops re-prompting after the retry cap", async () => {
  const dir = tmpProject(JSON.stringify({ gates: { lint: FAIL } }), true)
  const calls: any[] = []
  const client = { session: { promptAsync: async (o: any) => { calls.push(o) } } }
  const plugin = await RistrettoPluginInstalled({ directory: dir, worktree: dir, client } as any)
  // 3 red idles → 3 prompts; the 4th is capped.
  for (let i = 0; i < 4; i++) {
    await plugin.event!({ event: { type: "session.idle", properties: { sessionID: "s1" } } as any })
  }
  expect(calls.length).toBe(3)
})

test("LSP server publishes a severity-1 diagnostic when the format gate changes a file", async () => {
  // Format gate appends to the file itself (like prettier --write) so the LSP's
  // before/after content check detects the change.
  const dir = tmpProject(JSON.stringify({ gates: { format: `node -e "require('fs').appendFileSync(process.argv[1], 'x')" {file}` } }), false)
  const file = path.join(dir, "a.txt")
  writeFileSync(file, "x")
  const mirrorDir = mkdtempSync(path.join(tmpdir(), "ristretto-lsp-"))
  // Installed geometry: gate-lsp.mjs lives at <prefix>/ristretto/gate-lsp.mjs and resolves
  // its root from `..` — so the mirror must reproduce that nesting, not a flat tmp copy.
  mkdirSync(path.join(mirrorDir, "ristretto"), { recursive: true })
  copyFileSync(path.join(REPO, ".opencode", "scripts", "gate-lsp.mjs"),
    path.join(mirrorDir, "ristretto", "gate-lsp.mjs"))
  const lsp = path.join(mirrorDir, "ristretto", "gate-lsp.mjs")
  // gate.js requires ./testreport, ./junit, ./baseline at module load — without them
  // the spawned quick gate dies on require and the file never changes (the bug).
  for (const name of ["testreport.js", "junit.js", "baseline.js", "gate.js"]) {
    copyFileSync(path.join(REPO, "scripts", name), path.join(mirrorDir, "ristretto", name))
  }
  const child = spawn(process.execPath, [lsp], { stdio: ["pipe", "pipe", "pipe"] })
  let out = ""
  child.stdout.on("data", (d) => { out += d })
  const send = (msg: any) => {
    const body = JSON.stringify(msg)
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
  }
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
  send({ jsonrpc: "2.0", method: "initialized", params: {} })
  send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: "file://" + file } } })
  await new Promise((r) => setTimeout(r, 500))
  child.kill()
  expect(out).toContain("publishDiagnostics")
  expect(out).toContain('"severity":1')
  expect(out).toContain("auto-formatted by gate")
})

// --- Config + debug logging ---------------------------------------------------------
// ristretto.jsonc in the config dir (overridable via RISTRETTO_CONFIG) enables an
// append-only debug log. Test that a gate call and a failing gate each write to it.

function withDebugConfig(): { cfgDir: string; logPath: string } {
  const cfgDir = mkdtempSync(path.join(tmpdir(), "ristretto-config-"))
  const logPath = path.join(cfgDir, "debug.log")
  writeFileSync(path.join(cfgDir, "ristretto.jsonc"), JSON.stringify({ debug: { logPath } }))
  return { cfgDir, logPath }
}

function readDebugLog(logPath: string): string {
  return existsSync(logPath) ? readFileSync(logPath, "utf8") : ""
}

async function withConfigEnv(cfgDir: string, fn: () => Promise<void>) {
  const prev = process.env.RISTRETTO_CONFIG
  process.env.RISTRETTO_CONFIG = cfgDir
  try { await fn() } finally {
    if (prev === undefined) delete process.env.RISTRETTO_CONFIG
    else process.env.RISTRETTO_CONFIG = prev
  }
}

test("debug log writes every gate call when ristretto.jsonc sets debug.logPath", async () => {
  const { cfgDir, logPath } = withDebugConfig()
  await withConfigEnv(cfgDir, async () => {
    const dir = tmpProject(JSON.stringify({ gates: { lint: FAIL } }), true)
    const plugin = await RistrettoPluginInstalled({ directory: dir, worktree: dir, client: { session: { promptAsync: async () => {} } } } as any)
    await plugin.event!({ event: { type: "session.idle", properties: { sessionID: "s1" } } as any })
    await plugin.event!({ event: { type: "session.idle", properties: { sessionID: "s1" } } as any })
    const log = readDebugLog(logPath)
    expect(log).toContain("session.idle gate → exit 2")
    expect(log).toContain("message sent to model")
    expect(log).toContain("deterministic gates are red")
  })
  expect(readDebugLog(logPath)).toContain("session.idle gate → exit 2")
})

test("task gate failure logs the blocking message sent to the model", async () => {
  const { cfgDir, logPath } = withDebugConfig()
  await withConfigEnv(cfgDir, async () => {
    const dir = tmpProject(JSON.stringify({ gates: { lint: FAIL, typecheck: FAIL, test: FAIL } }), true)
    const plugin = await RistrettoPluginInstalled({ directory: dir, worktree: dir } as any)
    await expect(plugin["tool.execute.after"]!({ tool: "task", args: {} } as any, {} as any)).rejects.toThrow()
    const log = readDebugLog(logPath)
    expect(log).toContain("tool.execute.after task gate → exit 2")
    expect(log).toContain("Message sent to model")
    expect(log).toContain("work is not done")
  })
})

test("config cache re-reads ristretto.jsonc when the file changes on disk", async () => {
  // loadConfig caches by mtime+size: repeated gate calls must not re-read a config
  // nobody touched — but a live edit must land without a restart. Prove the edit lands:
  // first read sets timeout 300ms, a rewritten file (fresh mtime, 1ms timeout) makes
  // the very next gate finish faster than any 300ms budget allows — a stale cache
  // would have kept the old budget and the second idle would not have completed here.
  const cfgDir = mkdtempSync(path.join(tmpdir(), "ristretto-cfgcache-"))
  const logPath = path.join(cfgDir, "debug.log")
  const cfgFile = path.join(cfgDir, "ristretto.jsonc")
  writeFileSync(cfgFile, JSON.stringify({ debug: { logPath }, gateTimeoutMs: 300 }))
  await withConfigEnv(cfgDir, async () => {
    const dir = tmpProject(JSON.stringify({ gates: { lint: SLOW } }), true)
    const plugin = await RistrettoPluginInstalled({ directory: dir, worktree: dir, client: { session: { promptAsync: async () => {} } } } as any)
    await plugin.event!({ event: { type: "session.idle", properties: { sessionID: "s0" } } as any })
    // Rewrite with a guaranteed-fresh cache key: same-millisecond writes can collide
    // on mtime, so the key also carries size — assert the size change is real.
    const sizeBefore = statSync(cfgFile).size
    writeFileSync(cfgFile, JSON.stringify({ debug: { logPath }, gateTimeoutMs: 1 }))
    expect(statSync(cfgFile).size).not.toBe(sizeBefore) // cache key changes
    await plugin.event!({ event: { type: "session.idle", properties: { sessionID: "s1" } } as any })
    const log = readDebugLog(logPath)
    expect((log.match(/runGate spawn/g) || []).length).toBe(2)
    expect(log).toContain("timed out — UNVERIFIED")
  })
})

test("no ristretto.jsonc → no debug log is written", async () => {
  const cfgDir = mkdtempSync(path.join(tmpdir(), "ristretto-config-")) // empty dir, no config file
  const logPath = path.join(cfgDir, "debug.log")
  await withConfigEnv(cfgDir, async () => {
    const dir = tmpProject(JSON.stringify({ gates: { lint: FAIL } }), true)
    const plugin = await RistrettoPluginInstalled({ directory: dir, worktree: dir, client: { session: { promptAsync: async () => {} } } } as any)
    await plugin.event!({ event: { type: "session.idle", properties: { sessionID: "s1" } } as any })
    expect(existsSync(logPath)).toBe(false)
  })
})

// --- gate-spawn-node: runGate must spawn real node, never process.execPath ---
// Under opencode, process.execPath is opencode.exe — not a Node runtime. gate.js
// must be interpreted by a real `node` (or the configured path). The default and both
// config edges are covered here; the live-opencode proof is a manual check.

test("runGate spawns plain node by default, never process.execPath", async () => {
  const { cfgDir, logPath } = withDebugConfig()
  await withConfigEnv(cfgDir, async () => {
    const dir = tmpProject(JSON.stringify({ gates: { lint: PASS, typecheck: PASS, test: PASS } }), true)
    const plugin = await RistrettoPluginInstalled({ directory: dir, worktree: dir } as any)
    await plugin["tool.execute.after"]!({ tool: "task", args: {} } as any, {} as any)
  })
  const log = readDebugLog(logPath)
  expect(log).toMatch(/runGate spawn: node .*ristretto[\\/]gate\.js full/)
  expect(log).not.toContain(process.execPath)
})

test("configured node path is used exactly as the gate.js interpreter (stub argv)", async () => {
  const cfgDir = mkdtempSync(path.join(tmpdir(), "ristretto-nodecfg-"))
  const { stub, stubOut } = nodeStub(cfgDir)
  const logPath = path.join(cfgDir, "debug.log")
  writeFileSync(path.join(cfgDir, "ristretto.jsonc"),
    JSON.stringify({ nodejsPath: stub, debug: { logPath } }))

  await withConfigEnv(cfgDir, async () => {
    const dir = tmpProject(JSON.stringify({ gates: { lint: PASS, typecheck: PASS, test: PASS } }), true)
    const plugin = await RistrettoPluginInstalled({ directory: dir, worktree: dir } as any)
    await plugin["tool.execute.after"]!({ tool: "task", args: {} } as any, {} as any)
  })

  const argv = JSON.parse(readFileSync(stubOut, "utf8"))
  expect(argv.includes(stub)).toBe(true)
  expect(argv.some((a: string) => a.endsWith("gate.js"))).toBe(true)
  expect(argv.includes("full")).toBe(true)
  expect(readDebugLog(logPath)).toContain(`runGate spawn: ${stub} `)
})

test("non-string node config falls back to plain node and never blocks", async () => {
  const cfgDir = mkdtempSync(path.join(tmpdir(), "ristretto-nodebad-"))
  const logPath = path.join(cfgDir, "debug.log")
  writeFileSync(path.join(cfgDir, "ristretto.jsonc"),
    JSON.stringify({ nodejsPath: 123, debug: { logPath } }))
  await withConfigEnv(cfgDir, async () => {
    const dir = tmpProject(JSON.stringify({ gates: { lint: PASS, typecheck: PASS, test: PASS } }), true)
    const plugin = await RistrettoPluginInstalled({ directory: dir, worktree: dir } as any)
    await plugin["tool.execute.after"]!({ tool: "task", args: {} } as any, {} as any) // must not throw
    expect(readDebugLog(logPath)).toMatch(/runGate spawn: node /)
    expect(readDebugLog(logPath)).not.toContain(process.execPath)
  })
})

// --- opencode-house-rule-guard: tool.execute.before blocks house-rule writes ---
// Mirrors gate.js guard tests 96-102. The `before` hook reads output.args.filePath
// and runs gate.js `guard`; on exit 2 it throws gate.js's own refusal (naming the
// file and the "outside a run, edit it freely" context), which — a throw in `before`
// aborts the surrounding Effect.gen before item.execute, so the write never happens.
// Re-echo to TUI stderr is suppressed (captureOutput:false): the throw is the sole
// channel, so a blocked write is reported once, to the model, not N times to the TUI.

test("guard: writing CLAUDE.md while armed rejects with gate.js's named refusal (file left unwritten)", async () => {
  const dir = tmpProject(JSON.stringify({ gates: { lint: PASS, typecheck: PASS, test: PASS } }), true)
  const plugin = await RistrettoPluginInstalled({ directory: dir, worktree: dir } as any)
  const target = path.join(dir, "CLAUDE.md")
  await expect(
    plugin["tool.execute.before"]!({ tool: "write", sessionID: "s1", callID: "c1" } as any, {
      args: { filePath: target },
    } as any),
  ).rejects.toThrow(/CLAUDE\.md holds this repo's house rules/)
  // The guard threw before the write executed — file must not exist.
  expect(existsSync(target)).toBe(false)
})

test("guard: a non-house-rule file passes through (no throw)", async () => {
  const dir = tmpProject(JSON.stringify({ gates: { lint: PASS, typecheck: PASS, test: PASS } }), true)
  const plugin = await RistrettoPluginInstalled({ directory: dir, worktree: dir } as any)
  await plugin["tool.execute.before"]!({ tool: "write", sessionID: "s1", callID: "c1" } as any, {
    args: { filePath: path.join(dir, "backend/app/main.py") },
  } as any)
  // No throw — ordinary file is not a house-rule file.
})

test("guard: a payload with no filePath passes through (no throw)", async () => {
  const dir = tmpProject(JSON.stringify({ gates: { lint: PASS, typecheck: PASS, test: PASS } }), true)
  const plugin = await RistrettoPluginInstalled({ directory: dir, worktree: dir } as any)
  await plugin["tool.execute.before"]!({ tool: "write", sessionID: "s1", callID: "c1" } as any, {
    args: {},
  } as any)
  // No throw — gate.js guard exits 0 when file_path is falsy.
})

test("guard: unarmed run passes through CLAUDE.md (no throw)", async () => {
  const dir = tmpProject(JSON.stringify({ gates: { lint: PASS, typecheck: PASS, test: PASS } }), false)
  const plugin = await RistrettoPluginInstalled({ directory: dir, worktree: dir } as any)
  await plugin["tool.execute.before"]!({ tool: "write", sessionID: "s1", callID: "c1" } as any, {
    args: { filePath: path.join(dir, "CLAUDE.md") },
  } as any)
  // No throw — without .ristretto/pulling, the guard stays out of the way.
})

test("guard: case-insensitive basename — claude.md is refused", async () => {
  const dir = tmpProject(JSON.stringify({ gates: { lint: PASS, typecheck: PASS, test: PASS } }), true)
  const plugin = await RistrettoPluginInstalled({ directory: dir, worktree: dir } as any)
  await expect(
    plugin["tool.execute.before"]!({ tool: "edit", sessionID: "s1", callID: "c1" } as any, {
      args: { filePath: path.join(dir, "claude.md") },
    } as any),
  ).rejects.toThrow(/claude\.md holds this repo's house rules/)
})

test("guard: nested AGENTS.md is refused", async () => {
  const dir = tmpProject(JSON.stringify({ gates: { lint: PASS, typecheck: PASS, test: PASS } }), true)
  const plugin = await RistrettoPluginInstalled({ directory: dir, worktree: dir } as any)
  await expect(
    plugin["tool.execute.before"]!({ tool: "write", sessionID: "s1", callID: "c1" } as any, {
      args: { filePath: path.join(dir, "backend/sub/AGENTS.md") },
    } as any),
  ).rejects.toThrow(/AGENTS\.md holds this repo's house rules/)
})

test("guard: a read of CLAUDE.md passes through (guard is write/edit only)", async () => {
  const dir = tmpProject(JSON.stringify({ gates: { lint: PASS, typecheck: PASS, test: PASS } }), true)
  const plugin = await RistrettoPluginInstalled({ directory: dir, worktree: dir } as any)
  await plugin["tool.execute.before"]!({ tool: "read", sessionID: "s1", callID: "c1" } as any, {
    args: { filePath: path.join(dir, "CLAUDE.md") },
  } as any)
  // Reading a house-rule file is legitimate — only write/edit carry the guard.
})

test("guard: runGate passes 'guard' through as the gate.js subcommand", async () => {
  const { cfgDir, logPath } = withDebugConfig()
  await withConfigEnv(cfgDir, async () => {
    const dir = tmpProject(JSON.stringify({ gates: { lint: PASS, typecheck: PASS, test: PASS } }), true)
    const plugin = await RistrettoPluginInstalled({ directory: dir, worktree: dir } as any)
    await expect(
      plugin["tool.execute.before"]!({ tool: "write", sessionID: "s1", callID: "c1" } as any, {
        args: { filePath: path.join(dir, "CLAUDE.md") },
      } as any),
    ).rejects.toThrow(/CLAUDE\.md holds this repo's house rules/)
    const log = readDebugLog(logPath)
    expect(log).toMatch(/runGate spawn: .*ristretto[\\/]gate\.js guard /)
    expect(log).toMatch(/tool\.execute\.before guard write .* → exit 2/)
  })
})

// --- opencode-broken-install-warning ------------------------------------------------
// A plugin instance whose installed layout is incomplete (no <cfgDir>/ristretto/gate.js)
// warns exactly once at factory time, naming the absolute probed path, then all three
// spawn hooks go inert instead of repeatedly failing. A complete install is byte-for-byte
// unchanged (no warning, hooks spawn as before). Each instance is its own module record
// (mkInstalled imports a distinct installed path), so its probe and warning are its own —
// a broken-local + healthy-global pair reports independently.

// Capture console.error without leaking the patch on failure. Returns fn's result plus
// every captured line. Function declaration => hoisted for the criterion-16 test above.
async function withConsoleError<T>(fn: () => Promise<T>): Promise<{ result: T; calls: string[] }> {
  const calls: string[] = []
  const orig = console.error
  console.error = (...a: unknown[]) => { calls.push(a.map(String).join(" ")) }
  try { return { result: await fn(), calls } } finally { console.error = orig }
}

// Spawn detector: install a node stub as `nodejsPath`. If any hook leaked past the
// `gateAvailable` guard, runGate would spawn this stub and it would append its argv to
// stubOut. An inert run leaves stubOut absent — the counter is a file that never appears.
function nodeStub(cfgDir: string): { stub: string; stubOut: string } {
  const stubOut = path.join(cfgDir, "spawned.log")
  const stub = path.join(cfgDir, "fake-node.mjs")
  writeFileSync(stub,
    "#!/usr/bin/env node\n" +
    "import { appendFileSync } from \"node:fs\"\n" +
    `appendFileSync(${JSON.stringify(stubOut)}, JSON.stringify(process.argv) + "\\n")\n`)
  if (process.platform !== "win32") chmodSync(stub, 0o755)
  return { stub, stubOut }
}

test("broken install: factory warns once naming every missing probed path", async () => {
  const inst = mkdtempSync(path.join(tmpdir(), "ristretto-warn-"))
  const mod = await mkInstalled(inst)
  const { result: plugin, calls } = await withConsoleError(() =>
    mod.RistrettoPlugin({ directory: inst, worktree: inst, client: {} } as any))
  const missing = ["gate.js", "testreport.js", "junit.js", "baseline.js", "version.js", "skills"]
    .map((n) => path.join(inst, "ristretto", n))
  const expected =
    `ristretto: incomplete install — missing ${missing.join(", ")} — ` +
    `this plugin must be installed with 'npx ristretto --opencode'. Hooks disabled.`
  expect(calls.length).toBe(1)
  expect(calls[0]).toBe(expected)
  expect(typeof plugin["tool.execute.before"]).toBe("function") // still a working plugin object
})

test("broken install: guard/task/idle hooks spawn nothing and do not throw", async () => {
  const inst = mkdtempSync(path.join(tmpdir(), "ristretto-inert-"))
  const mod = await mkInstalled(inst)
  const cfg = mkdtempSync(path.join(tmpdir(), "ristretto-inertcfg-"))
  const { stub, stubOut } = nodeStub(cfg)
  writeFileSync(path.join(cfg, "ristretto.jsonc"), JSON.stringify({ nodejsPath: stub }))
  await withConfigEnv(cfg, async () => {
    const dir = tmpProject(JSON.stringify({ gates: { lint: PASS, typecheck: PASS, test: PASS } }), true)
    await withConsoleError(async () => {
      const plugin = await mod.RistrettoPlugin({ directory: dir, worktree: dir, client: {} } as any)
      let threw: unknown
      try {
        await plugin["tool.execute.before"]!({ tool: "write" } as any, { args: { filePath: path.join(dir, "CLAUDE.md") } } as any)
        await plugin["tool.execute.after"]!({ tool: "task", args: {} } as any, {} as any)
        await plugin.event!({ event: { type: "session.idle", properties: { sessionID: "s1" } } } as any)
      } catch (e) { threw = e }
      expect(threw).toBeUndefined()
    })
  })
  expect(existsSync(stubOut)).toBe(false) // no child process ever spawned
})

test("broken install: repeated hook calls re-warn and re-probe zero times", async () => {
  const inst = mkdtempSync(path.join(tmpdir(), "ristretto-once-"))
  const mod = await mkInstalled(inst)
  const cfg = mkdtempSync(path.join(tmpdir(), "ristretto-oncecfg-"))
  const { stub, stubOut } = nodeStub(cfg)
  writeFileSync(path.join(cfg, "ristretto.jsonc"), JSON.stringify({ nodejsPath: stub }))
  await withConfigEnv(cfg, async () => {
    const dir = tmpProject(JSON.stringify({ gates: { lint: PASS, typecheck: PASS, test: PASS } }), true)
    const { calls } = await withConsoleError(async () => {
      const plugin = await mod.RistrettoPlugin({ directory: dir, worktree: dir, client: {} } as any)
      for (let i = 0; i < 2; i++) {
        await plugin["tool.execute.before"]!({ tool: "write" } as any, { args: { filePath: path.join(dir, "CLAUDE.md") } } as any)
        await plugin["tool.execute.after"]!({ tool: "task", args: {} } as any, {} as any)
        await plugin.event!({ event: { type: "session.idle", properties: { sessionID: "s1" } } } as any)
      }
    })
    expect(calls.filter((c) => c.includes("incomplete install")).length).toBe(1)
  })
  expect(existsSync(stubOut)).toBe(false)
  // Structural proof of "no filesystem probe per hook": every existsSync lives in module
  // scope (the fs import + probeInstall); the plugin factory body is checked to contain none.
  const indexTs = readFileSync(path.join(REPO, ".opencode", "src", "index.ts"), "utf8")
  const code = indexTs.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")
  const factoryAt = code.indexOf("export const RistrettoPlugin")
  expect((code.slice(0, factoryAt).match(/\bexistsSync\b/g) || []).length).toBe(2)
  expect((code.slice(factoryAt).match(/\bexistsSync\b/g) || []).length).toBe(0)
})

test("healthy install: no broken-install warning; task gate spawns normally", async () => {
  const inst = mkdtempSync(path.join(tmpdir(), "ristretto-health-"))
  mirrorInstalled(inst, { gateScripts: true })
  const mod = await mkInstalled(inst)
  const { result: plugin, calls } = await withConsoleError(() =>
    mod.RistrettoPlugin({ directory: inst, worktree: inst, client: {} } as any))
  expect(calls.filter((c) => c.includes("incomplete install")).length).toBe(0)
  const dir = tmpProject(JSON.stringify({ gates: { lint: PASS, typecheck: PASS, test: PASS } }), true)
  await plugin["tool.execute.after"]!({ tool: "task", args: {} } as any, {} as any) // green → resolves, no throw
})

test("mixed installs: broken instance names its cfgDir, healthy instance stays silent and works", async () => {
  const broken = mkdtempSync(path.join(tmpdir(), "ristretto-mix-broken-"))
  const brokenMod = await mkInstalled(broken)
  const good = mkdtempSync(path.join(tmpdir(), "ristretto-mix-good-"))
  mirrorInstalled(good, { gateScripts: true })
  const goodMod = await mkInstalled(good)
  // The healthy instance's project dir is a separate ARMED project: the guard's behavior is
  // governed by the project, while gate availability is governed by the cfgDir mirror.
  const armed = tmpProject(JSON.stringify({ gates: { lint: PASS, typecheck: PASS, test: PASS } }), true)
  const { result: goodPlugin, calls } = await withConsoleError(async () => {
    await brokenMod.RistrettoPlugin({ directory: broken, worktree: broken, client: {} } as any)
    return goodMod.RistrettoPlugin({ directory: armed, worktree: armed, client: {} } as any)
  })
  expect(calls.length).toBe(1)
  expect(calls[0]).toContain(path.join(broken, "ristretto", "gate.js"))
  expect(calls[0]).not.toContain(good)
  // Healthy instance's guard executes for real: armed project + CLAUDE.md → gate.js exit 2 → throw.
  await expect(
    goodPlugin["tool.execute.before"]!({ tool: "write", sessionID: "s1", callID: "c1" } as any,
      { args: { filePath: path.join(armed, "CLAUDE.md") } } as any),
  ).rejects.toThrow(/CLAUDE\.md holds this repo's house rules/)
})

test("anchor derives COMMANDS_DIR at cfgDir for global- and local-shaped roots", async () => {
  // Global shape: <root>/plugins/ristretto.mjs (mkInstalled geometry).
  const g = mkdtempSync(path.join(tmpdir(), "ristretto-shape-g-"))
  mirrorInstalled(g)
  const gmod = await mkInstalled(g)
  const gcfg: any = {}
  // This mirror carries no gate.js, so the factory warns; capture it so stderr stays clean.
  await withConsoleError(async () => {
    await (await gmod.RistrettoPlugin({ directory: g, worktree: g } as any)).config(gcfg)
  })
  expect(Object.keys(gcfg.command).length).toBe(8)

  // Local shape: <root>/.opencode/plugins/ristretto.mjs.
  const l = mkdtempSync(path.join(tmpdir(), "ristretto-shape-l-"))
  mkdirSync(path.join(l, ".opencode", "plugins"), { recursive: true })
  copyFileSync(path.join(REPO, ".opencode", "plugins", "ristretto.mjs"),
    path.join(l, ".opencode", "plugins", "ristretto.mjs"))
  mirrorInstalled(path.join(l, ".opencode"))
  // Same bundle bytes in both shapes: PLUGIN_ROOT is the only variable, and the local
  // COMMANDS_DIR assertion below pins the local anchor. GATE_JS is the same
  // path.join(PLUGIN_ROOT, "ristretto", ...) join, so it needs no separate local assertion.
  expect(readFileSync(path.join(l, ".opencode", "plugins", "ristretto.mjs"), "utf8"))
    .toBe(readFileSync(path.join(REPO, ".opencode", "plugins", "ristretto.mjs"), "utf8"))
  const lmod = await import(`file://${path.join(l, ".opencode", "plugins", "ristretto.mjs")}?shape=${Date.now()}`) as any
  const lcfg: any = {}
  await withConsoleError(async () => {
    await (await lmod.RistrettoPlugin({ directory: l, worktree: l } as any)).config(lcfg)
  })
  expect(Object.keys(lcfg.command).length).toBe(8)
})
