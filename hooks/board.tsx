import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, BoardAtWork, BoardLive, BoardPins, BoardPrep, BoardRecord, BoardRepo, BoardRole, BoardRun, BoardStarted, BoardStatus } from '../types'
import { EMPTY_BOARD, commandOf, duration, fold, formatOf, mainRoleOf, markerState, plain, parseBrief, parseReport, parseRoadmap, reportText, signalOf } from './board-model.mjs'
import { EMPTY_PINS, foldPins, pinsOf } from './board-pins.mjs'
import { BASES, ago, baseArgs, branchOf, defaultBranch, featureIdOf, headArgs, isDocs, logArgs, parseBase, parseLog, shortHeadArgs, suiteArgs, suiteOf } from './board-branch.mjs'
import { phaseLock } from './board-svg.mjs'
import { parseChecks, parseDecisions, parsePlan, siblingOf } from './board-plan.mjs'
import { addGate, addRole, addTokens, closeRole, endRun, keep, markPhase, spawnModel, track } from './board-runs.mjs'
import { endedOf, judge, needsBeat, recordOf, sameShown } from './board-atwork.mjs'
import { messageOf, storyOf } from './board-timeline.mjs'
import { chipOf, modeOf, viewOf } from './board-modes.mjs'
import { BRASS, STEP_INK, chip as chipSvg, header, meter, rail, stepWord } from './board-look.mjs'

// The roadmap board, the Timeline (spec 2026-11-09): a read-only view of one repo, or of every
// direct subfolder of the session's folder that holds a roadmap. The branch decides the view: off
// its base, a repo tells its branch's story; on its base, only what is open. It observes and never
// answers: every hook passes its event on unchanged, and the board starts nothing (the person acts
// in the chat). Decisions live in board-timeline.mjs; this module reads, keeps state and draws.
//
// The session doing a pull leaves its run in that repo's .ristretto/at-work.json (gitignored), so
// the board in the folder's chat can show what each repo session pulls. That file is written on a
// shown change and, at most once a minute, as a heartbeat: never an atom, so it redraws nothing.
//
// How it draws (the desktop, measured; spec 0.2): only when something changes, never on a timer.
// A drawing never reads the clock (the engine redraws a drawing that did, every few seconds, and
// every redraw rebuilds every image and resets every hover): handlers stamp the time they changed
// what is shown in `drawnAt`, running times are SVG clocks that count up by themselves, and the
// animated images are phase-locked to that stamp.

const PANE = 'ristretto-board'
const ROADMAP = 'docs/ristretto/roadmap.md'
const MARKER = '.ristretto/pulling'
const SUITE = '.ristretto/suite.json'
const AT_WORK = '.ristretto/at-work.json'

const repos = atom({ plugin: 'ristretto', key: 'repos' } as const, [] as BoardRepo[])
// The roadmap statuses of sibling folders a single repo's plans name (`api/<id>`).
const siblings = atom({ plugin: 'ristretto', key: 'siblings' } as const, {} as Record<string, Record<string, BoardStatus>>)
// This session's own run as it last wrote it: the drawing shows it over its own file.
const ownRec = atom({ plugin: 'ristretto', key: 'ownRec' } as const, null as BoardAtWork | null)
const live = atom({ plugin: 'ristretto', key: 'live' } as const, null as BoardLive | null)
// The run in progress, counted as it goes (tokens, gate time): the drawing never reads it, so a
// token count never redraws the pane. `started` is what the drawing needs of it.
const run = atom({ plugin: 'ristretto', key: 'run' } as const, null as BoardRun | null)
const started = atom({ plugin: 'ristretto', key: 'started' } as const, null as BoardStarted | null)
const runs = atom({ plugin: 'ristretto', key: 'runs' } as const, [] as BoardRecord[])
const roles = atom({ plugin: 'ristretto', key: 'roles' } as const, {} as Record<string, BoardRole[]>)
const drawnAt = atom({ plugin: 'ristretto', key: 'drawnAt' } as const, 0)
// v1: prep running in this session, and what its answers pinned (spec 2026-11-20).
const prep = atom({ plugin: 'ristretto', key: 'prep' } as const, null as BoardPrep | null)
const pins = atom({ plugin: 'ristretto', key: 'pins' } as const, EMPTY_PINS as BoardPins)

let timers: { cancel: () => void }[] = []
let storeKey = ''
let sessionId = ''
let version = ''
let pluginFormat = ''
let rootName = ''
// The session's own repo, when its root holds a roadmap; null at a folder of repos.
let ownRoot: string | null = null
let roots: { folder: string | null; root: string }[] = []
// What this session last wrote to its own at-work file.
let lastRec: BoardAtWork | null = null

type Raw = { rec: BoardAtWork | null; owner: string | null; marker: boolean }
type Kept = { sig: string; rawSig: string; repo: BoardRepo; raw: Raw; gitDir?: string | null; baseLog?: string | null; sibs: Record<string, Record<string, BoardStatus>> }
// Per repo root: what was read and the signature it was read at.
const cache = new Map<string, Kept>()

// The time the handler that changed what is shown changed it: what a drawing counts its clocks
// and phase-locks its animations from.
async function stamp($: EngineInterface) {
  const now = await $.clock.now()
  await update($, drawnAt, () => now)
}

// A value the drawing reads is written only when it changed, and the change stamped: a poll
// that finds nothing new redraws nothing. (The engine lists each module's reads and writes from
// the call sites, so every read and update names its value there.)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// Whether the pane is open, for the chip's toggle; never drawn, so it redraws nothing.
const paneOpen = atom({ plugin: 'ristretto', key: 'paneOpen' } as const, false)

async function openPane($: EngineInterface) {
  await $.ui.open({ id: PANE, title: 'ristretto' })
  await update($, paneOpen, () => true)
}

async function closePane($: EngineInterface) {
  await $.ui.close({ id: PANE })
  await update($, paneOpen, () => false)
}

async function mtime($: EngineInterface, p: string) {
  try {
    return (await $.fs.exists(p)) ? String((await $.fs.stat(p)).mtimeMs) : '-'
  } catch {
    return '-'
  }
}

// The plans' mtimes in roadmap order: a box ticked in a plan redraws the board.
async function planSig($: EngineInterface, root: string, rows: { plan: string }[]) {
  const parts: string[] = []
  for (const row of rows) if (row.plan) parts.push(await mtime($, `${root}/docs/ristretto/${row.plan}`))
  return parts.join(',')
}

// A repo's roadmap and what every plan says, its manual checks and decisions with it. A plan that
// cannot be read is simply absent. A blocked row with no reason in the roadmap says why from its
// plan's Blockers. Paths are absolute: a shell `cd` in the session never moves them.
async function readBoardAt($: EngineInterface, root: string, name: string): Promise<Board> {
  try {
    if (!(await $.fs.exists(`${root}/${ROADMAP}`))) return { ...EMPTY_BOARD, name, error: 'no-roadmap' }
    const parsed = parseRoadmap(String(await $.fs.read(`${root}/${ROADMAP}`)))
    const plans: Board['plans'] = {}
    const checks: Board['checks'] = {}
    const decisions: Board['decisions'] = {}
    for (const row of parsed.rows) {
      if (!row.plan) continue
      try {
        const text = String(await $.fs.read(`${root}/docs/ristretto/${row.plan}`))
        checks[row.id] = parseChecks(text) as Board['checks'][string]
        decisions[row.id] = parseDecisions(text) as Board['decisions'][string]
        plans[row.id] = parsePlan(text) as Board['plans'][string]
      } catch {
        // The opened row says its plan was not found.
      }
      if (row.status === 'blocked' && !row.reason) row.reason = plans[row.id]?.blockers[0] ?? ''
    }
    return { name, rows: parsed.rows, format: { project: parsed.format, plugin: pluginFormat }, error: parsed.error, plans, checks, decisions }
  } catch (err) {
    return { ...EMPTY_BOARD, name, error: String(err).slice(0, 80) }
  }
}

// git in a repo, by argv: never a shell.
async function git($: EngineInterface, args: string[], cwd: string) {
  try {
    return await $.process.run(['git', ...args], { cwd })
  } catch {
    return { exitCode: 1, stdout: '', stderr: '' }
  }
}

// The branch, its base and the features on it (spec 4.1–4.3), and how old the branch is (its
// oldest commit off the base). Not a git repo: no branch.
async function readBranchAt($: EngineInterface, root: string, rows: { id: string }[], runList: BoardRecord[], kept: Partial<Kept>) {
  // A folder that is not its own repo: git would walk up and answer with the parent's branch.
  const top = await git($, ['rev-parse', '--show-toplevel'], root)
  const norm = (p: string) => p.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  if (top.exitCode !== 0 || norm(top.stdout) !== norm(root)) return { branch: null, age: null, head: null as string | null }
  const at = await git($, headArgs, root)
  if (at.exitCode !== 0) return { branch: null, age: null, head: null as string | null }
  let head = at.stdout.trim()
  if (head === 'HEAD') head = (await git($, shortHeadArgs, root)).stdout.trim() || 'HEAD'
  const origin = await git($, baseArgs.originHead, root)
  const listed = await git($, baseArgs.refs, root)
  const originHead = origin.exitCode === 0 ? origin.stdout : ''
  const refs = listed.exitCode === 0 ? listed.stdout : ''
  // Whether local main is behind origin/main: refs from git's own output, never an option.
  const have = new Set(refs.split(/\r?\n/).map(s => s.trim()).filter(Boolean))
  const behind = new Map<string, boolean>()
  for (const n of BASES) {
    const local = `refs/heads/${n}`
    const remote = `refs/remotes/origin/${n}`
    if (have.has(local) && (have.has(remote) || originHead.trim() === remote)) {
      behind.set(`${local}|${remote}`, (await git($, ['merge-base', '--is-ancestor', local, remote], root)).exitCode === 0)
    }
  }
  const base = parseBase({ head, originHead, refs, isAncestor: (a: string, b: string) => behind.get(`${a}|${b}`) ?? false })
  let commits: { at: number; subject: string }[] = []
  kept.baseLog = null
  if (base) {
    const common = (await git($, ['rev-parse', '--git-common-dir'], root)).stdout.trim()
    if (common) kept.baseLog = `${/^([A-Za-z]:)?[\\/]/.test(common) ? common : `${root}/${common}`}/logs/${base.ref}`
    const log = await git($, logArgs(base.ref), root)
    if (log.exitCode === 0) commits = parseLog(log.stdout) as typeof commits
  }
  // A feature is a roadmap row, or the plan of one that left the roadmap.
  const ids = new Set(rows.map(r => r.id))
  const left = new Set<string>()
  for (const c of commits) {
    const id = isDocs(c.subject) ? null : featureIdOf(c.subject)
    if (id && !ids.has(id) && !left.has(id) && (await $.fs.exists(`${root}/docs/ristretto/plans/${id}.md`))) left.add(id)
  }
  const now = await $.clock.now()
  const onDefault = head === defaultBranch({ originHead, refs })
  const branch = branchOf({ head, base, commits, known: (id: string) => ids.has(id) || left.has(id), runs: runList, now, onDefault })
  const age = commits.length ? ago(Math.min(...commits.map(c => c.at)), now) : null
  return { branch, age, head }
}

// The full-suite verdict, current only while it proves the code that is there (spec 4.5).
async function readSuiteAt($: EngineInterface, root: string) {
  let record: any = null
  try {
    if (await $.fs.exists(`${root}/${SUITE}`)) record = JSON.parse(String(await $.fs.read(`${root}/${SUITE}`)))
  } catch {
    record = null // half-written or unreadable: unproven
  }
  const at = await git($, ['rev-parse', 'HEAD'], root)
  const head = at.exitCode === 0 ? at.stdout.trim() : null
  const args = suiteArgs(record?.tree)
  const treeMatches = args ? (await git($, args, root)).exitCode === 0 : false
  return suiteOf(record, { treeMatches, head }) as BoardRepo['suite']
}

// A repo's at-work record and its pull marker, as the folder board judges them.
async function readRaw($: EngineInterface, root: string): Promise<Raw> {
  let rec: BoardAtWork | null = null
  try {
    if (await $.fs.exists(`${root}/${AT_WORK}`)) rec = JSON.parse(String(await $.fs.read(`${root}/${AT_WORK}`)))
  } catch {
    rec = null // half-written: no record until the next write
  }
  let owner: string | null = null
  let marker = false
  try {
    marker = await $.fs.exists(`${root}/${MARKER}`)
    if (marker) owner = String(await $.fs.read(`${root}/${MARKER}`)).trim()
  } catch {
    marker = false
  }
  return { rec, owner, marker }
}

// The sibling folders a single repo's plans name, and their roadmap statuses.
async function readSiblings($: EngineInterface, root: string, board: Board) {
  const names = new Set<string>()
  for (const plan of Object.values(board.plans)) for (const id of plan?.depends ?? []) { const s = siblingOf(id); if (s) names.add(s.folder) }
  const parent = root.replace(/[\\/][^\\/]+[\\/]?$/, '')
  const out: Record<string, Record<string, BoardStatus>> = {}
  for (const f of names) {
    try {
      const p = `${parent}/${f}/${ROADMAP}`
      if (!(await $.fs.exists(p))) continue
      out[f] = Object.fromEntries(parseRoadmap(String(await $.fs.read(p))).rows.map((r: any) => [r.id, r.status]))
    } catch {
      // Unreadable: its features are not found.
    }
  }
  return out
}

// What changed on disk for a repo, cheaply: the roadmap, the plans, git's HEAD and base reflog,
// the suite record (and a single repo's siblings). The at-work record and the pull marker have
// their own signature: a gate touches the marker on every stop, and that re-reads only them.
async function sigOf($: EngineInterface, root: string, kept: Kept | undefined) {
  if (kept && kept.gitDir === undefined) kept.gitDir = null
  const parts = [
    await mtime($, `${root}/${ROADMAP}`),
    kept ? await planSig($, root, kept.repo.board.rows) : '',
    await mtime($, `${root}/${SUITE}`),
  ]
  if (kept?.gitDir) parts.push(await mtime($, `${kept.gitDir}/HEAD`), await mtime($, `${kept.gitDir}/logs/HEAD`))
  if (kept?.baseLog) parts.push(await mtime($, kept.baseLog))
  if (kept) for (const f of Object.keys(kept.sibs)) parts.push(await mtime($, `${root.replace(/[\\/][^\\/]+[\\/]?$/, '')}/${f}/${ROADMAP}`))
  return parts.join('|')
}

// Every repo the board shows, re-read where something changed; the at-work records judged again
// on every poll (a quiet heartbeat turns a run into a stopped one). Written only when it changed.
async function refreshRepos($: EngineInterface, force = false) {
  try {
    const now = await $.clock.now()
    const out: BoardRepo[] = []
    let sibs: Record<string, Record<string, BoardStatus>> = {}
    for (const { folder, root } of roots) {
      let kept = cache.get(root)
      const sig = await sigOf($, root, kept)
      const rawSig = `${await mtime($, `${root}/${AT_WORK}`)}|${await mtime($, `${root}/${MARKER}`)}`
      if (kept && !force && kept.sig === sig && kept.rawSig !== rawSig) {
        kept.raw = await readRaw($, root)
        kept.rawSig = rawSig
      }
      if (force || !kept || kept.sig !== sig) {
        const name = folder ?? rootName
        const board = await readBoardAt($, root, name)
        const runList = root === ownRoot ? await read($, runs) : (((await $.store.get(`runs:${root}`)) as BoardRecord[] | undefined) ?? [])
        const next: Partial<Kept> = { gitDir: kept?.gitDir }
        if (next.gitDir === undefined || next.gitDir === null) {
          const at = await git($, ['rev-parse', '--absolute-git-dir'], root)
          next.gitDir = at.exitCode === 0 ? at.stdout.trim() : null
        }
        const { branch, age } = await readBranchAt($, root, board.rows, Array.isArray(runList) ? runList : [], next)
        const suite = await readSuiteAt($, root)
        const raw = await readRaw($, root)
        const s = folder === null ? await readSiblings($, root, board) : {}
        kept = { sig: '', rawSig, repo: { folder, board, branch, suite, runs: Array.isArray(runList) ? runList : [], atWork: { state: 'none', rec: null }, age }, raw, gitDir: next.gitDir, baseLog: next.baseLog, sibs: s }
        kept.sig = await sigOf($, root, kept)
        cache.set(root, kept)
      }
      const j = judge(kept.raw.rec, { owner: kept.raw.owner, markerExists: kept.raw.marker, now }) as BoardRepo['atWork']
      // A running record's heartbeat is not drawn: only a stopped one says how long ago.
      const atWork = j.state === 'running' && j.rec ? { state: j.state, rec: { ...j.rec, beat: 0 } } : j
      out.push({ ...kept.repo, atWork })
      sibs = { ...sibs, ...kept.sibs }
    }
    { const v = out; if (!same(await read($, repos), v)) { await update($, repos, () => v); await stamp($) } }
    { const v = sibs; if (!same(await read($, siblings), v)) { await update($, siblings, () => v); await stamp($) } }
  } catch {
    // The next poll tries again.
  }
}

// The repos this board shows: the session's own when its root holds a roadmap, else each direct
// subfolder that does (a folder of repos, as sisi's api, web and platform).
async function findRoots($: EngineInterface) {
  const root = await $.session.root()
  rootName = root.split(/[\\/]/).filter(Boolean).pop() || 'roadmap'
  if (await $.fs.exists(`${root}/${ROADMAP}`)) {
    ownRoot = root
    return [{ folder: null, root }]
  }
  ownRoot = null
  const found: { folder: string | null; root: string }[] = []
  try {
    for (const e of await $.fs.list(root)) {
      if (e.kind !== 'dir' || e.name.startsWith('.')) continue
      if (await $.fs.exists(`${root}/${e.name}/${ROADMAP}`)) found.push({ folder: e.name, root: `${root}/${e.name}` })
    }
  } catch {
    // An unreadable folder shows no repos.
  }
  return found.sort((a, b) => String(a.folder).localeCompare(String(b.folder)))
}

async function writeRec($: EngineInterface, rec: BoardAtWork) {
  if (!ownRoot) return
  try {
    // Another session's running record (it took the pull over: its marker, a fresh heartbeat) is
    // never overwritten. One a dead session left is judged stopped, and the next pull replaces it.
    const path = `${ownRoot}/${AT_WORK}`
    if (await $.fs.exists(path)) {
      const raw = await readRaw($, ownRoot)
      const there = raw.rec
      const running = judge(there, { owner: raw.owner, markerExists: raw.marker, now: await $.clock.now() }).state === 'running'
      if (there && there.session !== sessionId && running) {
        lastRec = null
        return
      }
    }
    await $.fs.write(`${ownRoot}/${AT_WORK}`, JSON.stringify(rec))
    lastRec = rec
  } catch {
    // The next change or heartbeat writes it again.
  }
}

// This session's run, left for the board at the folder: written when what it shows changed, and
// once more with endedAt when the run ends. The drawing reads `ownRec`; the heartbeat never is.
async function publish($: EngineInterface, after: BoardLive | null) {
  if (!ownRoot) return
  const now = await $.clock.now()
  let next: BoardAtWork | null = null
  if (after && after.id) {
    const title = cache.get(ownRoot)?.repo.board.rows.find(r => r.id === after.id)?.title ?? ''
    const rec = recordOf(after, { session: sessionId, title: plain(title), now, prev: lastRec }) as BoardAtWork
    if (!sameShown(lastRec, rec)) next = rec
  } else if (lastRec && lastRec.endedAt === null) {
    next = endedOf(lastRec, now) as BoardAtWork
  }
  if (!next) return
  await writeRec($, next)
  { const v = next; if (!same(await read($, ownRec), v)) { await update($, ownRec, () => v); await stamp($) } }
}

async function observe($: EngineInterface, obs: Parameters<typeof fold>[1]) {
  try {
    const now = await $.clock.now()
    const before = await read($, live)
    const after = fold(before, obs, now)
    { const v = after; if (!same(await read($, live), v)) { await update($, live, () => v); await stamp($) } }
    await publish($, after)
    await account($)
    // pull's and shot's implementer, fixer and closer follow their brief in the main loop: the
    // phase change names them, on the session's model (spec 4.8).
    const role = mainRoleOf(before, after)
    if (role) {
      let model = ''
      try {
        model = await $.session.model()
      } catch {
        // Unknown: a dash.
      }
      await update($, roles, r => addRole(r, role, model, now))
      await stamp($)
    }
  } catch {
    // An observation that fails leaves the board as it was; it must never fail the event.
  }
}

// A run follows the feature the fold says is running; when it moves on, the finished run is
// closed with the status the roadmap now shows and kept across sessions.
async function account($: EngineInterface) {
  const now = await $.clock.now()
  const before = await read($, run)
  const current = await read($, live)
  const step = track(before, current, now)
  if (step.run === before) {
    if (before) {
      await update($, run, r => (r && r.id === before.id ? markPhase(r, current, now) : r))
      // A step that changed changes the times the drawing shows.
      { const v = startedOf(await read($, run)); if (!same(await read($, started), v)) { await update($, started, () => v); await stamp($) } }
    }
    return
  }
  // Tokens and gate time keep arriving while this ran: only the call that still finds the run
  // it read moves it on, and it closes the run as it stands then, counts included.
  let moved = false
  let closing: BoardRun | null = null
  await update($, run, r => {
    if ((r?.id ?? null) !== (before?.id ?? null)) return r
    moved = true
    closing = r
    return step.run ? markPhase(step.run, current, now) : step.run
  })
  if (!moved) return
  const begun = step.run as BoardRun | null
  { const v = startedOf(begun); if (!same(await read($, started), v)) { await update($, started, () => v); await stamp($) } }
  // A feature's run starting again starts its roles over.
  if (begun && (await read($, roles))[begun.id]?.length) await update($, roles, r => ({ ...r, [begun.id]: [] }))
  if (!closing || !ownRoot) return
  await refreshRepos($, true)
  const ended: BoardRun = closing
  const status = cache.get(ownRoot)?.repo.board.rows.find(r => r.id === ended.id)?.status ?? 'unknown'
  // Another session in this repo may have kept runs since this one loaded them: add to what
  // the store holds now, not to this session's copy.
  const stored = storeKey ? await $.store.get(storeKey) : null
  const next = keep(Array.isArray(stored) ? (stored as BoardRecord[]) : await read($, runs), endRun(ended, now, status))
  { const v = next; if (!same(await read($, runs), v)) { await update($, runs, () => v); await stamp($) } }
  if (storeKey) await $.store.set(storeKey, next)
}

// What the drawing needs of a run: its start, and each step's time by step name (a run record
// keeps the build step's time under `code`).
const STEP_OF: Record<string, string> = { code: 'build' }
function startedOf(r: BoardRun | null): BoardStarted | null {
  if (!r) return null
  const steps: Record<string, number> = {}
  for (const [k, ms] of Object.entries(r.phases ?? {})) if (typeof ms === 'number' && ms > 0) steps[STEP_OF[k] ?? k] = ms
  return { id: r.id, startedAt: r.startedAt, steps, at: r.at ? { step: STEP_OF[r.at.bucket] ?? r.at.bucket, since: r.at.since } : null }
}

// v1: prep starts in this session; a build or another ristretto command ends it. Prep and a
// build open the pane by themselves, where the surface docks one beside the transcript.
async function startPrep($: EngineInterface, args: string) {
  // The first word, when the drawing finds it on a roadmap; free text names no feature.
  const id = args.trim().split(/\s+/)[0] || null
  const now = await $.clock.now()
  await update($, prep, () => ({ startedAt: now, id }))
  await update($, pins, () => EMPTY_PINS)
  await stamp($)
}
async function endPrep($: EngineInterface) {
  if ((await read($, prep)) === null && (await read($, pins)).points.length === 0) return
  await update($, prep, () => null)
  await update($, pins, () => EMPTY_PINS)
  await stamp($)
}
// What an answer pins: prep's points while prep runs, a build's rulings while one is live.
async function pinFrom($: EngineInterface, text: string) {
  if ((await read($, prep)) === null && (await read($, live)) === null) return
  const before = await read($, pins)
  const after = foldPins(before, pinsOf(text))
  if (after !== before && !same(before, after)) { await update($, pins, () => after); await stamp($) }
}

// Whose run the pull marker is, from the session id gate.js writes into it and its age: what
// the fold needs to know the run started and when it ended. The session's own repo only.
async function observeMarker($: EngineInterface) {
  if (!ownRoot) return
  try {
    let owner: string | null = null
    let idleMs: number | null = null
    if (await $.fs.exists(`${ownRoot}/${MARKER}`)) {
      owner = String(await $.fs.read(`${ownRoot}/${MARKER}`)).trim()
      idleMs = (await $.clock.now()) - (await $.fs.stat(`${ownRoot}/${MARKER}`)).mtimeMs
    }
    await observe($, { kind: 'marker', state: markerState(owner, idleMs, sessionId) })
  } catch {
    // The next poll tries again.
  }
}

// Every 5 s: what changed on disk, read again; nothing changed, nothing written. A run at work
// here refreshes its heartbeat at most once a minute: a file write, never an atom.
async function poll($: EngineInterface) {
  try {
    await observeMarker($)
    await refreshRepos($)
    const now = await $.clock.now()
    if (lastRec && needsBeat(lastRec, now)) await writeRec($, { ...lastRec, beat: now })
  } catch {
    // The next tick tries again.
  }
}

// The person's app theme picks the hairline and the ink inside SVG clocks (text follows the theme
// by itself, through theme keys). Read at session start, when /config changes it, and on a first
// draw that came before either; dark by default. Never on a timer.
let theme: 'dark' | 'light' = 'dark'
let themeKnown = false
async function readTheme($: any) {
  themeKnown = true
  try {
    const rows = await $.config.list()
    const value = rows?.find?.((r: any) => r.key === 'theme')?.value
    theme = /light/i.test(String(value ?? '')) ? 'light' : 'dark'
  } catch {
    // An unreadable config keeps the last theme.
  }
}

function isRoadmap(path: unknown) {
  return typeof path === 'string' && path.replace(/\\/g, '/').endsWith(ROADMAP)
}

// The model alias each feature's latest Agent call named, for a spawn that resolves none.
const aliasOf = new Map<string, string>()

// What the drawing hands the Timeline: this session's own record over its own file.
async function timelineOpts($: EngineInterface, nowMs: number) {
  const own = await read($, ownRec)
  return {
    now: nowMs,
    session: sessionId,
    own: own && own.endedAt === null && ownRoot ? { folder: null, rec: own } : null,
    siblings: await read($, siblings),
    name: rootName,
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const begun = await next(e)
    for (const timer of timers) timer.cancel()
    // The one timer: a poll that writes only what changed. No clock tick: running times count up
    // inside their SVG.
    timers = [$.clock.every(5000, () => void poll($))]
    sessionId = await $.session.id()
    cache.clear()
    lastRec = null
    roots = await findRoots($)
    // Run records live in the engine's store, per repo, so the history outlives the session.
    storeKey = ownRoot ? `runs:${ownRoot}` : ''
    const kept = storeKey ? await $.store.get(storeKey) : null
    await update($, runs, () => (Array.isArray(kept) ? (kept as BoardRecord[]) : []))
    try {
      pluginFormat = formatOf(await $.fs.read(`${$.plugin.root}/scripts/migrate.js`))
    } catch {
      // Without the plugin's format the format notice is skipped; the board itself still draws.
    }
    try {
      version = String(JSON.parse(String(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`))).version ?? '')
    } catch {
      version = ''
    }
    await readTheme($)
    await refreshRepos($, true)
    await poll($)
    await stamp($)
    return begun
  })

  on('config.set', { key: 'theme' }, async ($, e, next) => {
    try {
      return await next(e)
    } finally {
      await readTheme($)
      try {
        await $.ui.invalidate('ui.render')
      } catch {
        // The next change redraws it.
      }
    }
  })

  // A click on the chip (board-press.tsx) opens the pane, or closes it when it is open.
  on('ui.message', async ($, e, next) => {
    if ((e.data as any)?.press !== 'toggle') return next(e)
    try {
      if (await read($, paneOpen)) await closePane($)
      else await openPane($)
    } catch {
      // The next click tries again.
    }
    return {}
  })

  // The pane closed by its own x (or by anyone): the next click on the chip opens it again.
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if ((e as any).id === PANE) await update($, paneOpen, () => false)
    return closed
  })

  // The band above the prompt: the chip; a click on it opens or closes the pane.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      return (await drawBand($, e)) ?? next(e)
    } catch {
      return next(e)
    }
  })


  on('command.run', async ($, e, next) => {
    // A bare /ristretto:status opens the board where it docks beside the transcript, at once
    // and with no model turn; a filter, or a layout that would put it inline, gets the text
    // roadmap from commands/status.md as before.
    if (e.command === 'ristretto:status' && e.args.trim() === '' && e.presentation.isFullscreen && roots.length > 0) {
      await refreshRepos($, true)
      await openPane($)
      return { text: 'Roadmap opened in the side pane — /ristretto:status <filter> prints it as text.' }
    }
    const cmd = commandOf(e.command) as 'pull' | 'shot' | 'brew' | null
    try {
      const docked = !!e.presentation?.isFullscreen && roots.length > 0
      if (e.command === 'ristretto:prep') {
        await startPrep($, e.args)
        if (docked) await openPane($)
      } else if (cmd) {
        await endPrep($)
        if (docked) await openPane($)
      } else if (/^ristretto:/.test(e.command)) {
        await endPrep($)
      }
      const signal = signalOf({ tool: 'Skill', skill: e.command })
      if (signal) await observe($, signal)
    } catch {
      // The board never stands between the person and a command.
    }
    if (cmd) await observe($, { kind: 'command', command: cmd, args: e.args })
    return next(e)
  })

  // A pull the brewer sends is run by the model through the Skill tool, never typed: the same
  // observation, or the run has no command and is never unattended. From a builder subagent the
  // call carries its agentId.
  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    try {
      const skill = String((e as any).skill ?? '')
      const cmd = commandOf(skill) as 'pull' | 'shot' | 'brew' | null
      if (skill === 'ristretto:prep') await startPrep($, String((e as any).args ?? ''))
      else if (cmd && (e as any).agentId === undefined) await endPrep($)
      const signal = signalOf({ tool: 'Skill', skill })
      if (signal) await observe($, signal)
      if (cmd) await observe($, { kind: 'command', command: cmd, args: String((e as any).args ?? ''), agent: (e as any).agentId !== undefined })
    } catch {
      // The board never stands between the model and a skill.
    }
    return next(e)
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    // prep's last step starts a builder for the feature it planned: prep is over then, and its
    // pins must not come back when that build ends.
    try {
      if ((e as any).agentId === undefined && /\/ristretto:pull\b/.test(String(e.prompt ?? ''))) await endPrep($)
    } catch {
      // The board never stands between the model and a subagent.
    }
    const brief = parseBrief(String(e.prompt ?? ''))
    if (brief) aliasOf.set(brief.id, String((e as any).model ?? ''))
    if (brief) await observe($, { kind: 'brief', ...brief })
    const ran = await next(e)
    try {
      // Only a finished agent has reported: a background, failed or denied one has not.
      if (brief && (ran as any).result?.status === 'completed' && !(ran as any).isError) {
        const verdict = parseReport(brief.role, reportText(ran))
        if (verdict) await observe($, { kind: 'report', role: brief.role, verdict })
        // A planner's rulings are what the build decided for the person.
        if (brief.role === 'planner') await pinFrom($, reportText(ran))
        // Its own duration corrects when its role ended.
        const ms = Number((ran as any).result?.totalDurationMs)
        if (Number.isFinite(ms) && ms > 0) {
          const now = await $.clock.now()
          { const v = closeRole(await read($, roles), brief.id, ms, now); if (!same(await read($, roles), v)) { await update($, roles, () => v); await stamp($) } }
        }
      }
    } catch {
      // A missed report leaves the board as it was.
    }
    return ran
  })

  // Who works on a feature and on which model: the spawn says, once the subagent started.
  on('agent.spawn', async ($, e, next) => {
    const res = await next(e)
    try {
      const brief = parseBrief(String((e as any).prompt ?? ''))
      if (brief) {
        const model = spawnModel(res, aliasOf.get(brief.id))
        const current = await read($, live)
        const round = current && current.id === brief.id ? current.round : 0
        const now = await $.clock.now()
        await update($, roles, r => addRole(r, { id: brief.id, role: brief.role, round }, model, now))
        await stamp($)
      }
    } catch {
      // The table shows what it saw.
    }
    return res
  })

  // v1's steps: `gate.js verify` proves the build, `close.js` closes the feature.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    try {
      const signal = signalOf({ tool: 'Bash', command: String((e as any).command ?? '') })
      if (signal) await observe($, signal)
    } catch {
      // A missed step leaves the board as it was.
    }
    return next(e)
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (isRoadmap(e.file_path)) await refreshRepos($, true)
    return ran
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (isRoadmap(e.file_path)) await refreshRepos($, true)
    return ran
  })

  // Every model request while a run is live, main loop and subagents, counts toward its
  // tokens as it is answered. The run is not drawn, so a count never redraws the pane.
  on('turn.step', async function* ($, e, next) {
    const res = yield* next(e)
    try {
      await update($, run, r => addTokens(r, res.usage))
    } catch {
      // A missed count must never fail the request.
    }
    return res
  })

  on('classic.Stop', async ($, e, next) => {
    await observe($, { kind: 'gate-start' })
    const t0 = await $.clock.now()
    const result = await next(e)
    const ms = (await $.clock.now()) - t0
    await update($, run, r => addGate(r, ms, result.block !== undefined))
    await observe($, { kind: 'gate-end', red: result.block !== undefined })
    return result
  })

  on('classic.SubagentStop', async ($, e, next) => {
    await observe($, { kind: 'gate-start' })
    const t0 = await $.clock.now()
    const result = await next(e)
    const ms = (await $.clock.now()) - t0
    await update($, run, r => addGate(r, ms, result.block !== undefined))
    await observe($, { kind: 'gate-end', red: result.block !== undefined })
    return result
  })

  on('turn.complete', async ($, e, next) => {
    // The answer is whole before the turn's end runs on: pin from it first.
    if (e.agentId === undefined) {
      try {
        await pinFrom($, String((e as any).answer ?? ''))
      } catch {
        // An answer that pins nothing leaves the pins as they were.
      }
    }
    const done = await next(e)
    if (e.agentId === undefined) {
      await observeMarker($)
      await observe($, { kind: 'main-turn-end', interrupted: e.reason === 'aborted' || e.reason === 'error' })
      // At a folder no marker says a builder's run ended: the brewer's turn after its close does.
      const now = await read($, live)
      if (!ownRoot && now?.agent && now.phase === 'closing') await observe($, { kind: 'run-end' })
    }
    await refreshRepos($)
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // A render that throws leaves the pane blank with no word why: say it instead.
    try {
      return await drawPane($, e)
    } catch (err) {
      const { Text } = $.ui.resolve(e) as any
      return <Text color="error" wrap="wrap">{`ristretto board: ${String((err as any)?.stack ?? err).slice(0, 600)}`}</Text>
    }
  })
}

// ---- the pane, v1 (spec 2026-11-20) ------------------------------------------------------------
// One view per mode, display only: images for the head, the step word, the meter and the rail;
// the pane's own text for everything a person reads. Nothing presses.

// What each step does, under its name in the pull view.
const STEP_WORDS: Record<string, string> = {
  plan: 'against the current code',
  build: 'the code and its tests',
  prove: 'the whole repo, suite and gates',
  review: 'one code review',
  close: 'evidence, roadmap row, commit',
}
// A card's ground: a faint grey that holds on a light and a dark theme.
const CARD = '#80808020'

const caption = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ')

// A feature's title, wherever it is on the board.
function titleOf(list: BoardRepo[], id: string | null | undefined) {
  if (!id) return ''
  for (const r of list) {
    const row = r.board.rows.find(x => x.id === id)
    if (row) return plain(row.title)
  }
  return ''
}

const headAlt = (view: any) => `ristretto ${view.mode}: ${caption([`${view.head.big} ${view.head.small}`.trim(), view.head.label])}`

// What the pane and the band draw: the view of what happens now, or the one line said when there
// is no board to draw.
async function viewNow($: any): Promise<{ msg: string | null; view: any; nowMs: number }> {
  const shownRepos = await read($, repos)
  const nowMs = await read($, drawnAt)
  const msg = messageOf(shownRepos)
  if (msg) return { msg, view: null, nowMs }
  const story = storyOf(shownRepos, await timelineOpts($, nowMs))
  const lv = await read($, live)
  const named = await read($, prep)
  // prep's first word names a feature only when a roadmap has it.
  const pr = named && named.id && !titleOf(shownRepos, named.id) ? { ...named, id: null } : named
  const mode = modeOf({ live: lv, story, prep: pr })
  const view = viewOf({
    mode, live: lv, story, prep: pr,
    pins: await read($, pins), started: await read($, started),
    title: titleOf(shownRepos, mode === 'prep' ? pr?.id : lv?.id), now: nowMs,
  })
  return { msg: null, view, nowMs }
}

async function drawPane($: any, e: any) {
  const els = $.ui.resolve(e) as any
  const { Box, Text } = els
  if (!themeKnown) await readTheme($)
  const { msg, view, nowMs } = await viewNow($)
  if (msg) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="inactive" wrap="wrap">{msg}</Text>
      </Box>
    )
  }
  // The terminal resolves an Svg but draws it as nothing: text there.
  return els.Svg && e.surface !== 'terminal' ? richPane(els, view, nowMs) : textPane(els, view)
}

// The band above the prompt: the chip, the view at a glance; one line of text on the terminal.
async function drawBand($: any, e: any) {
  const { msg, view, nowMs } = await viewNow($)
  const c = msg ? null : chipOf(view)
  if (!c) return null
  const els = $.ui.resolve(e) as any
  const alt = `ristretto ${c.label}: ${c.word}`
  // The press area lies over the chip where the surface draws one (the desktop and the terminal;
  // VS Code resolves a Client but drops it, and mobile takes no presses).
  const press = (e.surface === 'desktop' || e.surface === 'terminal') && els.Client
    ? (
      <els.Box position="absolute" top={0} left={0} width="100%" height="100%">
        <els.Client key="chip-press" module="./board-press.tsx" width="100%" height="100%" props={{ id: 'toggle', blank: true }} />
      </els.Box>
    )
    : null
  if (els.Svg && e.surface !== 'terminal') {
    return (
      <els.Box flexDirection="column" position="relative">
        <els.Svg alt={alt} height={44} source={phaseLock(chipSvg({ ...c, now: nowMs }), nowMs)} />
        {press}
      </els.Box>
    )
  }
  const color = c.tone === 'you' ? 'permission' : c.step || c.tone === 'brass' ? 'claude' : 'text'
  return (
    <els.Box flexDirection="column" position="relative">
      <els.Text color={color} wrap="truncate-end">{`${c.label} · ${c.word}`}</els.Text>
      {press}
    </els.Box>
  )
}

function richPane(els: any, view: any, nowMs: number) {
  const { Box, Text, Svg } = els
  const ink = STEP_INK[theme] as Record<string, string>
  const gap = (key: string) => <Box key={key} height={1} />
  const label = (key: string, text: string, color = 'inactive') => <Text key={key} size="caption" weight="semibold" color={color}>{text}</Text>
  const head = header({ ...view.head, now: nowMs })
  const meterEl = (key: string, phases: any[], red: boolean) => (
    <Svg key={key} alt={`steps: ${phases.map((p: any) => `${p.name} ${p.state}`).join(', ')}`} height={21} source={phaseLock(meter({ phases, red }), nowMs)} />
  )
  // A timeline row: the rail's box two cells wide and as tall as the words beside it; the rail
  // image hangs in it out of the flow and is cut at the row's end.
  const stop = (key: string, kind: string, step: string | null, children: any) => (
    <Box key={key} flexDirection="row" alignItems="stretch">
      <Box width={2} flexShrink={0} position="relative" overflow="hidden">
        <Box position="absolute" top={0} left={0}>
          <Svg alt="timeline" width={16} height={600} source={phaseLock(rail(kind, step), nowMs)} />
        </Box>
      </Box>
      <Box flexDirection="column" flexGrow={1} paddingLeft={1}>{children}</Box>
    </Box>
  )
  const point = (key: string, top: string, words: string, topColor = 'inactive') => (
    <Box key={key} flexDirection="column">
      <Text size="caption" color={topColor}>{top}</Text>
      <Text color="text" wrap="wrap">{words}</Text>
    </Box>
  )
  const stepLine = (key: string, phases: any[]) => (
    <Text key={key} mono size="caption">
      {phases.flatMap((p: any, i: number) => [
        i ? <Text key={`${key}-d${i}`} color="inactive">{' · '}</Text> : null,
        <Text key={`${key}-${p.name}`} color={ink[p.name] ?? 'inactive'}>{p.name}</Text>,
      ]).filter(Boolean)}
    </Text>
  )

  const body: any[] = []
  if (view.mode === 'brew') {
    let first = true
    const kind = () => (first ? ((first = false), 'first') : 'done')
    for (const d of view.done) {
      body.push(stop(d.key, kind(), null, [
        <Text key="c" mono size="caption" color="inactive">{caption([d.tag, d.id, d.meta])}</Text>,
        <Text key="t" color="text" wrap="truncate-end">{d.title}</Text>,
        d.checks ? <Text key="k" size="caption" color="permission">{d.checks === 1 ? '1 check for you' : `${d.checks} checks for you`}</Text> : null,
        gap('g'),
      ]))
    }
    for (const c of view.cards) {
      first = false
      body.push(stop(c.key, 'live', c.step, [
        <Box key="card" flexDirection="column" borderStyle="round" borderColor={CARD} backgroundColor={CARD} paddingX={1}>
          <Text mono size="caption" color="inactive">{caption([c.tag, c.id])}</Text>
          <Text weight="semibold" color="text" wrap="truncate-end">{c.title}</Text>
          <Svg alt={`${c.word}, step ${c.count}`} height={44} source={stepWord({ word: c.word, step: c.step, count: c.count })} />
          {meterEl('meter', c.effort, c.red)}
          {stepLine('steps', c.effort)}
        </Box>,
        gap('g'),
      ]))
    }
    view.next.forEach((r: any, i: number) => {
      first = false
      body.push(stop(r.key, 'next', null, [
        <Text key="c" mono size="caption" color="inactive">{caption([i ? null : 'next', r.tag, r.id, r.detail])}</Text>,
        <Text key="t" color="text" wrap="truncate-end">{r.title}</Text>,
        gap('g'),
      ]))
    })
    if (view.more) body.push(stop('more', 'last', null, <Text mono size="caption" color="inactive">{`+ ${view.more} more planned`}</Text>))
  } else if (view.mode === 'pull') {
    body.push(<Text key="id" mono size="caption" color="inactive">{view.feature.id ?? ''}</Text>)
    body.push(<Text key="title" weight="semibold" color="text" wrap="wrap">{view.feature.title}</Text>)
    body.push(meterEl('meter', view.effort.phases, view.effort.red))
    body.push(gap('g1'))
    for (const s of view.steps) {
      body.push(
        <Text key={`step-${s.name}`}>
          <Text weight="semibold" color={ink[s.name] ?? 'text'}>{s.name.toUpperCase()}</Text>
          <Text color="inactive">{` · ${caption([STEP_WORDS[s.name], s.ms ? duration(s.ms) : null])}`}</Text>
        </Text>,
      )
    }
    if (view.decided.length) {
      body.push(gap('g2'), label('l-dec', 'DECIDED FOR YOU'))
      for (const d of view.decided) body.push(point(`dec-${d.topic}`, d.topic, d.ruling))
    }
    if (view.checks.length) {
      body.push(gap('g3'), label('l-after', 'FOR YOU, AFTER', 'permission'))
      view.checks.forEach((c: any, i: number) => body.push(point(`chk-${i}`, c.how || 'check', c.text)))
    }
  } else if (view.mode === 'prep') {
    if (view.feature) {
      body.push(<Text key="id" mono size="caption" color="inactive">{view.feature.id}</Text>)
      if (view.feature.title) body.push(<Text key="title" weight="semibold" color="text" wrap="wrap">{view.feature.title}</Text>)
      body.push(gap('g0'))
    }
    if (!view.decided.length && !view.open.length && !view.found.length) {
      body.push(<Text key="none" color="inactive" wrap="wrap">Talking it through. What is decided pins here.</Text>)
    }
    if (view.decided.length) {
      body.push(label('l-dec', 'DECIDED'))
      for (const d of view.decided) body.push(point(`dec-${d.topic}`, d.topic, d.ruling))
      body.push(gap('g1'))
    }
    if (view.open.length) {
      body.push(label('l-open', 'OPEN'))
      for (const o of view.open) body.push(point(`open-${o.topic}`, o.live ? `${o.topic} · talking now` : o.topic, o.question || '—', o.live ? BRASS : 'inactive'))
      body.push(gap('g2'))
    }
    if (view.found.length) {
      body.push(label('l-found', 'FOUND'))
      view.found.forEach((f: string, i: number) => body.push(<Text key={`found-${i}`} color="text" wrap="wrap">{f}</Text>))
    }
  } else {
    if (view.checks.length) {
      body.push(label('l-test', `TO TEST · ${view.checks.length}`, 'permission'))
      view.checks.forEach((c: any, i: number) => body.push(point(`chk-${i}`, caption([c.tag, c.id, c.how]), c.text)))
      body.push(gap('g1'))
    }
    if (view.blocked.length) {
      body.push(label('l-blk', `BLOCKED · ${view.blocked.length}`, 'error'))
      for (const b of view.blocked) body.push(point(`blk-${b.key}`, caption([b.tag, b.id]), b.reason))
      body.push(gap('g2'))
    }
    if (view.taken.length) {
      body.push(label('l-dec', `DECIDED FOR YOU · ${view.taken.length}`))
      view.taken.forEach((d: any, i: number) => body.push(point(`dec-${i}`, caption([d.tag, d.id]), d.text)))
      body.push(gap('g3'))
    }
    if (view.next.length) {
      body.push(label('l-next', 'NEXT'))
      for (const r of view.next) body.push(point(`next-${r.key}`, caption([r.tag, r.id, r.detail]), r.title))
    }
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Svg alt={headAlt(view)} height={head.h} source={phaseLock(head.src, nowMs)} />
      <Box height={1} />
      {body}
      <Box height={1} />
      <Text mono size="caption" color="inactive">{caption([rootName, version ? `v${version}` : null])}</Text>
    </Box>
  )
}

// The terminal, which draws no images: the same facts as lines.
function textPane(els: any, view: any) {
  const { Box, Text } = els
  const hd = view.head
  const lines: [string, string][] = [[`${caption([`${view.mode.toUpperCase()} ${hd.big} ${hd.small}`.trim(), hd.label])}`, 'text']]
  const add = (text: string, color = 'text') => lines.push([text, color])
  if (view.mode === 'brew') {
    for (const d of view.done) add(`✓ ${caption([d.tag, d.id, d.title])}`, 'inactive')
    for (const c of view.cards) add(`● ${caption([c.tag, c.id, `${c.word} ${c.count}`])}`, 'claude')
    for (const r of view.next) add(`○ ${caption([r.tag, r.id, r.title])}`, 'inactive')
    if (view.more) add(`+ ${view.more} more planned`, 'inactive')
  } else if (view.mode === 'pull') {
    add(caption([view.feature.id, view.feature.title]))
    for (const s of view.steps) add(`${s.state === 'done' ? '✓' : s.state === 'current' ? '●' : '○'} ${s.name}${s.ms ? ` · ${duration(s.ms)}` : ''}`, s.state === 'current' ? 'claude' : 'inactive')
    for (const d of view.decided) add(`decided: ${d.topic} → ${d.ruling}`, 'inactive')
    for (const c of view.checks) add(`for you after: ${c.text}`, 'permission')
  } else if (view.mode === 'prep') {
    for (const d of view.decided) add(`✓ ${d.topic} → ${d.ruling}`)
    for (const o of view.open) add(`○ ${o.topic} — ${o.question}`, o.live ? 'claude' : 'inactive')
    for (const f of view.found) add(`· ${f}`, 'inactive')
  } else {
    for (const c of view.checks) add(`to test: ${caption([c.tag, c.id, c.text])}`, 'permission')
    for (const b of view.blocked) add(`blocked: ${caption([b.tag, b.id, b.reason])}`, 'error')
    for (const r of view.next) add(`next: ${caption([r.tag, r.id, r.title])}`, 'inactive')
  }
  return (
    <Box flexDirection="column">
      {lines.map(([t, c], i) => <Text key={`l${i}`} color={c} wrap="truncate-end">{t}</Text>)}
    </Box>
  )
}
