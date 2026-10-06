// .opencode/src/index.ts
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync as readFileSync2, statSync } from "node:fs";
import path2 from "node:path";

// node_modules/jsonc-parser/lib/esm/impl/scanner.js
function createScanner(text, ignoreTrivia = false) {
  const len = text.length;
  let pos = 0, value = "", tokenOffset = 0, token = 16, lineNumber = 0, lineStartOffset = 0, tokenLineStartOffset = 0, prevTokenLineStartOffset = 0, scanError = 0;
  function scanHexDigits(count, exact) {
    let digits = 0;
    let value2 = 0;
    while (digits < count || !exact) {
      let ch = text.charCodeAt(pos);
      if (ch >= 48 && ch <= 57) {
        value2 = value2 * 16 + ch - 48;
      } else if (ch >= 65 && ch <= 70) {
        value2 = value2 * 16 + ch - 65 + 10;
      } else if (ch >= 97 && ch <= 102) {
        value2 = value2 * 16 + ch - 97 + 10;
      } else {
        break;
      }
      pos++;
      digits++;
    }
    if (digits < count) {
      value2 = -1;
    }
    return value2;
  }
  function setPosition(newPosition) {
    pos = newPosition;
    value = "";
    tokenOffset = 0;
    token = 16;
    scanError = 0;
  }
  function scanNumber() {
    let start = pos;
    if (text.charCodeAt(pos) === 48) {
      pos++;
    } else {
      pos++;
      while (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
      }
    }
    if (pos < text.length && text.charCodeAt(pos) === 46) {
      pos++;
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
      } else {
        scanError = 3;
        return text.substring(start, pos);
      }
    }
    let end = pos;
    if (pos < text.length && (text.charCodeAt(pos) === 69 || text.charCodeAt(pos) === 101)) {
      pos++;
      if (pos < text.length && text.charCodeAt(pos) === 43 || text.charCodeAt(pos) === 45) {
        pos++;
      }
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
        end = pos;
      } else {
        scanError = 3;
      }
    }
    return text.substring(start, end);
  }
  function scanString() {
    let result = "", start = pos;
    while (true) {
      if (pos >= len) {
        result += text.substring(start, pos);
        scanError = 2;
        break;
      }
      const ch = text.charCodeAt(pos);
      if (ch === 34) {
        result += text.substring(start, pos);
        pos++;
        break;
      }
      if (ch === 92) {
        result += text.substring(start, pos);
        pos++;
        if (pos >= len) {
          scanError = 2;
          break;
        }
        const ch2 = text.charCodeAt(pos++);
        switch (ch2) {
          case 34:
            result += '"';
            break;
          case 92:
            result += "\\";
            break;
          case 47:
            result += "/";
            break;
          case 98:
            result += "\b";
            break;
          case 102:
            result += "\f";
            break;
          case 110:
            result += `
`;
            break;
          case 114:
            result += "\r";
            break;
          case 116:
            result += "\t";
            break;
          case 117:
            const ch3 = scanHexDigits(4, true);
            if (ch3 >= 0) {
              result += String.fromCharCode(ch3);
            } else {
              scanError = 4;
            }
            break;
          default:
            scanError = 5;
        }
        start = pos;
        continue;
      }
      if (ch >= 0 && ch <= 31) {
        if (isLineBreak(ch)) {
          result += text.substring(start, pos);
          scanError = 2;
          break;
        } else {
          scanError = 6;
        }
      }
      pos++;
    }
    return result;
  }
  function scanNext() {
    value = "";
    scanError = 0;
    tokenOffset = pos;
    lineStartOffset = lineNumber;
    prevTokenLineStartOffset = tokenLineStartOffset;
    if (pos >= len) {
      tokenOffset = len;
      return token = 17;
    }
    let code = text.charCodeAt(pos);
    if (isWhiteSpace(code)) {
      do {
        pos++;
        value += String.fromCharCode(code);
        code = text.charCodeAt(pos);
      } while (isWhiteSpace(code));
      return token = 15;
    }
    if (isLineBreak(code)) {
      pos++;
      value += String.fromCharCode(code);
      if (code === 13 && text.charCodeAt(pos) === 10) {
        pos++;
        value += `
`;
      }
      lineNumber++;
      tokenLineStartOffset = pos;
      return token = 14;
    }
    switch (code) {
      case 123:
        pos++;
        return token = 1;
      case 125:
        pos++;
        return token = 2;
      case 91:
        pos++;
        return token = 3;
      case 93:
        pos++;
        return token = 4;
      case 58:
        pos++;
        return token = 6;
      case 44:
        pos++;
        return token = 5;
      case 34:
        pos++;
        value = scanString();
        return token = 10;
      case 47:
        const start = pos - 1;
        if (text.charCodeAt(pos + 1) === 47) {
          pos += 2;
          while (pos < len) {
            if (isLineBreak(text.charCodeAt(pos))) {
              break;
            }
            pos++;
          }
          value = text.substring(start, pos);
          return token = 12;
        }
        if (text.charCodeAt(pos + 1) === 42) {
          pos += 2;
          const safeLength = len - 1;
          let commentClosed = false;
          while (pos < safeLength) {
            const ch = text.charCodeAt(pos);
            if (ch === 42 && text.charCodeAt(pos + 1) === 47) {
              pos += 2;
              commentClosed = true;
              break;
            }
            pos++;
            if (isLineBreak(ch)) {
              if (ch === 13 && text.charCodeAt(pos) === 10) {
                pos++;
              }
              lineNumber++;
              tokenLineStartOffset = pos;
            }
          }
          if (!commentClosed) {
            pos++;
            scanError = 1;
          }
          value = text.substring(start, pos);
          return token = 13;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
      case 45:
        value += String.fromCharCode(code);
        pos++;
        if (pos === len || !isDigit(text.charCodeAt(pos))) {
          return token = 16;
        }
      case 48:
      case 49:
      case 50:
      case 51:
      case 52:
      case 53:
      case 54:
      case 55:
      case 56:
      case 57:
        value += scanNumber();
        return token = 11;
      default:
        while (pos < len && isUnknownContentCharacter(code)) {
          pos++;
          code = text.charCodeAt(pos);
        }
        if (tokenOffset !== pos) {
          value = text.substring(tokenOffset, pos);
          switch (value) {
            case "true":
              return token = 8;
            case "false":
              return token = 9;
            case "null":
              return token = 7;
          }
          return token = 16;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
    }
  }
  function isUnknownContentCharacter(code) {
    if (isWhiteSpace(code) || isLineBreak(code)) {
      return false;
    }
    switch (code) {
      case 125:
      case 93:
      case 123:
      case 91:
      case 34:
      case 58:
      case 44:
      case 47:
        return false;
    }
    return true;
  }
  function scanNextNonTrivia() {
    let result;
    do {
      result = scanNext();
    } while (result >= 12 && result <= 15);
    return result;
  }
  return {
    setPosition,
    getPosition: () => pos,
    scan: ignoreTrivia ? scanNextNonTrivia : scanNext,
    getToken: () => token,
    getTokenValue: () => value,
    getTokenOffset: () => tokenOffset,
    getTokenLength: () => pos - tokenOffset,
    getTokenStartLine: () => lineStartOffset,
    getTokenStartCharacter: () => tokenOffset - prevTokenLineStartOffset,
    getTokenError: () => scanError
  };
}
function isWhiteSpace(ch) {
  return ch === 32 || ch === 9;
}
function isLineBreak(ch) {
  return ch === 10 || ch === 13;
}
function isDigit(ch) {
  return ch >= 48 && ch <= 57;
}

// node_modules/jsonc-parser/lib/esm/impl/parser.js
var ParseOptions;
(function(ParseOptions2) {
  ParseOptions2.DEFAULT = {
    allowTrailingComma: false
  };
})(ParseOptions || (ParseOptions = {}));
function parse(text, errors = [], options = ParseOptions.DEFAULT) {
  let currentProperty = null;
  let currentParent = [];
  const previousParents = [];
  function onValue(value) {
    if (Array.isArray(currentParent)) {
      currentParent.push(value);
    } else if (currentProperty !== null) {
      currentParent[currentProperty] = value;
    }
  }
  const visitor = {
    onObjectBegin: () => {
      const object = {};
      onValue(object);
      previousParents.push(currentParent);
      currentParent = object;
      currentProperty = null;
    },
    onObjectProperty: (name) => {
      currentProperty = name;
    },
    onObjectEnd: () => {
      currentParent = previousParents.pop();
    },
    onArrayBegin: () => {
      const array = [];
      onValue(array);
      previousParents.push(currentParent);
      currentParent = array;
      currentProperty = null;
    },
    onArrayEnd: () => {
      currentParent = previousParents.pop();
    },
    onLiteralValue: onValue,
    onError: (error, offset, length) => {
      errors.push({ error, offset, length });
    }
  };
  visit(text, visitor, options);
  return currentParent[0];
}
function visit(text, visitor, options = ParseOptions.DEFAULT) {
  const _scanner = createScanner(text, false);
  const _jsonPath = [];
  let suppressedCallbacks = 0;
  function toNoArgVisit(visitFunction) {
    return visitFunction ? () => suppressedCallbacks === 0 && visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisit(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisitWithPath(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice()) : () => true;
  }
  function toBeginVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks++;
      } else {
        let cbReturn = visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice());
        if (cbReturn === false) {
          suppressedCallbacks = 1;
        }
      }
    } : () => true;
  }
  function toEndVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks--;
      }
      if (suppressedCallbacks === 0) {
        visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter());
      }
    } : () => true;
  }
  const onObjectBegin = toBeginVisit(visitor.onObjectBegin), onObjectProperty = toOneArgVisitWithPath(visitor.onObjectProperty), onObjectEnd = toEndVisit(visitor.onObjectEnd), onArrayBegin = toBeginVisit(visitor.onArrayBegin), onArrayEnd = toEndVisit(visitor.onArrayEnd), onLiteralValue = toOneArgVisitWithPath(visitor.onLiteralValue), onSeparator = toOneArgVisit(visitor.onSeparator), onComment = toNoArgVisit(visitor.onComment), onError = toOneArgVisit(visitor.onError);
  const disallowComments = options && options.disallowComments;
  const allowTrailingComma = options && options.allowTrailingComma;
  function scanNext() {
    while (true) {
      const token = _scanner.scan();
      switch (_scanner.getTokenError()) {
        case 4:
          handleError(14);
          break;
        case 5:
          handleError(15);
          break;
        case 3:
          handleError(13);
          break;
        case 1:
          if (!disallowComments) {
            handleError(11);
          }
          break;
        case 2:
          handleError(12);
          break;
        case 6:
          handleError(16);
          break;
      }
      switch (token) {
        case 12:
        case 13:
          if (disallowComments) {
            handleError(10);
          } else {
            onComment();
          }
          break;
        case 16:
          handleError(1);
          break;
        case 15:
        case 14:
          break;
        default:
          return token;
      }
    }
  }
  function handleError(error, skipUntilAfter = [], skipUntil = []) {
    onError(error);
    if (skipUntilAfter.length + skipUntil.length > 0) {
      let token = _scanner.getToken();
      while (token !== 17) {
        if (skipUntilAfter.indexOf(token) !== -1) {
          scanNext();
          break;
        } else if (skipUntil.indexOf(token) !== -1) {
          break;
        }
        token = scanNext();
      }
    }
  }
  function parseString(isValue) {
    const value = _scanner.getTokenValue();
    if (isValue) {
      onLiteralValue(value);
    } else {
      onObjectProperty(value);
      _jsonPath.push(value);
    }
    scanNext();
    return true;
  }
  function parseLiteral() {
    switch (_scanner.getToken()) {
      case 11:
        const tokenValue = _scanner.getTokenValue();
        let value = Number(tokenValue);
        if (isNaN(value)) {
          handleError(2);
          value = 0;
        }
        onLiteralValue(value);
        break;
      case 7:
        onLiteralValue(null);
        break;
      case 8:
        onLiteralValue(true);
        break;
      case 9:
        onLiteralValue(false);
        break;
      default:
        return false;
    }
    scanNext();
    return true;
  }
  function parseProperty() {
    if (_scanner.getToken() !== 10) {
      handleError(3, [], [2, 5]);
      return false;
    }
    parseString(false);
    if (_scanner.getToken() === 6) {
      onSeparator(":");
      scanNext();
      if (!parseValue()) {
        handleError(4, [], [2, 5]);
      }
    } else {
      handleError(5, [], [2, 5]);
    }
    _jsonPath.pop();
    return true;
  }
  function parseObject() {
    onObjectBegin();
    scanNext();
    let needsComma = false;
    while (_scanner.getToken() !== 2 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 2 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (!parseProperty()) {
        handleError(4, [], [2, 5]);
      }
      needsComma = true;
    }
    onObjectEnd();
    if (_scanner.getToken() !== 2) {
      handleError(7, [2], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseArray() {
    onArrayBegin();
    scanNext();
    let isFirstElement = true;
    let needsComma = false;
    while (_scanner.getToken() !== 4 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 4 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (isFirstElement) {
        _jsonPath.push(0);
        isFirstElement = false;
      } else {
        _jsonPath[_jsonPath.length - 1]++;
      }
      if (!parseValue()) {
        handleError(4, [], [4, 5]);
      }
      needsComma = true;
    }
    onArrayEnd();
    if (!isFirstElement) {
      _jsonPath.pop();
    }
    if (_scanner.getToken() !== 4) {
      handleError(8, [4], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseValue() {
    switch (_scanner.getToken()) {
      case 3:
        return parseArray();
      case 1:
        return parseObject();
      case 10:
        return parseString(true);
      default:
        return parseLiteral();
    }
  }
  scanNext();
  if (_scanner.getToken() === 17) {
    if (options.allowEmptyContent) {
      return true;
    }
    handleError(4, [], []);
    return false;
  }
  if (!parseValue()) {
    handleError(4, [], []);
    return false;
  }
  if (_scanner.getToken() !== 17) {
    handleError(9, [], []);
  }
  return true;
}

// .opencode/src/commands.ts
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// .opencode/lib/rewrite-namespace.mjs
var NAMESPACE_RE = /\/ristretto:([a-zA-Z0-9-]+)/g;
function rewriteNamespace(body) {
  return body.replace(NAMESPACE_RE, "/ristretto-$1");
}

// .opencode/src/commands.ts
var DEFAULT_DESCRIPTION = "ristretto command";
function loadCommands(dir) {
  const out = [];
  let files;
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  for (const file of files.sort()) {
    if (!file.startsWith("ristretto-") || !file.endsWith(".md"))
      continue;
    const name = file.slice(0, -3);
    const raw = readFileSync(path.join(dir, file), "utf8");
    const { description, body } = parseFrontmatter(raw);
    out.push({
      key: name,
      description: description || DEFAULT_DESCRIPTION,
      template: rewriteNamespace(body)
    });
  }
  return out;
}
function parseFrontmatter(raw) {
  const open = /^---\r?\n/.exec(raw);
  if (!open)
    return { body: raw };
  const closeAt = raw.indexOf(`
---`, open[0].length);
  if (closeAt === -1)
    return { body: raw };
  const after = raw.slice(closeAt + 4, closeAt + 6);
  const eolLen = after.startsWith(`\r
`) ? 2 : after.startsWith(`
`) ? 1 : -1;
  if (eolLen === -1)
    return { body: raw };
  const fm = raw.slice(open[0].length, closeAt + 1);
  const body = raw.slice(closeAt + 4 + eolLen);
  const descM = fm.match(/^description:\s*(.+?)\s*$/m);
  const hintM = fm.match(/^argument-hint:\s*(.+?)\s*$/m);
  const description = descM ? descM[1].trim() : undefined;
  const hint = hintM ? hintM[1].trim() : undefined;
  let folded;
  if (description && hint)
    folded = `${hint} — ${description}`;
  else if (description)
    folded = description;
  else if (hint)
    folded = hint;
  return { description: folded, body };
}

// .opencode/src/index.ts
var PLUGIN_ROOT = path2.dirname(import.meta.dir);
var RISTRETTO_DIR = path2.join(PLUGIN_ROOT, "ristretto");
var COMMANDS_DIR = path2.join(RISTRETTO_DIR, "skills");
var GATE_JS = path2.join(RISTRETTO_DIR, "gate.js");
var REQUIRED_INSTALL = ["gate.js", "testreport.js", "junit.js", "baseline.js", "version.js", "skills"];
var gateProbed = false;
var gateAvailable = false;
function probeInstall() {
  return REQUIRED_INSTALL.map((name) => path2.join(RISTRETTO_DIR, name)).filter((p) => !existsSync(p));
}
function configFile() {
  const dir = process.env.RISTRETTO_CONFIG || PLUGIN_ROOT;
  return path2.join(dir, "ristretto.jsonc");
}
var cfgCache = null;
function loadConfig() {
  const file = configFile();
  try {
    let st;
    try {
      st = statSync(file);
    } catch {
      cfgCache = null;
      return {};
    }
    const key = `${file}:${st.mtimeMs}:${st.size}`;
    if (cfgCache && cfgCache.key === key)
      return cfgCache.cfg;
    let cfg = {};
    const val = parse(readFileSync2(file, "utf8"));
    if (val && typeof val === "object" && !Array.isArray(val))
      cfg = val;
    cfgCache = { key, cfg };
    return cfg;
  } catch {
    return {};
  }
}
function debugLog(msg) {
  const logPath = loadConfig().debug?.logPath;
  if (!logPath)
    return;
  try {
    mkdirSync(path2.dirname(logPath), { recursive: true });
    appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}
`);
  } catch {}
}
var DEFAULT_GATE_TIMEOUT_MS = 660000;
var killTree = (child) => {
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {}
    return;
  }
  try {
    process.kill(-(child.pid ?? 0), "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {}
  }
};
function runGate(projectDir, mode, opts = {}) {
  const argv = [GATE_JS, mode, ...opts.arg ? [opts.arg] : []];
  const cfg = loadConfig();
  const cfgNode = cfg.nodejsPath;
  const interpreter = typeof cfgNode === "string" && cfgNode ? cfgNode : "node";
  const timeoutMs = typeof cfg.gateTimeoutMs === "number" && cfg.gateTimeoutMs > 0 ? cfg.gateTimeoutMs : DEFAULT_GATE_TIMEOUT_MS;
  debugLog(`runGate spawn: ${interpreter} ${argv.join(" ")} (cwd ${projectDir})`);
  return new Promise((resolve) => {
    const child = spawn(interpreter, argv, {
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
      stdio: ["pipe", "pipe", "pipe"],
      detached: true
    });
    const hook = opts.touchedFile ? JSON.stringify({ tool_input: { file_path: opts.touchedFile } }) : "{}";
    child.stdin.end(hook);
    let output = "";
    child.stdout?.on("data", (d) => {
      output += d;
    });
    child.stderr?.on("data", (d) => {
      output += d;
    });
    const timer = setTimeout(() => {
      killTree(child);
      if (!opts.fireAndForget) {
        console.error("[ristretto] gate timed out after " + timeoutMs + "ms — UNVERIFIED, not red");
      }
      resolve({ code: 2, output, timedOut: true });
    }, timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: 2, output });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (output.trim() && !opts.fireAndForget && opts.captureOutput !== false) {
        console.error(`[ristretto] gate output:
` + output.trim());
      }
      resolve({ code: code ?? 0, output });
    });
    if (opts.fireAndForget) {
      timer.unref();
      child.unref();
    }
  });
}
var MAX_REPROMPTS = 3;
var prompting = false;
var retries = new Map;
var IDLE_PROMPT = "ristretto: deterministic gates are red. Fix the failures before stopping. Do NOT weaken, skip, or delete gates/tests to get green.";
async function onSessionIdle(client, projectDir, sessionID) {
  const { code, timedOut } = await runGate(projectDir, "full", { fireAndForget: true });
  debugLog(`session.idle gate → exit ${code}${timedOut ? " (timed out — UNVERIFIED)" : ""}`);
  if (code !== 2 || timedOut) {
    if (!timedOut)
      retries.delete(sessionID);
    return;
  }
  if (prompting)
    return;
  prompting = true;
  try {
    const n = (retries.get(sessionID) || 0) + 1;
    if (n > MAX_REPROMPTS) {
      retries.delete(sessionID);
      return;
    }
    retries.set(sessionID, n);
    debugLog(`session.idle gate FAILED (re-prompt ${n}/${MAX_REPROMPTS}) — message sent to model:
${IDLE_PROMPT}`);
    await client.session.promptAsync({
      path: { id: sessionID },
      body: {
        parts: [{
          type: "text",
          text: IDLE_PROMPT
        }]
      }
    });
  } catch {} finally {
    prompting = false;
  }
}
var RistrettoPlugin = async ({ directory, worktree, client }) => {
  const projectDir = worktree || directory;
  if (!gateProbed) {
    gateProbed = true;
    const missing = probeInstall();
    gateAvailable = missing.length === 0;
    if (!gateAvailable) {
      console.error(`ristretto: incomplete install — missing ${missing.join(", ")} — this plugin must be installed with 'npx ristretto --opencode'. Hooks disabled.`);
    }
  }
  return {
    config: async (config) => {
      config.command = config.command || {};
      for (const cmd of loadCommands(COMMANDS_DIR)) {
        config.command[cmd.key] = { template: cmd.template, description: cmd.description };
      }
    },
    "tool.execute.before": async (input, output) => {
      if (!gateAvailable)
        return;
      if (input.tool !== "write" && input.tool !== "edit")
        return;
      const filePath = output.args?.filePath;
      if (!filePath)
        return;
      const { code, output: gateOutput } = await runGate(projectDir, "guard", { touchedFile: filePath, captureOutput: false });
      debugLog(`tool.execute.before guard ${input.tool} ${filePath} → exit ${code}`);
      if (code === 2) {
        const err = new Error(gateOutput.trim() || "ristretto: house-rule guard blocked this write — CLAUDE.md / AGENTS.md hold this repo's house rules. ristretto reads them, never writes them; put stale content in your final message instead.");
        debugLog(`tool.execute.before guard FAILED — blocked ${input.tool}:
${err.message}`);
        throw err;
      }
    },
    "tool.execute.after": async (input) => {
      if (!gateAvailable)
        return;
      if (input.tool === "task") {
        const { code, output } = await runGate(projectDir, "full", { arg: "subagent", captureOutput: false });
        debugLog(`tool.execute.after task gate → exit ${code}${output.trim() ? `:
` + output.trim() : ""}`);
        if (code === 2) {
          const err = new Error(`ristretto: work is not done — deterministic gates failed. Fix these before stopping. Do NOT weaken, skip, or delete gates/tests to get green.
` + output.trim());
          debugLog(`tool.execute.after task gate FAILED — blocking subagent. Message sent to model:
${err.message}`);
          throw err;
        }
      }
    },
    event: async ({ event }) => {
      if (!gateAvailable)
        return;
      if (event.type === "session.idle") {
        await onSessionIdle(client, projectDir, event.properties.sessionID);
      }
    }
  };
};
export {
  RistrettoPlugin
};
