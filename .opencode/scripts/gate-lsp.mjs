#!/usr/bin/env node
// gate-lsp.mjs — LSP adapter for ristretto's gate.js (spike).
//
// Proves the channel: ristretto's deterministic gates CAN reach the model inline
// via OpenCode's LSP diagnostics (the only channel after edit/write). Runs the
// per-file `format` gate on every didOpen/didChange and publishes a severity-1
// diagnostic when it changed the file.
//
// Severity MUST be 1 — OpenCode's filter (lsp/diagnostic.ts) drops 2/3/4 before
// the renderer; the "ERROR" label is hardcoded, tone lives in the message.
//
// Protocol: LSP 3.17 over stdio, zero deps. JSON-RPC + Content-Length framing.

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// `root` resolves from this file's location. The source lives at
// <repo>/.opencode/scripts/gate-lsp.mjs but is never executed there —
// build-ristretto.mjs copies it to <repo>/ristretto/gate-lsp.mjs (dev/test) and
// the installer copies that to <prefix>/ristretto/gate-lsp.mjs. At both staged
// locations `..` is the directory that holds ristretto/gate.js (repo root or
// install prefix), so a single `..` is correct for every layout this file
// actually runs from.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
// One layout: gate.js sits at <root>/ristretto/gate.js — staged by `bun run build`
// for the local clone + npm install, written by the installer for npx installs.
const GATE_JS = path.join(root, "ristretto", "gate.js")

// --- Framing ---------------------------------------------------------------
let buf = Buffer.alloc(0)

function tryReadMessage() {
  while (true) {
    const str = buf.toString("utf8")
    const headerEnd = str.indexOf("\r\n\r\n")
    if (headerEnd === -1) return null
    const header = str.slice(0, headerEnd)
    const m = header.match(/Content-Length:\s*(\d+)/i)
    if (!m) { buf = buf.slice(headerEnd + 4); continue }
    const len = parseInt(m[1], 10)
    const bodyStart = headerEnd + 4
    if (buf.length < bodyStart + len) return null
    const body = buf.toString("utf8", bodyStart, bodyStart + len)
    buf = buf.slice(bodyStart + len)
    try { return JSON.parse(body) } catch { continue }
  }
}

function send(msg) {
  const body = JSON.stringify(msg)
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
}

// --- Gate wrapping ---------------------------------------------------------
function projectDirFor(filePath) {
  let dir = path.dirname(filePath)
  while (dir !== path.dirname(dir)) {
    if (existsSync(path.join(dir, ".ristretto.json"))) return dir
    dir = path.dirname(dir)
  }
  return null
}

// Run the per-file format gate via gate.js `quick`. Returns true if the file
// changed (the gate left it different than when we started).
function formatFile(projectDir, filePath) {
  const before = existsSync(filePath) ? readFileSync(filePath, "utf8") : ""
  try {
    spawnSync(process.execPath, [GATE_JS, "quick"], {
      cwd: projectDir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
      input: JSON.stringify({ tool_input: { file_path: filePath } }),
      stdio: ["pipe", "ignore", "pipe"],
    })
  } catch { /* format is convenience — never surface a crash */ }
  const after = existsSync(filePath) ? readFileSync(filePath, "utf8") : ""
  return before !== after
}

// --- LSP handlers ----------------------------------------------------------
const openFiles = new Map() // uri → filePath

function handle(msg) {
  if (!msg) return
  const { id, method, params } = msg
  switch (method) {
    case "initialize":
      send({ jsonrpc: "2.0", id, result: { capabilities: { textDocumentSync: { openClose: true, change: 1 } } } })
      break
    case "initialized":
      break
    case "textDocument/didOpen": {
      const uri = params.textDocument.uri
      const filePath = uri.replace("file://", "")
      openFiles.set(uri, filePath)
      validate(uri, filePath)
      break
    }
    case "textDocument/didChange": {
      const uri = params.textDocument.uri
      const filePath = openFiles.get(uri) || uri.replace("file://", "")
      validate(uri, filePath)
      break
    }
    case "textDocument/didClose":
      openFiles.delete(params.textDocument.uri)
      break
    case "shutdown":
      send({ jsonrpc: "2.0", id, result: null }); break
    case "exit":
      process.exit(0)
    default:
      if (id !== undefined) send({ jsonrpc: "2.0", id, result: null })
  }
}

function validate(uri, filePath) {
  const projectDir = projectDirFor(filePath)
  if (!projectDir) { sendEmpty(uri); return }
  const changed = formatFile(projectDir, filePath)
  const rel = path.relative(projectDir, filePath)
  const diag = changed ? {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    severity: 1,
    source: "ristretto",
    message: `${rel}: auto-formatted by gate (format gate). Note the reformatted content.`,
  } : []
  send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri, diagnostics: diag } })
}

function sendEmpty(uri) {
  send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri, diagnostics: [] } })
}

let processing = false
async function processBuffer() {
  if (processing) return
  processing = true
  while (true) {
    const m = tryReadMessage()
    if (!m) break
    handle(m)
    await new Promise((r) => setImmediate(r))
  }
  processing = false
}

process.stdin.on("data", (chunk) => { buf = Buffer.concat([buf, chunk]); processBuffer() })
