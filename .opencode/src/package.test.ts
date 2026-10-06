// package.test.ts — npm pack ships the verbatim SOURCE layout (commands/, scripts/,
// briefs/, reference/, docs/, .claude-plugin/, .opencode/, bin/); the staged
// ristretto/ tree is gone as a concept — nothing packages one. Run with:
// bun test ./.opencode/src/package.test.ts
import { test, expect } from "bun:test"
import { execSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

const REPO = process.cwd()

test("package.json version is 0.17.0", () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"))
  expect(pkg.version).toBe("0.17.0")
})

// --ignore-scripts skips the prepack build: pack reads the working tree, and the
// source layout IS the working tree now — no build step needed before packing.
// Memoized: pack spawns npm and walks the tree; two tests read the same result.
let packCache: string[] | undefined
function packFiles(): string[] {
  if (packCache) return packCache
  const out = execSync("npm pack --dry-run --json --ignore-scripts", { cwd: REPO, encoding: "utf8" })
  const files: string[] = JSON.parse(out)[0].files.map((f: any) => f.path)
  packCache = files
  return files
}

test("npm pack ships the SOURCE layout (no ristretto/ staged tree)", () => {
  const files = packFiles()
  const expectListed = (p: string) => expect(files).toContain(p)
  // commands/ verbatim — unprefixed source names, the dest prefix is added at install time.
  expectListed("commands/brew.md")
  expect(
    files.filter((f) => f.startsWith("commands/") && f.endsWith(".md")).length,
  ).toBe(8)
  // scripts/ — the five engine files.
  for (const p of ["scripts/gate.js", "scripts/testreport.js", "scripts/junit.js", "scripts/baseline.js", "scripts/version.js"]) {
    expectListed(p)
  }
  // briefs/ and reference/ ship whole dirs.
  expectListed("briefs/common.md")
  expect(files.some((f) => f.startsWith("briefs/"))).toBe(true)
  expectListed("reference/config.md")
  // The two committed docs files win over the repo-level docs/ ignore.
  expectListed("docs/format-migration.md")
  expectListed("docs/decisions.md")
  // Plugin manifest + OpenCode support assets.
  expectListed(".claude-plugin/plugin.json")
  expectListed(".claude-plugin/marketplace.json")
  expectListed(".opencode/plugins/ristretto.mjs")
  expectListed(".opencode/lib/rewrite-namespace.mjs")
  expectListed(".opencode/scripts/gate-lsp.mjs")
  // Installer + package metadata + both READMEs.
  expectListed("bin/install.mjs")
  expectListed("package.json")
  expectListed("README.md")
  expectListed("README.opencode.md")
})

test("npm pack excludes tests, fixtures, dev scripts, docs/ristretto/, and the staged tree", () => {
  const files = packFiles()
  // The staged tree no longer exists as a concept — no ristretto/ paths at all.
  expect(files.some((p: string) => p.startsWith("ristretto/"))).toBe(false)
  for (const p of ["bin/install.test.ts", "scripts/gate.test.js", "scripts/briefs.test.js",
    "scripts/junit.test.js", "scripts/testreport.test.js", "scripts/baseline.test.js",
    "scripts/version.test.js", "scripts/whatruns.sh", "docs/ristretto/roadmap.md",
    "docs/notes/REFACTOR-INSTALL.md"]) {
    expect(files).not.toContain(p)
  }
  // The whole fixtures dir stays out, not just one file in it.
  expect(files.some((p: string) => p.startsWith("scripts/junit.fixtures/"))).toBe(false)
})

test("package.json files lists source dirs and never ristretto (allowlist of record)", () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"))
  expect(pkg.files).toContain("commands")
  expect(pkg.files).not.toContain("ristretto")
})

test("prepack is bun run build and nothing stages ristretto/ anymore", () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"))
  expect(pkg.scripts.prepack).toBe("bun run build")
  expect(pkg.scripts.build).toBe(
    "bun build .opencode/src/index.ts --outfile .opencode/plugins/ristretto.mjs --target node --tree-shaking",
  )
})

test("build-ristretto.mjs is deleted (no staging step exists)", () => {
  expect(existsSync(path.join(REPO, ".opencode", "scripts", "build-ristretto.mjs"))).toBe(false)
})

test(".gitignore drops /ristretto/ but keeps .ristretto/", () => {
  const raw = readFileSync(path.join(REPO, ".gitignore"), "utf8")
  // Harder form that cannot pass while the .ristretto/ entry still exists.
  expect(raw.split("\n").some((l) => l.trim() === "/ristretto/")).toBe(false)
  expect(raw.split("\n").some((l) => l.trim() === ".ristretto/")).toBe(true)
})