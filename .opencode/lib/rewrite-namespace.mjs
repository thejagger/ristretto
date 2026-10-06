// One rule for the Claude Code slash-namespace → OpenCode flat command key rewrite.
// The plugin's command loader (.opencode/src/commands.ts) and the installer's path
// baking (bin/install.mjs) both rewrite "/ristretto:<name>" in command bodies to
// "/ristretto-<name>" — two copies of one rule drifted silently toward lying to each
// other, so this module is now the single definition both import.
//
// Plain .mjs (no TypeScript): the installer runs on bare `node` via npx, which cannot
// strip types on every Node this ships to. The loader imports it under Bun, which
// handles ESM from either world.

// Claude Code slash-namespace is `:`, OpenCode command keys are flat.
export const NAMESPACE_RE = /\/ristretto:([a-zA-Z0-9-]+)/g

// Idempotent: installed bodies are already rewritten, so running this again on them
// (the loader reading installed files) changes nothing. A global regex with `replace`
// is safe to share — `replace` resets lastIndex itself.
export function rewriteNamespace(body) {
  return body.replace(NAMESPACE_RE, "/ristretto-$1")
}