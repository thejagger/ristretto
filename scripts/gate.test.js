#!/usr/bin/env node
// Self-check for gate.js — run with: node scripts/gate.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GATE = path.join(__dirname, 'gate.js');
const PASS = `node -e "process.exit(0)"`;
const FAIL = `node -e "console.error('boom'); process.exit(1)"`;
// Silent forever — a genuine hang.
const HANG = `node -e "setTimeout(()=>{}, 60000)"`;
// Slow but alive: prints every 250ms for ~3s, then succeeds. Must NEVER be killed, however
// short the silence budget — this is the legitimately-slow suite that a duration cap murders.
const SLOW = `node -e "let n=0; const t=setInterval(()=>{console.log('tick'+(++n)); if(n>11){clearInterval(t); process.exit(0);}}, 250)"`;
// Prints once, then goes quiet forever — the shape of a real hang (suite starts, then wedges).
const STALL = `node -e "console.log('starting'); setTimeout(()=>{}, 60000)"`;
// Talks for ~8s. Used only where a killed run must be distinguishable from an unkilled one by
// wall-clock: the gap has to be wide enough that a loaded machine can't blur the two. A tight
// bound against a 3s command is exactly the kind of red that means "the box was busy".
const VERY_SLOW = `node -e "let n=0; const t=setInterval(()=>{console.log('tick'+(++n)); if(n>31){clearInterval(t); process.exit(0);}}, 250)"`;

function gate(dir, mode, stdin = '{}', env = {}, arg) {
  return spawnSync(process.execPath, arg ? [GATE, mode, arg] : [GATE, mode], {
    input: stdin,
    encoding: 'utf8',
    // Cleared by default, not just spread from the parent: this suite is itself often run from
    // inside a live Claude Code session, whose real CLAUDE_CODE_SESSION_ID would otherwise leak
    // into every child process and silently win over the session_id a test puts on stdin. Tests
    // that mean to exercise the env var pass it explicitly via `env`, which still overrides this.
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_SESSION_ID: '', ...env },
  });
}

function tmpRepo(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ristretto-gate-'));
  if (config !== undefined) fs.writeFileSync(path.join(dir, '.ristretto.json'), config);
  return dir;
}

function arm(dir) {
  fs.mkdirSync(path.join(dir, '.ristretto'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ristretto', 'pulling'), '');
}

// 1. No config → never interfere, all modes.
let dir = tmpRepo();
assert.strictEqual(gate(dir, 'quick').status, 0, 'quick without config must exit 0');
assert.strictEqual(gate(dir, 'full').status, 0, 'full without config must exit 0');
assert.strictEqual(gate(dir, 'verify').status, 0, 'verify without config must exit 0');

// 2. Config but no marker → full gate stays disarmed.
dir = tmpRepo(JSON.stringify({ gates: { lint: FAIL } }));
assert.strictEqual(gate(dir, 'full').status, 0, 'full without marker must exit 0');

// 3. Armed + failing gate → blocks with exit 2 and names the gate.
arm(dir);
let r = gate(dir, 'full');
assert.strictEqual(r.status, 2, 'failing gate while armed must exit 2');
assert.ok(r.stderr.includes("gate 'lint' FAILED"), 'stderr must name the failing gate');

// 4. Retry budget: two more blocks, then it surfaces with exit 0.
assert.strictEqual(gate(dir, 'full').status, 2, 'retry 2 must still block');
assert.strictEqual(gate(dir, 'full').status, 2, 'retry 3 must still block');
r = gate(dir, 'full');
assert.strictEqual(r.status, 0, 'after retry budget it must surface, not loop');
assert.ok(r.stderr.includes('surfacing to user'), 'exhausted budget must say so');
assert.strictEqual(gate(dir, 'full').status, 2, 'budget must reset after surfacing');

// 5. Passing gates → exit 0 and the retry counter resets.
dir = tmpRepo(JSON.stringify({ gates: { lint: PASS, typecheck: PASS, test: PASS } }));
arm(dir);
fs.writeFileSync(path.join(dir, '.ristretto', 'gate-retries'), '2');
assert.strictEqual(gate(dir, 'full').status, 0, 'green gates must exit 0');
assert.ok(!fs.existsSync(path.join(dir, '.ristretto', 'gate-retries')), 'green gates must reset retries');

// 6. Broken config while armed → fail closed (exit 2), not silently disarmed.
dir = tmpRepo('{not json');
arm(dir);
r = gate(dir, 'full');
assert.strictEqual(r.status, 2, 'broken config while armed must fail closed');
assert.ok(r.stderr.includes('unparseable'), 'broken config must be named');
assert.strictEqual(gate(dir, 'quick').status, 0, 'broken config in quick mode must not block');
assert.strictEqual(gate(dir, 'verify').status, 1, 'broken config in verify mode must exit 1');

// 7. Quick mode formats the touched file via {file}.
dir = tmpRepo(JSON.stringify({ gates: { format: `node -e "require('fs').writeFileSync(process.argv[1] + '.formatted', '')" {file}` } }));
const touched = path.join(dir, 'a.txt');
fs.writeFileSync(touched, 'x');
r = gate(dir, 'quick', JSON.stringify({ tool_input: { file_path: touched } }));
assert.strictEqual(r.status, 0, 'quick must exit 0');
assert.ok(fs.existsSync(touched + '.formatted'), 'format command must receive the touched file');

// --- Fingerprint cache: an unchanged green tree must not re-run the gates. ---
// COUNT appends one char to ./count per gate invocation, so the file length counts runs.
const COUNT = `node -e "require('fs').appendFileSync('count', 'x')"`;
const runs = (d) => { try { return fs.readFileSync(path.join(d, 'count'), 'utf8').length; } catch { return 0; } };

function gitTmpRepo(config) {
  const d = tmpRepo(config);
  fs.writeFileSync(path.join(d, '.gitignore'), '.ristretto/\ncount\n');
  fs.writeFileSync(path.join(d, 'src.txt'), 'v1');
  const g = (args) => spawnSync('git', args, { cwd: d, encoding: 'utf8' });
  g(['init', '-q']);
  g(['add', '-A']);
  g(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']);
  return d;
}

// 8. Green run stores a fingerprint; identical tree → gates skipped on the next run.
dir = gitTmpRepo(JSON.stringify({ gates: { test: COUNT } }));
arm(dir);
assert.strictEqual(gate(dir, 'full').status, 0, 'green gates must exit 0 (git repo)');
assert.strictEqual(runs(dir), 1, 'first green run must execute the gates');
assert.strictEqual(gate(dir, 'full').status, 0, 'unchanged tree must exit 0');
assert.strictEqual(runs(dir), 1, 'unchanged tree must NOT re-run the gates');

// 9. Any tree change invalidates the fingerprint → gates run again.
fs.writeFileSync(path.join(dir, 'src.txt'), 'v2');
assert.strictEqual(gate(dir, 'full').status, 0, 'changed tree must exit 0 when green');
assert.strictEqual(runs(dir), 2, 'changed tree must re-run the gates');

// 10. Same file names, different content → still a cache miss (content is hashed, not just paths).
fs.writeFileSync(path.join(dir, 'src.txt'), 'v3');
assert.strictEqual(gate(dir, 'full').status, 0);
assert.strictEqual(runs(dir), 3, 'content-only change must re-run the gates');

// 11. Outside a git repo there is no caching — gates always run (safe fallback).
dir = tmpRepo(JSON.stringify({ gates: { test: COUNT } }));
arm(dir);
gate(dir, 'full');
gate(dir, 'full');
assert.strictEqual(runs(dir), 2, 'non-git repo must run the gates every time');

// --- Hang detection by SILENCE, not duration. ---

// 12. A gate that never prints is killed, reported, and does NOT block (exit 0).
dir = tmpRepo(JSON.stringify({ gates: { test: HANG }, silence: { test: 1 } }));
arm(dir);
let startedAt = Date.now();
r = gate(dir, 'full');
assert.ok(Date.now() - startedAt < 30000, 'a hung gate must be killed at its silence budget, not run to completion');
assert.strictEqual(r.status, 0, 'a hung gate must surface (exit 0), not block into another hang');
assert.ok(r.stderr.includes('printed nothing for 1s'), 'the report must say it went silent, and for how long');
assert.ok(r.stderr.includes('hung, not slow'), 'the report must distinguish hung from slow');
assert.ok(r.stderr.includes('testChanged'), 'hang advice must point at the scoped-test escape hatch');
assert.ok(!fs.existsSync(path.join(dir, '.ristretto', 'gate-retries')), 'a hang must not consume the retry budget');
assert.strictEqual(fs.readFileSync(path.join(dir, '.ristretto', 'gate-stalled'), 'utf8'), 'test',
  'a hang must be recorded so the close step can report the work as unverified');

// 13. verify mode reports a hang too, and fails (exit 1) rather than passing it off as green.
r = gate(dir, 'verify');
assert.strictEqual(r.status, 1, 'a hung gate in verify must exit 1');
assert.ok(r.stdout.includes('test ✗'), 'verify must mark the hung gate failed in its summary');
// A hung gate is not a red gate: the board must read the verdict as unverified (final review I4).
assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, '.ristretto', 'suite.json'), 'utf8')).verdict, 'unverified', 'a hang is recorded as unverified, never red');

// 14. THE REGRESSION TEST. A gate that runs far longer than its silence budget but keeps
//     printing is working, not hung, and must be left alone to finish. A duration cap would
//     kill this; watching the output stream does not.
dir = tmpRepo(JSON.stringify({ gates: { test: SLOW }, silence: { test: 1 } }));
arm(dir);
startedAt = Date.now();
r = gate(dir, 'full');
const slowRanFor = Date.now() - startedAt;
assert.ok(slowRanFor > 2500, `the slow gate must actually have run its course (ran ${slowRanFor}ms)`);
assert.strictEqual(r.status, 0, 'a slow but talking gate must pass, not be killed');
assert.ok(!r.stderr.includes('printed nothing'), 'a gate that keeps printing must never be called hung');
assert.ok(!fs.existsSync(path.join(dir, '.ristretto', 'gate-stalled')), 'a slow gate must not be recorded as stalled');

// 15. Output resets the clock: a gate that starts, prints, then wedges is still caught.
dir = tmpRepo(JSON.stringify({ gates: { test: STALL }, silence: { test: 1 } }));
arm(dir);
r = gate(dir, 'full');
assert.strictEqual(r.status, 0, 'a gate that stalls mid-run must surface');
assert.ok(r.stderr.includes('printed nothing for 1s'), 'the stall must be detected after the last output');

// 16. No duration cap by default: a gate slower than any budget still passes on its own terms.
dir = tmpRepo(JSON.stringify({ gates: { test: SLOW } }));
arm(dir);
assert.strictEqual(gate(dir, 'full').status, 0, 'with no timeouts configured, nothing caps a working gate');

// 17. A hard cap is opt-in and still works when asked for — it kills a talking gate too.
dir = tmpRepo(JSON.stringify({ gates: { test: VERY_SLOW }, timeouts: { test: 1 } }));
arm(dir);
startedAt = Date.now();
r = gate(dir, 'full');
const cappedAfter = Date.now() - startedAt;
assert.ok(cappedAfter < 5000, `an explicit hard cap must cut a long gate short (ran ${cappedAfter}ms of a ~8s command)`);
assert.strictEqual(r.status, 0, 'a hard-capped gate must surface, not block');
assert.ok(r.stderr.includes('hard cap of 1s'), 'a hard-cap kill must be named as such, not as a stall');

// --- Scoped tests: the loop tests what changed, verify tests everything. ---

// SCOPED/FULL each append a distinct char to ./count so we can tell which ran.
const SCOPED = `node -e "require('fs').appendFileSync('count', 's')"`;
const FULL = `node -e "require('fs').appendFileSync('count', 'f')"`;
const trace = (d) => { try { return fs.readFileSync(path.join(d, 'count'), 'utf8'); } catch { return ''; } };

// 18. full mode prefers gates.testChanged; verify mode always runs the whole suite.
dir = gitTmpRepo(JSON.stringify({ gates: { test: FULL, testChanged: SCOPED } }));
arm(dir);
fs.writeFileSync(path.join(dir, 'src.txt'), 'touched');
assert.strictEqual(gate(dir, 'full').status, 0);
assert.strictEqual(trace(dir), 's', 'the loop must run the scoped test gate when one is configured');
r = gate(dir, 'verify');
assert.strictEqual(r.status, 0, 'verify must exit 0 when green');
assert.strictEqual(trace(dir), 'sf', 'verify must run the FULL suite, never the scoped one');
assert.ok(r.stdout.includes('test ✓'), 'verify must print a gate summary');

// 19. verify ignores the green-tree cache — its whole job is to re-prove the tree.
gate(dir, 'verify');
assert.strictEqual(trace(dir), 'sff', 'verify must not be short-circuited by the fingerprint cache');

// 20. Without testChanged, the loop falls back to the full test gate (today's behavior).
dir = gitTmpRepo(JSON.stringify({ gates: { test: FULL } }));
arm(dir);
fs.writeFileSync(path.join(dir, 'src.txt'), 'touched');
assert.strictEqual(gate(dir, 'full').status, 0);
assert.strictEqual(trace(dir), 'f', 'no testChanged → the full suite still runs, unchanged behavior');

// 21. {files} in a scoped command is substituted with the touched files.
const ARGS = `node -e "require('fs').appendFileSync('args', process.argv.slice(1).join(',') + '\\n')" {files}`;
dir = gitTmpRepo(JSON.stringify({ gates: { test: FULL, testChanged: ARGS } }));
arm(dir);
fs.writeFileSync(path.join(dir, 'src.txt'), 'touched');
fs.writeFileSync(path.join(dir, 'new.txt'), 'added');
assert.strictEqual(gate(dir, 'full').status, 0);
let args = fs.readFileSync(path.join(dir, 'args'), 'utf8').trim();
assert.ok(args.includes('src.txt'), 'a modified file must reach the scoped command');
assert.ok(args.includes('new.txt'), 'an untracked file must reach the scoped command too');
assert.ok(!args.includes('{files}'), 'the placeholder must be substituted, not passed through');

// 22. {files} with an untouched tree → nothing to scope to, so the test gate is skipped, not
//     run bare (which would silently become a full-suite run at the worst possible moment).
dir = gitTmpRepo(JSON.stringify({ gates: { test: FULL, testChanged: ARGS } }));
arm(dir);
assert.strictEqual(gate(dir, 'full').status, 0);
assert.ok(!fs.existsSync(path.join(dir, 'args')), 'an untouched tree must not run a bare scoped command');
assert.strictEqual(trace(dir), '', 'an untouched tree must not fall back to the full suite either');

// 23. A scoped failure still blocks — scoping changes what runs, never whether it's enforced.
dir = gitTmpRepo(JSON.stringify({ gates: { test: PASS, testChanged: FAIL } }));
arm(dir);
fs.writeFileSync(path.join(dir, 'src.txt'), 'touched');
r = gate(dir, 'full');
assert.strictEqual(r.status, 2, 'a failing scoped test must block like any other red gate');
assert.ok(r.stderr.includes("gate 'test (changed)' FAILED"), 'the scoped gate must be named as such');

// 24. verify with no gates configured is a no-op success, not a false green claim.
dir = tmpRepo(JSON.stringify({ gates: {} }));
r = gate(dir, 'verify');
assert.strictEqual(r.status, 0);
assert.ok(r.stdout.includes('none configured'), 'verify must say when there was nothing to run');

// --- Toolchain drift: a pre-flight proved with a different binary than the hook runs. ---
// The real-world shape: two installs of the same tool on one machine, the agent prepends the
// working one to PATH for its pre-flight, and the hook — which inherits no such thing — runs
// the other and goes red on an untouched tree. The red looks like a repo problem. It isn't.
if (process.platform !== 'win32') {
  const mkTool = (name, body) => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ristretto-bin-'));
    const exe = path.join(binDir, name);
    fs.writeFileSync(exe, `#!/bin/sh\n${body}\n`);
    fs.chmodSync(exe, 0o755);
    return binDir;
  };
  const goodBin = mkTool('faketool', 'echo "1068 tests passed"; exit 0');
  const badBin = mkTool('faketool', 'echo "2 tests failed: shader manifest"; exit 1');

  // 25. verify records the toolchain it proved the tree with, and shows it.
  dir = tmpRepo(JSON.stringify({ gates: { test: 'faketool' } }));
  r = gate(dir, 'verify', '{}', { PATH: `${goodBin}:${process.env.PATH}` });
  assert.strictEqual(r.status, 0, 'the good toolchain must verify green');
  assert.ok(r.stdout.includes(`faketool → ${goodBin}/faketool`), 'verify must show which binary it used');
  const recorded = JSON.parse(fs.readFileSync(path.join(dir, '.ristretto', 'gate-tools.json'), 'utf8'));
  assert.strictEqual(recorded.faketool, `${goodBin}/faketool`, 'verify must record the resolved binary');

  // 26. The hook resolving a DIFFERENT binary names the drift, so the red is explained rather
  //     than blamed on the repo. This is the whole point: the pre-flight proved nothing here.
  arm(dir);
  r = gate(dir, 'full', '{}', { PATH: `${badBin}:${process.env.PATH}` });
  assert.strictEqual(r.status, 2, 'a red gate still blocks');
  assert.ok(r.stderr.includes('is not the one that was verified'), 'the drift must be called out');
  assert.ok(r.stderr.includes(goodBin) && r.stderr.includes(badBin), 'both binaries must be named');
  assert.ok(r.stderr.includes('do not inherit a PATH you exported'), 'the advice must name the actual cause');
  assert.ok(r.stderr.includes('shader manifest'), 'the underlying failure must still be reported');

  // 27. Same binary → no noise. The warning must only fire on a genuine mismatch.
  fs.rmSync(path.join(dir, '.ristretto', 'gate-retries'), { force: true });
  r = gate(dir, 'full', '{}', { PATH: `${goodBin}:${process.env.PATH}` });
  assert.strictEqual(r.status, 0, 'the verified toolchain must pass');
  assert.ok(!r.stderr.includes('is not the one that was verified'), 'no drift warning when nothing drifted');
}

// --- The orchestrator exemption. ---
// brew's main agent writes no source; gating its stops runs a suite against a tree a live
// subagent is mid-edit on, and reports a red that belongs to a half-finished TDD cycle.

// 28. While orchestrating, a Stop is exempt but a SubagentStop is still fully gated.
dir = tmpRepo(JSON.stringify({ gates: { lint: FAIL } }));
arm(dir);
fs.writeFileSync(path.join(dir, '.ristretto', 'orchestrating'), '');
assert.strictEqual(gate(dir, 'full').status, 0, 'an orchestrator Stop must not be gated');
r = gate(dir, 'full', '{}', {}, 'subagent');
assert.strictEqual(r.status, 2, 'a SubagentStop must be gated even while orchestrating');
assert.ok(r.stderr.includes("gate 'lint' FAILED"), 'the subagent gate must still name the failure');

// 29. The exemption is opt-in per run: without the marker, Stop gates exactly as before. pull
//     and shot never write it, because there the main agent IS the implementer.
fs.rmSync(path.join(dir, '.ristretto', 'orchestrating'));
fs.rmSync(path.join(dir, '.ristretto', 'gate-retries'), { force: true });
assert.strictEqual(gate(dir, 'full').status, 2, 'without the marker a red Stop must block as usual');

// 30. The event name from the hook payload identifies a SubagentStop too, so a hooks.json that
//     predates the argument still gates subagents rather than silently exempting them.
fs.writeFileSync(path.join(dir, '.ristretto', 'orchestrating'), '');
fs.rmSync(path.join(dir, '.ristretto', 'gate-retries'), { force: true });
r = gate(dir, 'full', JSON.stringify({ hook_event_name: 'SubagentStop' }));
assert.strictEqual(r.status, 2, 'the payload event name must be enough to identify a subagent stop');

// --- The gate lock: one run at a time, repo-wide. ---

// 31. A held lock is waited on, never run through. THE KEY PROPERTY: it BLOCKS rather than
//     waving the stop through. Exiting 0 here would let an agent stop with the gates never run
//     — the self-reporting this whole mechanism exists to replace. A lock conflict is transient
//     (unlike a hang), so telling the agent to try again is exactly right.
const lockDir = (d) => path.join(d, '.ristretto', 'gate-lock');
dir = tmpRepo(JSON.stringify({ gates: { test: COUNT }, lockWait: 1 }));
arm(dir);
fs.mkdirSync(path.join(dir, '.ristretto'), { recursive: true });
fs.writeFileSync(lockDir(dir), JSON.stringify({ pid: process.pid, label: 'a full suite', at: Date.now() })); // ours = alive
r = gate(dir, 'full');
assert.strictEqual(r.status, 2, 'a lock conflict must block, not wave the stop through unverified');
assert.strictEqual(runs(dir), 0, 'the gates must NOT run while another run holds the lock');
assert.ok(r.stderr.includes('UNVERIFIED'), 'a lock conflict must be reported as unverified, not as red');
assert.ok(r.stderr.includes('a full suite'), 'the report must name who is holding the lock');
assert.ok(r.stderr.includes('Nothing is wrong with your work'), 'the agent must not be sent hunting for a defect');

// 32. It cannot block forever: the shared retry budget bounds it, then it surfaces.
assert.strictEqual(gate(dir, 'full').status, 2, 'second lock conflict still blocks');
assert.strictEqual(gate(dir, 'full').status, 2, 'third lock conflict still blocks');
r = gate(dir, 'full');
assert.strictEqual(r.status, 0, 'a wedged lock must surface, not loop forever');
assert.ok(r.stderr.includes('appears wedged'), 'the surfaced message must name the cause');
assert.strictEqual(runs(dir), 0, 'no gate may have run during any of that');

// 33. A lock left by a dead process is stolen, not obeyed forever.
fs.writeFileSync(lockDir(dir), JSON.stringify({ pid: 0x7ffffffe, label: 'a crashed run', at: Date.now() }));
assert.strictEqual(gate(dir, 'full').status, 0, 'a stale lock must not wedge the gates');
assert.strictEqual(runs(dir), 1, 'a stale lock must be stolen and the gates run');

// 34. Pid reuse must not make a lock immortal. A live pid on an ancient lock is a recycled
//     number, not a two-hour gate run — no gate can outlive the hook backstop.
fs.writeFileSync(path.join(dir, 'x.txt'), 'bust'); // (no git repo here, but keep it honest)
fs.writeFileSync(lockDir(dir), JSON.stringify({
  pid: process.pid, label: 'a recycled pid', at: Date.now() - 3 * 60 * 60 * 1000 }));
assert.strictEqual(gate(dir, 'full').status, 0, 'an ancient lock must be stolen despite a live pid');
assert.strictEqual(runs(dir), 2, 'the gates must actually run after stealing a recycled-pid lock');

// 35. The lock is released on exit, so back-to-back runs are not blocked by the previous one.
//     Three consecutive gate runs have now happened in this repo with no lock left behind.
assert.strictEqual(gate(dir, 'full').status, 0);
assert.strictEqual(runs(dir), 3, 'the lock must be released when a run finishes');
assert.ok(!fs.existsSync(path.join(dir, '.ristretto', 'gate-lock')), 'no lock file may survive a finished run');

// 36. verify refuses to claim green it could not prove — a lock conflict is exit 1, not 0.
dir = tmpRepo(JSON.stringify({ gates: { test: PASS }, lockWait: 1 }));
fs.mkdirSync(path.join(dir, '.ristretto'), { recursive: true });
fs.writeFileSync(path.join(dir, '.ristretto', 'gate-lock'),
  JSON.stringify({ pid: process.pid, label: 'a full suite', at: Date.now() }));
r = gate(dir, 'verify');
assert.strictEqual(r.status, 1, 'verify must not report success it never established');
assert.ok(r.stderr.includes('UNVERIFIED'), 'verify must say the tree is unverified, not red');
assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, '.ristretto', 'suite.json'), 'utf8')).verdict, 'unverified', 'the board must read unverified, not red');

// --- verify cached: do not re-pay for an unchanged tree. ---

// 37. A plain verify always re-runs; `verify cached` returns the stored verdict for the same tree.
dir = gitTmpRepo(JSON.stringify({ gates: { test: COUNT } }));
assert.strictEqual(gate(dir, 'verify').status, 0, 'the first verify must run and pass');
assert.strictEqual(runs(dir), 1, 'the first verify must actually execute the suite');
r = gate(dir, 'verify', '{}', {}, 'cached');
assert.strictEqual(r.status, 0, 'a cached green tree must verify green');
assert.strictEqual(runs(dir), 1, 'an unchanged tree must NOT re-run the suite in cached mode');
assert.ok(r.stdout.includes('cached green'), 'a cached verdict must say it was cached');

// 38. Any change to the tree makes the cache miss — the pre-flight is real again.
fs.writeFileSync(path.join(dir, 'src.txt'), 'moved on');
assert.strictEqual(gate(dir, 'verify', '{}', {}, 'cached').status, 0);
assert.strictEqual(runs(dir), 2, 'a changed tree must re-run even in cached mode');

// --- Format scoping: the convenience formatter stays where it belongs. ---
const MARK = `node -e "require('fs').appendFileSync(process.argv[1] + '.formatted', 'x')" {file}`;
const formatted = (f) => fs.existsSync(f + '.formatted');

// 39. With formatPaths set, a file inside the patterns is formatted and one outside is left alone.
dir = tmpRepo(JSON.stringify({ gates: { format: MARK, formatPaths: ['src/**/*.{ts,tsx}'] } }));
fs.mkdirSync(path.join(dir, 'src', 'deep'), { recursive: true });
const code = path.join(dir, 'src', 'deep', 'a.ts');
const doc = path.join(dir, 'DEPLOY.md');
fs.writeFileSync(code, 'x');
fs.writeFileSync(doc, '# heading');
assert.strictEqual(gate(dir, 'quick', JSON.stringify({ tool_input: { file_path: code } })).status, 0);
assert.ok(formatted(code), 'a file matching formatPaths must still be formatted');
assert.strictEqual(gate(dir, 'quick', JSON.stringify({ tool_input: { file_path: doc } })).status, 0);
assert.ok(!formatted(doc), 'a file outside formatPaths must be left completely alone');

// 40. `**/` matches zero directories too, so `src/**/*.ts` covers `src/a.ts`.
const shallow = path.join(dir, 'src', 'b.ts');
fs.writeFileSync(shallow, 'x');
gate(dir, 'quick', JSON.stringify({ tool_input: { file_path: shallow } }));
assert.ok(formatted(shallow), '**/ must match zero directories as well as many');

// 41. Unconfigured formatPaths keeps today's behavior — everything is formatted.
dir = tmpRepo(JSON.stringify({ gates: { format: MARK } }));
const anything = path.join(dir, 'README.md');
fs.writeFileSync(anything, 'x');
gate(dir, 'quick', JSON.stringify({ tool_input: { file_path: anything } }));
assert.ok(formatted(anything), 'without formatPaths the formatter must behave exactly as before');

// --- Stale marker: a dead session must not arm a live one. ---

// 42. A marker with no gate activity for a day is a leftover, not a pull. It is reported and ignored.
dir = tmpRepo(JSON.stringify({ gates: { lint: FAIL } }));
arm(dir);
const old = Date.now() / 1000 - 48 * 3600;
fs.utimesSync(path.join(dir, '.ristretto', 'pulling'), old, old);
r = gate(dir, 'full');
assert.strictEqual(r.status, 0, 'a stale marker must not gate a session that never asked');
assert.ok(r.stderr.includes('no gate run for 48h'), 'the staleness must be reported as idleness, with its duration');
assert.ok(r.stderr.includes('gate.js disarm'), 'the report must say how to clear it');

// 43. A fresh marker gates exactly as before — the age-out must not weaken a live pull.
arm(dir);
assert.strictEqual(gate(dir, 'full').status, 2, 'a fresh marker must still gate');

// 44. THE REGRESSION THAT MATTERS HERE. Staleness is measured from the last gate run, not from
//     when the marker was created — every armed run touches it. Without this, an unattended
//     batch that runs longer than the window would silently disarm its own gates halfway
//     through, which is the exact opposite of what a long run needs.
dir = tmpRepo(JSON.stringify({ gates: { lint: PASS } }));
arm(dir);
const marker = path.join(dir, '.ristretto', 'pulling');
const halfWay = Date.now() / 1000 - 12 * 3600; // idle a while, but not aged out
fs.utimesSync(marker, halfWay, halfWay);
assert.strictEqual(gate(dir, 'full').status, 0, 'a marker within the window must still gate');
const idleAfter = Date.now() - fs.statSync(marker).mtimeMs;
assert.ok(idleAfter < 60000, `a gate run must reset the marker's idle clock (was ${Math.round(idleAfter / 1000)}s)`);

// --- Routed testChanged: a polyglot repo needs more than one runner. ---
// A single command string gets EVERY changed path substituted into it, so on a backend+frontend
// repo `pytest {files}` would be handed .tsx files. Routed, each runner sees only its own — and
// a runner with nothing to do never starts, which is where the wall-clock actually goes.
const BE = `node -e "require('fs').appendFileSync('args', 'BE:' + process.argv.slice(1).join(',') + '\\n')" {files}`;
const FE = `node -e "require('fs').appendFileSync('args', 'FE:' + process.argv.slice(1).join(',') + '\\n')" {files}`;
const ran = (d) => { try { return fs.readFileSync(path.join(d, 'args'), 'utf8'); } catch { return ''; } };

const routed = (extra = []) => JSON.stringify({
  gates: {
    test: FULL,
    testChanged: [
      { match: ['backend/**/*.py'], cmd: BE, name: 'backend' },
      { match: ['frontend/**/*.{ts,tsx}'], cmd: FE, name: 'frontend' },
      ...extra,
    ],
  },
});

function polyRepo(config) {
  const d = gitTmpRepo(config);
  fs.mkdirSync(path.join(d, 'backend'), { recursive: true });
  fs.mkdirSync(path.join(d, 'frontend'), { recursive: true });
  return d;
}

// 45. Each route receives ONLY its own files — never the other stack's.
dir = polyRepo(routed());
arm(dir);
fs.writeFileSync(path.join(dir, 'backend', 'api.py'), 'x');
fs.writeFileSync(path.join(dir, 'frontend', 'ui.tsx'), 'x');
assert.strictEqual(gate(dir, 'full').status, 0, 'a routed run must exit 0 when green');
let out = ran(dir);
assert.ok(/BE:[^\n]*backend\/api\.py/.test(out), 'the backend route must receive its .py file');
assert.ok(!/BE:[^\n]*\.tsx/.test(out), 'the backend route must NEVER receive a .tsx file');
assert.ok(/FE:[^\n]*frontend\/ui\.tsx/.test(out), 'the frontend route must receive its .tsx file');
assert.ok(!/FE:[^\n]*\.py/.test(out), 'the frontend route must never receive a .py file');
assert.strictEqual(trace(dir), '', 'a fully routed change must never fall back to the full suite');

// 46. THE ONE THAT SAVES THE TIME. A change touching only one stack must not start the other's
//     suite at all — that is the whole difference between an 11-minute stop and a 20-second one.
dir = polyRepo(routed());
arm(dir);
fs.writeFileSync(path.join(dir, 'frontend', 'only.tsx'), 'x');
assert.strictEqual(gate(dir, 'full').status, 0);
out = ran(dir);
assert.ok(out.includes('FE:'), 'the touched stack must be tested');
assert.ok(!out.includes('BE:'), 'the untouched stack must NOT run at all');

// 47. Fail-safe: a changed file matching no route runs the FULL suite rather than a partial
//     one. An unrecognised path may be exactly the one that breaks everything, and a green
//     that quietly skipped it would be a lie.
dir = polyRepo(routed());
arm(dir);
fs.writeFileSync(path.join(dir, 'backend', 'api.py'), 'x');
fs.writeFileSync(path.join(dir, 'infra.tf'), 'resource {}'); // routed nowhere
r = gate(dir, 'full');
assert.strictEqual(r.status, 0);
assert.strictEqual(trace(dir), 'f', 'an unrouted file must force the full suite');
assert.strictEqual(ran(dir), '', 'no partial route may run when the full suite was chosen');
assert.ok(r.stderr.includes('match no "testChanged" route'), 'the fallback must say why it happened');
assert.ok(r.stderr.includes('infra.tf'), 'the fallback must name the unrouted file');

// 48. An empty cmd claims files deliberately — the explicit "these need no tests" route.
dir = polyRepo(routed([{ match: ['**/*.md', '*.tf'], cmd: '' }]));
arm(dir);
fs.writeFileSync(path.join(dir, 'README.md'), '# docs');
fs.writeFileSync(path.join(dir, 'infra.tf'), 'resource {}');
r = gate(dir, 'full');
assert.strictEqual(r.status, 0);
assert.strictEqual(trace(dir), '', 'a claimed-but-untested change must not trigger the full suite');
assert.strictEqual(ran(dir), '', 'an empty cmd must run nothing');
assert.ok(!r.stderr.includes('match no'), 'an explicitly claimed file is not unrouted');

// 49. A failing route still blocks, and names which route failed.
dir = polyRepo(JSON.stringify({ gates: { test: PASS, testChanged: [{ match: ['backend/**'], cmd: FAIL, name: 'backend' }] } }));
arm(dir);
fs.writeFileSync(path.join(dir, 'backend', 'api.py'), 'x');
r = gate(dir, 'full');
assert.strictEqual(r.status, 2, 'a failing route must block like any other red gate');
assert.ok(r.stderr.includes("gate 'test (changed: backend)' FAILED"), 'the failing route must be named');

// 50. verify ignores routing entirely — its job is to prove the whole repo.
dir = polyRepo(routed());
fs.writeFileSync(path.join(dir, 'frontend', 'only.tsx'), 'x');
r = gate(dir, 'verify');
assert.strictEqual(r.status, 0);
assert.strictEqual(trace(dir), 'f', 'verify must run the FULL suite regardless of routes');
assert.strictEqual(ran(dir), '', 'verify must never run a scoped route');

// --- The slow-unscoped-suite hint. Measured, not guessed, so it fires in any language. ---
// A `.ristretto.json` that already exists is exactly where "add testChanged" gets skipped: the
// repo looks configured, so nobody looks. The runner is the one thing that knows, from the clock,
// that the suite is slow enough for it to matter.

// 51. A slow full suite with no testChanged says so, and shows both config forms.
const SLOW_TEST = `node -e "let n=0; const t=setInterval(()=>{console.log('t'+(++n)); if(n>4){clearInterval(t); process.exit(0);}}, 250)"`;
dir = tmpRepo(JSON.stringify({ gates: { test: SLOW_TEST } }));
arm(dir);
r = gate(dir, 'full', '{}', {}, undefined);
assert.strictEqual(r.status, 0, 'a green slow suite must still pass');
// The real threshold is 60s; assert the mechanism instead of waiting a minute for it.
assert.ok(!r.stderr.includes('will run again at every stop'),
  'a suite under the threshold must NOT nag — the hint has to stay rare enough to be read');

// 52. The hint never fires when testChanged is already configured — no nagging about a
//     setting the repo has already made.
dir = gitTmpRepo(JSON.stringify({ gates: { test: FULL, testChanged: SCOPED } }));
arm(dir);
fs.writeFileSync(path.join(dir, 'src.txt'), 'touched');
r = gate(dir, 'full');
assert.strictEqual(r.status, 0);
assert.ok(!r.stderr.includes('will run again at every stop'), 'a configured repo must never see the hint');
assert.strictEqual(trace(dir), 's', 'and it must be running the scoped gate, not the full one');



// 53. A run that has to queue says so IMMEDIATELY, not only when it gives up. This is the whole
//     lesson of the stall: an agent that emits nothing for ~10 minutes is killed, and a killed
//     agent's result is lost entirely — so a silent wait costs far more than the wait itself.
dir = tmpRepo(JSON.stringify({ gates: { test: COUNT }, lockWait: 1 }));
arm(dir);
fs.mkdirSync(path.join(dir, '.ristretto'), { recursive: true });
fs.writeFileSync(lockDir(dir), JSON.stringify({ pid: process.pid, label: 'a full suite', at: Date.now() }));
r = gate(dir, 'full');
assert.ok(r.stderr.includes('waiting for the gate lock'),
  'a queued run must announce the wait, not sit silent until the deadline');
assert.ok(r.stderr.includes('a full suite'), 'and name what it is waiting on');
assert.strictEqual(runs(dir), 0, 'announcing must not mean running');

// 54. The default wait is a CEILING, not a preference: it exists to end before the caller is
//     killed for going quiet. A future edit that raises it past the stall watchdog would restore
//     exactly the failure this replaced — a subagent killed mid-wait, its work stranded unproven.
const gateSrc = fs.readFileSync(path.join(__dirname, 'gate.js'), 'utf8');
const declared = /const DEFAULT_LOCK_WAIT = (\d+);/.exec(gateSrc);
assert.ok(declared, 'DEFAULT_LOCK_WAIT must stay a plain literal this check can read');
assert.ok(Number(declared[1]) <= 600,
  `DEFAULT_LOCK_WAIT is ${declared[1]}s — it must stay under the ~600s agent stall watchdog`);
// 55. The scoped-gate hint must stay rare: a scoped run that is actually fast says nothing. A hint
//     that fires on every loop is a hint nobody reads by the third feature.
dir = gitTmpRepo(JSON.stringify({ gates: { test: FULL, testChanged: SCOPED } }));
arm(dir);
fs.writeFileSync(path.join(dir, 'src.txt'), 'touched');
r = gate(dir, 'full');
assert.strictEqual(r.status, 0);
assert.ok(!r.stderr.includes('that is the fast path'), 'a fast scoped gate must not be flagged as slow');

// 56. And its threshold is a ceiling for the same reason the lock's is: it exists to be read by
//     whoever is still alive. Past the stall watchdog the advice arrives after the run it would
//     have saved. (The firing path itself is not exercised here — it needs a five-minute gate.)
const scopedHint = /const SLOW_SCOPED_HINT_MS = ([^;]+);/.exec(gateSrc);
assert.ok(scopedHint, 'SLOW_SCOPED_HINT_MS must stay a plain literal this check can read');
assert.ok(eval(scopedHint[1]) <= 600 * 1000,
  'SLOW_SCOPED_HINT_MS must stay under the ~600s agent stall watchdog');
assert.ok(/scopedMs >= SLOW_SCOPED_HINT_MS/.test(gateSrc),
  'the hint must stay wired to the scoped gate — an unwired hint is silently never emitted');

// 57. THE ONE THAT WOULD HAVE SAVED THE RUN. A scoped route that dropped a flag its full `test`
//     gate carries is named before anything slow happens — structurally, without knowing what the
//     flag means. Nothing about this config looks wrong to a reader; only the two commands side by
//     side show that the fast path lost the parallelism the slow one has.
const POLY = {
  test: 'cd backend && pytest -q -n auto && cd .. && cd frontend && npm run test',
  testChanged: [
    { name: 'backend', match: ['backend/**/*.py'], cmd: 'pytest -q {files}' },
    { name: 'frontend', match: ['frontend/**'], cmd: 'cd frontend && npm run test' },
  ],
};
dir = gitTmpRepo(JSON.stringify({ gates: POLY }));
arm(dir);
r = gate(dir, 'verify');
assert.ok(r.stderr.includes("missing a flag its full \"test\" gate has: -n auto"),
  'the dropped flag must be named exactly, at pre-flight, before a single subagent runs');
assert.ok(r.stderr.includes('backend'), 'and it must say WHICH route dropped it');

// 58. And it must not cry wolf on the polyglot case it was written for: the frontend route shares
//     `npm run test` with the same chained gate, and the backend's flags are not its to carry.
//     A check that flags every well-configured multi-stack repo would be turned off within a day.
assert.ok(!/changed: frontend'\) is missing|changed: frontend' is missing/.test(r.stderr),
  'a route matching a different segment of the chain must not inherit the other stack\'s flags');

// 59. Once the flag is carried across, the runner goes quiet — the signal has to clear, or it
//     becomes background noise nobody reads.
const FIXED = JSON.parse(JSON.stringify(POLY));
FIXED.testChanged[0].cmd = 'pytest -q -n auto {files}';
dir = gitTmpRepo(JSON.stringify({ gates: FIXED }));
arm(dir);
r = gate(dir, 'verify');
assert.ok(!r.stderr.includes('missing a flag'), 'a corrected config must produce no advice at all');

// 60. THE SILENT ONE. A leftover `orchestrating` marker turns Stop gating off — no error, no
//     symptom, nothing to notice until something red is committed. A brew that dies without
//     disarming leaves exactly that behind, and before this the exemption never expired.
dir = tmpRepo(JSON.stringify({ gates: { test: COUNT } }));
arm(dir);
const orchPath = path.join(dir, '.ristretto', 'orchestrating');
fs.writeFileSync(orchPath, '');
r = gate(dir, 'full');
assert.strictEqual(r.status, 0, 'a live brew orchestrator is still exempt');
assert.strictEqual(runs(dir), 0, 'and exempt means no gate ran');

const stale = Date.now() / 1000 - 3 * 60 * 60; // 3h without a single subagent stop
fs.utimesSync(orchPath, stale, stale);
r = gate(dir, 'full');
assert.ok(r.stderr.includes('leftover from a dead brew'), 'a stale exemption must be named, not honoured');
assert.strictEqual(runs(dir), 1, 'and the gates must actually run — an expired exemption is no exemption');

// 61. A subagent stopping is the only thing that proves the loop is alive, so it — and nothing
//     else — keeps the exemption current. Without this a long feature would expire its own brew.
r = gate(dir, 'full', undefined, {}, 'subagent');
assert.ok(Date.now() - fs.statSync(orchPath).mtimeMs < 60 * 1000,
  'a subagent gate must refresh the exemption it runs under');
r = gate(dir, 'full');
assert.strictEqual(r.status, 0, 'and the orchestrator is exempt again once the loop has proven itself alive');

// 62. THE ONE THAT KILLED A HEALTHY SUITE. `pytest -q` over a thousand tests is about a kilobyte
//     of dots — less than one buffer block — so piped rather than attached to a terminal it emits
//     nothing until it exits. Silence-based hang detection then times out a suite that was working
//     the entire time. A gate that never printed one byte must be told apart from one that spoke
//     and then wedged, because the two have completely different fixes.
const MUTE = `node -e "setTimeout(()=>process.exit(0), 4000)"`;
dir = tmpRepo(JSON.stringify({ gates: { test: MUTE }, silence: { test: 1 } }));
arm(dir);
r = gate(dir, 'full');
assert.ok(r.stderr.includes('NOTHING AT ALL'), 'a gate that never printed must be diagnosed as buffering, not as a hang');
assert.ok(!r.stderr.includes("waiting on (an open handle"),
  'and must NOT send anyone hunting an open handle that is not there');

// 63. The diagnosis must stay narrow: a gate that spoke and THEN went quiet is a real hang, and
//     still gets the real-hang advice. Blurring the two would trade one wrong answer for another.
dir = tmpRepo(JSON.stringify({ gates: { test: STALL }, silence: { test: 1 } }));
arm(dir);
r = gate(dir, 'full');
assert.ok(!r.stderr.includes('NOTHING AT ALL'), 'a gate that printed before wedging is not a buffering case');
assert.ok(r.stderr.includes("waiting on (an open handle"), 'and it must still get the hunt-the-handle advice');

// 64. Unverified is unverified: diagnosing the cause must never quietly turn a killed gate green.
assert.ok(r.stderr.includes('UNVERIFIED'), 'a killed gate stays unverified whatever the explanation');

// 65. THE GENERAL FORM OF THE PYTHON BUG. A silence budget is a guess about how talkative a runner
//     is, and every guess is wrong for some repo — a .NET build quiet for minutes, a Gradle phase
//     gap, or simply a suite that grew past it. So a gate that finished GREEN has proven its own
//     longest silence was healthy, and that measurement widens the budget. No tool names involved.
const PAUSER = `node -e "console.log('a'); setTimeout(()=>{console.log('b'); process.exit(0);}, 2500)"`;
dir = tmpRepo(JSON.stringify({ gates: { test: PAUSER }, silence: { test: 5 } }));
arm(dir);
r = gate(dir, 'full');
assert.strictEqual(r.status, 0, 'the calibrating run must pass on its generous budget');
const quiet = JSON.parse(fs.readFileSync(path.join(dir, '.ristretto', 'gate-quiet.json'), 'utf8'));
assert.ok(quiet.test >= 2000, `the healthy silence must be recorded (got ${quiet.test}ms)`);

// Now starve the configured budget. Before calibration this gate is killed at 1s; after it, the
// gate's own proven behaviour wins — which is exactly what a suite growing past 300s needed.
fs.writeFileSync(path.join(dir, '.ristretto.json'), JSON.stringify({ gates: { test: PAUSER }, silence: { test: 1 } }));
r = gate(dir, 'full');
assert.strictEqual(r.status, 0, 'a gate must not be killed for a silence it has already proven healthy');
assert.ok(!r.stderr.includes('printed nothing for'), 'and it must not be called hung at all');

// 66. Calibration may only ever LOOSEN, and never past the point where a real hang is unkillable.
//     A measurement that could tighten a budget would invent kills; one without a ceiling would
//     let a wedged gate run forever on the strength of a good day.
assert.ok(/Math\.max\(configuredSec, Math\.round\(widenedMs \/ 1000\)\)/.test(gateSrc2()),
  'the widened budget must be a max() against the configured one — never a replacement');
assert.ok(/Math\.min\(observed \* QUIET_SLACK \+ QUIET_FLOOR_MS, QUIET_CEILING_MS\)/.test(gateSrc2()),
  'and it must be capped, so no history can make a hang unkillable');
function gateSrc2() { return fs.readFileSync(path.join(__dirname, 'gate.js'), 'utf8'); }

// 67. A gate that never went green must never be calibrated — otherwise a hang teaches the runner
//     to tolerate itself, and the budget grows every time it wedges.
dir = tmpRepo(JSON.stringify({ gates: { test: STALL }, silence: { test: 1 } }));
arm(dir);
gate(dir, 'full');
assert.ok(!fs.existsSync(path.join(dir, '.ristretto', 'gate-quiet.json')),
  'a killed gate must record nothing — only green runs are evidence');


// --- The {file} contract. ---
// formatPaths matches repo-relative paths and {files} substitutes repo-relative paths, so {file}
// substituting an ABSOLUTE one made a single config file speak two path languages. Every command
// that composed with it — the `cd sub && fmt ../{file}` a monorepo naturally writes — silently
// formatted nothing, forever, because quick mode discards what it cannot block on.

// 68. {file} is repo-relative, like everything else a config author writes.
dir = tmpRepo();
fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'x\n');
fs.writeFileSync(path.join(dir, '.ristretto.json'), JSON.stringify({
  gates: { format: 'node -e "require(\'fs\').appendFileSync(\'got.txt\', process.argv[1])" {file}' },
}));
gate(dir, 'quick', JSON.stringify({ tool_input: { file_path: path.join(dir, 'src', 'a.ts') } }));
assert.strictEqual(fs.readFileSync(path.join(dir, 'got.txt'), 'utf8').trim(), 'src/a.ts',
  '{file} must arrive repo-relative, with forward slashes');

// --- A formatter that fails every time must say so. ---
// "Never block" was implemented as "never report", so a format gate that was broken on every
// single edit produced not one byte of evidence. Non-blocking is a promise about exit 2, not a
// reason to swallow the output.

// 69. A failing format gate is surfaced — without blocking (never exit 2).
dir = tmpRepo(JSON.stringify({ gates: { format: FAIL } }));
fs.writeFileSync(path.join(dir, 'a.ts'), 'x\n');
const fmtHook = JSON.stringify({ tool_input: { file_path: path.join(dir, 'a.ts') } });
r = gate(dir, 'quick', fmtHook);
assert.notStrictEqual(r.status, 2, 'the format gate must never block');
assert.notStrictEqual(r.status, 0, 'but a formatter that failed must not pass silently either');
assert.ok(/format/i.test(r.stderr), 'and it must name the format gate');

// 70. Once, not on every keystroke. The same failure again is already on the record.
r = gate(dir, 'quick', fmtHook);
assert.strictEqual(r.status, 0, 'the same format failure must not be reported twice');
assert.ok(!/format/i.test(r.stderr), 'and must stay quiet the second time');

// 71. A formatter that starts working clears the record, so a LATER regression is reported again.
fs.writeFileSync(path.join(dir, '.ristretto.json'), JSON.stringify({ gates: { format: PASS } }));
gate(dir, 'quick', fmtHook);
fs.writeFileSync(path.join(dir, '.ristretto.json'), JSON.stringify({ gates: { format: FAIL } }));
r = gate(dir, 'quick', fmtHook);
assert.notStrictEqual(r.status, 0, 'a formatter that breaks again must be reported again');

// --- The calibration bootstrap. ---
// Budgets could only ever widen from a GREEN run, so a tool whose first run is killed for
// buffering never recorded anything and was killed identically forever. The measurement that was
// meant to replace a per-tool table could only ever help tools that never needed it. Python
// escaped it via a hardcoded PYTHONUNBUFFERED; no other stack had a way out.
// Silent for 3s, then succeeds: healthy, just buffered.
const QUIET_PASS = 'node -e "setTimeout(()=>{console.log(\'42 passed\'); process.exit(0)}, 3000)"';

// 72. A gate killed having printed NOTHING widens its own rope for next time, and then passes.
dir = tmpRepo(JSON.stringify({ gates: { test: QUIET_PASS }, silence: { test: 2 } }));
arm(dir);
r = gate(dir, 'full');
assert.ok(/printed nothing/.test(r.stderr), 'run 1 is killed, as before');
r = gate(dir, 'full');
assert.strictEqual(r.status, 0, 'run 2 must survive — a buffering tool has to be able to prove itself');
assert.ok(!/printed nothing/.test(r.stderr), 'and must not be killed again for the same silence');

// 73. A gate that SPOKE and then wedged is a real hang: it earns no rope at all.
dir = tmpRepo(JSON.stringify({ gates: { test: STALL }, silence: { test: 1 } }));
arm(dir);
gate(dir, 'full');
let quietAfterStall = {};
try { quietAfterStall = JSON.parse(fs.readFileSync(path.join(dir, ".ristretto", "gate-quiet.json"), "utf8")); } catch { /* none */ }
assert.ok(!Object.keys(quietAfterStall).some((k) => k.startsWith('test')),
  'a gate that spoke before wedging must never teach the runner to tolerate it');

// 74. And the rope is bounded — no history of buffering may make a genuine hang unkillable.
assert.ok(/QUIET_CEILING_MS/.test(gateSrc2()),
  'the widened budget must still be capped by the ceiling');

// --- Which binary is this gate actually going to run? ---
// resolveGateTools read Object.values(gates), so it fed itself formatPaths (an array of globs)
// and testChanged (an array of objects, stringified to "[object Object]"). Every real command
// that began with `cd` resolved to the shell builtin. The drift detector recorded three pieces
// of junk and not one tool — inert on exactly the polyglot configs the docs recommend.

// 75. Only real gate commands, and the program behind a `cd` prefix — never a glob or an object.
dir = tmpRepo(JSON.stringify({
  gates: {
    test: 'cd . && ' + PASS,
    formatPaths: ['frontend/**/*.{ts,tsx}'],
    testChanged: [{ match: ['x/**'], cmd: PASS }],
  },
}));
gate(dir, 'verify');
const tools = JSON.parse(fs.readFileSync(path.join(dir, '.ristretto', 'gate-tools.json'), 'utf8'));
assert.ok('node' in tools, 'the real program behind a `cd` prefix must be resolved');
assert.ok(!('cd' in tools), '`cd` is a shell builtin, not a toolchain');
assert.ok(!Object.keys(tools).some((k) => k.includes('[object') || k.includes('*')),
  'globs and route objects are not commands and must never be probed as tools');

// 76. A green run clears the stall marker. Left behind, it says a gate is hung long after one is.
dir = tmpRepo(JSON.stringify({ gates: { test: HANG }, silence: { test: 1 } }));
arm(dir);
gate(dir, 'full');
assert.ok(fs.existsSync(path.join(dir, '.ristretto', 'gate-stalled')), 'a hang is recorded');
fs.writeFileSync(path.join(dir, '.ristretto.json'), JSON.stringify({ gates: { test: PASS } }));
gate(dir, 'full');
assert.ok(!fs.existsSync(path.join(dir, '.ristretto', 'gate-stalled')),
  'and a green run must clear it — stale state that says "hung" is a lie with no expiry');

// --- The lock wait and the agent's silence budget are the same budget. ---
// The agent that triggered this hook is killed after ~10 minutes of silence, and a killed agent
// loses its result ENTIRELY — whoever dispatched it gets no answer at all. A queue wait that
// ignores how long the run itself takes spends that budget twice: 8 minutes waiting plus a
// 6-minute suite is a subagent that dies having said nothing, and a feature blocked for a reason
// that was never about the feature.

// 77. The wait is cut to the room the watchdog has left, not the configured ceiling.
dir = tmpRepo(JSON.stringify({ gates: { test: PASS }, lockWait: 3600, watchdog: 65 }));
arm(dir);
fs.mkdirSync(path.join(dir, '.ristretto'), { recursive: true });
fs.writeFileSync(path.join(dir, '.ristretto', 'gate-lock'),
  JSON.stringify({ pid: process.pid, label: 'someone else', at: Date.now() }));
r = gate(dir, 'full');
assert.ok(/Up to 5s/.test(r.stderr),
  'the wait must shrink to what the watchdog has left, not the configured 3600s — got: ' + r.stderr.slice(0, 300));

// 78. A run that eats most of that budget says so, while someone is still alive to read it.
dir = tmpRepo(JSON.stringify({ gates: { test: SLOW }, watchdog: 4 }));
arm(dir);
r = gate(dir, 'full');
assert.strictEqual(r.status, 0, 'a slow gate still passes on its own terms');
assert.ok(/watchdog|silence budget|killed for going quiet/i.test(r.stderr),
  'a run this close to the agent\'s own limit must be named — got: ' + r.stderr.slice(0, 300));


// 79. The hang report must quote the budget the gate was ACTUALLY killed at, not the configured
//     one. Calibration and probation both widen it, so quoting the config would tell someone to
//     raise a number that is already being ignored in their favour — and would understate, every
//     time, exactly how much rope the tool has already been given.
dir = tmpRepo(JSON.stringify({ gates: { test: HANG }, silence: { test: 1 } }));
arm(dir);
r = gate(dir, 'full');
assert.ok(r.stderr.includes('printed nothing for 1s'), 'the first kill is at the configured budget');
r = gate(dir, 'full');
assert.ok(r.stderr.includes('printed nothing for 2s'),
  'the second kill is at the widened budget, and must say so — got: ' + r.stderr.slice(0, 200));
assert.ok(r.stderr.includes('(now 2s)'),
  'and the advice must offer to raise the budget from where it actually stands');


// --- Attribution: which failures are NEW. ---
// A gate produces one bit, and one bit cannot say whose fault a failure is. Given the report the
// runner already writes, it can: failures this change introduced block, failures that were
// already there are tolerated and counted. Configure nothing and none of this speaks.

// A stand-in test runner. Writes a JUnit report naming the ids it was given, fails the ones it
// was told to fail, and exits accordingly — a real runner in every way that matters here.
const REPORTER_SRC = `
const fs = require('fs');
const ids = (process.argv[2] || '').split(',').filter(Boolean);
const bad = new Set((process.argv[3] || '').split(',').filter(Boolean));
const cases = ids.map((id) => {
  const [c, n] = id.split('::');
  return bad.has(id)
    ? '<testcase classname="' + c + '" name="' + n + '"><failure message="x">boom</failure></testcase>'
    : '<testcase classname="' + c + '" name="' + n + '"/>';
}).join('');
fs.mkdirSync('.ristretto', { recursive: true });
fs.writeFileSync('.ristretto/report.xml', '<testsuites><testsuite>' + cases + '</testsuite></testsuites>');
process.exit(bad.size ? 1 : 0);
`;

function reporterRepo(ids, fails, gatesExtra) {
  const d = tmpRepo(JSON.stringify({
    gates: Object.assign({
      test: `node reporter.js "${ids.join(',')}" "${fails.join(',')}"`,
      testReport: '.ristretto/report.xml',
    }, gatesExtra || {}),
  }));
  fs.writeFileSync(path.join(d, 'reporter.js'), REPORTER_SRC);
  return d;
}

function setBaseline(d, ids) {
  fs.mkdirSync(path.join(d, '.ristretto'), { recursive: true });
  fs.writeFileSync(path.join(d, '.ristretto', 'baseline.json'),
    JSON.stringify({ capturedAt: 1, head: null, failing: ids }));
}

const readBaseline = (d) =>
  JSON.parse(fs.readFileSync(path.join(d, '.ristretto', 'baseline.json'), 'utf8')).failing;

// 80. A pre-existing failure is tolerated: the gate passes despite a non-zero exit code, and says
//     how many it is carrying.
dir = reporterRepo(['a::1', 'a::2'], ['a::1']);
arm(dir);
setBaseline(dir, ['a::1']);
r = gate(dir, 'full');
assert.strictEqual(r.status, 0, 'a failure that was already there must not block');
assert.ok(/1 pre-existing/.test(r.stderr), `the tolerated count must be stated — got: ${r.stderr.slice(0, 300)}`);

// 81. A NEW failure blocks, and the message names only the new one. Naming all of them is the
//     same as naming none: the whole value is knowing which failure is yours.
dir = reporterRepo(['a::1', 'a::2'], ['a::1', 'a::2']);
arm(dir);
setBaseline(dir, ['a::1']);
r = gate(dir, 'full');
assert.strictEqual(r.status, 2, 'a new failure still blocks');
assert.ok(r.stderr.includes('a::2'), 'the new failure must be named');
assert.ok(!/^\s+a::1$/m.test(r.stderr), 'the pre-existing one must be counted, never blamed');

// 82. THE RATCHET, end to end. A baseline failure that now passes leaves the file on disk.
dir = reporterRepo(['a::1', 'a::2'], []);
arm(dir);
setBaseline(dir, ['a::1']);
r = gate(dir, 'full');
assert.strictEqual(r.status, 0);
assert.deepStrictEqual(readBaseline(dir), [],
  'a fixed test must leave the tolerated set and never be allowed back in silently');

// 83. THE EXIT-5 CASE. A runner reporting "nothing ran" with a non-zero exit is not a red tree.
//     pytest returns 5 when the changed files contained no tests, which blocked agents on a suite
//     that never executed and sent them hunting a broken test that did not exist.
dir = tmpRepo(JSON.stringify({
  gates: { test: 'node reporter.js', testReport: '.ristretto/report.xml' },
}));
fs.writeFileSync(path.join(dir, 'reporter.js'),
  "const fs=require('fs');fs.mkdirSync('.ristretto',{recursive:true});" +
  "fs.writeFileSync('.ristretto/report.xml','<testsuites><testsuite tests=\"0\"/></testsuites>');" +
  'process.exit(5);');
arm(dir);
setBaseline(dir, []);
r = gate(dir, 'full');
assert.strictEqual(r.status, 0, 'no tests ran and none failed — that is not a failing gate');

// 84. With NO baseline on disk a hook treats every failure as new, and must not create one.
//     Capture is a deliberate act that belongs to verify.
dir = reporterRepo(['a::1'], ['a::1']);
arm(dir);
r = gate(dir, 'full');
assert.strictEqual(r.status, 2, 'no baseline means nothing is tolerated');
assert.ok(!fs.existsSync(path.join(dir, '.ristretto', 'baseline.json')),
  'and a hook must never create one');

// 85. Unconfigured repos are untouched: no testReport, no attribution, the exit code decides.
dir = tmpRepo(JSON.stringify({ gates: { test: FAIL } }));
arm(dir);
r = gate(dir, 'full');
assert.strictEqual(r.status, 2);
assert.ok(!/pre-existing|NEW test failure/.test(r.stderr),
  'attribution must not speak in a repo that did not ask for it');


// 86. THE ONE THAT WOULD LIE. A report left behind by a previous run describes a run that is
//     over. If this run's command dies before writing one, reading yesterday's file would call
//     the tree green on the strength of results nobody produced.
dir = tmpRepo(JSON.stringify({
  gates: { test: `node -e "process.exit(1)"`, testReport: '.ristretto/report.xml' },
}));
arm(dir);
fs.writeFileSync(path.join(dir, '.ristretto', 'report.xml'),
  '<testsuites><testsuite><testcase classname="a" name="1"/></testsuite></testsuites>');
setBaseline(dir, []);
r = gate(dir, 'full');
assert.strictEqual(r.status, 2, 'a stale green report must not rescue a failing run');
assert.ok(!fs.existsSync(path.join(dir, '.ristretto', 'report.xml')),
  'the stale report must have been deleted before the gate ran');

// 87. And when no report appears at all, the gate says so and falls back to the exit code rather
//     than inventing a verdict from a file that is not there.
assert.ok(/no test report/i.test(r.stderr),
  `the fallback must be stated, not silent — got: ${r.stderr.slice(0, 300)}`);


// --- Capture. ---
// Creating a baseline and updating one are different acts, and only the first is restricted.

// 88. First capture belongs to verify, and is loud. A deliberate moment — brew's pre-flight, or
//     a person at a terminal — never a hook firing in the middle of the night.
dir = reporterRepo(['a::1', 'a::2'], ['a::1']);
r = gate(dir, 'verify');
assert.strictEqual(r.status, 0, 'the first verify captures rather than refusing to start');
assert.ok(/captured 1 pre-existing/.test(r.stdout + r.stderr),
  `the capture must be announced with its count — got: ${(r.stdout + r.stderr).slice(0, 300)}`);
assert.deepStrictEqual(readBaseline(dir), ['a::1']);

// 89. THE ONE THAT STOPS A BAD DAY BECOMING A BLESSING. Once a baseline exists, even verify may
//     not widen it. A verify against a database that happens to be down would otherwise record
//     every one of its failures as "pre-existing" and tolerate them for the whole night.
dir = reporterRepo(['a::1', 'a::2'], ['a::1', 'a::2']);
setBaseline(dir, ['a::1']);
r = gate(dir, 'verify');
assert.strictEqual(r.status, 1, 'new failures fail a verify');
assert.deepStrictEqual(readBaseline(dir), ['a::1'], 'and the baseline is left exactly as it was');

// 90. A tolerant green still reports what it is carrying, so it never reads as a clean suite.
dir = reporterRepo(['a::1', 'a::2'], ['a::1']);
setBaseline(dir, ['a::1']);
r = gate(dir, 'verify');
assert.strictEqual(r.status, 0);
assert.ok(/1 pre-existing/.test(r.stdout + r.stderr), 'a tolerant green must still name its debt');


// 91. Each route reports on its own run. A backend route must never be judged against the
//     frontend's results, and a route with no report of its own falls back to its exit code
//     without disturbing the route beside it.
//     NOTE: deliberately no commit in this fixture. With no HEAD, treeFingerprint() returns null
//     and the green-tree cache stays off — which is what lets 92 actually run the gates instead
//     of being short-circuited by 91's green result on an identical tree.
dir = tmpRepo(JSON.stringify({
  gates: {
    test: PASS,
    testChanged: [
      { name: 'be', match: ['be/**'], cmd: 'node reporter.js "be::1" "be::1"', report: '.ristretto/report.xml' },
      { name: 'fe', match: ['fe/**'], cmd: PASS },
    ],
  },
}));
fs.writeFileSync(path.join(dir, 'reporter.js'), REPORTER_SRC);
arm(dir);
fs.mkdirSync(path.join(dir, 'be'), { recursive: true });
fs.mkdirSync(path.join(dir, 'fe'), { recursive: true });
fs.writeFileSync(path.join(dir, 'be', 'x.py'), 'x');
fs.writeFileSync(path.join(dir, 'fe', 'x.ts'), 'x');
// Only be/ and fe/ may look like changed files here: anything else is unrouted, and an unrouted
// path correctly falls back to the FULL suite — which would prove nothing about routing.
fs.writeFileSync(path.join(dir, '.gitignore'), '.ristretto/\nreporter.js\n.gitignore\n.ristretto.json\n');
spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' });
spawnSync('git', ['-C', dir, 'config', 'user.email', 't@t'], { encoding: 'utf8' });
spawnSync('git', ['-C', dir, 'config', 'user.name', 't'], { encoding: 'utf8' });
setBaseline(dir, ['be::1']);
r = gate(dir, 'full');
assert.strictEqual(r.status, 0, 'the backend failure is tolerated and the frontend route is green');
assert.ok(/1 pre-existing/.test(r.stderr));

// 92. And scoping changes WHAT runs, never whether attribution is enforced: a failure that is
//     new inside the handful of tests a route executed still blocks.
setBaseline(dir, []);
r = gate(dir, 'full');
assert.strictEqual(r.status, 2, 'a new failure in a scoped route blocks like any other');
assert.ok(r.stderr.includes('be::1'), 'and names the test that is new');


// 93. The single-command scoped form carries the report too. A repo with one runner and one
//     `testChanged` string would otherwise lose attribution the moment the loop scoped itself —
//     silently, and only on the fast path, which is the hardest place to notice anything.
dir = tmpRepo(JSON.stringify({
  gates: {
    test: PASS,
    testChanged: 'node reporter.js "s::1" "s::1"',
    testReport: '.ristretto/report.xml',
  },
}));
fs.writeFileSync(path.join(dir, 'reporter.js'), REPORTER_SRC);
fs.writeFileSync(path.join(dir, '.gitignore'), '.ristretto/\nreporter.js\n.gitignore\n.ristretto.json\n');
fs.writeFileSync(path.join(dir, 'src.js'), 'x');
spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' });
spawnSync('git', ['-C', dir, 'config', 'user.email', 't@t'], { encoding: 'utf8' });
spawnSync('git', ['-C', dir, 'config', 'user.name', 't'], { encoding: 'utf8' });
arm(dir);
setBaseline(dir, ['s::1']);
r = gate(dir, 'full');
assert.strictEqual(r.status, 0, 'a scoped single-command gate must attribute like any other');
assert.ok(/1 pre-existing/.test(r.stderr));


// 94. A report flag is not a dropped flag. The full gate and a scoped route legitimately write
//     their reports to DIFFERENT paths, because they run from different directories — the full
//     one may `cd` into a subproject first. Comparing them as if one had lost something reports
//     a gap on exactly the config this plugin now recommends, and a warning that cries wolf on
//     correct config is worse than no warning.
dir = tmpRepo(JSON.stringify({
  gates: {
    test: 'cd be && pytest -q -n auto --junitxml=../.ristretto/r.xml',
    testChanged: [{
      name: 'be',
      match: ['be/**'],
      cmd: 'pytest -q -n auto --junitxml=.ristretto/r.xml {files}',
      report: '.ristretto/r.xml',
    }],
    testReport: '.ristretto/r.xml',
  },
}));
r = gate(dir, 'verify');
assert.ok(!/missing a flag/.test(r.stderr),
  `a differing report path must not read as a dropped flag — got: ${r.stderr.slice(0, 400)}`);

// 95. And the audit must still catch a genuinely dropped one beside it.
dir = tmpRepo(JSON.stringify({
  gates: {
    test: 'pytest -q -n auto --junitxml=.ristretto/r.xml',
    testChanged: [{ name: 'be', match: ['be/**'], cmd: 'pytest -q --junitxml=.ristretto/r.xml {files}', report: '.ristretto/r.xml' }],
    testReport: '.ristretto/r.xml',
  },
}));
r = gate(dir, 'verify');
assert.ok(/missing a flag/.test(r.stderr) && /-n auto/.test(r.stderr),
  `the real dropped flag must still be named — got: ${r.stderr.slice(0, 400)}`);

// 96. The house-rule guard. Without a config ristretto is not set up here and must never
// interfere, whatever the write target is.
const write = (f) => JSON.stringify({ tool_input: { file_path: f } });
dir = tmpRepo();
assert.strictEqual(gate(dir, 'guard', write('CLAUDE.md')).status, 0,
  'guard without config must exit 0');

// 97. Armed run + a write to CLAUDE.md → refused, and the message names the file so the agent
// knows what it hit rather than guessing.
dir = tmpRepo(JSON.stringify({ gates: { lint: PASS } }));
arm(dir);
r = gate(dir, 'guard', write(path.join(dir, 'CLAUDE.md')));
assert.strictEqual(r.status, 2, 'writing CLAUDE.md while armed must be refused');
assert.ok(/CLAUDE\.md/.test(r.stderr), 'the refusal must name the file');
assert.ok(/final message/.test(r.stderr), 'and must say where the staleness goes instead');

// 98. AGENTS.md is the same rule, and a nested one is matched on its basename — the house rules
// near the files a feature touches are exactly the ones a subagent is tempted to "fix".
assert.strictEqual(gate(dir, 'guard', write('backend/sub/AGENTS.md')).status, 2,
  'a nested AGENTS.md must be refused too');

// 99. Case is not the point: on a case-insensitive filesystem `claude.md` is the same file, and
// a guard that could be stepped around by shift-key is not a guard.
assert.strictEqual(gate(dir, 'guard', write('claude.md')).status, 2,
  'the match must be case-insensitive');

// 100. Everything else passes straight through. This hook runs before EVERY Write and Edit, so
// anything but a house-rule file must cost nothing and decide nothing.
assert.strictEqual(gate(dir, 'guard', write('backend/app/main.py')).status, 0,
  'an ordinary file must not be touched by the guard');
assert.strictEqual(gate(dir, 'guard', '{}').status, 0,
  'a payload with no file_path must exit 0');

// 101. No armed run → the file is the user's own business. This is `/revise-claude-md`, and a
// guard that fired here would be a bug rather than a safeguard.
dir = tmpRepo(JSON.stringify({ gates: { lint: PASS } }));
assert.strictEqual(gate(dir, 'guard', write('CLAUDE.md')).status, 0,
  'without an armed run the guard must stay out of the way');

// 102. A marker left behind by a session that died must not lock the file forever. Same idleness
// rule the full gate uses — measured from the marker, not from the calendar.
arm(dir);
const longAgo = Date.now() / 1000 - 25 * 60 * 60;
fs.utimesSync(path.join(dir, '.ristretto', 'pulling'), longAgo, longAgo);
assert.strictEqual(gate(dir, 'guard', write('CLAUDE.md')).status, 0,
  'a stale marker must not keep the house rules locked');

// --- A silence budget above the harness watchdog is a budget nobody is alive to collect. ---
// Hang detection reads silence, and `silence` is authored per repo — so a repo whose suite is
// genuinely quiet for a quarter of an hour will be told, correctly, to raise the budget. Raising it
// past the ~600s stall watchdog buys NOTHING: the agent waiting on the gate is killed first, and a
// killed agent loses its result entirely. The gate then looks green in the log and the orchestrator
// gets `failed: no progress for 600s` on work that was complete and proven. Measured on the
// vs-ruprechtshofen brew of 2026-09-07: `silence.test` 2400, one unbroken quiet stretch of 1,008,795ms
// (PHPUnit `--no-progress`), and three subagents reported failed whose results were green.
// So the budget is bounded by what the caller can still survive, and reporting UNVERIFIED at nine
// minutes beats being killed at ten having said nothing. Exactly the rule DEFAULT_LOCK_WAIT already
// follows (check 54) — applied to the budget that actually did the killing.

// 103. A configured silence above the watchdog is not honoured: the kill lands inside the budget the
//      caller has left, so there is still somebody there to read the result.
dir = tmpRepo(JSON.stringify({ gates: { test: HANG }, silence: { test: 2400 }, watchdog: 65 }));
arm(dir);
r = gate(dir, 'full');
assert.ok(r.stderr.includes('printed nothing for 5s'),
  'a 2400s budget under a 65s watchdog must be cut to the room the caller has — got: ' + r.stderr.slice(0, 400));

// 104. And it says which key it overrode. A clamp that binds silently is the same defect one layer
//      down: the config still reads 2400, and the next person raises it again.
assert.ok(/"silence"\."test"|silence\.test/.test(r.stderr) && /2400/.test(r.stderr),
  'the override must name the configured key and value it is not honouring — got: ' + r.stderr.slice(0, 400));
assert.ok(/watchdog|killed after|stall/i.test(r.stderr),
  'and say what the ceiling is for — got: ' + r.stderr.slice(0, 400));

// 105. `verify` is exempt. It is the deliberate whole-repo run — brew's pre-flight and its final
//      pass — launched by the orchestrator and backgrounded, so no stall watchdog is counting. That
//      run is allowed to be quiet for as long as the suite honestly takes; clamping it would make a
//      slow-but-healthy suite unprovable anywhere.
const QUIET_OK = `node -e "setTimeout(()=>process.exit(0), 6000)"`;
dir = tmpRepo(JSON.stringify({ gates: { test: QUIET_OK }, silence: { test: 2400 }, watchdog: 65 }));
r = gate(dir, 'verify');
assert.strictEqual(r.status, 0,
  'verify must not be clamped — the whole-repo run has no agent watchdog to lose: ' + r.stderr.slice(0, 400));

// 106. The advice must stop offering the one move that cannot work. Once the budget is already at
//      the ceiling, "raise silence" is advice to change a number that is being ignored in the
//      caller's favour; what is left is making the gate talk, or scoping it.
dir = tmpRepo(JSON.stringify({ gates: { test: HANG }, silence: { test: 2400 }, watchdog: 65 }));
arm(dir);
r = gate(dir, 'full');
assert.ok(!/raise "silence"/.test(r.stderr),
  'at the ceiling the gate must not advise raising the budget further — got: ' + r.stderr.slice(0, 500));
assert.ok(/already at|cannot be raised|make it stream|make the gate talk|scope/i.test(r.stderr),
  'and must name what is actually left to do — got: ' + r.stderr.slice(0, 500));

// 107. Calibration cannot climb past it either. Probation doubles the rope on every silent kill and
//      QUIET_CEILING_MS is 30 minutes — three times the watchdog — so the automatic path reaches the
//      same dead end as the hand-written one, with nobody having configured anything at all.
dir = tmpRepo(JSON.stringify({ gates: { test: HANG }, silence: { test: 1 }, watchdog: 65 }));
arm(dir);
let usedSecs = [];
for (let i = 0; i < 4; i++) {
  const run = gate(dir, 'full');
  const m = /printed nothing for (\d+)s/.exec(run.stderr);
  if (m) usedSecs.push(Number(m[1]));
}
assert.strictEqual(usedSecs.length, 4, 'every run must report the budget it was killed at');
assert.ok(Math.max(...usedSecs) <= 5,
  `probation must never widen past the watchdog ceiling — got ${usedSecs.join(', ')}s`);


// 108. And the pre-flight is where it has to be said. `verify` runs its own budget uncapped, so the
//      clamp never binds there and the announcement above never fires — which would leave brew's
//      pre-flight, the one moment config is audited before a loop that will pay for it dozens of
//      times, as the only run that stays quiet about it. It audits the number instead of obeying it.
dir = tmpRepo(JSON.stringify({ gates: { test: PASS }, silence: { test: 2400 } }));
r = gate(dir, 'verify');
assert.strictEqual(r.status, 0, 'the audit reports, it does not refuse — the clamp already makes the value harmless');
assert.ok(/2400/.test(r.stderr) && /"silence"\."test"|silence\.test/.test(r.stderr),
  'verify must name an authored budget the hooks will not honour — got: ' + r.stderr.slice(0, 400));

// 109. A budget under the ceiling is not news, in any mode. An audit that fires on every healthy
//      repo is one nobody reads by the second feature.
dir = tmpRepo(JSON.stringify({ gates: { test: PASS }, silence: { test: 120 } }));
r = gate(dir, 'verify');
assert.ok(!/not being honoured|will not honour/.test(r.stderr),
  'a budget inside the ceiling must produce no audit at all — got: ' + r.stderr.slice(0, 300));

// 110. `state` reports an unarmed repo without touching anything, and never fails.
dir = tmpRepo(JSON.stringify({ gates: { test: PASS } }));
r = gate(dir, 'state');
assert.strictEqual(r.status, 0, 'state must always exit 0');
assert.ok(/pulling: not armed/.test(r.stdout), 'state must say pulling is not armed — got: ' + r.stdout);
assert.ok(/orchestrating: not armed/.test(r.stdout), 'state must report orchestrating too');
assert.ok(!fs.existsSync(path.join(dir, '.ristretto', 'pulling')), 'state must create nothing');

// 111. An armed marker is reported with its owner and how long it has been idle.
arm(dir);
fs.writeFileSync(path.join(dir, '.ristretto', 'pulling'), 'sess-aaa');
r = gate(dir, 'state', '{}', { CLAUDE_CODE_SESSION_ID: 'sess-aaa' });
assert.ok(/pulling: armed by this session/.test(r.stdout), 'own marker must read as this session — got: ' + r.stdout);

// 112. A marker from someone else says so plainly — this is the stale-marker symptom.
r = gate(dir, 'state', '{}', { CLAUDE_CODE_SESSION_ID: 'sess-bbb' });
assert.ok(/pulling: armed by ANOTHER session/.test(r.stdout), 'foreign marker must be named — got: ' + r.stdout);

// 113. Leftover build plans are named — a new run must be able to see what a dead one left.
fs.mkdirSync(path.join(dir, '.ristretto', 'build'), { recursive: true });
fs.writeFileSync(path.join(dir, '.ristretto', 'build', 'BREW-9.md'), 'x');
r = gate(dir, 'state');
assert.ok(/BREW-9/.test(r.stdout), 'state must name leftover build plans — got: ' + r.stdout);

// 114. `.ristretto/` collects more than gate.js writes — subagent logs, junit dumps, scratch
//      scripts. Files gate.js knows about (including every configured report path) must not be
//      called out; everything else must be, by name, so a pre-flight actually shows what a dead
//      run left rather than only the slice gate.js recognises.
fs.writeFileSync(path.join(dir, '.ristretto', 'gate-green'), 'deadbeef');
fs.writeFileSync(path.join(dir, '.ristretto', 'scratch.log'), 'x');
r = gate(dir, 'state');
assert.ok(/unrecognised/.test(r.stdout), 'state must call out files it does not own — got: ' + r.stdout);
assert.ok(r.stdout.includes('scratch.log'), 'the unrecognised file must be named — got: ' + r.stdout);
assert.ok(!r.stdout.includes('gate-green'), 'a file gate.js owns must not be reported as unrecognised — got: ' + r.stdout);

// 115. `state` must run even when `.ristretto.json` is absent — the global constraint from the
//      brief. The second config-read (the try/catch around JSON.parse) must not fall through to
//      exit(0) before `state` gets to print anything.
dir = tmpRepo(); // tmpRepo() with no argument writes no .ristretto.json at all
r = gate(dir, 'state');
assert.strictEqual(r.status, 0, 'state without a config file must exit 0');
assert.ok(/pulling: not armed/.test(r.stdout),
  'state without a config file must still report — got stdout: ' + JSON.stringify(r.stdout) + ' stderr: ' + JSON.stringify(r.stderr));

// 116. An unclaimed marker (armed, but no session has touched it yet) reads as a sentence, not
//      as "armed by unclaimed" — and idle time is rendered in the largest sensible unit rather
//      than raw seconds.
dir = tmpRepo(JSON.stringify({ gates: { test: PASS } }));
arm(dir); // writes an empty marker — unclaimed
const oldMtime = new Date(Date.now() - 6 * 60 * 60 * 1000); // 6h ago
fs.utimesSync(path.join(dir, '.ristretto', 'pulling'), oldMtime, oldMtime);
r = gate(dir, 'state');
assert.ok(/pulling: armed, unclaimed/.test(r.stdout), 'unclaimed marker must read as a sentence — got: ' + r.stdout);
assert.ok(!/armed by unclaimed/.test(r.stdout), '"armed by unclaimed" is not a sentence — got: ' + r.stdout);
assert.ok(/\b6h ago\b/.test(r.stdout), 'a 6-hour-old marker must render in hours, not raw seconds — got: ' + r.stdout);
assert.ok(!/21600s ago/.test(r.stdout), 'idle time must not be printed as raw seconds once it is this large — got: ' + r.stdout);

// 117. `arm` creates the marker and stamps it with this session.
dir = tmpRepo(JSON.stringify({ gates: { test: PASS } }));
r = gate(dir, 'arm', '{}', { CLAUDE_CODE_SESSION_ID: 'sess-aaa' });
assert.strictEqual(r.status, 0, 'arm must exit 0');
assert.strictEqual(fs.readFileSync(path.join(dir, '.ristretto', 'pulling'), 'utf8').trim(), 'sess-aaa',
  'arm must stamp the marker with the session');

// 118. `arm orchestrator` additionally creates the orchestrating marker.
r = gate(dir, 'arm', '{}', { CLAUDE_CODE_SESSION_ID: 'sess-aaa' }, 'orchestrator');
assert.ok(fs.existsSync(path.join(dir, '.ristretto', 'orchestrating')), 'arm orchestrator must create it');

// 119. `arm` in the SAME session is idempotent — "the API died, I fire again" must just work.
r = gate(dir, 'arm', '{}', { CLAUDE_CODE_SESSION_ID: 'sess-aaa' });
assert.strictEqual(r.status, 0, 'arming twice in one session must not fail');

// 120. `arm` never refuses over a foreign marker — it takes over and says so.
r = gate(dir, 'arm', '{}', { CLAUDE_CODE_SESSION_ID: 'sess-ccc' });
assert.strictEqual(r.status, 0, 'arm must never refuse');
assert.strictEqual(fs.readFileSync(path.join(dir, '.ristretto', 'pulling'), 'utf8').trim(), 'sess-ccc',
  'arm must take the marker over');
assert.ok(/taking it over|another session/i.test(r.stderr), 'a takeover must be said out loud — got: ' + r.stderr);

// 121. `arm` works even with no `.ristretto.json` at all — same exemption as `state`. A first
//      `arm` in a repo that has not run `prep` yet must not be refused for lack of config.
dir = tmpRepo(); // no .ristretto.json
r = gate(dir, 'arm', '{}', { CLAUDE_CODE_SESSION_ID: 'sess-fresh' });
assert.strictEqual(r.status, 0, 'arm without a config file must exit 0');
assert.strictEqual(fs.readFileSync(path.join(dir, '.ristretto', 'pulling'), 'utf8').trim(), 'sess-fresh',
  'arm without a config file must still stamp the marker');

// 122. A gate run from a FOREIGN session does not gate — the stale-marker bug.
dir = tmpRepo(JSON.stringify({ gates: { lint: FAIL } }));
fs.mkdirSync(path.join(dir, '.ristretto'), { recursive: true });
fs.writeFileSync(path.join(dir, '.ristretto', 'pulling'), 'sess-owner');
r = gate(dir, 'full', JSON.stringify({ session_id: 'sess-stranger' }));
assert.strictEqual(r.status, 0, 'a foreign session must not be gated by someone else\'s marker');

// 123. …and it must not refresh the marker either. The wrong gating kept it alive before.
const before = fs.statSync(path.join(dir, '.ristretto', 'pulling')).mtimeMs;
gate(dir, 'full', JSON.stringify({ session_id: 'sess-stranger' }));
assert.strictEqual(fs.statSync(path.join(dir, '.ristretto', 'pulling')).mtimeMs, before,
  'a foreign session must never refresh the marker');

// 124. The OWNING session is gated normally.
r = gate(dir, 'full', JSON.stringify({ session_id: 'sess-owner' }));
assert.strictEqual(r.status, 2, 'the owning session must still be gated by a failing gate');

// 125. An unclaimed marker is claimed by the first hook that sees it, then gates.
dir = tmpRepo(JSON.stringify({ gates: { lint: FAIL } }));
arm(dir); // writes an empty marker, as `arm` does when no session id is available
r = gate(dir, 'full', JSON.stringify({ session_id: 'sess-first' }));
assert.strictEqual(r.status, 2, 'an unclaimed marker must gate the session that claims it');
assert.strictEqual(fs.readFileSync(path.join(dir, '.ristretto', 'pulling'), 'utf8').trim(), 'sess-first',
  'the first hook must claim the marker');

// 126. `disarm` removes every file a run created — one list, one place — but never build/.
dir = tmpRepo(JSON.stringify({ gates: { test: PASS } }));
fs.mkdirSync(path.join(dir, '.ristretto', 'build'), { recursive: true });
for (const f of ['pulling', 'orchestrating', 'gate-retries', 'gate-stalled']) {
  fs.writeFileSync(path.join(dir, '.ristretto', f), '');
}
fs.writeFileSync(path.join(dir, '.ristretto', 'build', 'BREW-9.md'), 'x');
r = gate(dir, 'disarm');
assert.strictEqual(r.status, 0, 'disarm must exit 0');
for (const f of ['pulling', 'orchestrating', 'gate-retries', 'gate-stalled']) {
  assert.ok(!fs.existsSync(path.join(dir, '.ristretto', f)), `disarm must remove ${f}`);
}
assert.ok(fs.existsSync(path.join(dir, '.ristretto', 'build', 'BREW-9.md')),
  'disarm must NOT touch build/ — a plan the user paid for outlives the run');

// 127. `disarm` on an already-clean repo is not an error.
assert.strictEqual(gate(dir, 'disarm').status, 0, 'disarm must be idempotent');

// 128. `guard` is ownership-aware too, same rule as `full`: a marker owned by another session
//      does not guard this one.
dir = tmpRepo(JSON.stringify({ gates: { lint: PASS } }));
arm(dir);
fs.writeFileSync(path.join(dir, '.ristretto', 'pulling'), 'sess-owner');
r = gate(dir, 'guard', JSON.stringify({ tool_input: { file_path: 'CLAUDE.md' }, session_id: 'sess-stranger' }));
assert.strictEqual(r.status, 0, 'a foreign session must not be guarded by someone else\'s marker');

// 129. …but the owner is still guarded.
r = gate(dir, 'guard', JSON.stringify({ tool_input: { file_path: 'CLAUDE.md' }, session_id: 'sess-owner' }));
assert.strictEqual(r.status, 2, 'the owning session must still be guarded from writing house rules');

// 130. `arm` fails loudly, not silently, when it cannot write the marker — a swallowed error here
//      would leave a run believing it is armed while the gates are off. Make `pulling` a directory
//      so `writeFileSync` fails the same way (EISDIR) on every platform.
dir = tmpRepo(JSON.stringify({ gates: { test: PASS } }));
fs.mkdirSync(path.join(dir, '.ristretto', 'pulling'), { recursive: true });
r = gate(dir, 'arm', '{}', { CLAUDE_CODE_SESSION_ID: 'sess-aaa' });
assert.strictEqual(r.status, 1, 'arm must exit 1 when it cannot write the marker');
assert.ok(r.stderr.includes('could not arm') && r.stderr.includes(path.join(dir, '.ristretto', 'pulling')),
  'arm must name the unwritable path — got: ' + r.stderr);

// --- `prove`: one gate run instead of two. ---
// The agent's own final proof, run inside its own turn instead of paid for again in the silence
// after it. Same lock, same scoped gate list, same budgets as the SubagentStop hook — so a hook
// that follows finds the tree already proven and does nothing.

// 131. `prove` runs the gates, exits 0 green, and writes the fingerprint so the hook is free.
dir = gitTmpRepo(JSON.stringify({ gates: { lint: PASS, test: PASS } }));
arm(dir);
r = gate(dir, 'prove');
assert.strictEqual(r.status, 0, 'prove must exit 0 when the gates pass');
assert.ok(fs.existsSync(path.join(dir, '.ristretto', 'gate-green')), 'prove must write the fingerprint');

// 132. And the SubagentStop hook that follows must find it proven and do nothing.
const provenAt = fs.statSync(path.join(dir, '.ristretto', 'gate-green')).mtimeMs;
r = gate(dir, 'full', JSON.stringify({ session_id: '' }), {}, 'subagent');
assert.strictEqual(r.status, 0, 'the hook after prove must exit 0');
assert.strictEqual(fs.statSync(path.join(dir, '.ristretto', 'gate-green')).mtimeMs, provenAt,
  'the hook must skip entirely, not re-run and rewrite the fingerprint');

// 133. `prove` reports red with exit 1 — never 2. It informs its caller; it does not block a stop.
//      And it never touches the retry budget: that belongs to the hook, not to a one-shot proof.
dir = tmpRepo(JSON.stringify({ gates: { lint: FAIL } }));
arm(dir);
r = gate(dir, 'prove');
assert.strictEqual(r.status, 1, 'prove must exit 1 on a red gate, never 2');
assert.ok(!fs.existsSync(path.join(dir, '.ristretto', 'gate-green')), 'a red prove must not write a fingerprint');
assert.ok(!fs.existsSync(path.join(dir, '.ristretto', 'gate-retries')), 'prove must never touch the retry budget');

// 134. `prove` uses the SCOPED test gate, like the hook does — not the full suite like `verify`.
//      A brew that paid for a repo-wide run per feature is the cost this whole design avoids.
dir = gitTmpRepo(JSON.stringify({ gates: { test: FULL, testChanged: SCOPED } }));
arm(dir);
fs.writeFileSync(path.join(dir, 'src.txt'), 'touched');
r = gate(dir, 'prove');
assert.strictEqual(r.status, 0, 'prove must exit 0 when the scoped gate passes');
assert.strictEqual(trace(dir), 's', 'prove must run the scoped gate, not the full test gate');

// 135. A stalled gate makes `prove` UNVERIFIED — exit 3, never 0 (which would claim a proof it
//      never made) and never 1 (which would send the caller hunting a defect that may not exist).
//      It prints the same hang advice the hook prints, and writes no fingerprint.
dir = tmpRepo(JSON.stringify({ gates: { test: STALL }, silence: { test: 1 } }));
arm(dir);
r = gate(dir, 'prove');
assert.strictEqual(r.status, 3, 'a stalled prove must exit 3 — not 0 and not 1');
assert.ok(r.stderr.includes('printed nothing for 1s'), 'prove must print the same hang advice the hook prints');
assert.ok(!fs.existsSync(path.join(dir, '.ristretto', 'gate-green')), 'a stalled prove must write no fingerprint');
assert.ok(!fs.existsSync(path.join(dir, '.ristretto', 'gate-retries')), 'a stalled prove must never touch the retry budget');

// 136. A lock `prove` cannot obtain is the other UNVERIFIED case — a collision must not look like
//      a defect, and must not claim a proof that never ran.
dir = tmpRepo(JSON.stringify({ gates: { test: PASS }, lockWait: 1 }));
fs.mkdirSync(path.join(dir, '.ristretto'), { recursive: true });
fs.writeFileSync(path.join(dir, '.ristretto', 'gate-lock'),
  JSON.stringify({ pid: process.pid, label: 'a full suite', at: Date.now() }));
r = gate(dir, 'prove');
assert.strictEqual(r.status, 3, 'a prove that cannot get the lock must exit 3, not 0 and not 1');
assert.ok(!fs.existsSync(path.join(dir, '.ristretto', 'gate-green')), 'an unlocked prove must write no fingerprint');
assert.ok(!fs.existsSync(path.join(dir, '.ristretto', 'gate-retries')), 'an unlocked prove must never touch the retry budget');

// 137. `prove` in a repo with no ristretto config has nothing to prove — say so and exit 0, same
//      as every other command that finds ristretto not set up here.
dir = tmpRepo();
r = gate(dir, 'prove');
assert.strictEqual(r.status, 0, 'prove with no config must exit 0 — nothing is set up to prove');

// --- Fix round 1: findings from review of the runGates extraction. ---

// 138. skipIfProven: once the lock is ours, `prove` rechecks the fingerprint against gate-green
//      before running anything — under brew this is the ORDINARY case, a reviewer/closer stacked
//      behind a sibling run on an unchanged tree. `verify` deliberately never takes this path
//      (see check 37): a direct `verify` always re-runs for real, cache or not.
//      A genuine "the holder proves it while we queue for the lock" race needs a second live
//      process to reproduce, and this file's `gate()` fixture is synchronous — it cannot hold a
//      contended lock open while writing gate-green from the same test. So this proves the option
//      itself on the case `prove` always takes when it starts on an already-proven tree: unlike
//      `full`, `prove` has no pre-lock fingerprint check of its own, so the ONLY thing that can
//      skip the gate here is the check inside runGates.
dir = gitTmpRepo(JSON.stringify({ gates: { test: COUNT } }));
arm(dir);
assert.strictEqual(gate(dir, 'full').status, 0, 'the first full run must execute and prove the tree');
assert.strictEqual(runs(dir), 1, 'the first full run must have run the gate once');
r = gate(dir, 'prove');
assert.strictEqual(r.status, 0, 'prove on an already-proven tree must exit 0');
assert.strictEqual(runs(dir), 1, 'prove must NOT re-run the gate once the tree is already proven');

// 139. And `verify` — off by design — still re-runs on that same already-proven tree, matching
//      check 37's "a plain verify always re-runs" guarantee.
r = gate(dir, 'verify');
assert.strictEqual(r.status, 0);
assert.strictEqual(runs(dir), 2, 'a direct verify must re-run even though the tree is already proven green');

// 140. recordQuiet fires on the gate command's own clean exit, in every mode — even when
//      attribution then blocks the run. The silence budget measures the TOOL's behaviour, not
//      the verdict it produced: gating this on the verdict left every report-attributed gate
//      permanently uncalibrated as long as the repo carried so much as one tolerated failure,
//      which is the common case, not the rare one. (Old `verify` recorded unconditionally on
//      `result === null`; the extraction had narrowed that to only a fully passing gate.)
dir = tmpRepo(JSON.stringify({ gates: { test: 'node writer.js', testReport: '.ristretto/report.xml' } }));
fs.writeFileSync(path.join(dir, 'writer.js'), `
const fs = require('fs');
fs.mkdirSync('.ristretto', { recursive: true });
fs.writeFileSync('.ristretto/report.xml',
  '<testsuites><testsuite><testcase classname="a" name="1"><failure message="x">boom</failure></testcase></testsuite></testsuites>');
process.exit(0);
`);
arm(dir);
setBaseline(dir, []); // no pre-existing failures, so a::1 reads as NEW and blocks
r = gate(dir, 'full');
assert.strictEqual(r.status, 2, 'a NEW failure in the report must block even though the command itself exited 0');
const quietAfterBlock = JSON.parse(fs.readFileSync(path.join(dir, '.ristretto', 'gate-quiet.json'), 'utf8'));
assert.ok(Number.isFinite(quietAfterBlock.test),
  'recordQuiet must fire on a clean process exit even when attribution then blocks the run');

// 141. A blocking gate's attribution lines are printed exactly once — via the failures text, not
//      also eagerly. `runGates` printed unconditionally whenever there were new or tolerated
//      failures, and then again through `failures`, so a NEW failure showed up twice in stderr.
//      (Old `full` had exactly this duplicate before the extraction too; removing it there was
//      intended, not a new regression.) A PASS that tolerates something still prints its line
//      once, eagerly — nothing else would ever surface it.
dir = reporterRepo(['a::1', 'a::2'], ['a::1', 'a::2']);
arm(dir);
setBaseline(dir, ['a::1']);
r = gate(dir, 'full');
assert.strictEqual(r.status, 2, 'a new failure still blocks');
const headerCount = (r.stderr.match(/NEW test failure/g) || []).length;
assert.strictEqual(headerCount, 1,
  'the NEW-failure attribution must be printed exactly once, not eagerly and again via the failures text');

// 142. `prove` on a broken/unparseable config is UNVERIFIED (3), never the generic exit 0 an
//      implementer running `prove` as its final proof would otherwise read as green.
dir = tmpRepo('{not json');
r = gate(dir, 'prove');
assert.strictEqual(r.status, 3, 'a broken config must leave prove UNVERIFIED (3), not green (0) or red (1)');
assert.ok(r.stderr.includes('.ristretto.json'), 'the error must name the config file — got: ' + r.stderr.slice(0, 200));
assert.ok(!fs.existsSync(path.join(dir, '.ristretto', 'gate-green')), 'a broken config must not let prove write a fingerprint');

// --- Task 5: four config detections `verify` (and the `full` hook) can name for themselves. ---

// 143. A format gate with no formatPaths rewrites files it does not own. Say so.
dir = tmpRepo(JSON.stringify({ gates: { format: PASS, test: PASS } }));
r = gate(dir, 'verify');
assert.ok(/formatPaths/.test(r.stderr), 'an unscoped formatter must be named — got: ' + r.stderr.slice(0, 300));

// 144. A slow suite with no testChanged is what makes a batch never finish. The hint reads a
//      wall-clock DURATION recorded by runGates on this very run (not observedQuiet['test'], the
//      longest silent GAP of a green run — on a chatty ten-minute suite that reads ~1s and never
//      fires). `verify` calls the audit after its gate loop, so it sees the number this run just
//      recorded rather than only a stale one from whichever run happened to go last.
dir = tmpRepo(JSON.stringify({ gates: { test: SLOW } })); // SLOW talks for ~3s
r = gate(dir, 'verify', '{}', { RISTRETTO_SLOW_TEST_MS: '1' }); // threshold override for the test
assert.ok(/testChanged/.test(r.stderr), 'a slow suite with no scoping must be named — got: ' + r.stderr.slice(0, 300));

// 145. A flag that silences the runner deletes the only evidence a slow gate is alive.
dir = tmpRepo(JSON.stringify({ gates: { test: 'pytest -q --no-progress' } }));
r = gate(dir, 'verify');
assert.ok(/silence|quiet|--no-progress|-q\b/.test(r.stderr), 'a silencing flag must be named — got: ' + r.stderr.slice(0, 300));

// 146. Paths matching no route fall back to the full suite. That is safe but slow, and it is
//      invisible — the pre-flight is where it costs nothing to hear about it. Needs a real git
//      repo: the check reads dirtyPaths(), which is null (and so reports nothing) outside one.
dir = gitTmpRepo(JSON.stringify({
  gates: { test: PASS, testChanged: [{ name: 'be', match: ['backend/**'], cmd: PASS }] },
}));
fs.writeFileSync(path.join(dir, 'frontend.txt'), 'untracked, and matches no route');
r = gate(dir, 'verify');
assert.ok(/route|uncovered|falls back/i.test(r.stderr), 'route gaps must be reported at pre-flight — got: ' + r.stderr.slice(0, 400));

// 147. The three static checks (formatPaths, silencing flags, route gaps) are pre-flight advice,
//      not hook noise — the amendment the controller's ruling restored after the "one shared
//      audit" merge made them fire on every green subagent stop too. A green `full` stop must stay
//      silent about a missing formatPaths; `verify` on the same config still names it.
dir = tmpRepo(JSON.stringify({ gates: { format: PASS, test: PASS } }));
arm(dir);
r = gate(dir, 'full');
assert.strictEqual(r.status, 0, 'green gates while armed must exit 0');
assert.ok(!/formatPaths/.test(r.stderr),
  'the hook must not repeat the formatPaths advice on every green stop — got: ' + r.stderr.slice(0, 300));

r = gate(dir, 'verify');
assert.ok(/formatPaths/.test(r.stderr), 'verify must still name the missing formatPaths — got: ' + r.stderr.slice(0, 300));

// 148. `verify cached` short-circuits before the post-loop auditConfig call, so a resumed batch
//      that keeps hitting cache would otherwise never hear a missing formatPaths at all. The three
//      static checks now run before that short-circuit too, and the cached-green verdict must still
//      stand.
dir = gitTmpRepo(JSON.stringify({ gates: { format: PASS, test: COUNT } }));
assert.strictEqual(gate(dir, 'verify').status, 0, 'the first verify must run and pass');
assert.strictEqual(runs(dir), 1, 'the first verify must actually execute the suite');
r = gate(dir, 'verify', '{}', {}, 'cached');
assert.strictEqual(r.status, 0, 'a cache hit missing formatPaths must still exit 0');
assert.strictEqual(runs(dir), 1, 'a cache hit must not re-run the suite');
assert.ok(r.stdout.includes('cached green'), 'a cache hit must still say it was cached');
assert.ok(/formatPaths/.test(r.stderr), 'a cache hit must still name the missing formatPaths — got: ' + r.stderr.slice(0, 300));

// 149. A subagent that finishes by calling SubagentHandback ends its turn on a tool result, and
//      Claude Code discards a SubagentStop block on such a turn (2.1.294: "Stop hook block
//      discarded (turn ended by tool result, no model re-invoke)"). The hand-back itself must be
//      gated: hooks.json routes PreToolUse on SubagentHandback through the subagent gate, and a red
//      gate on that payload exits 2, which refuses the hand-back and sends the agent back to work.
const hooksJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf8'));
const handback = (hooksJson.hooks.PreToolUse || []).find((h) => new RegExp(`^(?:${h.matcher})$`).test('SubagentHandback'));
assert.ok(handback, 'hooks.json must run a PreToolUse hook on SubagentHandback');
assert.ok(handback.hooks.some((x) => /gate\.js" full subagent$/.test(x.command)), 'the SubagentHandback hook must run the subagent gate — got: ' + JSON.stringify(handback.hooks));
assert.ok(!(hooksJson.hooks.PreToolUse || []).some((h) => h !== handback && new RegExp(`^(?:${h.matcher})$`).test('SubagentHandback')), 'only one PreToolUse entry may match SubagentHandback');
dir = tmpRepo(JSON.stringify({ gates: { lint: FAIL } }));
arm(dir);
r = gate(dir, 'full', JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', agent_id: 'a1' }), {}, 'subagent');
assert.strictEqual(r.status, 2, 'a red gate on a hand-back must exit 2 — got exit ' + r.status + ': ' + r.stderr.slice(0, 300));
assert.ok(r.stderr.includes("gate 'lint' FAILED"), 'the refusal must name the failing gate — got: ' + r.stderr.slice(0, 300));

// --- The suite verdict the board reads (.ristretto/suite.json). ---
{
  const suite = (d) => JSON.parse(fs.readFileSync(path.join(d, '.ristretto', 'suite.json'), 'utf8'));
  const g = (d, args) => spawnSync('git', args, { cwd: d, encoding: 'utf8' }).stdout.trim();

  // A green verify records the head and the tree it proved — uncommitted work included, from a
  // copy of the index, so the user's own index is never touched.
  dir = gitTmpRepo(JSON.stringify({ gates: { test: PASS } }));
  fs.writeFileSync(path.join(dir, 'src.txt'), 'v2, not yet committed');
  assert.strictEqual(gate(dir, 'verify').status, 0, 'verify must pass');
  let s = suite(dir);
  assert.strictEqual(s.verdict, 'green');
  assert.strictEqual(s.head, g(dir, ['rev-parse', 'HEAD']), 'suite.json must name the head it proved');
  assert.match(s.tree, /^[0-9a-f]{40}$/);
  assert.notStrictEqual(s.tree, g(dir, ['rev-parse', 'HEAD^{tree}']), 'the tree must include the uncommitted change');
  assert.strictEqual(g(dir, ['diff', '--cached', '--name-only']), '', "the user's index must stay untouched");
  assert.ok(Math.abs(s.at - Date.now()) < 60000);
  // The index copy lives in the git dir (it must never land in the tree it describes) and is gone after.
  assert.ok(!fs.existsSync(path.join(dir, '.git', 'ristretto-suite-index')), 'the index copy must be removed');
  assert.ok(!fs.existsSync(path.join(dir, '.ristretto', 'suite-index')), 'and never written into the work tree');
  // Committing exactly what was proved keeps the same tree: the verdict still holds after the closer commits.
  g(dir, ['add', '-A']);
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'v2'], { cwd: dir });
  assert.strictEqual(g(dir, ['rev-parse', 'HEAD^{tree}']), s.tree, 'the proved tree must equal the committed one');

  // A cached green is recorded too, and says so.
  gate(dir, 'verify');
  assert.strictEqual(gate(dir, 'verify', '{}', {}, 'cached').status, 0);
  s = suite(dir);
  assert.strictEqual(s.verdict, 'green');
  assert.strictEqual(s.cached, true, 'a cached verdict must say it was cached');

  // Red names the failing gate; disarm keeps the verdict (it outlives the run).
  dir = gitTmpRepo(JSON.stringify({ gates: { test: FAIL } }));
  assert.strictEqual(gate(dir, 'verify').status, 1, 'a red verify must exit 1');
  s = suite(dir);
  assert.strictEqual(s.verdict, 'red');
  assert.ok(s.failing.length > 0, 'a red verdict must name what failed');
  gate(dir, 'disarm');
  assert.ok(fs.existsSync(path.join(dir, '.ristretto', 'suite.json')), 'disarm must keep suite.json');

  // A SHA-256 repository: its 64-hex tree is recorded too.
  {
    const d = tmpRepo(JSON.stringify({ gates: { test: PASS } }));
    fs.writeFileSync(path.join(d, '.gitignore'), '.ristretto/\n');
    fs.writeFileSync(path.join(d, 'src.txt'), 'v1');
    const init = spawnSync('git', ['init', '-q', '--object-format=sha256'], { cwd: d, encoding: 'utf8' });
    if (init.status === 0) {
      spawnSync('git', ['add', '-A'], { cwd: d });
      spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: d });
      assert.strictEqual(gate(d, 'verify').status, 0);
      const s256 = suite(d);
      assert.match(s256.tree, /^[0-9a-f]{64}$/, 'a SHA-256 tree is kept, not dropped');
      assert.match(s256.head, /^[0-9a-f]{64}$/);
    }
  }

  // Outside git the verdict is still recorded, with no head or tree to prove it by.
  dir = tmpRepo(JSON.stringify({ gates: { test: PASS } }));
  assert.strictEqual(gate(dir, 'verify').status, 0);
  s = suite(dir);
  assert.deepStrictEqual([s.verdict, s.head, s.tree], ['green', null, null]);
}

console.log('gate.test.js: all checks passed');
