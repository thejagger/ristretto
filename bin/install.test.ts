// bin/install.test.ts — installer against the SOURCE-layout pkgRoot. Run with:
// bun test bin/install.test.ts
//
// Each test uses a throwaway tmpdir as the install prefix — no shared filesystem
// state, no cleanup. `install(prefix)` is called with the tmpdir explicitly so the
// default `resolvePrefix()` (which reads ~/.config/opencode) never runs.
//
// Flag-resolution tests (default local / --global / -g / --local / env scoping) are
// subprocess spawns of bin/install.mjs: resolvePrefix() reads process.argv, which an
// in-process call can't set, and each test asserts the filesystem outcome after the
// run, not just the exit code. Env is pinned (XDG_CONFIG_HOME, HOME,
// OPENCODE_CONFIG_DIR) so the host's real global config can't leak into assertions.
//
// opencode-source-layout-packaging: the pkgRoot mirror is SOURCE layout — commands/,
// scripts/, briefs/, reference/, docs/, .claude-plugin/, .opencode/ — and ristretto/
// is never created in it (the staged tree is gone as a concept). The installer maps
// source→installed and is the only site of OpenCode adaptation.
import { test, expect } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, copyFileSync, cpSync, symlinkSync } from "node:fs"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { cleanDir, install, migrate } from "./install.mjs"

const INSTALL = path.resolve("bin", "install.mjs")
const REPO = process.cwd()

// The mirror inverts: pkgRoot mirrors SOURCE layout only. ristretto/ is never created
// in the mirror — the old staged tree is gone as a concept.
function createSourceMirror(pkgRoot: string) {
  mkdirSync(pkgRoot, { recursive: true })
  cpSync(path.resolve(REPO, "commands"), path.join(pkgRoot, "commands"), { recursive: true })
  mkdirSync(path.join(pkgRoot, "scripts"), { recursive: true })
  for (const name of ["gate.js", "testreport.js", "junit.js", "baseline.js", "version.js"]) {
    copyFileSync(path.resolve(REPO, "scripts", name), path.join(pkgRoot, "scripts", name))
  }
  cpSync(path.resolve(REPO, ".opencode", "scripts", "gate-lsp.mjs"), path.join(pkgRoot, ".opencode", "scripts", "gate-lsp.mjs"))
  cpSync(path.resolve(REPO, ".opencode", "lib", "rewrite-namespace.mjs"), path.join(pkgRoot, ".opencode", "lib", "rewrite-namespace.mjs"))
  cpSync(path.resolve(REPO, ".opencode", "plugins", "ristretto.mjs"), path.join(pkgRoot, ".opencode", "plugins", "ristretto.mjs"))
  cpSync(path.resolve(REPO, "briefs"), path.join(pkgRoot, "briefs"), { recursive: true })
  cpSync(path.resolve(REPO, "reference"), path.join(pkgRoot, "reference"), { recursive: true })
  cpSync(path.resolve(REPO, ".claude-plugin"), path.join(pkgRoot, ".claude-plugin"), { recursive: true })
  mkdirSync(path.join(pkgRoot, "docs"), { recursive: true })
  copyFileSync(path.resolve(REPO, "docs", "format-migration.md"), path.join(pkgRoot, "docs", "format-migration.md"))
  // Sanity: no staged tree anywhere.
  expect(existsSync(path.join(pkgRoot, "ristretto"))).toBe(false)
}

// Spawn the installer in a pinned sandbox: cwd = <cwdDir>, HOME = a throwaway dir,
// XDG_CONFIG_HOME = <xdgDir> (global target), OPENCODE_CONFIG_DIR passed only when
// given. Scrubbed otherwise so a real environment can't steer resolution.
function runInstall(cwdDir: string, opts: { xdg?: string; openCodeDir?: string; flags?: string[] } = {}) {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v
  }
  delete env.OPENCODE_CONFIG_DIR
  env.HOME = mkdtempSync(path.join(tmpdir(), "ristretto-home-"))
  delete env.USERPROFILE
  if (opts.xdg) env.XDG_CONFIG_HOME = opts.xdg
  else delete env.XDG_CONFIG_HOME
  if (opts.openCodeDir) env.OPENCODE_CONFIG_DIR = opts.openCodeDir
  return spawnSync("node", [INSTALL, ...(opts.flags ?? [])], { cwd: cwdDir, env, encoding: "utf8" })
}

// The layout the contract spells: command prompts, gate runner, plugin.
function expectFullLayout(prefix: string) {
  const skillsDir = path.join(prefix, "ristretto", "skills")
  const installed = readdirSync(skillsDir).filter((f) => f.startsWith("ristretto-") && f.endsWith(".md"))
  expect(installed.length).toBe(8)
  expect(existsSync(path.join(prefix, "ristretto", "gate.js"))).toBe(true)
  expect(existsSync(path.join(prefix, "plugins", "ristretto.mjs"))).toBe(true)
}

test("spawn: no flags → cwd/.opencode gets the full layout (default is repo-local, no heuristic)", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "ristretto-cwd-"))
  const result = runInstall(cwd)
  expect(result.status).toBe(0)
  expect(result.stderr).toBe("")
  expectFullLayout(path.join(cwd, ".opencode"))
  // stdout names the prefix it resolved — runtime evidence of which branch ran.
  expect(result.stdout).toContain(`Installing ristretto into ${path.join(cwd, ".opencode")}`)
})

test("spawn: --global writes the XDG config dir, not cwd/.opencode (even with a local .opencode present)", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "ristretto-cwd-"))
  const xdg = mkdtempSync(path.join(tmpdir(), "ristretto-xdg-"))
  // A local .opencode already exists — --global must still opt up.
  mkdirSync(path.join(cwd, ".opencode"), { recursive: true })
  const result = runInstall(cwd, { xdg, flags: ["--global"] })
  expect(result.status).toBe(0)
  const prefix = path.join(xdg, "opencode")
  expect(existsSync(path.join(prefix, "ristretto", "gate.js"))).toBe(true)
  expect(existsSync(path.join(prefix, "plugins", "ristretto.mjs"))).toBe(true)
  expect(existsSync(path.join(prefix, "ristretto", "skills", "ristretto-help.md"))).toBe(true)
  // cwd stayed untouched.
  expect(existsSync(path.join(cwd, ".opencode", "ristretto", "gate.js"))).toBe(false)
})

test("spawn: -g behaves identically to --global (both resolve to the XDG config dir)", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "ristretto-cwd-"))
  const xdg = mkdtempSync(path.join(tmpdir(), "ristretto-xdg-"))
  const result = runInstall(cwd, { xdg, flags: ["-g"] })
  expect(result.status).toBe(0)
  expect(result.stdout).toContain(`Installing ristretto into ${path.join(xdg, "opencode")}`)
  expect(existsSync(path.join(xdg, "opencode", "ristretto", "gate.js"))).toBe(true)
  expect(existsSync(path.join(xdg, "opencode", "plugins", "ristretto.mjs"))).toBe(true)
  expect(existsSync(path.join(cwd, ".opencode"))).toBe(false)
})

test("spawn: --local still writes cwd/.opencode and stdout names the prefix used", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "ristretto-cwd-"))
  const xdg = mkdtempSync(path.join(tmpdir(), "ristretto-xdg-"))
  const result = runInstall(cwd, { xdg, flags: ["--local"] })
  expect(result.status).toBe(0)
  expect(result.stdout).toContain(`Installing ristretto into ${path.join(cwd, ".opencode")}`)
  expectFullLayout(path.join(cwd, ".opencode"))
  expect(existsSync(path.join(xdg, "opencode"))).toBe(false)
})

test("spawn: OPENCODE_CONFIG_DIR with no flags pins the local target (env scoping preserved)", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "ristretto-cwd-"))
  const xdg = mkdtempSync(path.join(tmpdir(), "ristretto-xdg-"))
  const pinned = mkdtempSync(path.join(tmpdir(), "ristretto-pin-"))
  const result = runInstall(cwd, { xdg, openCodeDir: pinned })
  expect(result.status).toBe(0)
  expectFullLayout(pinned)
  // cwd/.opencode NOT created — the env var replaced the cwd default too.
  expect(existsSync(path.join(cwd, ".opencode"))).toBe(false)
  // ...and the pinned prefix is what stdout names.
  expect(result.stdout).toContain(`Installing ristretto into ${pinned}`)
})

test("spawn: --global beats OPENCODE_CONFIG_DIR (env override scopes to the local default only)", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "ristretto-cwd-"))
  const xdg = mkdtempSync(path.join(tmpdir(), "ristretto-xdg-"))
  const pinned = mkdtempSync(path.join(tmpdir(), "ristretto-pin-"))
  const result = runInstall(cwd, { xdg, openCodeDir: pinned, flags: ["--global"] })
  expect(result.status).toBe(0)
  // Global branch won: XDG dir written, the env-pinned dir stays empty.
  expect(existsSync(path.join(xdg, "opencode", "ristretto", "gate.js"))).toBe(true)
  expect(result.stdout).toContain(`Installing ristretto into ${path.join(xdg, "opencode")}`)
  // pinned is a mkdtemp dir (exists by construction) — what must be absent is any
  // install content in it.
  expect(existsSync(path.join(pinned, "ristretto"))).toBe(false)
  expect(existsSync(path.join(pinned, "opencode.json"))).toBe(false)
})

test("spawn: pre-existing global config dir does NOT capture a flagless install (heuristic removed)", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "ristretto-cwd-"))
  const xdg = mkdtempSync(path.join(tmpdir(), "ristretto-xdg-"))
  // The old default was "global if it exists" — seed a global config and prove the
  // flagless install lands locally instead.
  mkdirSync(path.join(xdg, "opencode"), { recursive: true })
  const result = runInstall(cwd, { xdg })
  expect(result.status).toBe(0)
  expect(existsSync(path.join(cwd, ".opencode", "ristretto", "gate.js"))).toBe(true)
  expect(existsSync(path.join(xdg, "opencode", "ristretto"))).toBe(false)
})

test("spawn: --local --global together resolve to global (flag wins over alias)", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "ristretto-cwd-"))
  const xdg = mkdtempSync(path.join(tmpdir(), "ristretto-xdg-"))
  const result = runInstall(cwd, { xdg, flags: ["--local", "--global"] })
  expect(result.status).toBe(0)
  expect(result.stdout).toContain(`Installing ristretto into ${path.join(xdg, "opencode")}`)
  expect(existsSync(path.join(xdg, "opencode", "ristretto", "gate.js"))).toBe(true)
  expect(existsSync(path.join(cwd, ".opencode", "ristretto", "gate.js"))).toBe(false)
})

test("migrate deletes <prefix>/commands/ristretto-*.md when plugin.json version is < 0.16", () => {
  const prefix = mkdtempSync(path.join(tmpdir(), "ristretto-install-"))
  mkdirSync(path.join(prefix, "ristretto"), { recursive: true })
  writeFileSync(path.join(prefix, "ristretto", "plugin.json"), JSON.stringify({ version: "0.15.0" }))
  mkdirSync(path.join(prefix, "commands"), { recursive: true })
  writeFileSync(path.join(prefix, "commands", "ristretto-help.md"), "old")
  writeFileSync(path.join(prefix, "commands", "ristretto-brew.md"), "old")
  writeFileSync(path.join(prefix, "commands", "other-plugin.md"), "stays")
  migrate(prefix)
  expect(existsSync(path.join(prefix, "commands", "ristretto-help.md"))).toBe(false)
  expect(existsSync(path.join(prefix, "commands", "ristretto-brew.md"))).toBe(false)
  expect(existsSync(path.join(prefix, "commands", "other-plugin.md"))).toBe(true)
})

test("migrate is a no-op when <prefix>/ristretto/plugin.json is absent (first install)", () => {
  const prefix = mkdtempSync(path.join(tmpdir(), "ristretto-install-"))
  mkdirSync(path.join(prefix, "commands"), { recursive: true })
  writeFileSync(path.join(prefix, "commands", "ristretto-help.md"), "stays")
  migrate(prefix)
  expect(existsSync(path.join(prefix, "commands", "ristretto-help.md"))).toBe(true)
})

test("migrate is a no-op when plugin.json version is >= 0.16", () => {
  const prefix = mkdtempSync(path.join(tmpdir(), "ristretto-install-"))
  mkdirSync(path.join(prefix, "ristretto"), { recursive: true })
  writeFileSync(path.join(prefix, "ristretto", "plugin.json"), JSON.stringify({ version: "0.17.0" }))
  mkdirSync(path.join(prefix, "commands"), { recursive: true })
  writeFileSync(path.join(prefix, "commands", "ristretto-help.md"), "stays")
  migrate(prefix)
  expect(existsSync(path.join(prefix, "commands", "ristretto-help.md"))).toBe(true)
})

test("cleanDir is a no-op on a non-existent directory (force: true)", () => {
  const prefix = mkdtempSync(path.join(tmpdir(), "ristretto-install-"))
  const dir = path.join(prefix, "ristretto") // never created
  expect(() => cleanDir(dir)).not.toThrow()
  expect(existsSync(dir)).toBe(false)
})

test("install writes commands to <prefix>/ristretto/skills/, LSP to <prefix>/ristretto/gate-lsp.mjs, not <prefix>/commands/", () => {
  const prefix = mkdtempSync(path.join(tmpdir(), "ristretto-install-"))
  install(prefix)
  // 8 commands land under ristretto/skills/ristretto-*.md
  const skillsDir = path.join(prefix, "ristretto", "skills")
  const installed = readdirSync(skillsDir).filter((f) => f.startsWith("ristretto-") && f.endsWith(".md"))
  expect(installed.length).toBe(8)
  for (const name of ["brew", "grind", "help", "prep", "pull", "shot", "status", "tamp"]) {
    expect(installed).toContain(`ristretto-${name}.md`)
  }
  // No commands under <prefix>/commands/ — that dir never gets created
  expect(existsSync(path.join(prefix, "commands"))).toBe(false)
  // LSP moves to <prefix>/ristretto/gate-lsp.mjs
  expect(existsSync(path.join(prefix, "ristretto", "gate-lsp.mjs"))).toBe(true)
  expect(existsSync(path.join(prefix, "scripts", "gate-lsp.mjs"))).toBe(false)
  // plugin.json lands at <prefix>/ristretto/plugin.json carrying 0.17.0
  const pluginJson = JSON.parse(readFileSync(path.join(prefix, "ristretto", "plugin.json"), "utf8"))
  expect(pluginJson.version).toBe("0.17.0")
})

test("install runs migrate first: a pre-0.16 install's <prefix>/commands/ristretto-*.md get deleted before the new layout is written", () => {
  const prefix = mkdtempSync(path.join(tmpdir(), "ristretto-install-"))
  // Seed a pre-0.16 install
  mkdirSync(path.join(prefix, "ristretto"), { recursive: true })
  writeFileSync(path.join(prefix, "ristretto", "plugin.json"), JSON.stringify({ version: "0.15.0" }))
  mkdirSync(path.join(prefix, "commands"), { recursive: true })
  writeFileSync(path.join(prefix, "commands", "ristretto-help.md"), "stale")
  install(prefix)
  // migrate ran before the new layout — stale file deleted, new layout under ristretto/skills/
  expect(existsSync(path.join(prefix, "commands", "ristretto-help.md"))).toBe(false)
  expect(existsSync(path.join(prefix, "ristretto", "skills", "ristretto-help.md"))).toBe(true)
  // Clean step ran — the pre-existing ristretto/ dir was wiped and rewritten
  expect(existsSync(path.join(prefix, "ristretto", "plugin.json"))).toBe(true)
})

test("installed commands carry no ${CLAUDE_PLUGIN_ROOT} residuals and no <prefix>/scripts/ paths", () => {
  // Path-baking must convert every ${CLAUDE_PLUGIN_ROOT}/scripts/* and
  // ${CLAUDE_PLUGIN_ROOT}/docs/* to <prefix>/ristretto/*. Enumerating the files
  // individually would silently miss new ones (testreport.js was the bug).
  const prefix = mkdtempSync(path.join(tmpdir(), "ristretto-install-"))
  install(prefix)
  const skillsDir = path.join(prefix, "ristretto", "skills")
  for (const f of readdirSync(skillsDir).filter((f) => f.endsWith(".md"))) {
    const body = readFileSync(path.join(skillsDir, f), "utf8")
    expect(body).not.toContain("${CLAUDE_PLUGIN_ROOT}")
    expect(body).not.toContain(prefix + "/scripts/")
  }
})

test("every installed skill's ${CLAUDE_PLUGIN_ROOT} reference resolves to a file on disk", () => {
  // The bug a future contributor would hit: a command referencing an asset the
  // package doesn't ship — the path-baking writes a dead absolute path and the
  // subagent reads nothing. 0.16's instance was pull.md's testreport.js --probe
  // step; 0.17 dropped that step but added briefs/* and reference/config.md.
  // So instead of matching one known string, extract every node "<path>" the
  // installed bodies contain and check each one exists.
  const prefix = mkdtempSync(path.join(tmpdir(), "ristretto-install-"))
  install(prefix)
  const skillsDir = path.join(prefix, "ristretto", "skills")
  const bodies = readdirSync(skillsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => readFileSync(path.join(skillsDir, f), "utf8"))
  const refs = new Set<string>()
  for (const b of bodies) for (const m of b.matchAll(/node "([^"]+\.(?:js|mjs))"/g)) refs.add(m[1])
  expect(refs.size).toBeGreaterThan(0)
  for (const ref of refs) expect(existsSync(ref)).toBe(true)
})

test("install names the configured nodejsPath in the LSP entry, not a hardcoded node", () => {
  // The plugin honors ristretto.jsonc's nodejsPath for gate.js; an LSP registered with
  // a hardcoded "node" would spawn a formatter server the rest of the install doesn't
  // trust — one config key, two interpreters.
  const prefix = mkdtempSync(path.join(tmpdir(), "ristretto-lsp-"))
  const cfgDir = mkdtempSync(path.join(tmpdir(), "ristretto-lspcfg-"))
  const nodeStub = path.join(cfgDir, "node-stub")
  writeFileSync(nodeStub, "")
  writeFileSync(path.join(cfgDir, "ristretto.jsonc"), JSON.stringify({ nodejsPath: nodeStub }))
  // install() reads ristretto.jsonc at <prefix>/ristretto.jsonc — seed it there.
  writeFileSync(path.join(prefix, "ristretto.jsonc"), JSON.stringify({ nodejsPath: nodeStub }))
  install(prefix)
  // Find which config file the LSP landed in.
  const jsonc = path.join(prefix, "opencode.jsonc")
  const json = path.join(prefix, "opencode.json")
  const cfgFile = existsSync(jsonc) ? jsonc : json
  const raw = readFileSync(cfgFile, "utf8")
  expect(raw).toContain(nodeStub)
  expect(raw).not.toMatch(/"command":\s*\[\s*"node"/)
})

test("install runs when invoked via a symlink (npm/npx .bin/ristretto path)", () => {
  // Bug 1 — isMain used path.resolve(process.argv[1]), which does NOT follow
  // symlinks. npm/npx invokes the bin via a symlink; install() silently no-op'd.
  const tmp = mkdtempSync(path.join(tmpdir(), "ristretto-symlink-"))
  const prefix = path.join(tmp, "prefix")
  mkdirSync(prefix, { recursive: true })

  const real = path.resolve("bin", "install.mjs")
  const link = path.join(tmp, "ristretto-link.mjs")
  symlinkSync(real, link)

  // OPENCODE_CONFIG_DIR pins resolvePrefix() to <prefix>. Default pkgRoot = PKG_ROOT =
  // the repo, which IS source layout now — the assertion stays dest-side only.
  const result = spawnSync("node", [link], {
    env: { ...process.env, OPENCODE_CONFIG_DIR: prefix },
    encoding: "utf8",
  })
  expect(result.status).toBe(0)
  const skillsDir = path.join(prefix, "ristretto", "skills")
  expect(existsSync(skillsDir)).toBe(true)
  const installed = readdirSync(skillsDir).filter((f) => f.startsWith("ristretto-") && f.endsWith(".md"))
  expect(installed.length).toBe(8)
})

// --- opencode-source-layout-packaging ------------------------------------------------

test("install maps SOURCE-layout pkgRoot to the installed layout: unprefixed commands/, scripts/, .claude-plugin/ reads", () => {
  const pkgRoot = mkdtempSync(path.join(tmpdir(), "ristretto-srcmirror-"))
  createSourceMirror(pkgRoot)
  // Marker proves the manifest read moved off the staged path (supersedes
  // npx-install-fix's pkgRoot/ristretto/plugin.json read).
  const MARKER = "9.99.99-from-source"
  writeFileSync(path.join(pkgRoot, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "ristretto", version: MARKER }))
  const prefix = mkdtempSync(path.join(tmpdir(), "ristretto-srcprefix-"))

  expect(() => install(prefix, pkgRoot)).not.toThrow()

  // (a) 8 skills files named ristretto-{brew,…}.md, each once, no double prefix.
  const skillsDir = path.join(prefix, "ristretto", "skills")
  const installed = readdirSync(skillsDir).filter((f) => f.endsWith(".md"))
  expect(installed.length).toBe(8)
  for (const f of installed) expect(f).not.toMatch(/ristretto-ristretto-/)
  for (const name of ["brew", "grind", "help", "prep", "pull", "shot", "status", "tamp"]) {
    expect(installed.filter((f) => f === `ristretto-${name}.md`).length).toBe(1)
  }

  // (b) every mapped destination exists — scripts reads, plugin.json, docs, briefs, reference.
  for (const f of ["gate.js", "testreport.js", "junit.js", "baseline.js", "version.js",
    "gate-lsp.mjs", "plugin.json", "format-migration.md"]) {
    expect(existsSync(path.join(prefix, "ristretto", f))).toBe(true)
  }
  for (const f of ["common.md", "planner.md", "implementer.md", "reviewer.md", "closer.md"]) {
    expect(existsSync(path.join(prefix, "ristretto", "briefs", f))).toBe(true)
  }
  expect(existsSync(path.join(prefix, "ristretto", "reference", "config.md"))).toBe(true)

  // (c) the manifest came from pkgRoot/.claude-plugin/ (marker survives) and the mjs
  // landed at <prefix>/plugins/.
  const pluginJson = JSON.parse(readFileSync(path.join(prefix, "ristretto", "plugin.json"), "utf8"))
  expect(pluginJson.version).toBe(MARKER)
  expect(existsSync(path.join(prefix, "plugins", "ristretto.mjs"))).toBe(true)
})

test("install(prefix, pkgRoot) does not mutate pkgRoot (source bytes pristine after install)", () => {
  const pkgRoot = mkdtempSync(path.join(tmpdir(), "ristretto-srcmirror2-"))
  createSourceMirror(pkgRoot)
  const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex")
  const versionBefore = sha(path.join(pkgRoot, "scripts", "version.js"))
  const brewBefore = sha(path.join(pkgRoot, "commands", "brew.md"))
  const prefix = mkdtempSync(path.join(tmpdir(), "ristretto-srcprefix2-"))

  install(prefix, pkgRoot)

  expect(sha(path.join(pkgRoot, "scripts", "version.js"))).toBe(versionBefore)
  expect(sha(path.join(pkgRoot, "commands", "brew.md"))).toBe(brewBefore)
  // The adaptation never touched the source bytes: placeholders and the source-relative
  // manifest path are still there.
  expect(readFileSync(path.join(pkgRoot, "commands", "brew.md"), "utf8"))
    .toContain("${CLAUDE_PLUGIN_ROOT}/scripts/version.js")
  expect(readFileSync(path.join(pkgRoot, "scripts", "version.js"), "utf8"))
    .toContain("path.join(__dirname, '..', '.claude-plugin', 'plugin.json')")
})

test("installed version.js is layout-patched at install time (source copy untouched)", () => {
  const pkgRoot = mkdtempSync(path.join(tmpdir(), "ristretto-srcmirror3-"))
  createSourceMirror(pkgRoot)
  const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex")
  const before = sha(path.join(pkgRoot, "scripts", "version.js"))
  const prefix = mkdtempSync(path.join(tmpdir(), "ristretto-srcprefix3-"))
  install(prefix, pkgRoot)
  expect(sha(path.join(pkgRoot, "scripts", "version.js"))).toBe(before)

  // Branch 1 — no roadmap: version.js read plugin.json BESIDE it (the unpatched
  // ../.claude-plugin/ path would exit 2 "cannot read the plugin version").
  const emptyProject = mkdtempSync(path.join(tmpdir(), "ristretto-emptyproj-"))
  const r1 = spawnSync("node", [path.join(prefix, "ristretto", "version.js"), "check"], {
    cwd: emptyProject,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: emptyProject },
  })
  expect(r1.status).toBe(0)
  expect(r1.stdout).toContain("nothing to migrate")

  // Branch 2 — a 0.9-stamped roadmap: the printed migration line names the file
  // actually installed at <prefix>/ristretto/format-migration.md.
  const oldProject = mkdtempSync(path.join(tmpdir(), "ristretto-oldproj-"))
  mkdirSync(path.join(oldProject, "docs", "ristretto"), { recursive: true })
  writeFileSync(path.join(oldProject, "docs", "ristretto", "roadmap.md"),
    "# Roadmap\n<!-- ristretto-format: 0.9 -->\n")
  const r2 = spawnSync("node", [path.join(prefix, "ristretto", "version.js"), "check"], {
    cwd: oldProject,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: oldProject },
  })
  expect(r2.status).toBe(1)
  expect(r2.stdout).toContain(path.join(prefix, "ristretto", "format-migration.md"))
})