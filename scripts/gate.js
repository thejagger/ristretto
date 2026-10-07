#!/usr/bin/env node
// ristretto gate runner — deterministic gates, framework-agnostic via .ristretto.json.
// Node instead of bash+jq so it runs identically on Windows, macOS, Linux.
//
// Modes:
//   quick            PostToolUse hook. Formats the touched file — only if it matches
//                    gates.formatPaths, when that is configured. ALWAYS exits 0 (convenience).
//   full             Stop hook. Runs lint + typecheck + test. Exits 2 on failure (blocks the
//                    agent), but ONLY while .ristretto/pulling exists. Outside a pull: exits 0.
//                    Uses gates.testChanged (scoped to the touched files) when configured — the
//                    loop stays fast; the full suite is proven once at the end via `verify`.
//   full subagent    SubagentStop hook. Same, but never exempt (see ORCHESTRATOR below).
//   verify           Not a hook — run directly (`node gate.js verify`). Runs lint + typecheck +
//                    the FULL test gate, ignoring the marker and the cache. One-line summary.
//                    Exits 0 green, 1 red. brew's pre-flight and its end-of-run proof.
//   verify cached    Same, but a tree byte-identical to one already proven green returns that
//                    verdict instead of re-running. For a pre-flight repeated after a session
//                    restart: re-paying a ten-minute suite to re-prove an unchanged tree is
//                    waste, and waste at the worst moment — before anything has been built.
//   prove            Not a hook — run directly (`node gate.js prove`). Runs exactly what the
//                    SubagentStop hook would: the SCOPED test gate, same lock, same budgets. On
//                    green it writes the fingerprint, so the hook that follows finds a proven
//                    tree and does nothing — one run instead of two. Exits 0 green, 1 red, 3
//                    UNVERIFIED (a stall, an unobtained lock, or an unparseable config), never the
//                    hook's 2.
//
// ORCHESTRATOR. brew's main agent writes no source by design; it dispatches subagents, which are
// gated individually on SubagentStop. Gating its OWN stops means running a suite against a tree a
// live subagent is mid-edit on — a half-applied migration reads as hundreds of red tests that
// belong to nobody. So while .ristretto/orchestrating exists, Stop is exempt and SubagentStop is
// not. pull and shot never write that marker: there the main agent IS the implementer.
//
// LOCK. Exactly one gate run at a time, repo-wide (.ristretto/gate-lock). Two concurrent suites
// sharing one database or port produce failures that belong to neither — a red that is pure
// artifact, and indistinguishable from a real one without knowing what else was running. A run
// that cannot get the lock reports UNVERIFIED and never blocks: a collision must not look like a
// defect. Waiting is usually cheap, because the holder often proves the very tree we came to test.
//
// Hang detection is by SILENCE, not duration. A slow suite is still working and prints as it
// goes; a hung one goes quiet. Killing on total runtime would murder a legitimately slow suite
// and call it broken, so there is no duration cap by default — set `timeouts` to opt into one.
// A stalled gate is reported and surfaced immediately, never retried: retrying a hang re-hangs.
//
// Reads hook JSON from stdin (Claude Code protocol) in quick/full mode.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync, execSync } = require('child_process');
const { readReport } = require('./testreport');
const { ratchet, load: loadBaseline, save: saveBaseline } = require('./baseline');

const MODE = process.argv[2] || 'quick';
const ARG = process.argv[3] || '';
const MAX_RETRIES = 3;

// Seconds a gate run will wait for the lock. This ceiling is NOT about how long a suite takes.
// It is about how long whatever started us can stay silent before something else kills it: an
// agent that emits nothing for ~10 minutes is killed by the harness stall watchdog, and a killed
// agent loses its result *entirely* — whoever dispatched it gets no answer at all, rather than a
// failure it could act on. Waiting quietly past that point cannot help anyone, because there is
// no longer anybody listening. So the wait ends, and says so, while someone is still alive to
// hear it: reporting UNVERIFIED at eight minutes beats being killed at ten having said nothing.
// (This was 3600-shaped once, reasoned from the hook backstop alone; the hook is not the only
// thing with a patience limit, and it is not the shortest.) Raise `lockWait` deliberately on a
// repo where gate runs legitimately queue for longer and nothing is watching the clock.
const DEFAULT_LOCK_WAIT = 480;

// How long the agent that triggered this hook may stay silent before its own harness kills it.
// This is the budget the whole run is spending, and it is spent by two things that never knew
// about each other: the wait for the lock, and the gate run itself. Eight minutes of queue plus a
// six-minute suite is fourteen minutes of a subagent saying nothing — dead at ten, its result
// gone, and a feature blocked for a reason that was never about the feature. So the wait is sized
// against what the run is measured to cost, not set to a ceiling picked in isolation.
const DEFAULT_WATCHDOG = 600;

// Kept back from the wait for the run that follows it. A wait that consumed every remaining
// second would guarantee the run itself starts with nothing left.
const LOCK_SLACK = 60;

// Never wait zero — a lock conflict is transient, and giving up instantly would report UNVERIFIED
// on a run that was a second away from starting. This floor only ever binds when the last run
// already ate the budget, which is itself the thing worth reporting.
const MIN_LOCK_WAIT = 5;

// A single run past this share of the watchdog is close enough to name. Below it the margin is
// real; above it, one slow day is the difference between a result and a killed agent.
const WATCHDOG_WARN_SHARE = 0.5;

// A lock file older than this is stale whatever its pid says. Liveness alone is not enough:
// pids get recycled, so a dead holder's number can come back as an unrelated process and the
// lock would look held forever. Nothing can legitimately hold it this long — the hook backstop
// is an hour, and every path that takes the lock releases it on exit.
const LOCK_MAX_AGE_MS = 2 * 60 * 60 * 1000;

// A marker with no gate activity for this long belongs to a session that died, not to a live
// pull. Every armed run touches the marker, so this measures IDLENESS, not age — an unattended
// batch that runs for three days keeps its own gates armed the whole time, while a marker left
// behind by a crashed session ages out instead of arming a session that never asked for it.
// This now only ever advances on the OWNER's runs — a foreign session never refreshes someone
// else's marker — so a run whose subagents all die still disarms itself after a day, instead of
// being kept alive forever by gate hooks from sessions that were never part of it.
const MARKER_MAX_IDLE_MS = 24 * 60 * 60 * 1000;

// The orchestrator's exemption gets a far shorter rope than the pulling marker, because the two
// fail in opposite directions. A stale `pulling` gates a session that never asked for it: annoying,
// and obvious the moment it happens. A stale `orchestrating` turns Stop gating OFF, which has no
// symptom at all — work simply stops being checked. A live brew stops a subagent every few minutes,
// so hours of silence is not a slow feature; it is a loop that is no longer running.
const ORCHESTRATOR_MAX_IDLE_MS = 2 * 60 * 60 * 1000;

// null when it cannot be read at all — the caller decides what to do with "unknown", and every
// caller here chooses the safe direction rather than the convenient one.
function markerIdleMs(p) {
  try { return Date.now() - fs.statSync(p).mtimeMs; } catch { return null; }
}

// Who owns this run. `arm` runs as a command and has CLAUDE_CODE_SESSION_ID; a hook always
// has session_id on stdin. Either is enough — and an empty marker is claimed by the first
// hook that sees it, so the id never has to be known at arm time.
function mySession() {
  return process.env.CLAUDE_CODE_SESSION_ID || hook.session_id || '';
}

// '' means nobody has claimed it yet, null means there is no marker.
function markerOwner(p) {
  try { return fs.readFileSync(p, 'utf8').trim(); } catch { return null; }
}

function ownerLabel(p) {
  const owner = markerOwner(p);
  if (owner === null) return null;
  if (owner === '') return 'unclaimed';
  return owner === mySession() ? 'this session' : 'ANOTHER session';
}

// Raw seconds stop being legible well before an hour ("21642s ago") — render in the largest
// unit that still reads as a sentence: seconds under a minute, then minutes, then hours.
function formatAge(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}min ago`;
  return `${Math.round(ms / 3600000)}h ago`;
}

// Seconds a gate may produce NO output before it's treated as hung.
// lint and typecheck get a long rope on purpose: whole-project analysers print nothing at all
// until they finish — a type checker, a linter over the whole tree, a compile step — so their
// silence carries no information whatsoever. Test runners stream progress as they go, so silence
// from one is a much stronger signal. These are budgets per gate KIND, not per tool, which is
// why they hold across every stack rather than needing a table of runners.
const DEFAULT_SILENCE = { format: 30, lint: 600, typecheck: 600, test: 300, testChanged: 300 };

// Kept back from the silence budget for the same reason LOCK_SLACK is kept back from the wait: the
// kill has to land early enough that the report gets written, read, and answered by an agent that
// is still alive.
const SILENCE_SLACK = 60;

// Never zero, however small a watchdog someone configures — a budget of nothing would report every
// gate as hung before it started.
const MIN_SILENCE = 5;

// The highest silence budget that can still produce a result somebody is alive to collect.
//
// `silence` is authored per repo, and a repo whose suite is genuinely quiet for a quarter of an hour
// will be told — correctly, by this very runner — to raise the budget. Raising it past the watchdog
// buys NOTHING: the agent waiting on the gate is killed first, and a killed agent loses its result
// entirely. The gate reads green in the log while whoever dispatched it is told the agent stalled,
// about work that was finished and proven. Both roads to that end were open here: a hand-written
// `silence` was merged over the defaults unclamped, and calibration alone can widen to
// QUIET_CEILING_MS — thirty minutes, three times the watchdog — with nothing configured at all.
// So the budget is bounded by what the caller can survive. This can turn a slow-but-healthy gate
// into a reported hang, and that is the trade taken deliberately: UNVERIFIED at nine minutes is a
// result, and being killed at ten having said nothing is not. Exactly the reasoning DEFAULT_LOCK_WAIT
// already follows.
//
// `verify` is exempt, and has to be: it is the deliberate whole-repo run — brew's pre-flight and its
// final pass — launched and backgrounded by the orchestrator, with no stall watchdog counting against
// it. Clamping that would make a suite that is merely slow unprovable anywhere at all.
function hookSilenceCeilingSec() {
  return Math.max(MIN_SILENCE, watchdog - SILENCE_SLACK);
}
function silenceCeilingSec() {
  if (MODE === 'verify') return Infinity;
  return hookSilenceCeilingSec();
}

// The pre-flight audit. `verify` runs uncapped, so nothing above would ever fire there — which would
// make the one run that exists to check the config before a loop pays for it dozens of times the only
// run that stays quiet about a budget the loop will not honour. It reports and does not refuse: the
// clamp has already made the number harmless, and stopping a brew over a value that can no longer
// hurt it would be a gate on tidiness. What it buys is the cause getting fixed — a budget this high
// was written because something is mute, and that something is still mute.
function auditSilenceBudgets() {
  const ceilingSec = hookSilenceCeilingSec();
  const over = silenceAuthored.filter((k) => Number.isFinite(silence[k]) && silence[k] > ceilingSec);
  if (!over.length) return;
  for (const key of over) {
    console.error(`ristretto: "silence"."${key}" is ${silence[key]}s — the hooks will not honour it, they will use ${ceilingSec}s.`);
  }
  console.error(`  An agent is killed after ~${watchdog}s of silence and loses its result entirely, so a budget past`);
  console.error('  that point cannot be collected. This run is exempt (nothing is waiting on it), which is exactly');
  console.error('  why it is the run that has to tell you. A number this high was written because a gate is mute:');
  console.error('  make it stream (drop --no-progress/-q, add a per-test reporter) or scope it with "testChanged",');
  console.error('  then put the budget back where it measures something.');
}

// Said once per run, and only for a budget somebody TYPED. Calibration going over is the runner's own
// doing and is simply capped, and so are the defaults — `lint` and `typecheck` are 600 against a 600s
// watchdog, so a scolding here would fire on every repo about a number nobody chose. A value in
// `.ristretto.json` is a decision, and leaving a decision silently ignored is how the same defect
// returns one layer down: the file still reads 2400, so the next person raises it again.
const ceilingAnnounced = new Set();
function announceSilenceCeiling(gate, configuredSec, ceilingSec) {
  if (ceilingAnnounced.has(gate.key)) return;
  ceilingAnnounced.add(gate.key);
  console.error(`ristretto: "silence"."${gate.key}" is ${configuredSec}s, and is not being honoured — using ${ceilingSec}s.`);
  console.error(`  The agent waiting on this gate is killed after ~${watchdog}s of quiet, and a killed agent loses its`);
  console.error('  result entirely. A budget past that point cannot be collected by anyone. If this gate is genuinely');
  console.error('  quiet for that long, the fix is to make it stream (drop any --no-progress/-q flag, add a per-test');
  console.error('  reporter) or to scope it with "gates"."testChanged" — not to raise the number.');
}

// Hard duration caps, seconds. OFF by default — a slow gate is not a broken gate. `format` is the
// exception: it's a per-keystroke convenience on a single file, and its hook is capped anyway.
const DEFAULT_HARD_CAP = { format: 30 };

// An unscoped test gate that runs longer than this is worth saying something about: it will be
// paid again at every stop for the rest of the run. Measured, not guessed — a repo whose suite
// is genuinely quick never sees the hint, whatever language it is written in.
const SLOW_TEST_HINT_MS = 60 * 1000;

// A *scoped* run this slow is a defect in the scoping, not a fact about the repo. The usual cause
// is that the scoped command quietly dropped the parallelism the full gate has (`-n auto`, `-T`,
// `--parallel`), which can make "only the files this feature touched" take longer than the entire
// suite. Well under the ~600s an agent may go silent before it is killed, so this gets a chance to
// be read rather than arriving after the run it was meant to save.
const SLOW_SCOPED_HINT_MS = 5 * 60 * 1000;

const POLL_MS = 1000;
const MAX_CAPTURE = 2 * 1024 * 1024; // keep the tail of the output, not all of it

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const configPath = path.join(projectDir, '.ristretto.json');
const markerPath = path.join(projectDir, '.ristretto', 'pulling');
const retriesPath = path.join(projectDir, '.ristretto', 'gate-retries');
const greenPath = path.join(projectDir, '.ristretto', 'gate-green');
const stalledPath = path.join(projectDir, '.ristretto', 'gate-stalled');
const toolsPath = path.join(projectDir, '.ristretto', 'gate-tools.json');
const lockPath = path.join(projectDir, '.ristretto', 'gate-lock');
const formatBrokenPath = path.join(projectDir, '.ristretto', 'format-broken');
const baselinePath = path.join(projectDir, '.ristretto', 'baseline.json');
const orchestratingPath = path.join(projectDir, '.ristretto', 'orchestrating');

// Files ristretto reads and never writes. A hand-curated memory file that an agent appends to
// stops being worth reading, so every brief in every command says so — and prose held right up
// until one subagent read it differently and rewrote the house rules mid-feature. Same rule,
// enforced instead of asked for. Matched on basename so a nested one is covered too.
const HOUSE_RULE_FILES = new Set(['claude.md', 'agents.md']);

// No config → ristretto not set up in this repo → never interfere.
// `state` answers questions about a repo that may not be set up yet — that is a legitimate
// answer, not a reason to say nothing. `arm`/`disarm` are commands, not hooks, and need only
// `.ristretto/` to exist — a first `arm` in a repo that has not run `prep` yet must still work.
if (!fs.existsSync(configPath) && MODE !== 'state' && MODE !== 'arm' && MODE !== 'disarm') process.exit(0);

let hook = {};
if (MODE !== 'verify' && MODE !== 'state' && MODE !== 'arm' && MODE !== 'disarm' && MODE !== 'prove') {
  try { hook = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { /* no/bad stdin is fine */ }
}

// Which stop is this? The hooks.json argument is authoritative; the event name from the hook
// payload is a fallback for a hooks.json that predates the argument.
const IS_SUBAGENT = ARG === 'subagent' || hook.hook_event_name === 'SubagentStop';
const CACHED = ARG === 'cached';

let gates = {};
let silence = DEFAULT_SILENCE;
let hardCaps = DEFAULT_HARD_CAP;
let lockWait = DEFAULT_LOCK_WAIT;
let watchdog = DEFAULT_WATCHDOG;
// Which silence budgets a human actually wrote down, as opposed to inherited.
let silenceAuthored = [];
try {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  gates = config.gates || {};
  silence = { ...DEFAULT_SILENCE, ...(config.silence || {}) };
  silenceAuthored = Object.keys(config.silence || {});
  hardCaps = { ...DEFAULT_HARD_CAP, ...(config.timeouts || {}) };
  if (Number.isFinite(config.lockWait)) lockWait = config.lockWait;
  if (Number.isFinite(config.watchdog)) watchdog = config.watchdog;
} catch (e) {
  if (MODE === 'verify') {
    console.error(`ristretto: .ristretto.json is unparseable (${e.message}) — fix it, the gate cannot run.`);
    process.exit(1);
  }
  if (MODE === 'prove') {
    // Never the generic exit 0 below: an implementer running `prove` as its final proof would
    // read exit 0 as green. This proved nothing either way, same as a stall or an unobtained
    // lock — exit 3, not 0 (falsely green) and not verify's 1 (this never ran a gate to fail).
    console.error(`ristretto: .ristretto.json is unparseable (${e.message}) — fix it, the gate cannot run.`);
    process.exit(3);
  }
  if (MODE === 'full' && fs.existsSync(markerPath)) {
    // Fail closed: a broken config while a pull is active must not silently disarm the gate.
    console.error(`ristretto: .ristretto.json is unparseable (${e.message}) — fix it, the gate cannot run.`);
    process.exit(2);
  }
  // Same reasoning as the exists-check above: `state` answers questions about a repo that may
  // not be set up (or may have a broken config) rather than going silent, and `arm`/`disarm`
  // never read `gates` at all. The defaults already assigned above (`gates = {}` etc.) are enough.
  if (MODE !== 'state' && MODE !== 'arm' && MODE !== 'disarm') process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Is that pid still around? EPERM means it exists but belongs to someone else — still alive.
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// --- The gate lock: one gate run at a time, repo-wide. ---
// Not an optimisation. Two `pytest -n auto` runs against one shared database produce a stable,
// convincing, entirely fictional set of failures; the same is true of any suite that binds a
// port or a fixture. Serialising is the only way a red gate can be trusted to mean something.

let holdsLock = false;

// How long this run may queue before it has to report UNVERIFIED instead. `lockWait` is a ceiling,
// not a plan: what actually decides is how much of the agent's silence budget the run that follows
// is going to need. That is measured, not guessed — the last full pass recorded what it cost — so
// a repo whose suite grows into the watchdog automatically stops queueing for eight minutes on top
// of it.
let waitSec = lockWait;
function effectiveLockWait() {
  const lastRunMs = observedQuiet[RUN_TOTAL_KEY];
  // Bounded by the watchdog even with nothing measured yet: the run still has to happen after the
  // wait, so spending the whole budget queueing is wrong on the first run too. A measured run only
  // tightens it further.
  const lastRunSec = Number.isFinite(lastRunMs) ? Math.round(lastRunMs / 1000) : 0;
  const room = watchdog - lastRunSec - LOCK_SLACK;
  return Math.max(MIN_LOCK_WAIT, Math.min(lockWait, room));
}

// true if the lock is ours, false if we waited it out without getting it.
async function acquireLock(label) {
  waitSec = effectiveLockWait();
  const deadline = Date.now() + waitSec * 1000;
  let announced = false;
  for (;;) {
    try {
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      // 'wx' fails if the file exists — the atomic create that makes this a lock at all.
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, label, at: Date.now() }));
      fs.closeSync(fd);
      holdsLock = true;
      return true;
    } catch (e) {
      // Can't create it for a reason other than "taken" (read-only checkout, odd permissions):
      // proceed unlocked rather than refuse to gate at all. Enforcement beats serialisation.
      if (e.code !== 'EEXIST') return true;
      let held = null;
      try { held = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { /* torn or empty */ }
      const tooOld = held && Number.isFinite(held.at) && Date.now() - held.at > LOCK_MAX_AGE_MS;
      if (!held || !alive(held.pid) || tooOld) {
        // Say it. A lock outlives its holder only when that run was killed rather than finishing,
        // and that is the one trace such a death leaves anywhere — the agent it belonged to is
        // gone with its output. Stealing it silently is correct and also throws away the only
        // evidence that anything went wrong at all.
        if (held && !announced) {
          console.error(`ristretto: a previous gate run (${held.label || 'unknown'}, pid ${held.pid}) left its lock behind — it was killed, not finished. Taking it over.`);
        }
        try { fs.unlinkSync(lockPath); } catch { /* someone else cleaned up first */ }
        continue; // the holder died, or its pid was recycled by something unrelated — steal it
      }
      if (Date.now() >= deadline) return false;
      // Say once, immediately, that we are queued rather than working. Silence here is the most
      // expensive thing this script can do: whoever is waiting on us cannot tell a queue from a
      // hang, and the usual response to an unexplained quiet minute is to start a second suite —
      // exactly what the lock exists to prevent.
      if (!announced) {
        announced = true;
        console.error(`ristretto: waiting for the gate lock — ${lockHolder()} is running. Up to ${waitSec}s.`);
      }
      await sleep(POLL_MS);
    }
  }
}

function releaseLock() {
  if (!holdsLock) return;
  try {
    const held = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (held.pid === process.pid) fs.unlinkSync(lockPath);
  } catch { /* already gone, or not ours to remove */ }
  holdsLock = false;
}
process.on('exit', releaseLock);

// Consume one unit of the shared retry budget and report the new count. Every path that blocks
// the agent goes through here, so no failure mode — red gates, an unreachable lock — can loop
// without bound. A green run clears it.
function bumpRetries() {
  let retries = 0;
  try { retries = parseInt(fs.readFileSync(retriesPath, 'utf8'), 10) || 0; } catch { /* first one */ }
  retries += 1;
  try { fs.mkdirSync(path.dirname(retriesPath), { recursive: true }); fs.writeFileSync(retriesPath, String(retries)); } catch { /* best-effort */ }
  return retries;
}

function lockHolder() {
  try {
    const held = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    return `${held.label || 'a gate run'} (pid ${held.pid}, started ${Math.round((Date.now() - held.at) / 1000)}s ago)`;
  } catch {
    return 'another gate run';
  }
}

// --- Which files may the format convenience touch? ---
// Unconfigured, it formats whatever was written — which is how a repo-wide formatter ends up
// reflowing a doc nobody asked it to, and how a two-line edit becomes a hundred-line diff that
// the next edit re-triggers. gates.formatPaths scopes it to the paths the formatter owns.

function expandBraces(glob) {
  const m = /\{([^{}]*)\}/.exec(glob);
  if (!m) return [glob];
  return m[1].split(',').flatMap((opt) =>
    expandBraces(glob.slice(0, m.index) + opt + glob.slice(m.index + m[0].length)));
}

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++; // `**/` also matches zero directories
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  // Windows and macOS resolve paths case-insensitively; a pattern written `src/**` must not
  // silently stop matching because an editor or a tool handed us `Src/...`.
  return new RegExp(`^${re}$`, process.platform === 'linux' ? '' : 'i');
}

function formatAllowed(file) {
  const patterns = gates.formatPaths;
  if (!Array.isArray(patterns) || !patterns.length) return true; // unconfigured → format anything
  const rel = path.relative(projectDir, file).split(path.sep).join('/');
  if (!rel || rel.startsWith('..')) return false; // outside the repo — never ours to rewrite
  return patterns.some((p) => expandBraces(p).some((g) => globToRegExp(g).test(rel)));
}

// Kill the whole process group. A test runner forks workers; killing only the shell leaves them
// holding the ports and file handles that caused the hang in the first place.
function killTree(child) {
  if (process.platform === 'win32') {
    try { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); return; } catch { /* fall through */ }
  }
  try { process.kill(-child.pid, 'SIGKILL'); } catch {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

// Returns null on success, or { output, stalled, hardCapped, quietFor } on failure.
// Watches the output stream: a gate that has printed nothing for `silenceSec` is hung, however
// long it has been running in total. `hardCapSec` (undefined = no cap) is a separate opt-in belt.
function run(cmd, { silenceSec, hardCapSec }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, {
      cwd: projectDir,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32', // own process group, so killTree can take the workers
      // Hang detection reads silence, which quietly assumes a tool talks while it works. Python
      // does not: piped rather than attached to a terminal it block-buffers, so `pytest -q` over a
      // thousand tests — barely a kilobyte of dots, less than one buffer — emits NOTHING until it
      // exits. A perfectly healthy suite then looks identical to a wedged one, and gets killed the
      // moment it outlives the budget. One variable turns the largest such offender back into a
      // tool that streams; it costs nothing on every other stack, where it is simply ignored.
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    const chunks = [];
    let size = 0;
    let lastOutput = Date.now();
    const startedAt = lastOutput;
    let stalled = false;
    let hardCapped = false;
    // The longest this gate went without saying anything. On a run that ends green this is a
    // measurement of how talkative the tool actually is — which is the thing the silence budget
    // was guessing at, and the only honest way to know it for a runner nobody anticipated.
    let maxQuiet = 0;

    const capture = (buf) => {
      maxQuiet = Math.max(maxQuiet, Date.now() - lastOutput);
      lastOutput = Date.now();
      chunks.push(buf);
      size += buf.length;
      while (size > MAX_CAPTURE && chunks.length > 1) size -= chunks.shift().length;
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);

    const watchdog = setInterval(() => {
      const now = Date.now();
      if (silenceSec && now - lastOutput >= silenceSec * 1000) {
        stalled = true;
        clearInterval(watchdog);
        killTree(child);
      } else if (hardCapSec && now - startedAt >= hardCapSec * 1000) {
        hardCapped = true;
        clearInterval(watchdog);
        killTree(child);
      }
    }, POLL_MS);

    const finish = (code) => {
      clearInterval(watchdog);
      const output = Buffer.concat(chunks).toString('utf8');
      // The tail counts too: a gate whose last word comes early and then works in silence until it
      // exits is exactly the shape this is here to learn.
      lastRunMaxQuietMs = Math.max(maxQuiet, Date.now() - lastOutput);
      if (stalled || hardCapped) {
        return resolve({ output, stalled, hardCapped, quietFor: Math.round((Date.now() - lastOutput) / 1000) });
      }
      resolve(code === 0 ? null : { output: output || `exited with code ${code}`, stalled: false, hardCapped: false });
    };

    child.on('close', (code) => finish(code));
    child.on('error', (err) => {
      clearInterval(watchdog);
      resolve({ output: String(err.message), stalled: false, hardCapped: false });
    });
  });
}

function git(args) {
  try {
    return execSync(`git ${args}`, { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024 });
  } catch {
    return null;
  }
}

// Paths of every dirty or untracked file, as git reports them.
function dirtyPaths() {
  const status = git('status --porcelain -uall');
  if (status === null) return null;
  return status.split('\n').filter(Boolean).map((line) => {
    let p = line.slice(3);
    if (p.includes(' -> ')) p = p.split(' -> ')[1];
    if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1).replace(/\\(.)/g, '$1');
    return p;
  });
}

// Fingerprint of the working tree: HEAD + status + content of every dirty/untracked
// file. If the tree is byte-identical to one that already passed the gates, re-running
// them proves nothing — subagents that change no code (reviewers, closers) would
// otherwise pay a full test-suite run at every stop. Returns null outside a git repo:
// no caching, gates always run.
function treeFingerprint() {
  const head = git('rev-parse HEAD');
  const paths = dirtyPaths();
  if (head === null || paths === null) return null;
  const h = crypto.createHash('sha256');
  h.update(head + '\0' + paths.join('\0'));
  for (const p of paths) {
    try { h.update(fs.readFileSync(path.join(projectDir, p))); } catch { h.update('\0gone'); }
    h.update('\0');
  }
  return h.digest('hex');
}

// Every changed file that still exists on disk, repo-relative.
function changedFiles() {
  return (dirtyPaths() || []).filter((p) => {
    try { return fs.statSync(path.join(projectDir, p)).isFile(); } catch { return false; }
  });
}

const quote = (files) => files.map((f) => `"${f}"`).join(' ');
const matchesAny = (file, globs) =>
  Array.isArray(globs) && globs.some((g) => expandBraces(g).some((x) => globToRegExp(x).test(file)));

// The test gate(s) to run at this point in the lifecycle. Returns an array — a polyglot repo
// needs more than one.
//
// scoped → prefer gates.testChanged, which tests only what this feature touched. Two forms:
//
//   "testChanged": "npx vitest related --run {files}"        one runner owns the whole repo
//
//   "testChanged": [                                          several runners, routed by path
//     { "match": ["backend/**/*.py"],        "cmd": "python -m pytest {files}" },
//     { "match": ["frontend/**/*.{ts,tsx}"], "cmd": "npx vitest related --run {files}" },
//     { "match": ["docs/**", "**/*.md"],     "cmd": "" }
//   ]
//
// The routed form is the one that matters on a real project: a single command string gets EVERY
// changed path substituted into it, so a frontend-only change would hand .tsx files to pytest.
// Routed, each entry sees only its own files, and an entry with nothing to do is skipped — which
// is where the time actually goes: a frontend feature never starts the backend suite at all.
//
// An empty `cmd` claims files and runs nothing — the explicit way to say "changes here need no
// tests". Anything matching NO entry falls back to the FULL suite: an unrecognised path might be
// the one that breaks everything, and a green that skipped it would be a lie. That fallback is
// announced, because a silently-full suite looks like the scoping simply isn't working.
// --- Flags a scoped route dropped from the full test gate. ---
// This deliberately knows nothing about what any flag *means*. `-n auto`, `--parallel`, `-T`,
// `--maxWorkers`, and whatever the next runner invents are all just tokens here. The signal is
// structural: the same runner was configured twice, and the copy that is supposed to be the fast
// path lost something the slow one has. A table of known parallelism flags would cover the five
// stacks someone thought of; this covers the ones nobody has written yet.
//
// Compared segment by segment, because a multi-stack `test` gate is a chain — matching a frontend
// route against a backend runner's flags would report a gap in every well-configured polyglot repo.
const segments = (cmd) => cmd.split(/&&|\|\||;/).map((s) => s.trim()).filter(Boolean);
const words = (seg) => seg.split(/\s+/).filter(Boolean);
const isFlag = (w) => /^-/.test(w);
const plain = (seg) => new Set(words(seg).filter((w) => !isFlag(w) && !/[{}]/.test(w)));

function droppedFlags(fullCmd, scopedCmd) {
  if (!fullCmd || !scopedCmd) return [];
  const missing = [];
  for (const scopedSeg of segments(scopedCmd)) {
    const scopedWords = words(scopedSeg);
    if (!scopedWords.length) continue;
    // The same runner means: invoked the same way, and recognisably the same command. One shared
    // token is `cd`; two or more is a real match.
    const match = segments(fullCmd).find((fullSeg) => {
      const fullWords = words(fullSeg);
      if (!fullWords.length || fullWords[0] !== scopedWords[0]) return false;
      const shared = [...plain(scopedSeg)].filter((w) => plain(fullSeg).has(w));
      // Two shared names is a confident match. One is enough only when one is all there is —
      // `pytest -q {files}` names its program and nothing else, and demanding corroboration it
      // cannot supply would blind this to the plainest configs of all.
      return shared.length >= 2 || (shared.length >= 1 && plain(scopedSeg).size === 1);
    });
    if (!match) continue;
    const have = new Set(words(scopedSeg).filter(isFlag));
    const fullWords = words(match);
    fullWords.forEach((w, i) => {
      if (!isFlag(w) || have.has(w)) return;
      const value = fullWords[i + 1];
      missing.push(value && !isFlag(value) && !/[{}]/.test(value) ? `${w} ${value}` : w);
    });
  }
  return missing;
}

// Every scoped route, checked without running anything. `verify` is the pre-flight — the one moment
// a whole batch is still cheap to fix — but it runs the full suite by definition and so would never
// touch the scoped commands. Reporting a gap only once the loop is already dispatching subagents is
// reporting it to nobody: that output lands in a subagent's hook, not in front of the orchestrator.
function auditScopedGates() {
  const spec = gates.testChanged;
  if (typeof spec === 'string') return reportDroppedFlags('test (changed)', spec);
  if (!Array.isArray(spec)) return;
  for (const entry of spec) {
    if (!entry || typeof entry.cmd !== 'string' || !entry.cmd) continue;
    reportDroppedFlags(`test (changed: ${entry.name || firstToken(entry.cmd) || 'changed'})`, entry.cmd);
  }
}

// Every report path this config names, in any gate. Used to tell a *report* flag apart from a
// dropped one: the full gate and a scoped route legitimately write to different paths, because
// they run from different directories — the full one often `cd`s into a subproject first, so its
// path carries a `../` the route has no use for. Comparing those as if one had lost something
// warns about correct config, and a warning that cries wolf is worse than no warning at all.
function allReportPaths() {
  const out = [...reportList(gates.testReport)];
  if (Array.isArray(gates.testChanged)) {
    for (const entry of gates.testChanged) {
      if (entry) out.push(...reportList(entry.report));
    }
  }
  return out;
}

const gapReported = new Set();
function reportDroppedFlags(label, cmd) {
  const reports = allReportPaths();
  const missing = droppedFlags(gates.test, cmd).filter((flag) =>
    !reports.some((p) => flag.includes(p) || flag.includes(path.basename(p))));
  if (!missing.length || gapReported.has(label)) return;
  gapReported.add(label);
  console.error(`ristretto: the scoped gate '${label}' is missing a flag its full "test" gate has: ${missing.join(', ')}`);
  console.error('  Same runner, configured twice — and the copy that lost something is the one meant to be fast.');
  console.error('  A scoped run without the full run\'s parallelism can take longer than testing the whole repo,');
  console.error('  which looks like nothing at all in the config and only shows up as a loop that drags.');
  console.error('  Add it to "testChanged" in .ristretto.json, or accept this line as the price of leaving it out.');
}

function testGates(scoped) {
  const spec = scoped ? gates.testChanged : null;
  const full = gates.test ? [{ key: 'test', label: 'test', cmd: gates.test, reports: reportList(gates.testReport) }] : [];

  if (!spec || (Array.isArray(spec) && !spec.length)) return full;

  // Single-command form.
  if (typeof spec === 'string') {
    reportDroppedFlags('test (changed)', spec);
    const reports = reportList(gates.testReport);
    if (!spec.includes('{files}')) return [{ key: 'testChanged', label: 'test (changed)', cmd: spec, reports }];
    const files = changedFiles();
    if (!files.length) return []; // nothing touched → nothing to scope a run to
    return [{ key: 'testChanged', label: 'test (changed)', cmd: spec.replace('{files}', quote(files)), reports }];
  }

  if (!Array.isArray(spec)) return full; // malformed → prove everything rather than nothing

  const files = changedFiles();
  if (!files.length) return [];

  const list = [];
  const claimed = new Set();
  for (const entry of spec) {
    if (!entry || typeof entry.cmd !== 'string') continue;
    const mine = files.filter((f) => matchesAny(f, entry.match));
    if (!mine.length) continue;
    mine.forEach((f) => claimed.add(f));
    if (!entry.cmd) continue; // claimed, deliberately untested
    const name = entry.name || firstToken(entry.cmd) || 'changed';
    reportDroppedFlags(`test (changed: ${name})`, entry.cmd);
    list.push({
      key: 'testChanged',
      label: `test (changed: ${name})`,
      cmd: entry.cmd.includes('{files}') ? entry.cmd.replace('{files}', quote(mine)) : entry.cmd,
      // Each route is judged against its own results. A backend route must never be compared with
      // the frontend's report, and a route with none falls back to its exit code without
      // disturbing the route beside it.
      reports: reportList(entry.report),
    });
  }

  const unrouted = files.filter((f) => !claimed.has(f));
  if (unrouted.length && full.length) {
    console.error(`ristretto: ${unrouted.length} changed file(s) match no "testChanged" route — running the FULL test gate instead of a partial one.`);
    console.error(`  unrouted: ${unrouted.slice(0, 5).join(', ')}${unrouted.length > 5 ? ` (+${unrouted.length - 5} more)` : ''}`);
    console.error('  Add a route for them, or an entry with "cmd": "" to say they need no tests.');
    return full;
  }
  return list;
}

// The gates for one pass, in order. Lint and typecheck are always repo-wide: they're cheap
// next to a test suite, and a scoped typecheck is a contradiction in terms.
function gateList(scoped) {
  const list = [];
  for (const key of ['lint', 'typecheck']) {
    if (gates[key]) list.push({ key, label: key, cmd: gates[key] });
  }
  list.push(...testGates(scoped));
  return list;
}

// --- Self-calibrating silence budgets. ---
// Setting PYTHONUNBUFFERED fixes the loudest offender, but naming tools one at a time is how you
// end up with a table that covers the five stacks somebody thought of. The general problem is that
// a silence budget is a *guess* about how talkative a runner is, and every guess is wrong for some
// repo — a .NET build that says nothing for four minutes, a Gradle task between phases, a suite
// that simply grew. So stop guessing and measure: a gate that has finished GREEN has, by
// definition, proven that its longest silence was healthy. Nothing else needs to know why.
//
// This can only ever widen a budget, never narrow one, so it cannot introduce a kill that would
// not have happened anyway — and the ceiling keeps a genuine hang from becoming unkillable.
// The hole this had for a long time: evidence could only come from a GREEN run, and a tool that
// buffers is killed before it can ever produce one. Its budget therefore never moved, and it was
// killed identically on every run forever — the one shape of tool that most needs a wider rope was
// the one shape that could never earn it. Python escaped only because PYTHONUNBUFFERED is set for
// every gate above; nothing else had a way out, which is exactly the per-stack table this was
// written to avoid. So a kill is evidence too, but only the kind that says "buffering": a gate
// that printed NOTHING AT ALL, start to finish. That one widens on probation and tries again.
// A gate that spoke and then went quiet is a real hang and earns nothing.
const QUIET_SLACK = 2;                      // observed silences vary run to run; leave real room
const QUIET_FLOOR_MS = 60 * 1000;           // absolute slack, so a chatty gate still tolerates a pause
const QUIET_CEILING_MS = 30 * 60 * 1000;    // beyond this it is a hang, whatever it has done before
const PROBATION = ':probation';             // a rope earned by being killed, not by passing
const RUN_TOTAL_KEY = 'run:total';          // what the last full pass cost, in ms
const quietPath = path.join(projectDir, '.ristretto', 'gate-quiet.json');
let lastRunMaxQuietMs = 0;

let observedQuiet = {};
try { observedQuiet = JSON.parse(fs.readFileSync(quietPath, 'utf8')) || {}; } catch { /* first run */ }

// Only ever called after a gate came back green.
function recordQuiet(key, ms) {
  if (!key || !Number.isFinite(ms)) return;
  if (observedQuiet[key] === ms) return;
  observedQuiet[key] = ms;
  try {
    fs.mkdirSync(path.dirname(quietPath), { recursive: true });
    fs.writeFileSync(quietPath, JSON.stringify(observedQuiet));
  } catch { /* calibration is an optimisation, never a requirement */ }
}

const budget = (gate) => {
  const configuredSec = silence[gate.key];
  const observed = observedQuiet[gate.key];
  let silenceSec = configuredSec;
  if (configuredSec && Number.isFinite(observed)) {
    const widenedMs = Math.min(observed * QUIET_SLACK + QUIET_FLOOR_MS, QUIET_CEILING_MS);
    silenceSec = Math.max(configuredSec, Math.round(widenedMs / 1000));
  }
  const probationMs = observedQuiet[gate.key + PROBATION];
  if (configuredSec && Number.isFinite(probationMs)) {
    silenceSec = Math.max(silenceSec, Math.round(Math.min(probationMs, QUIET_CEILING_MS) / 1000));
  }
  // Last, so it binds on every road to a budget: the configured number, the calibrated widening, and
  // the probation rope all pass through here.
  if (silenceSec) {
    const ceilingSec = silenceCeilingSec();
    if (silenceSec > ceilingSec) {
      if (configuredSec > ceilingSec && silenceAuthored.includes(gate.key)) {
        announceSilenceCeiling(gate, configuredSec, ceilingSec);
      }
      silenceSec = ceilingSec;
    }
  }
  return { silenceSec, hardCapSec: hardCaps[gate.key] };
};

// A gate may write more than one report — a `test` gate chaining a backend and a frontend runner
// produces two, and both describe the same run.
function reportList(spec) {
  if (typeof spec === 'string' && spec) return [spec];
  if (Array.isArray(spec)) return spec.filter((p) => typeof p === 'string' && p);
  return [];
}

// What this gate run says about WHOSE failures these are. null when this gate has no usable
// report, which means the caller falls back to the exit code exactly as before.
//
// Called for EVERY run, green or red — not only failing ones. A run where everything passed is
// exactly how a previously-failing test leaves the tolerated set, and skipping attribution on
// green would make the ratchet one-way in the wrong direction: able to grow, never to shrink.
function attribute(gate) {
  const paths = gate.reports || [];
  if (!paths.length) return null;
  const executed = new Set();
  const failing = new Set();
  let readAny = false;
  for (const rel of paths) {
    const report = readReport(path.join(projectDir, rel));
    if (!report) continue;
    readAny = true;
    for (const id of report.executed) executed.add(id);
    for (const id of report.failing) failing.add(id);
  }
  if (!readAny) {
    console.error(`ristretto: no test report at ${paths.join(', ')} — falling back to the exit code for '${gate.label}'.`);
    console.error('  Nothing was attributed this run. Check the command still writes the report it is configured to.');
    return null;
  }
  const baseline = loadBaseline(baselinePath) || new Set();
  const { newFailures, tolerated, next } = ratchet({ baseline, executed, failing });
  return { verdict: newFailures.length ? 'block' : 'pass', newFailures, tolerated, next };
}

// Only the NEW failures are named. Naming all of them is the same as naming none — the whole
// value of a compared gate is knowing which failure is yours.
function attributionLines(a) {
  const lines = [];
  if (a.newFailures.length) {
    lines.push(`ristretto: ${a.newFailures.length} NEW test failure(s) — these were not failing before this change:`);
    for (const id of a.newFailures.slice(0, 25)) lines.push(`  ${id}`);
    if (a.newFailures.length > 25) lines.push(`  (+${a.newFailures.length - 25} more)`);
  }
  if (a.tolerated.length) {
    lines.push(`  (${a.tolerated.length} pre-existing failure(s) tolerated — already failing when this feature started)`);
  }
  return lines.join('\n');
}

// The format gate's own record, so a standing failure is reported once rather than per keystroke.
// Keyed by the command and the failure, so a changed config or a changed error speaks up again.
function reportFormat(result) {
  let last = null;
  try { last = fs.readFileSync(formatBrokenPath, 'utf8'); } catch { /* nothing on record */ }
  if (result === null) {
    // Working again. Forget the old failure so a later regression is reported rather than muffled
    // by a note about the last one.
    if (last !== null) { try { fs.unlinkSync(formatBrokenPath); } catch { /* already gone */ } }
    return;
  }
  const why = result.stalled ? 'went quiet and was killed'
    : result.hardCapped ? 'hit its hard cap and was killed'
    : String(result.output || '').trim().split('\n').slice(-3).join('\n');
  const signature = `${gates.format}\n${why}`;
  if (last === signature) return; // already said, and nothing has changed since
  try {
    fs.mkdirSync(path.dirname(formatBrokenPath), { recursive: true });
    fs.writeFileSync(formatBrokenPath, signature);
  } catch { /* best-effort — worst case it is reported twice */ }
  console.error(`ristretto: the "format" gate failed — nothing was formatted, and this is not blocking your work.`);
  console.error(`  command: ${gates.format}`);
  console.error(`  ${why.split('\n').join('\n  ')}`);
  console.error('  A format gate that fails once usually fails every time, so this is said once and then dropped');
  console.error('  until it changes. `{file}` is substituted repo-relative, and the command runs from the repo root.');
  process.exit(1); // non-zero, but never 2: reported to you, never blocking the agent
}

// What a full pass costs, recorded so the next one can size its queue wait against it, and named
// out loud once it is eating the budget its caller needs to stay alive. Measured rather than
// configured: a suite grows a test at a time, and the run that finally crosses the line looks
// exactly like the hundred before it.
function reportRunCost(ms) {
  if (!Number.isFinite(ms)) return;
  observedQuiet[RUN_TOTAL_KEY] = ms;
  try {
    fs.mkdirSync(path.dirname(quietPath), { recursive: true });
    fs.writeFileSync(quietPath, JSON.stringify(observedQuiet));
  } catch { /* best-effort */ }
  if (ms < watchdog * WATCHDOG_WARN_SHARE * 1000) return;
  const secs = Math.round(ms / 1000);
  console.error(`ristretto: these gates took ${secs}s, against a ~${watchdog}s silence budget for the agent waiting on them.`);
  console.error('  Nothing failed. But an agent that says nothing for that long is killed by its own harness, and a');
  console.error('  killed agent loses its result entirely — the work is stranded unproven and the feature blocks for a');
  console.error('  reason that was never about the feature. Scope the loop with "gates"."testChanged" so each stop');
  console.error('  proves only what the feature touched, and leave the whole repo to `gate.js verify` at the end.');
}

// A gate killed without producing one byte gets a wider rope for next time. Doubling only — the
// budget it was just killed at is the only evidence there is, and a floor here would hand a gate
// configured to be impatient a minute it never asked for. Ceilinged, so no amount of buffering can
// make a genuine hang unkillable: at the ceiling it is reported as a hang and stays reported.
function widenOnProbation(key, usedSec) {
  if (!key) return;
  const nextMs = Math.min(usedSec * 2000, QUIET_CEILING_MS);
  if (observedQuiet[key + PROBATION] === nextMs) return;
  observedQuiet[key + PROBATION] = nextMs;
  try {
    fs.mkdirSync(path.dirname(quietPath), { recursive: true });
    fs.writeFileSync(quietPath, JSON.stringify(observedQuiet));
  } catch { /* calibration is an optimisation, never a requirement */ }
}

// --- Which binary is this gate actually going to run? ---
// A pre-flight run by the agent and a gate run by the hook inherit different environments. If
// the agent prepends a workaround toolchain to PATH, `verify` proves a green tree that the hook
// will never reproduce — and the hook's red looks like a repo problem instead of two Flutters.
// So verify records what it resolved, and the hook says so plainly when it resolved something else.

// First word of a shell command, minus quotes and any leading VAR=value assignments.
function firstToken(cmd) {
  for (const word of String(cmd).trim().split(/\s+/)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) continue; // env prefix, not the program
    return word.replace(/^["']|["']$/g, '');
  }
  return '';
}

function resolveTool(tok) {
  if (!tok || tok.includes('/') || tok.includes('\\')) return tok || null; // already a path
  try {
    const probe = process.platform === 'win32'
      ? spawnSync('where', [tok], { encoding: 'utf8' })
      : spawnSync('/bin/sh', ['-c', `command -v ${tok}`], { encoding: 'utf8' });
    const line = (probe.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean)[0];
    return line || null;
  } catch {
    return null;
  }
}

// Shell builtins that begin a command without being the program it runs. `cd sub && real-tool`
// is the most common command shape in a monorepo, and taking its first word recorded the builtin
// and never the toolchain — the drift detector then compared nothing against nothing, forever.
const NOT_A_TOOL = new Set(['cd', 'set', 'export', 'source', '.', 'exec', 'env', 'call', 'pushd', 'popd']);

// Every gate command that is actually a command. `gates` also holds `formatPaths` (an array of
// globs) and `testChanged` (which may be an array of route objects); stringifying those and taking
// the first word is how a glob and the literal text "[object" ended up recorded as toolchains.
function gateCommands() {
  const out = [];
  for (const key of ['format', 'lint', 'typecheck', 'test']) {
    if (typeof gates[key] === 'string' && gates[key]) out.push(gates[key]);
  }
  const spec = gates.testChanged;
  if (typeof spec === 'string' && spec) out.push(spec);
  else if (Array.isArray(spec)) {
    for (const entry of spec) {
      if (entry && typeof entry.cmd === 'string' && entry.cmd) out.push(entry.cmd);
    }
  }
  return out;
}

// { flutter: "/usr/bin/flutter", npx: "/usr/local/bin/npx" } for every configured gate command.
// Every segment of every command, because a chained gate runs more than one program and any of
// them can be the one that resolves differently under the hook.
function resolveGateTools() {
  const tools = {};
  for (const cmd of gateCommands()) {
    for (const seg of segments(cmd)) {
      const tok = firstToken(seg);
      if (!tok || NOT_A_TOOL.has(tok) || tok in tools) continue;
      tools[tok] = resolveTool(tok);
    }
  }
  return tools;
}

// Lines describing every tool the hook resolves differently from the recorded verify run.
function toolDrift(now) {
  let recorded = null;
  try { recorded = JSON.parse(fs.readFileSync(toolsPath, 'utf8')); } catch { return []; }
  const drift = [];
  for (const [tok, was] of Object.entries(recorded)) {
    const is = now[tok];
    if (tok in now && was !== is) {
      drift.push(`ristretto: '${tok}' is not the one that was verified — verify used ${was || '(unresolved)'}, this gate ran ${is || '(unresolved)'}.`);
      drift.push(`  A green pre-flight proves nothing about a different toolchain. Put the intended path in .ristretto.json`);
      drift.push(`  (the hooks do not inherit a PATH you exported in your shell), or fix the install so both resolve the same.`);
    }
  }
  return drift;
}

// A gate that produced not one byte from start to finish is a different animal from one that
// spoke and then stopped: total silence from the very beginning is the signature of a tool that
// buffers when it isn't attached to a terminal, not of one that wedged. This is the only kill
// that counts as evidence about the tool's rhythm.
const buffered = (result) => Boolean(result.stalled) && !String(result.output || '').trim();

// `usedSec` is the budget this run was actually killed at, which is not always the configured one:
// calibration and probation both widen it. Quoting the config instead would tell someone to raise
// a number that is already being ignored in their favour.
function hangAdvice(gate, result, usedSec) {
  const why = result.stalled
    ? `printed nothing for ${usedSec}s and was killed — it is hung, not slow`
    : `exceeded the hard cap of ${hardCaps[gate.key]}s in .ristretto.json and was killed`;
  // A gate that produced not one byte from start to finish is a different animal from one that
  // spoke and then stopped. Real hangs almost always say something first — a banner, a collection
  // count, the first few tests — and then wedge. Total silence from the very beginning is the
  // signature of a tool that buffers its output when it isn't attached to a terminal, and that
  // gate was very likely working perfectly the whole time it was being timed out. Saying so is
  // the difference between one config change and an afternoon hunting an open handle that isn't
  // there. This is a diagnosis, never an exemption: unverified is still unverified.
  const neverSpoke = buffered(result);
  const lines = [
    `ristretto: gate '${gate.label}' ${why}.`,
    `  A hung gate is not a red gate — the work is UNVERIFIED, not proven broken.`,
  ];
  if (neverSpoke) {
    lines.push(`  It printed NOTHING AT ALL, start to finish — which is the shape of buffering, not of hanging.`);
    lines.push(`  A tool that streams normally says something before it wedges. Check whether this one buffers`);
    lines.push(`  when its output is piped (many do), and make it stream: an unbuffered flag, a progress reporter,`);
    lines.push(`  a per-test format. Only then is a silence budget measuring what it thinks it is.`);
  } else {
    lines.push(`  Find what it's waiting on (an open handle, a port, watch mode, a prompt), or:`);
  }
  lines.push(`  · scope the run — set "gates"."testChanged" to your runner's related-tests form, with {files}`);
  // At the ceiling, "raise the budget" is advice to change a number that is already being ignored in
  // the caller's favour, and following it costs another run to learn nothing. What is actually left is
  // making the gate talk, or running less of it.
  if (usedSec >= silenceCeilingSec()) {
    lines.push(`  · "silence"."${gate.key}" is already at ${usedSec}s, the most the agent's ~${watchdog}s watchdog leaves —`);
    lines.push(`    it cannot be raised any further. Make the gate stream instead (drop --no-progress/-q, add a`);
    lines.push(`    per-test reporter), or scope it, so a healthy run stops looking exactly like a wedged one.`);
  } else {
    lines.push(`  · if the tool is simply quiet for long stretches, raise "silence"."${gate.key}" (now ${usedSec}s)`);
  }
  return lines.join('\n');
}

// --- Config problems the runner can see for itself. ---
// Each of these was a paragraph in a doc that a human had to read and obey; saying it here, with
// the actual command in view, is strictly better — and it is the difference between a rule and a
// check. Split in two by what each half needs: the three STATIC checks below — formatPaths,
// silencing flags, route gaps — are true of the config itself, no gate run required, so `verify`
// calls this before its cache short-circuit, the one place a cache hit would otherwise never run
// them at all. The `full` hook never calls this one: repeating config advice on every green
// subagent stop is noise, not a pre-flight.
function auditStaticConfig() {
  if (gates.format && !(Array.isArray(gates.formatPaths) && gates.formatPaths.length)) {
    console.error('ristretto: a "format" gate is set but "formatPaths" is not — the formatter will rewrite');
    console.error('  every file anyone edits, including docs and generated files. List what it is canonical for.');
  }

  const QUIET = [/(^|\s)-q(\s|$)/, /--no-progress/, /--quiet/, /--reporter[= ](silent|dot|summary)/];
  for (const key of ['test', 'testChanged']) {
    const cmds = Array.isArray(gates[key]) ? gates[key].map((route) => (route && route.cmd) || '') : [gates[key] || ''];
    for (const cmd of cmds) {
      if (QUIET.some((re) => re.test(cmd))) {
        console.error(`ristretto: "${key}" carries a flag that silences the runner: ${cmd}`);
        console.error('  Hang detection reads the gate\'s output — a mute suite is indistinguishable from a wedged');
        console.error('  one for its whole run, and raising "silence" cannot help past the watchdog. Keep the stream.');
        break;
      }
    }
  }

  // Every changed path this config's routes don't cover. Reported at pre-flight, where it costs
  // nothing to hear about it — falling back to the full suite is safe, but silent, and only shows
  // up later as a loop that unexpectedly drags. Reuses `matchesAny`, the same matcher `testChanged`
  // routing uses at runtime, rather than a second glob implementation that could drift from it.
  if (Array.isArray(gates.testChanged)) {
    const paths = dirtyPaths() || [];
    const uncovered = paths.filter((p) => !gates.testChanged.some((entry) => entry && matchesAny(p, entry.match)));
    if (uncovered.length) {
      console.error(`ristretto: ${uncovered.length} changed path(s) match no "testChanged" route and fall back to the full suite:`);
      for (const p of uncovered.slice(0, 10)) console.error(`  ${p}`);
      console.error('  Safe, but slow — and invisible until a run goes quiet. Completing the routes is what keeps the loop fast.');
    }
  }
}

// The two duration hints only — both need a gate loop's own measurement, so both callers place
// this after their loop. The three static checks live in `auditStaticConfig` instead: `verify`
// calls that one before its cache short-circuit too, which this function's callers never reach
// on a cache hit, and calling it again here would print the same advice twice on a real run.
function auditConfig() {
  // `<key>:ms` — the gate's own wall-clock length on its last green run, recorded by runGates
  // beside the quiet record. NOT observedQuiet[key]: that is the longest SILENT GAP of a green
  // run, not the run's length, and reads as ~1s even on a ten-minute suite that talks the whole
  // way through. The hook calls this after the loop that just recorded this run's number; `verify`
  // calls it after its own loop for the same reason — either way this fires on a real measurement.
  const slowMs = Number(process.env.RISTRETTO_SLOW_TEST_MS) || SLOW_TEST_HINT_MS;
  const testMs = observedQuiet['test:ms'];
  if (gates.test && !gates.testChanged && Number.isFinite(testMs) && testMs >= slowMs) {
    console.error(`ristretto: the full test suite took ${Math.round(testMs / 1000)}s, and it will run again at every stop — no "gates"."testChanged" is configured.`);
    console.error('  Scope the loop to what each feature touches; the whole repo is still proven by `gate.js verify` at the end.');
    console.error('  One runner:  "testChanged": "<related-tests command> {files}"');
    console.error('  Several:     "testChanged": [{ "match": ["backend/**/*.py"], "cmd": "..." }, { "match": ["frontend/**"], "cmd": "..." }]');
  }

  // The mirror of it: a scoped gate is the fast path by definition, so one that runs this long is
  // a defect in the scoping, not a fact about the repo.
  const scopedMs = observedQuiet['testChanged:ms'];
  if (gates.testChanged && Number.isFinite(scopedMs) && scopedMs >= SLOW_SCOPED_HINT_MS) {
    console.error(`ristretto: the scoped test gate took ${Math.round(scopedMs / 1000)}s — that is the fast path, so something is wrong with it.`);
    console.error('  Most often it dropped the parallelism the full "test" gate has: compare the two commands in .ristretto.json');
    console.error('  and give the scoped one the same flags (-n auto, --parallel, -T, ...). A scoped run that is slower than the');
    console.error('  whole suite is worse than no scoping at all. Otherwise the route is matching more than the feature touched.');
  }
}

// The gate-running core: acquire the lock, run the configured list against the tree, attribute
// each result against the baseline, and on a clean pass write the green fingerprint. Every mode
// that actually executes gates shares this one — `verify`, the `full` hook, and `prove` differ
// only in the switches below. Everything else about a mode — whether it may run at all, what a
// failure does to the retry budget, markers, ownership, the orchestrator exemption — is the
// caller's job, not this one's, and stays wrapped around the call.
//
//   scoped             gateList(scoped) — the fast, feature-sized list vs the whole repo.
//   stopOnStall         a stall ends the run right here, reported to the caller immediately (the
//                       hook, `prove`) vs recorded and the remaining gates still run (`verify`,
//                       which owes a full report of everything it found).
//   mayCreateBaseline    only a caller that deliberately chose to run (`verify`) may capture a
//                       first-ever baseline; every other caller only ever updates one that exists.
//   skipIfProven        after the lock is ours, recheck the fingerprint against gate-green before
//                       running anything — the holder may have just proven exactly the tree we
//                       queued to test. Under brew this is the ORDINARY case: a reviewer/closer
//                       stacks behind a sibling run on an unchanged tree. On for the hook and
//                       `prove`; off for `verify`, which is a deliberate request to re-run for
//                       real and must not be answered from a cache it never asked for.
//
// Returns `ok: true` on a clean pass (the fingerprint has been written, or was already there —
// see `alreadyProven`), `false` on a real failure or a stopped stall (see `stalled`), or `null`
// when the lock itself was never obtained — nothing ran at all. `failures` is the text a caller
// prints; `results` is the per-gate ✓/✗ summary `verify` shows.
async function runGates({ scoped, stopOnStall, mayCreateBaseline, skipIfProven, label }) {
  if (!(await acquireLock(label))) return { ok: null, stalled: false, results: [], failures: '' };

  if (skipIfProven) {
    const fp = treeFingerprint();
    let lastGreen = null;
    try { lastGreen = fs.readFileSync(greenPath, 'utf8'); } catch { /* nothing proven yet */ }
    if (fp !== null && fp === lastGreen) {
      return { ok: true, stalled: false, results: [], failures: '', alreadyProven: true };
    }
  }

  const passStartedAt = Date.now();
  const results = [];
  let failures = '';
  let hung = false;

  for (const gate of gateList(scoped)) {
    const gateStartedAt = Date.now();
    const used = budget(gate);
    for (const rel of gate.reports || []) {
      try { fs.unlinkSync(path.join(projectDir, rel)); } catch { /* nothing to clear */ }
    }
    const result = await run(gate.cmd, used);
    // Green: whatever silence this gate showed was healthy silence. That is the calibration —
    // fired on the command's own exit, in every mode, whatever attribution later decides. The
    // silence budget measures the TOOL's behaviour, not the verdict; gating this on the verdict
    // left every report-attributed gate uncalibrated as long as the repo carried a tolerated
    // failure, which is the ordinary case, not the rare one.
    if (result === null) recordQuiet(gate.key, lastRunMaxQuietMs);

    // Attribution runs whether or not the command exited 0 — a report is how a previously-failing
    // test LEAVES the tolerated set, and skipping this on a green exit would make the ratchet able
    // to grow and never shrink.
    const attributed = attribute(gate);

    // First capture is a deliberate act that belongs only to a caller that asked for it — never a
    // hook, or a one-shot proof, firing mid-run.
    if (attributed && mayCreateBaseline && loadBaseline(baselinePath) === null) {
      saveBaseline(baselinePath, attributed.next, git('rev-parse HEAD'));
      console.log(`ristretto: captured ${attributed.next.size} pre-existing test failure(s) as the baseline.`);
      console.log('  These will be TOLERATED until they are fixed. Nothing may be added to this set —');
      console.log('  a run that introduces a new failure still blocks, and a fixed test leaves for good.');
      results.push(`${gate.label} ✓`);
      continue;
    }

    const attributedPass = Boolean(attributed) && attributed.verdict === 'pass';
    // Updating an existing baseline is never restricted — only creating one is.
    if (attributedPass && loadBaseline(baselinePath) !== null) {
      saveBaseline(baselinePath, attributed.next, git('rev-parse HEAD'));
    }
    // Printed here only for a PASS that is tolerating something — informational, since nothing
    // else ever shows it. A BLOCKING gate's lines go out exactly once, via the failures text
    // below; printing them here too would say the same failure twice.
    if (attributedPass && attributed.tolerated.length) {
      console.error(attributionLines(attributed));
    }

    // The report outranks the exit code once there is one: a non-zero exit with no NEW failures
    // is a suite that was already red for reasons this change did not cause, and a zero exit with
    // new failures in the report still blocks.
    if (attributed ? attributedPass : result === null) {
      // A gate's own wall-clock cost, on every green run — beside the quiet record, under a key
      // that cannot collide with PROBATION. `auditConfig` reads this back, so a slow suite or a
      // slow scoped route is a fact the runner measured, not a paragraph a human has to remember
      // to go check.
      recordQuiet(`${gate.key}:ms`, Date.now() - gateStartedAt);
      results.push(`${gate.label} ✓`);
      continue;
    }

    results.push(`${gate.label} ✗`);
    if (result && (result.stalled || result.hardCapped)) {
      hung = true;
      if (buffered(result)) widenOnProbation(gate.key, used.silenceSec);
      const advice = hangAdvice(gate, result, used.silenceSec);
      if (stopOnStall) {
        // Surface immediately rather than let the caller loop back to a gate that hangs again,
        // burning a whole retry budget on the same wall — the exact wedge this avoids.
        try { fs.mkdirSync(path.dirname(stalledPath), { recursive: true }); fs.writeFileSync(stalledPath, gate.label); } catch { /* best-effort */ }
        return { ok: false, stalled: true, results, failures: advice };
      }
      failures += `\n${advice}`;
      continue;
    }
    failures += attributed
      ? `\n${attributionLines(attributed)}`
      : `\n--- ristretto gate '${gate.label}' FAILED ---\n${result.output.split('\n').slice(-40).join('\n')}`;
  }

  if (failures) return { ok: false, stalled: hung, results, failures };

  // Nothing is hung any more. A marker left from an older run keeps saying one is, with no expiry
  // and nothing to contradict it — state that lies is worse than state that is missing.
  try { fs.unlinkSync(stalledPath); } catch { /* never existed */ }
  reportRunCost(Date.now() - passStartedAt);
  const green = treeFingerprint();
  if (green !== null) {
    try { fs.mkdirSync(path.dirname(greenPath), { recursive: true }); fs.writeFileSync(greenPath, green); } catch { /* best-effort */ }
  }
  return { ok: true, stalled: false, results, failures: '' };
}

async function main() {
  if (MODE === 'guard') {
    const file = hook.tool_input && hook.tool_input.file_path;
    if (!file) process.exit(0);
    if (!HOUSE_RULE_FILES.has(path.basename(file).toLowerCase())) process.exit(0);
    // Only while a run is armed. Outside one this file is the user's own business — `/revise-claude-md`
    // is exactly that, and a guard that fired then would be a bug, not a safeguard.
    if (!fs.existsSync(markerPath)) process.exit(0);
    const idle = markerIdleMs(markerPath);
    if (idle !== null && idle > MARKER_MAX_IDLE_MS) process.exit(0);

    // Same ownership rule as the `full` branch: a write from a session that does not hold the
    // marker is not this run's to guard, and an unclaimed marker is claimed by whichever hook
    // sees it first.
    const owner = markerOwner(markerPath);
    const me = mySession();
    if (owner === '') {
      try { fs.writeFileSync(markerPath, me); } catch { /* best-effort */ }
    } else if (owner !== me && me !== '') {
      process.exit(0);
    }

    console.error(`ristretto: ${path.basename(file)} holds this repo's house rules — ristretto reads it, never writes it.`);
    console.error('  Whatever is stale there goes in your final message instead; the user decides what lands in that file.');
    console.error('  (Only while a ristretto run is armed — outside one, edit it freely.)');
    process.exit(2);
  }

  if (MODE === 'quick') {
    const file = hook.tool_input && hook.tool_input.file_path;
    if (gates.format && file && fs.existsSync(file) && formatAllowed(file)) {
      // Repo-relative, like `formatPaths` matches and like `{files}` substitutes. One config file
      // must not speak two path languages: an absolute path here silently broke every command that
      // composed with it — `cd sub && fmt ../{file}`, the shape a monorepo naturally writes.
      const rel = path.relative(projectDir, file).split(path.sep).join('/');
      const result = await run(gates.format.replace('{file}', `"${rel}"`), budget({ key: 'format' }));
      // Never block — this is a convenience, and exit 2 would stop an agent over whitespace. But
      // "never block" was read as "never report", and a formatter that failed on every single edit
      // produced no evidence at all, for months. Say it once: the first time, and again only when
      // the failure changes or comes back after a run that worked. A formatter is either working
      // or it isn't, so one line is the whole story and a line per keystroke is noise.
      reportFormat(result);
    }
    process.exit(0);
  }

  // Read-only: what is armed, whose it is, and what a dead run left behind. Nothing here
  // creates, deletes, or refreshes anything — a command that reports state must never be the
  // reason the state changes.
  if (MODE === 'state') {
    for (const [label, p] of [['pulling', markerPath], ['orchestrating', orchestratingPath]]) {
      const who = ownerLabel(p);
      if (who === null) { console.log(`${label}: not armed`); continue; }
      const idle = markerIdleMs(p);
      const age = idle === null ? 'unknown' : formatAge(idle);
      // "armed by unclaimed" reads as a typo, not a state — an unclaimed marker gets its own
      // clause instead of being forced through the "armed by <owner>" template.
      const status = who === 'unclaimed' ? 'armed, unclaimed' : `armed by ${who}`;
      console.log(`${label}: ${status}, last activity ${age}`);
    }

    const paths = dirtyPaths();
    if (paths === null) {
      console.log('tree: not a git repo, or git is unavailable');
    } else if (paths.length === 0) {
      console.log('tree: clean');
    } else {
      let lastGreen = null;
      try { lastGreen = fs.readFileSync(greenPath, 'utf8'); } catch { /* nothing proven yet */ }
      const fp = treeFingerprint();
      const proven = fp !== null && fp === lastGreen;
      console.log(`tree: ${paths.length} changed path(s) — ${proven ? 'PROVEN GREEN, commit it rather than discarding it' : 'unproven'}`);
      for (const p of paths.slice(0, 20)) console.log(`  ${p}`);
      if (paths.length > 20) console.log(`  … and ${paths.length - 20} more`);
    }

    let builds = [];
    try { builds = fs.readdirSync(path.join(projectDir, '.ristretto', 'build')).filter((f) => f.endsWith('.md')); } catch { /* none */ }
    if (builds.length) console.log(`build plans left behind: ${builds.join(', ')}`);

    // `.ristretto/` collects more than gate.js writes — subagents drop logs, junit dumps, and
    // scratch scripts there that nothing here ever reads. A pre-flight that only names build/
    // makes those invisible; everything gate.js doesn't own gets named instead, so a stale
    // directory reads as the fifty-odd files it actually is rather than as tidy.
    // Derived from the same path constants gate.js writes through, not retyped — a renamed
    // file stays known automatically instead of silently drifting from this list. `build` has
    // no constant naming it (no single file owns that directory), so it stays a literal.
    const known = new Set([
      markerPath, orchestratingPath, retriesPath, greenPath, stalledPath,
      toolsPath, lockPath, quietPath, formatBrokenPath, baselinePath,
    ].map((p) => path.basename(p)));
    known.add('build');
    for (const rel of allReportPaths()) known.add(path.basename(rel));
    let entries = [];
    try { entries = fs.readdirSync(path.join(projectDir, '.ristretto')); } catch { /* not armed yet */ }
    const unrecognised = entries.filter((f) => !known.has(f));
    if (unrecognised.length) {
      console.log(`unrecognised: ${unrecognised.length} file(s) — ${unrecognised.slice(0, 10).join(', ')}`);
    }

    process.exit(0);
  }

  // The commands no longer know these filenames. Three different cleanup lists is how a `pull`
  // after a `brew` left `orchestrating` behind — and while that file exists, Stop does not gate
  // at all, with no error and no symptom.
  if (MODE === 'arm') {
    const me = mySession();
    const prior = markerOwner(markerPath);
    if (prior !== null && prior !== '' && prior !== me) {
      const idle = markerIdleMs(markerPath);
      const age = idle === null ? 'an unreadable age' : `${Math.round(idle / 60000)}min`;
      console.error(`ristretto: .ristretto/pulling belongs to another session (idle ${age}) — taking it over.`);
      console.error('  If a run really is live in another window, stop it: two runs share one branch and one gate lock.');
    }
    // These writes are deliberately NOT best-effort: an `arm` that swallows the error, prints
    // nothing, and exits 0 without having written the marker would leave a run believing it is
    // armed while the gates are off — the exact silent failure this task exists to remove. So a
    // write failure here is loud (one line naming the path and why) and exits 1 instead.
    try {
      fs.mkdirSync(path.join(projectDir, '.ristretto', 'build'), { recursive: true });
      fs.writeFileSync(markerPath, me);
      if (ARG === 'orchestrator') fs.writeFileSync(orchestratingPath, me);
    } catch (e) {
      console.error(`ristretto: could not arm — cannot write ${e.path || markerPath}: ${e.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  if (MODE === 'disarm') {
    // Everything a run creates, in one place. `build/` is deliberately absent: a plan that was
    // paid for and never implemented outlives the run, and its closer deletes it.
    for (const p of [markerPath, orchestratingPath, retriesPath, stalledPath]) {
      try { fs.unlinkSync(p); } catch { /* never existed */ }
    }
    process.exit(0);
  }

  if (MODE === 'verify') {
    // Before the cache short-circuit: a config gap is true whether or not this tree was proven
    // already, and the cached path is exactly when a resumed batch would otherwise never hear it.
    auditScopedGates();
    auditSilenceBudgets();
    auditStaticConfig();
    // A pre-flight repeated on an unchanged tree proves nothing the first one didn't. `cached`
    // is how brew asks for that verdict instead of re-paying for it after a session restart.
    if (CACHED) {
      const fp = treeFingerprint();
      let lastGreen = null;
      try { lastGreen = fs.readFileSync(greenPath, 'utf8'); } catch { /* nothing proven yet */ }
      if (fp !== null && fp === lastGreen) {
        const drift = toolDrift(resolveGateTools());
        if (drift.length) {
          // The cached green was proved with a different toolchain than this run would use, so
          // it says nothing about this one. Fall through and prove it properly.
          console.error(drift.join('\n'));
        } else {
          console.log('gates: cached green — tree byte-identical to the last proven run, nothing re-run');
          process.exit(0);
        }
      }
    }

    // Full scope, no cache, no marker required. Green here is the real proof.
    const r = await runGates({ scoped: false, stopOnStall: false, mayCreateBaseline: true, label: 'verify' });
    if (r.ok === null) {
      console.error(`ristretto: could not start — ${lockHolder()} still holds the gate lock after ${waitSec}s.`);
      console.error('  The tree is UNVERIFIED, not red. Let that run finish, then verify again.');
      process.exit(1);
    }
    // After the loop, not before: the slow-suite/slow-scoped checks inside read the duration this
    // very run just recorded, not only a stale number left over from whichever run happened last.
    // The three static checks already ran above, before the cache short-circuit.
    auditConfig();
    if (!r.results.length) {
      console.log('gates: none configured — nothing to verify');
      process.exit(0);
    }
    console.log(`gates: ${r.results.join(' ')}`);
    // Record and show the toolchain this verdict was produced with, so a hook that resolves
    // something else can say so instead of surfacing a mystery red on an untouched tree.
    const tools = resolveGateTools();
    const shown = Object.entries(tools).map(([tok, at]) => `${tok} → ${at || '(not found)'}`);
    if (shown.length) console.log(`tools: ${shown.join('  ')}`);
    try { fs.mkdirSync(path.dirname(toolsPath), { recursive: true }); fs.writeFileSync(toolsPath, JSON.stringify(tools, null, 2)); } catch { /* best-effort */ }
    if (r.failures) {
      console.error(r.failures);
      process.exit(1);
    }
    process.exit(0);
  }

  if (MODE === 'full') {
    if (!fs.existsSync(markerPath)) process.exit(0); // only gate while a run is active

    // A marker nobody disarmed keeps gating sessions that are not runs. Age it out rather than
    // silently arming a session that never asked — and say so, so it gets cleaned up.
    const markerIdle = markerIdleMs(markerPath);
    if (markerIdle !== null && markerIdle > MARKER_MAX_IDLE_MS) {
      console.error(`ristretto: .ristretto/pulling has seen no gate run for ${Math.round(markerIdle / 3600000)}h — treating it as a leftover from a dead session and NOT gating.`);
      console.error('  If a run really is in progress, run `gate.js arm`; otherwise `gate.js disarm`.');
      process.exit(0);
    }

    // Whose run is this? A marker from a dead session used to gate every later session in the
    // repo — and because the wrong gating refreshed the marker, it could never expire. Only the
    // owner gates, and only the owner refreshes.
    const owner = markerOwner(markerPath);
    const me = mySession();
    if (owner === '') {
      try { fs.writeFileSync(markerPath, me); } catch { /* best-effort */ }
    } else if (owner !== me && me !== '') {
      console.error('ristretto: .ristretto/pulling belongs to another session — not gating this one.');
      console.error('  If that run is over, `gate.js disarm` clears it.');
      process.exit(0);
    }

    // This run counts as activity. Without it, "old" would mean total age and a batch that runs
    // longer than the window would disarm its own gates halfway through.
    try { const t = Date.now() / 1000; fs.utimesSync(markerPath, t, t); } catch { /* best-effort */ }

    // A subagent stopping is the only proof that a brew loop is actually alive — nothing else
    // produces one. So that, and only that, keeps the orchestrator's exemption current.
    if (IS_SUBAGENT && fs.existsSync(orchestratingPath)) {
      try { const t = Date.now() / 1000; fs.utimesSync(orchestratingPath, t, t); } catch { /* best-effort */ }
    }

    // brew's orchestrator writes no source and its subagents are gated one by one. Running a
    // suite here measures a tree that a live subagent is mid-edit on — the red belongs to a
    // half-finished cycle, not to anyone's work, and it burns the retry budget to say so.
    //
    // But this exemption TURNS GATES OFF, so unlike the pulling marker it may never be taken on
    // faith. A brew that dies without disarming leaves this file behind, and an exemption that
    // never expires means every later session in that repo stops ungated — silently, with no
    // symptom until something red is committed. Being wrong the other way costs one unnecessary
    // suite on a tree a subagent may be mid-edit on: recoverable, and loud.
    if (!IS_SUBAGENT && fs.existsSync(orchestratingPath)) {
      const idle = markerIdleMs(orchestratingPath);
      if (idle !== null && idle <= ORCHESTRATOR_MAX_IDLE_MS) process.exit(0);
      const age = idle === null ? 'an unreadable age' : `${Math.round(idle / 3600000)}h`;
      console.error(`ristretto: .ristretto/orchestrating has seen no subagent gate for ${age} — treating it as a leftover from a dead brew and gating normally.`);
      console.error('  If a brew really is running, touch the file; if not, delete it. Leaving it would turn Stop gating off for good.');
    }

    // Tree unchanged since the last green run → already proven, skip.
    const fp = treeFingerprint();
    let lastGreen = null;
    try { lastGreen = fs.readFileSync(greenPath, 'utf8'); } catch { /* no green run yet */ }
    if (fp !== null && fp === lastGreen) process.exit(0);

    // Serialise. A gate that runs alongside another one measures both. `skipIfProven` covers the
    // rare tree-matched-mid-wait race: the holder may have proven exactly this tree while we
    // queued for the lock, which under brew is the ORDINARY case, not the rare one.
    const r = await runGates({ scoped: true, stopOnStall: true, mayCreateBaseline: false, skipIfProven: true, label: IS_SUBAGENT ? 'subagent stop' : 'stop' });

    if (r.ok === null) {
      // BLOCK, don't wave through. Unlike a hang, a lock conflict is transient and clears on its
      // own, so retrying is the right move — and exiting 0 here would let a stop through with the
      // gates never run, which is precisely the self-reporting this whole mechanism exists to
      // replace. Bounded by the normal retry budget, so it can never loop forever.
      const held = lockHolder();
      if (bumpRetries() > MAX_RETRIES) {
        console.error(`ristretto: could not get the gate lock after ${MAX_RETRIES} attempts — ${held} appears wedged. Surfacing instead of looping; the work is UNVERIFIED.`);
        process.exit(0);
      }
      console.error(`ristretto: the gates could not run — ${held} still holds the gate lock after ${waitSec}s.`);
      console.error('  Nothing is wrong with your work: two suites at once invent failures that belong to neither run,');
      console.error('  so ristretto waits rather than report a red it cannot trust. This stop is UNVERIFIED, not green.');
      console.error('  Wait for that run to finish and run the gates again. Do not start a second suite yourself.');
      process.exit(2);
    }

    // The holder proved exactly the tree we came to test while we waited for the lock — same as
    // the pre-lock check above, just on the far side of a wait that could have taken a while.
    if (r.alreadyProven) process.exit(0);

    // Did the pre-flight prove a green tree with a different toolchain than this hook runs? Only
    // worth asking once we know the gates are actually about to run — computing it any earlier
    // paid for a toolchain resolution on paths (a contended lock, an already-proven tree) that
    // never use it at all.
    const drift = toolDrift(resolveGateTools());
    const driftNote = drift.length ? `\n${drift.join('\n')}\n` : '';

    if (r.stalled) {
      console.error(driftNote + r.failures);
      process.exit(0);
    }

    if (r.ok) {
      if (driftNote) console.error(driftNote.trim());
      // The hook only ever sees the two duration hints — the three static checks are pre-flight
      // advice about the config itself, not hook noise on every green stop.
      auditConfig();
      try { fs.unlinkSync(retriesPath); } catch { /* never existed */ }
      process.exit(0);
    }

    let retries = 0;
    try { retries = parseInt(fs.readFileSync(retriesPath, 'utf8'), 10) || 0; } catch { /* first failure */ }
    if (retries >= MAX_RETRIES) {
      try { fs.unlinkSync(retriesPath); } catch { /* ignore */ }
      console.error(`${driftNote}ristretto: gates still failing after ${MAX_RETRIES} forced retries — surfacing to user instead of looping.${r.failures}`);
      process.exit(0);
    }
    fs.writeFileSync(retriesPath, String(retries + 1));
    console.error(`${driftNote}ristretto: work is not done — deterministic gates failed. Fix these before stopping. Do NOT weaken, skip, or delete gates/tests to get green.${r.failures}`);
    process.exit(2);
  }

  // The agent's own final proof. Runs exactly what the SubagentStop hook would run — the scoped
  // test gate, the same lock, the same budgets — and writes the fingerprint, so the hook that
  // follows finds a proven tree and exits immediately. One run instead of two, and it happens
  // inside the agent's own turn rather than in the silence after it.
  //
  // Three exit codes, and never the hook's 2: this reports to its caller, it does not block a
  // stop. 0 is green. 1 is a real red — the caller acted, the tree is broken. 3 is neither: a
  // stalled gate or a lock never obtained proved nothing either way, and must not be read as
  // "fix this" (1) or "ship it" (0). No fingerprint is written on 1 or 3, and the retry budget —
  // scoped to the hook's own loop — is never touched here.
  if (MODE === 'prove') {
    // skipIfProven: another run may have proven this exact tree while we queued for the lock —
    // or, on an unchanged tree with an uncontended lock, may have proven it before prove ever
    // started. Either way there is nothing left to run.
    const r = await runGates({ scoped: true, stopOnStall: true, mayCreateBaseline: false, skipIfProven: true, label: 'prove' });
    if (r.ok === null) {
      console.error(`ristretto: could not start — ${lockHolder()} still holds the gate lock after ${waitSec}s.`);
      console.error('  The tree is UNVERIFIED, not red. Let that run finish, then prove again.');
      process.exit(3);
    }
    if (r.stalled) {
      console.error(r.failures);
      process.exit(3);
    }
    if (r.failures) {
      console.error(r.failures);
      process.exit(1);
    }
    process.exit(0);
  }

  process.exit(0);
}

main();
