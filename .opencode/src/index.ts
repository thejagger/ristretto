import { spawn, spawnSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
// jsonc-parser: import `parse` straight from the impl module, not `lib/esm/main.js`.
// Two reasons:
//   1. `main` is UMD (AMD-style `define`) — bundling it under --target node emitted a
//      broken require.
//   2. main.js evaluates four enum IIFEs (ScanError, SyntaxKind, ParseErrorCode, …) that
//      no consumer here reads; the bundler keeps them (an IIFE is a side effect), so
//      ~10 KB of reverse-mapped enum tables shipped in every bundle. impl/parser.js
//      has no such exports — this one import cut is worth ~10 KB of the bundle.
import { parse } from "jsonc-parser/lib/esm/impl/parser.js"
import { type Plugin } from "@opencode-ai/plugin"
import { loadCommands } from "./commands.ts"

// --- Plugin root ------------------------------------------------------------------
// The install prefix that owns ristretto/, anchored at this file, no walk-up, no probe:
//   installed:  <prefix>/plugins/ristretto.mjs    → root <prefix>
//   dev bundle: <repo>/.opencode/plugins/ristretto.mjs → root <repo>/.opencode
// The plugin FILE dir is <root>/plugins/, so the root is dirname once. Checkout of this
// repo is not a valid install on its own — nothing stages a skills/ tree there anymore —
// so there is deliberately no "first ancestor with ristretto/gate.js" search and no
// fallback branch: the anchor is deterministic geometry.
const PLUGIN_ROOT = path.dirname(import.meta.dir)

// Everything the installer writes lands under ristretto/ at the resolved root. These are
// derived paths only — whether they exist is decided once, by the factory probe below.
const RISTRETTO_DIR = path.join(PLUGIN_ROOT, "ristretto")

// Commands live as markdown under ristretto/skills/, invisible to OpenCode's
// {command,commands}/**/*.md glob (so co-installed plugins stop colliding).
const COMMANDS_DIR = path.join(RISTRETTO_DIR, "skills")

// Gate runner.
const GATE_JS = path.join(RISTRETTO_DIR, "gate.js")

// The installed contract: gate.js requires testreport/baseline/junit at module load (and
// testreport requires junit), version.js is the format checker the update path runs, and
// skills/ is where the config hook registers commands from. An install missing any one of
// these is incomplete — probing gate.js alone would let a partial install keep live hooks
// that die on `require` (exit 1, which every hook reads as green) or register zero commands.
const REQUIRED_INSTALL = ["gate.js", "testreport.js", "junit.js", "baseline.js", "version.js", "skills"]

// Broken-install probe: one module record == one install prefix (each installed path is a
// distinct import). The layout is trusted once, at factory time; `probeInstall()` runs the
// whole existsSync set in one pass. `gateAvailable` is read by the three spawn hooks, which
// go inert rather than spawn a missing gate.js or re-warn per hook. No mid-session re-probe:
// a broken install stays reported, not silently transitioned to working.
let gateProbed = false
let gateAvailable = false

function probeInstall(): string[] {
  return REQUIRED_INSTALL
    .map((name) => path.join(RISTRETTO_DIR, name))
    .filter((p) => !existsSync(p))
}

// --- Plugin config ----------------------------------------------------------------
// ristretto.jsonc lives in the OpenCode config dir (== PLUGIN_ROOT for an npx install,
// the project .opencode dir for the npm layout). JSONC, must parse to a JSON object.
//   { "debug": { "logPath": "/abs/path/ristretto-debug.log" } }
// A missing/unparseable file, or no logPath, silently disables debug.
//
// RISTRETTO_CONFIG overrides the config dir (used by tests — points at a throwaway
// copy instead of the live config dir).
function configFile() {
  const dir = process.env.RISTRETTO_CONFIG || PLUGIN_ROOT
  return path.join(dir, "ristretto.jsonc")
}

// ristretto.jsonc config shape. Currently consumes debug.logPath, nodejsPath and
// gateTimeoutMs; the file must parse to an object and may grow.
type RistrettoConfig = { debug?: { logPath?: string }; nodejsPath?: string; gateTimeoutMs?: number }

// Config reads are cached by mtime: every gate call used to stat+read+parse the file,
// which is per-spawn waste for a file read zero or once per event. The stat still runs
// per call — cheap, and it keeps the two behaviors the cache must not break: the file
// is live-editable (a changed mtime rereads it) and RISTRETTO_CONFIG can switch config
// dirs mid-run (a changed dir is a different stat and a fresh read).
let cfgCache: { key: string; cfg: RistrettoConfig } | null = null
function loadConfig(): RistrettoConfig {
  const file = configFile()
  try {
    let st: { mtimeMs: number; size: number }
    try { st = statSync(file) } catch { cfgCache = null; return {} }
    const key = `${file}:${st.mtimeMs}:${st.size}`
    if (cfgCache && cfgCache.key === key) return cfgCache.cfg
    let cfg: RistrettoConfig = {}
    const val = parse(readFileSync(file, "utf8"))
    if (val && typeof val === "object" && !Array.isArray(val)) cfg = val as RistrettoConfig
    cfgCache = { key, cfg }
    return cfg
  } catch {
    // broken/missing → no debug, never block the plugin. Not cached: a half-written
    // file read as broken fixes itself on the next read without a restart.
    return {}
  }
}

// Debug logging — append-only. Only enabled when ristretto.jsonc sets
// debug.logPath. Writes every gate call, and on failure the message the model is
// being sent.
function debugLog(msg: string) {
  const logPath = loadConfig().debug?.logPath
  if (!logPath) return
  try {
    mkdirSync(path.dirname(logPath), { recursive: true })
    appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`)
  } catch { /* debug is best-effort — never break the plugin over a log write */ }
}

// --- Gate bridge ------------------------------------------------------------------
// Spawns gate.js (unchanged, shared with Claude Code) as a subprocess.
// CLAUDE_PROJECT_DIR points the gate at the project so it resolves .ristretto.json.
//
// Output is captured, never inherited, so a running gate can't spam the terminal or
// interleave with the model loop. A timeout kills a hung gate instead of blocking the
// turn. `fireAndForget` detaches the subprocess for the advisory session-idle gate —
// it must never stall turn end.
//
// GATE_TIMEOUT_MS is a last-resort backstop against a wedged subprocess, NOT a budget
// for a real gate run — a full pass (lint + typecheck + test) legitimately takes minutes,
// and gate.js's own comment block is explicit that there is no duration cap by default
// and that killing on duration murder a legitimately slow suite. So the default is sized
// past the longest silence budget gate.js honours (its 600s watchdog), and any timeout
// is distinguishable from a genuine red: gate.js never uses exit 2 to mean "red" from
// these spawn paths (2 is its block-the-agent exit), but the timer path resolves with
// `code: 2` AND `timedOut: true`, and the session.idle re-prompt consults that flag —
// reporting a slow-but-running suite as "red" and re-prompting the model to fix it
// would be exactly the dishonest red the lock exists to prevent. Set
// `gateTimeoutMs` in ristretto.jsonc to raise/lower it; a non-number is ignored.
const DEFAULT_GATE_TIMEOUT_MS = 660_000 // 600s gate.js watchdog + 60s slack

// Kill the whole process group. gate.js spawns test runners that fork their own
// workers; killing only the `node gate.js` process leaves those workers holding the
// ports, files, and databases that caused the hang in the first place. Because the
// child is spawned detached (its own process group), -pid reaches all of them.
const killTree = (child: ReturnType<typeof spawn>) => {
  if (process.platform === "win32") {
    try { spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }) } catch { /* fall through */ }
    return
  }
  try { process.kill(-(child.pid ?? 0), "SIGKILL") } catch {
    try { child.kill("SIGKILL") } catch { /* already gone */ }
  }
}

function runGate(
  projectDir: string,
  mode: "quick" | "full" | "guard",
  opts: { arg?: string; touchedFile?: string; fireAndForget?: boolean; captureOutput?: boolean } = {},
): Promise<{ code: number; output: string; timedOut?: boolean }> {
  const argv = [GATE_JS, mode, ...(opts.arg ? [opts.arg] : [])]
  // Resolve the node interpreter: optional `nodejsPath` from ristretto.jsonc, else PATH "node".
  // Never process.execPath — under opencode that is opencode.exe, not a Node runtime.
  // A plain "node" resolves via PATH in the inherited env. Non-string nodejsPath falls back
  // to "node" so a broken config never blocks the plugin.
  const cfg = loadConfig()
  const cfgNode = cfg.nodejsPath
  const interpreter = typeof cfgNode === "string" && cfgNode ? cfgNode : "node"
  const timeoutMs = typeof cfg.gateTimeoutMs === "number" && cfg.gateTimeoutMs > 0
    ? cfg.gateTimeoutMs
    : DEFAULT_GATE_TIMEOUT_MS
  debugLog(`runGate spawn: ${interpreter} ${argv.join(" ")} (cwd ${projectDir})`)
  return new Promise((resolve) => {
    const child = spawn(interpreter, argv, {
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
      stdio: ["pipe", "pipe", "pipe"],
      // Always detached — the gate runs test suites that fork workers, and the
      // timeout path kills the whole process group, not just the shell. The
      // fire-and-forget case additionally `unref`s both handles below.
      detached: true,
    })
    // gate.js reads hook JSON from stdin (quick needs tool_input.file_path; full ignores it).
    const hook = opts.touchedFile ? JSON.stringify({ tool_input: { file_path: opts.touchedFile } }) : "{}"
    child.stdin.end(hook)

    let output = ""
    child.stdout?.on("data", (d) => { output += d })
    child.stderr?.on("data", (d) => { output += d })

    const timer = setTimeout(() => {
      // A hung gate must never block the model — and must never be mistaken for a
      // red gate. Kill the whole process group (workers outlive their shell) and
      // report the result with `timedOut: true`, which the session.idle path reads
      // as UNVERIFIED rather than red.
      killTree(child)
      if (!opts.fireAndForget) {
        console.error("[ristretto] gate timed out after " + timeoutMs + "ms — UNVERIFIED, not red")
      }
      resolve({ code: 2, output, timedOut: true })
    }, timeoutMs)

    child.on("error", () => { clearTimeout(timer); resolve({ code: 2, output }) })
    child.on("close", (code) => {
      clearTimeout(timer)
      // Surface captured gate output so failures are visible without inheriting.
      if (output.trim() && !opts.fireAndForget && opts.captureOutput !== false) {
        console.error("[ristretto] gate output:\n" + output.trim())
      }
      resolve({ code: code ?? 0, output })
    })

    // For the fire-and-forget / session.idle case, unref so the timer/child handles
    // don't keep the event loop alive at turn end.
    if (opts.fireAndForget) {
      timer.unref()
      child.unref()
    }
  })
}

// --- Phase 3: session.idle orchestrator -------------------------------------------
// Stop-hook equivalent. On session.idle, run the full gate fire-and-forget; if it
// comes back red (exit 2), actively re-prompt the model via client.session.promptAsync
// so it fixes the tree instead of the failure being silent.
//
// Guards (from the event-driven research — mandatory):
//   prompting   — the ONLY re-entrancy this flag prevents: idle firing again while a
//                 promptAsync to the same session is still in flight. It wraps just
//                 the prompt call, not the gate run — the previous span (whole idle
//                 handler) made concurrent sessions silently drop each other's gate
//                 runs, an ungated stop with no symptom.
//   timingOut   — a gate the timer killed is UNVERIFIED, never red. Re-prompting
//                 "fix the failures" with nothing failing sends the model to fix
//                 ghosts; skip the prompt and let the next idle try again. A
//                 timeout past gateTimeoutMs can still mean a saturated tree.
//   retries     — per-session cap (matches gate.js MAX_RETRIES). gate.js also exits 0
//                 after its own cap, so this is belt-and-suspenders.
//   fingerprint— gate.js already skips unchanged-green trees; a red tree re-runs and
//                increments its own retry counter, so the loop is naturally bounded.
const MAX_REPROMPTS = 3
let prompting = false
const retries = new Map<string, number>()

const IDLE_PROMPT = "ristretto: deterministic gates are red. Fix the failures before stopping. Do NOT weaken, skip, or delete gates/tests to get green."

async function onSessionIdle(client: any, projectDir: string, sessionID: string) {
  // No global gate here: two sessions idling at once both deserve their gate run
  // (gate.js serialises them behind the repo-wide gate lock, and the loser's
  // fingerprint check then finds the tree already proven). The only re-entrancy
  // to prevent is prompting the same session while a prompt is still landing.
  const { code, timedOut } = await runGate(projectDir, "full", { fireAndForget: true })
  debugLog(`session.idle gate → exit ${code}${timedOut ? " (timed out — UNVERIFIED)" : ""}`)
  if (code !== 2 || timedOut) {
    // Green, or a real failure to hear about: the retry budget resets either way —
    // a timeout followed by a red is a fresh red, not a continuation.
    if (!timedOut) retries.delete(sessionID)
    return
  }
  if (prompting) return
  prompting = true
  try {
    const n = (retries.get(sessionID) || 0) + 1
    if (n > MAX_REPROMPTS) { retries.delete(sessionID); return }
    retries.set(sessionID, n)
    debugLog(`session.idle gate FAILED (re-prompt ${n}/${MAX_REPROMPTS}) — message sent to model:\n${IDLE_PROMPT}`)
    await client.session.promptAsync({
      path: { id: sessionID },
      body: {
        parts: [{
          type: "text",
          text: IDLE_PROMPT,
        }],
      },
    })
  } catch {
    // promptAsync can fail (session gone, server busy) — never crash the idle handler.
  } finally {
    prompting = false
  }
}

// --- Plugin -----------------------------------------------------------------------
export const RistrettoPlugin: Plugin = async ({ directory, worktree, client }) => {
  const projectDir = worktree || directory

  // One broken-install report per install prefix, at factory time. `console.error`, not
  // debugLog: the state must reach a user who is not debugging. Every missing path is named
  // verbatim — a concurrent broken-local + healthy-global pair is only pinpointable if each
  // instance reports its own absolute paths.
  if (!gateProbed) {
    gateProbed = true
    const missing = probeInstall()
    gateAvailable = missing.length === 0
    if (!gateAvailable) {
      console.error(
        `ristretto: incomplete install — missing ${missing.join(", ")} — this plugin must be installed with 'npx ristretto --opencode'. Hooks disabled.`,
      )
    }
  }

  return {
    // Register the 8 slash-commands at startup.
    config: async (config) => {
      config.command = config.command || {}
      for (const cmd of loadCommands(COMMANDS_DIR)) {
        config.command[cmd.key] = { template: cmd.template, description: cmd.description }
      }
    },

    // PreToolUse → tool.execute.before. House-rule guard: refuse writes to CLAUDE.md /
    // AGENTS.md while a ristretto run is armed. gate.js `guard` decides armed vs not; the
    // plugin only spawns it and throws on exit 2. A throw here aborts the tool's execute,
    // so the file is never written — equivalent to Claude's exit-2 block.
    "tool.execute.before": async (input, output) => {
      if (!gateAvailable) return
      // Guard only the mutating tools. Reading a house-rule file is legitimate —
      // only write/edit are PreToolUse-scoped, so a `read` of CLAUDE.md/AGENTS.md
      // must pass straight through.
      if (input.tool !== "write" && input.tool !== "edit") return
      const filePath = output.args?.filePath
      if (!filePath) return
      // captureOutput:false — gate.js's refusal is forwarded to the model via the
      // throw below (same shape as the task gate at line 230); re-echoing it to the
      // TUI stderr via console.error is pure noise, and the model often retries a
      // blocked write several times back-to-back, multiplying that noise.
      const { code, output: gateOutput } = await runGate(projectDir, "guard", { touchedFile: filePath, captureOutput: false })
      debugLog(`tool.execute.before guard ${input.tool} ${filePath} → exit ${code}`)
      if (code === 2) {
        // Forward gate.js's named, contextual refusal (which file, and "outside a
        // run, edit it freely") to the model — a generic message reads as transient
        // and the model retries the same write. Fallback covers an edge gate.js
        // exit 2 with no stderr (defensive; not observed in practice).
        const err = new Error(
          gateOutput.trim() ||
          "ristretto: house-rule guard blocked this write — CLAUDE.md / AGENTS.md hold this repo's house rules. ristretto reads them, never writes them; put stale content in your final message instead.",
        )
        debugLog(`tool.execute.before guard FAILED — blocked ${input.tool}:\n${err.message}`)
        throw err
      }
    },

    // SubagentStop → gate the subagent's result. Exit 2 throws → blocks the subagent.
    // `full subagent` is the never-exempt variant (a plain `full` Stop is exempted while
    // brew's orchestrator marker exists, but a subagent's work is never exempt).
    // Per-edit format is handled by the LSP server (ristretto/gate-lsp.mjs), not here.
    "tool.execute.after": async (input) => {
      if (!gateAvailable) return
      if (input.tool === "task") {
        const { code, output } = await runGate(projectDir, "full", { arg: "subagent", captureOutput: false })
        debugLog(`tool.execute.after task gate → exit ${code}${output.trim() ? ":\n" + output.trim() : ""}`)
        if (code === 2) {
          const err = new Error(
            "ristretto: work is not done — deterministic gates failed. Fix these before stopping. Do NOT weaken, skip, or delete gates/tests to get green.\n" + output.trim(),
          )
          debugLog(`tool.execute.after task gate FAILED — blocking subagent. Message sent to model:\n${err.message}`)
          throw err
        }
      }
    },

    // Stop → run the full gate; on red, re-prompt the model to fix it (guarded).
    event: async ({ event }) => {
      if (!gateAvailable) return
      if (event.type === "session.idle") {
        await onSessionIdle(client, projectDir, event.properties.sessionID)
      }
    },
  }
}
