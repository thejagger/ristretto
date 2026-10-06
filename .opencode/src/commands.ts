import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
// The namespace rewrite is shared with the installer (bin/install.mjs), which runs on
// bare node — so the definition lives in a plain .mjs module in lib/ both can import.
import { rewriteNamespace } from "../lib/rewrite-namespace.mjs"

// --- Command loading --------------------------------------------------------------
// Each ristretto/skills/ristretto-<name>.md registers as `/ristretto-<name>`. The
// directory is ristretto/skills/ (invisible to OpenCode's auto-discovery glob
// {command,commands}/**/*.md) so co-installed plugins' commands don't get re-keyed
// under our prefix. Frontmatter yields the description; the markdown body is the
// template. `$ARGUMENTS` already works verbatim.
//
// Kept in its own module so index.ts exports exactly one plugin-shaped function.
// OpenCode's legacy plugin loader treats every function export from a plugin module
// as a plugin; a stray export would be invoked with the plugin context and throw.

// Claude Code slash-namespace → flat OpenCode key: shared rule, see .opencode/lib/rewrite-namespace.mjs.

const DEFAULT_DESCRIPTION = "ristretto command"

export type Command = { key: string; template: string; description: string }

export function loadCommands(dir: string): Command[] {
  const out: Command[] = []
  let files: string[]
  try {
    files = readdirSync(dir)
  } catch {
    // Broken install — the skills dir was never written (or was wiped). Zero commands,
    // no throw: the config hook registers nothing and OpenCode keeps booting. The
    // broken-install warning is the missing-dir explainer; the loader stays inert here.
    return []
  }
  for (const file of files.sort()) {
    // Filter to ristretto-prefixed files only. The directory lives at
    // ristretto/skills/, away from OpenCode's command glob, so non-ristretto .md
    // files here (if any sneak in) are picked up by name, not auto-discovered.
    if (!file.startsWith("ristretto-") || !file.endsWith(".md")) continue
    const name = file.slice(0, -3)
    const raw = readFileSync(path.join(dir, file), "utf8")
    const { description, body } = parseFrontmatter(raw)
    out.push({
      key: name,
      description: description || DEFAULT_DESCRIPTION,
      // Only rewrite in the body — frontmatter never carries the namespace. The
      // rewrite is idempotent, so installed (already-rewritten) files load as-is.
      template: rewriteNamespace(body),
    })
  }
  return out
}

// Folds `argument-hint` into `description` with " — " so OpenCode's palette
// surfaces both. OpenCode's Command schema has no arg field, so the only way to
// show the hint is via description. The regex is whole-line so inner colons
// in `[optional filter: "open", ...]` survive — a YAML `key: value` split
// would chop the hint at the first colon.
function parseFrontmatter(raw: string): { description?: string; body: string } {
  // CRLF-tolerant: a command file saved on Windows reads `---\r\n`, and an LF-only
  // match would treat the whole file as frontmatter-less body. Both fences are located
  // by line with either EOL style; `\r` before `\n` also lands in the `.+` of the two
  // description regexes and is trimmed away below.
  const open = /^---\r?\n/.exec(raw)
  if (!open) return { body: raw }
  const closeAt = raw.indexOf("\n---", open[0].length)
  if (closeAt === -1) return { body: raw }
  const after = raw.slice(closeAt + 4, closeAt + 6)
  const eolLen = after.startsWith("\r\n") ? 2 : after.startsWith("\n") ? 1 : -1
  if (eolLen === -1) return { body: raw } // `\n---` was content, not the closing fence
  const fm = raw.slice(open[0].length, closeAt + 1)
  const body = raw.slice(closeAt + 4 + eolLen)
  const descM = fm.match(/^description:\s*(.+?)\s*$/m)
  const hintM = fm.match(/^argument-hint:\s*(.+?)\s*$/m)
  const description = descM ? descM[1].trim() : undefined
  const hint = hintM ? hintM[1].trim() : undefined
  let folded: string | undefined
  if (description && hint) folded = `${hint} — ${description}`
  else if (description) folded = description
  else if (hint) folded = hint
  return { description: folded, body }
}
