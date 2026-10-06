// README.opencode.test.ts — README describes the source-layout tarball, the
// installer-side adaptation, the hook table, brew example, and pin. Run with:
// bun test .opencode/src/README.opencode.test.ts
import { test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const README = readFileSync(path.join(process.cwd(), "README.opencode.md"), "utf8")

test("README describes the unified ristretto/skills/ install layout (not <prefix>/commands/)", () => {
  expect(README).toContain("ristretto/skills/")
  expect(README).not.toMatch(/<prefix>\/commands\/ristretto-\*\.md/)
})

test("README hook table has 4 rows including tool.execute.before", () => {
  expect(README).toContain("tool.execute.before")
  // Count hook rows in the table — every row is "| <name> | <name> | <effect> |".
  const tableRows = (README.match(/^\| [^|]+ \| [^|]+ \| [^|]+ \|$/gm) || [])
    .filter((line) => /tool\.execute|session\.idle/.test(line))
  expect(tableRows.length).toBeGreaterThanOrEqual(4)
})

test("README Stop row says active re-prompt via promptAsync (not advisory)", () => {
  expect(README).toContain("promptAsync")
  expect(README).not.toMatch(/Stop.*\b(advisory)\b/i)
})

test("README brew example shows [easy]", () => {
  expect(README).toMatch(/\/ristretto-brew \[easy\]/)
})

test("README pins @0.17.0", () => {
  expect(README).toContain("@0.17.0")
  expect(README).not.toMatch(/@0\.(12|15)\.0/)
})

test("README describes the source-layout ship and installer-side adaptation", () => {
  expect(README).toMatch(/source layout/)
  expect(README).toContain("commands/")
  expect(README).toContain("scripts/")
  expect(README).toContain(".claude-plugin/")
  // The staged ristretto/ tree is gone as a concept — no staging prose survives.
  expect(README).not.toMatch(/staged/i)
  expect(README).not.toMatch(/bun run build.*stage|stage.*ristretto\//i)
})