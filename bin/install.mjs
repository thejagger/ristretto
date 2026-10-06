#!/usr/bin/env node
// ristretto — OpenCode installer.
//
// Usage: npx ristretto --opencode
//
// Copies the plugin, commands, and gate runner into the OpenCode config dir
// (the "installation prefix"), then registers the plugin in opencode.json[c].
// OpenCode auto-discovers plugins/*.mjs, so the copy alone would load it — the
// config edit is belt-and-suspenders and matches the declarative path.
//
// Layout written (OpenCode's opencode.jsonc is preferred over opencode.json):
//   <prefix>/plugins/ristretto.mjs             (the plugin)
//   <prefix>/ristretto/skills/ristretto-*.md   (slash-command prompts, paths baked absolute)
//   <prefix>/ristretto/gate.js                 (gate runner)
//   <prefix>/ristretto/version.js              (format-version check, patched)
//   <prefix>/ristretto/format-migration.md     (format migration guide)
//   <prefix>/ristretto/testreport.js           (report reader, required by gate.js)
//   <prefix>/ristretto/junit.js                (JUnit reader, required by testreport.js)
//   <prefix>/ristretto/baseline.js             (failure-ratchet, required by gate.js)
//   <prefix>/ristretto/gate-lsp.mjs            (LSP adapter)
//   <prefix>/ristretto/plugin.json             (version stamp for migrations)
//
// Read source (the npm tarball ships the verbatim SOURCE layout — no staged tree):
//   pkgRoot/commands/*.md, pkgRoot/scripts/*.js, pkgRoot/briefs/, pkgRoot/reference/,
//   pkgRoot/docs/format-migration.md, pkgRoot/.claude-plugin/plugin.json,
//   pkgRoot/.opencode/{plugins,scripts,lib}/. The installer performs every OpenCode
//   adaptation itself: prefix rename, namespace rewrite, ${CLAUDE_PLUGIN_ROOT} baking,
//   version.js layout patch, manifest relocation. The tarball is host-neutral bytes.
//
// The plugin resolves its root from its own file: <prefix>. It finds
// ristretto/skills/ there and the gate runner under ristretto/ (see
// .opencode/plugin/index.ts). OpenCode command templates have no runtime ${VAR}
// interpolation, so the installer rewrites every ${CLAUDE_PLUGIN_ROOT}/...
// reference in commands/ to the absolute installed path (see writeCommand below).

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { applyEdits, findNodeAtLocation, modify, parse, parseTree } from "jsonc-parser"
import path from "node:path"
import { fileURLToPath } from "node:url"
// Shared namespace-rewrite rule — the plugin loader (.opencode/src/commands.ts)
// imports the same definition from .opencode/lib/, the layer both the installer and
// the bundled plugin can reach.
import { rewriteNamespace } from "../.opencode/lib/rewrite-namespace.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Package root: <pkg>/bin/install.mjs → <pkg>
const PKG_ROOT = path.join(__dirname, "..")

// --- Config dir resolution (OpenCode) -------------------------------------------
// Default is repo-local: <cwd>/.opencode. `--global` (or `-g`) opts up to the
// global config dir (XDG: $XDG_CONFIG_HOME/opencode, else $HOME/.config/opencode).
// `--local` is a redundant legacy alias. OPENCODE_CONFIG_DIR pins the LOCAL target
// only — `--global` takes precedence over it, so a scripted `--global` stays
// unambiguous. No "global if it exists" heuristic: a shared-config install is a
// deliberate `--global`, never a silent default.
function resolvePrefix() {
  const global = process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, "opencode")
    : path.join(process.env.HOME || process.env.USERPROFILE, ".config", "opencode")

  if (process.argv.includes("--global") || process.argv.includes("-g")) return global
  return process.env.OPENCODE_CONFIG_DIR || path.join(process.cwd(), ".opencode")
}

function copy(src, dest) {
  mkdirSync(path.dirname(dest), { recursive: true })
  copyFileSync(src, dest)
  console.log(`  ${path.relative(process.cwd(), dest)}`)
}

// Wipe a directory before writing fresh contents into it. force: true makes this
// a no-op when the directory doesn't exist (first install never fails on the
// clean step — there is nothing to clean). ristretto.jsonc lives at
// <prefix>/ristretto.jsonc, outside the cleaned dir, so it survives.
export function cleanDir(p) {
  rmSync(p, { recursive: true, force: true })
}

// Version-gated migration from the pre-0.16 layout. Reads
// <prefix>/ristretto/plugin.json (already written by a prior install at line ~157
// in the legacy flow); when its version is < 0.16, deletes the stale
// <prefix>/commands/ristretto-*.md files. Missing plugin.json → first install,
// nothing to migrate. MAJOR.MINOR numeric compare — the same comparison
// scripts/version.js makes.
export function migrate(prefix) {
  const manifest = path.join(prefix, "ristretto", "plugin.json")
  if (!existsSync(manifest)) return // first install — nothing to migrate
  let installed
  try {
    installed = JSON.parse(readFileSync(manifest, "utf8")).version
  } catch { return } // unparseable — leave existing files alone
  const m = /^(\d+)\.(\d+)/.exec(String(installed))
  if (!m) return
  const [, majStr, minStr] = m
  const maj = Number(majStr), min = Number(minStr)
  if (maj > 0 || (maj === 0 && min >= 16)) return // already 0.16 or newer
  // pre-0.16 layout: commands lived at <prefix>/commands/ristretto-*.md
  const oldDir = path.join(prefix, "commands")
  if (!existsSync(oldDir)) return
  for (const f of readdirSync(oldDir).filter((f) => f.startsWith("ristretto-") && f.endsWith(".md"))) {
    rmSync(path.join(oldDir, f), { force: true })
  }
}

// Preferred config file is opencode.jsonc — it is the one OpenCode loads first
// and the one users actually edit (it holds default_agent, providers, mcp, etc.).
// Fall back to opencode.json. Both are merged by OpenCode, so we target whichever
// exists; if neither, create opencode.json.
function resolveConfigPath(prefix) {
  const jsonc = path.join(prefix, "opencode.jsonc")
  const json = path.join(prefix, "opencode.json")
  if (existsSync(jsonc)) return jsonc
  return json // exists or will be created
}

// Insert pluginRef into the `plugin` array by editing the raw text, so a .jsonc
// file's comments and formatting survive. Returns true if it wrote the file.
function insertIntoPluginArray(configPath, pluginRef) {
  const raw = readFileSync(configPath, "utf8")
  const tree = parseTree(raw)
  const arr = tree && findNodeAtLocation(tree, ["plugin"])
  // Array nodes carry items in `children`, not `value`. Verify it's really an array.
  if (!arr || arr.type !== "array") return false // no plugin array — leave it
  const existing = arr.children.map((c) => c.value)
  if (existing.includes(pluginRef)) return false // already registered

  // Append `pluginRef` at the end of the array. isArrayInsertion tells modify()
  // to insert at that index rather than overwrite.
  const edits = modify(raw, ["plugin", existing.length], pluginRef, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
    isArrayInsertion: true,
  })
  writeFileSync(configPath, applyEdits(raw, edits))
  return true
}

// The node interpreter the LSP entry names. The plugin honors `nodejsPath` from
// <prefix>/ristretto.jsonc for the same reason (a repo whose `node` is not a
// usable runtime); registering the LSP with a hardcoded "node" would spawn an LSP
// the plugin world no longer trusts. Absent/non-string → "node".
function lspInterpreter(prefix) {
  try {
    const cfgPath = path.join(prefix, "ristretto.jsonc")
    if (!existsSync(cfgPath)) return "node"
    const parsed = parse(readFileSync(cfgPath, "utf8"))
    const n = parsed && typeof parsed === "object" ? parsed.nodejsPath : undefined
    return typeof n === "string" && n ? n : "node"
  } catch { return "node" }
}

// Register the LSP server (per-edit format feedback) under the `lsp` key.
// OpenCode spawns it per project; it runs gate.js `quick` on didOpen/didChange.
function registerLsp(prefix) {
  const configPath = resolveConfigPath(prefix)
  const lspRef = {
    command: [lspInterpreter(prefix), path.join(prefix, "ristretto", "gate-lsp.mjs")],
    extensions: [".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs", ".json", ".md"],
  }

  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, "utf8")
    const tree = parseTree(raw)
    const node = tree && findNodeAtLocation(tree, ["lsp", "ristretto"])
    if (node) return // already registered
    const edits = modify(raw, ["lsp", "ristretto"], lspRef, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    })
    writeFileSync(configPath, applyEdits(raw, edits))
    console.log(`registered ristretto LSP in ${configPath}`)
    return
  }

  // No config yet — create a minimal opencode.json.
  writeFileSync(configPath, JSON.stringify({ lsp: { ristretto: lspRef } }, null, 2) + "\n")
  console.log(`created ${configPath}`)
}

function registerPlugin(prefix) {
  const configPath = resolveConfigPath(prefix)
  const pluginRef = "./plugins/ristretto.mjs"

  // .jsonc is edited structurally via jsonc-parser to preserve comments/format.
  // If the plugin key is absent, leave the file untouched and warn — never munge.
  if (existsSync(configPath)) {
    if (insertIntoPluginArray(configPath, pluginRef)) {
      console.log(`registered ristretto in ${configPath}`)
    } else {
      console.log(`ristretto already registered in ${configPath}`)
    }
    return
  }

  // No config yet — create a minimal opencode.json.
  writeFileSync(configPath, JSON.stringify({ plugin: [pluginRef] }, null, 2) + "\n")
  console.log(`created ${configPath}`)
}

// --- Command packaging -----------------------------------------------------------
// Copied files are prefixed `ristretto-<name>.md` and their bodies have
// `/ristretto:` rewritten to `/ristretto-` (OpenCode command keys are flat). The
// plugin's loadCommands skips the prefix when already present and the body rewrite
// is idempotent, so the installed files load as-is.
//
// OpenCode command templates support no `${VAR}` interpolation at runtime (unlike
// Claude Code's `${CLAUDE_PLUGIN_ROOT}`), so the installer bakes the installed
// asset paths to absolutes: every `${CLAUDE_PLUGIN_ROOT}/...` reference is rewritten
// to the concrete file it resolves to under the install prefix. The plugin root
// differs from the package layout — gate runner + helpers land in <prefix>/ristretto/,
// not <prefix>/scripts/ — so each reference maps to its on-disk location.

function commandName(file) {
  return `ristretto-${file}` // src `brew.md` → dest `ristretto-brew.md`; basename, not filename
}

// version.js layout patch — installer-side. Two replacements, both on the same read:
// (1) the manifest path — source layout carries plugin.json at ../.claude-plugin/, the
// installed layout beside the script; (2) the printed migration line — version.js emits
// a literal '${CLAUDE_PLUGIN_ROOT}/docs/format-migration.md' and its own stdout is never
// passed through writeCommand, so the installer patches the literal to name the file
// actually installed. Source scripts/version.js is never touched (the Claude layout
// still reads ../.claude-plugin/).
function patchVersionJs(src, prefix) {
  const ristrettoDir = path.join(prefix, "ristretto")
  return readFileSync(src, "utf8")
    .replace(
      "path.join(__dirname, '..', '.claude-plugin', 'plugin.json')",
      "path.join(__dirname, 'plugin.json')",
    )
    .replaceAll("${CLAUDE_PLUGIN_ROOT}/docs/", ristrettoDir + "/")
}

function writeCommand(src, dest, prefix) {
  mkdirSync(path.dirname(dest), { recursive: true })
  const raw = readFileSync(src, "utf8")
  // Surrounding quotes/backticks already live in the text — replace the placeholder
  // path once per asset, keeping whatever quoting the command carries.
  // One prefix rule per directory: every <prefix>/scripts/* and <prefix>/docs/*
  // reference resolves to <prefix>/ristretto/* (the unified installed layout).
  // Enumerating files individually would silently miss new ones (e.g. testreport.js).
  const ristrettoDir = path.join(prefix, "ristretto")
  const body = rewriteNamespace(raw)
    .replaceAll("${CLAUDE_PLUGIN_ROOT}/scripts/", ristrettoDir + "/")
    .replaceAll("${CLAUDE_PLUGIN_ROOT}/docs/", ristrettoDir + "/")
    .replaceAll("${CLAUDE_PLUGIN_ROOT}/briefs/", ristrettoDir + "/briefs/")
    .replaceAll("${CLAUDE_PLUGIN_ROOT}/reference/", ristrettoDir + "/reference/")
    // Any other ${CLAUDE_PLUGIN_ROOT} reference → the install prefix.
    .replaceAll("${CLAUDE_PLUGIN_ROOT}", prefix)
  writeFileSync(dest, body)
  console.log(`  ${path.relative(process.cwd(), dest)}`)
}

export function install(prefix = resolvePrefix(), pkgRoot = PKG_ROOT) {
  console.log(`Installing ristretto into ${prefix}`)

  // Pre-0.16 layouts had commands in <prefix>/commands/ristretto-*.md; delete them
  // before writing the new layout so OpenCode's auto-discovery glob doesn't pick
  // them up as duplicate commands. Runs before the clean step because migrate reads
  // <prefix>/ristretto/plugin.json — the clean step wipes that file out.
  migrate(prefix)

  // Wipe <prefix>/ristretto/ before writing fresh contents. force: true makes
  // this a no-op on first install (the dir doesn't exist yet). ristretto.jsonc
  // lives at <prefix>/ristretto.jsonc — outside the cleaned dir, so it survives.
  cleanDir(path.join(prefix, "ristretto"))
  mkdirSync(path.join(prefix, "ristretto"), { recursive: true })

  copy(path.join(pkgRoot, ".opencode", "plugins", "ristretto.mjs"), path.join(prefix, "plugins", "ristretto.mjs"))
  // Gate runner + helpers live in scripts/ in the source layout; all land under
  // ristretto/ (single installed layout).
  copy(path.join(pkgRoot, "scripts", "gate.js"), path.join(prefix, "ristretto", "gate.js"))
  // gate.js requires ./testreport, ./baseline and ./junit at module load — if the
  // installed copy lacks them, the runner dies on `require` before the first gate.
  // testreport.js itself requires ./junit. Copy all three beside the gate runner.
  copy(path.join(pkgRoot, "scripts", "testreport.js"), path.join(prefix, "ristretto", "testreport.js"))
  copy(path.join(pkgRoot, "scripts", "junit.js"), path.join(prefix, "ristretto", "junit.js"))
  copy(path.join(pkgRoot, "scripts", "baseline.js"), path.join(prefix, "ristretto", "baseline.js"))
  // LSP server is OpenCode-only and lives under .opencode/scripts/ in source.
  copy(path.join(pkgRoot, ".opencode", "scripts", "gate-lsp.mjs"), path.join(prefix, "ristretto", "gate-lsp.mjs"))
  // version.js is layout-patched at install (see patchVersionJs above) — a manual
  // write because the copy helper takes files, not string content.
  const installedVersionJs = path.join(prefix, "ristretto", "version.js")
  mkdirSync(path.dirname(installedVersionJs), { recursive: true })
  writeFileSync(installedVersionJs, patchVersionJs(path.join(pkgRoot, "scripts", "version.js"), prefix))
  console.log(`  ${path.relative(process.cwd(), installedVersionJs)}`)
  copy(path.join(pkgRoot, ".claude-plugin", "plugin.json"), path.join(prefix, "ristretto", "plugin.json"))
  copy(path.join(pkgRoot, "docs", "format-migration.md"), path.join(prefix, "ristretto", "format-migration.md"))

  // briefs/ and reference/ — 0.17 moved the shared rules out of commands/ into
  // these dirs; the commands installed into skills/ point at them, so a 0.17
  // install without them hands subagents dead paths.
  for (const dir of ["briefs", "reference"]) {
    const srcDir = path.join(pkgRoot, dir)
    for (const f of readdirSync(srcDir).filter((f) => f.endsWith(".md"))) {
      copy(path.join(srcDir, f), path.join(prefix, "ristretto", dir, f))
    }
  }

  // Commands land at <prefix>/ristretto/skills/ristretto-<name>.md — invisible to
  // OpenCode's {command,commands}/**/*.md auto-discovery glob, so co-installed
  // plugins stop colliding. The plugin's config hook is the sole registration path.
  // The source layout names commands unprefixed (commands/brew.md); the dest name IS
  // the prefix rename, so ristretto-ristretto- is structurally impossible.
  const commandsDir = path.join(pkgRoot, "commands")
  for (const file of readdirSync(commandsDir).filter((f) => f.endsWith(".md"))) {
    writeCommand(path.join(commandsDir, file), path.join(prefix, "ristretto", "skills", commandName(file)), prefix)
  }

  registerPlugin(prefix)
  registerLsp(prefix)
  console.log("Restart OpenCode, then confirm with /ristretto-help.")
}

// Run only when invoked as a script. `import { install } from "./install.mjs"` in
// a test never triggers the side effects — cleanDir/migrate/install are called
// explicitly, and the script invocation is gated on argv[1].
const isMain = process.argv[1] && realpathSync(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isMain) install()
