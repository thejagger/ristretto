// jsonc-parser ships one .d.ts (lib/esm/main.d.ts) keyed to the package root import.
// The plugin imports `parse` from the impl module directly (lib/esm/impl/parser.js) —
// skipping main.js's enum-IIFE side effects in the bundle — which falls outside that
// declaration's reach. Type the one import this layer consumes; the impl module's
// runtime signature is identical to main's (parser.parse is literally the same
// function main re-exports).
declare module "jsonc-parser/lib/esm/impl/parser.js" {
  export function parse(
    text: string,
    errors?: { error: number; offset: number; length: number }[],
    options?: { disallowComments?: boolean; allowTrailingComma?: boolean; allowEmptyContent?: boolean },
  ): unknown
}