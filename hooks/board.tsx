import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, BoardAtWork, BoardFile, BoardLive, BoardPage, BoardRecord, BoardRepo, BoardRole, BoardRun, BoardStarted, BoardStatus } from '../types'
import { EMPTY_BOARD, commandOf, duration, elapsed, fold, formatOf, inline, mainRoleOf, markerState, plain, parseBrief, parseReport, parseRoadmap, reportText } from './board-model.mjs'
import { featureIdOf, featureLogArgs, isDocs, parseNumstat, sumFiles } from './board-files.mjs'
import { BASES, ago, baseArgs, branchOf, defaultBranch, headArgs, logArgs, parseBase, parseLog, shortHeadArgs, suiteArgs, suiteOf } from './board-branch.mjs'
import { chip, terminalSegments, tracker } from './board-effort.mjs'
import { HAIR, HUE, INK, PHASE, back as backArrow, chevron, clockWords, cup, dims, effortLabels, mark, phaseLock, space, splitAlt, splitBar, svgClock, statusGlyph } from './board-svg.mjs'
import { buttonKeeper } from './board-keep.mjs'
import { parseChecks, parseDecisions, parsePlan, siblingOf } from './board-plan.mjs'
import { addGate, addRole, addTokens, closeRole, count, endRun, keep, markPhase, spawnModel, track } from './board-runs.mjs'
import { endedOf, judge, needsBeat, recordOf, sameShown } from './board-atwork.mjs'
import { pageOf, timelineBandOf, timelineOf } from './board-timeline.mjs'

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
const page = atom({ plugin: 'ristretto', key: 'page' } as const, null as BoardPage | null)
// Whether the board's pane is open: the band's toggle follows it.
const paneOpen = atom({ plugin: 'ristretto', key: 'paneOpen' } as const, false)
// A feature's files (its commits, found by ID) keyed `<folder>\u0000<id>`, and the folders opened by hand.
const files = atom({ plugin: 'ristretto', key: 'files' } as const, {} as Record<string, BoardFile[]>)
const folders = atom({ plugin: 'ristretto', key: 'folders' } as const, {} as Record<string, Record<string, boolean>>)
// The run in progress, counted as it goes (tokens, gate time): the drawing never reads it, so a
// token count never redraws the pane. `started` is what the drawing needs of it.
const run = atom({ plugin: 'ristretto', key: 'run' } as const, null as BoardRun | null)
const started = atom({ plugin: 'ristretto', key: 'started' } as const, null as BoardStarted | null)
const runs = atom({ plugin: 'ristretto', key: 'runs' } as const, [] as BoardRecord[])
const roles = atom({ plugin: 'ristretto', key: 'roles' } as const, {} as Record<string, BoardRole[]>)
const drawnAt = atom({ plugin: 'ristretto', key: 'drawnAt' } as const, 0)

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

// What a feature's commits changed, found by its ID in their subjects (`feat(<ID>): …`), re-read
// whenever its page opens. A row from before that rule may only carry a hash in its Commit cell:
// that is the roadmap's text, not a trusted argument, so only a hash reaches git, after
// --end-of-options.
async function loadFiles($: EngineInterface, folder: string | null, id: string) {
  try {
    const at = roots.find(r => r.folder === folder)
    if (!at) return
    const commit = cache.get(at.root)?.repo.board.rows.find(r => r.id === id)?.commit ?? ''
    const byId = await git($, featureLogArgs(id), at.root)
    let list = byId.exitCode === 0 ? sumFiles(parseNumstat(byId.stdout)) : []
    if (list.length === 0 && /^[0-9a-f]{4,40}$/i.test(commit)) {
      const shown = await git($, ['show', '--numstat', '--format=', '--end-of-options', commit], at.root)
      if (shown.exitCode === 0) list = parseNumstat(shown.stdout)
    }
    const key = `${folder ?? ''}\u0000${id}`
    { const v = { ...(await read($, files)), [key]: list }; if (!same(await read($, files), v)) { await update($, files, () => v); await stamp($) } }
  } catch {
    // The card shows the plan's files meanwhile; the next open tries again.
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
    if (before) await update($, run, r => (r && r.id === before.id ? markPhase(r, current, now) : r))
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
  { const v = begun ? { id: begun.id, startedAt: begun.startedAt } : null; if (!same(await read($, started), v)) { await update($, started, () => v); await stamp($) } }
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

// What each whole-row press area runs, by its id: the closure of the latest drawing, as the
// button keeper keeps a Button's handler current.
const pressRuns = new Map<string, () => void>()
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

  // A press area (board-press.tsx) was clicked: a row runs its press.
  on('ui.message', async ($, e, next) => {
    const id = (e.data as any)?.press
    if (typeof id === 'string' && id.startsWith('run:')) {
      pressRuns.get(id.slice(4))?.()
      return {}
    }
    return next(e)
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

  // The band above the prompt: the main thing only, and the board toggle.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      const nowMs = await read($, drawnAt)
      const b = timelineBandOf(await read($, repos), await timelineOpts($, nowMs))
      if (!b) return next(e)
      const els = $.ui.resolve(e) as any
      let toggle: any = null
      if (els.Button && e.surface !== 'mobile') {
        const open = await read($, paneOpen)
        const label = open ? 'hide board' : 'board'
        toggle = keeper.keep(`band|${e.surface}|toggle`, label, () => void (open ? closePane($) : openPane($)), (onPress: () => void) => <els.Button key="band-toggle" onPress={onPress}>{label}</els.Button>)
      }
      return bandLine(els, b, nowMs, toggle, e.surface, ownRoot !== null)
    } catch {
      return next(e)
    }
  })

  // The pane closed by its own x (or by anyone): the band offers to open it again.
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if ((e as any).id === PANE) await update($, paneOpen, () => false)
    return closed
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
    if (cmd) await observe($, { kind: 'command', command: cmd, args: e.args })
    return next(e)
  })

  // A pull the brewer sends is run by the model through the Skill tool, never typed: the same
  // observation, or the run has no command and is never unattended. From a builder subagent the
  // call carries its agentId.
  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    try {
      const cmd = commandOf(String((e as any).skill ?? '')) as 'pull' | 'shot' | 'brew' | null
      if (cmd) await observe($, { kind: 'command', command: cmd, args: String((e as any).args ?? ''), agent: (e as any).agentId !== undefined })
    } catch {
      // The board never stands between the model and a skill.
    }
    return next(e)
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const brief = parseBrief(String(e.prompt ?? ''))
    if (brief) aliasOf.set(brief.id, String((e as any).model ?? ''))
    if (brief) await observe($, { kind: 'brief', ...brief })
    const ran = await next(e)
    try {
      // Only a finished agent has reported: a background, failed or denied one has not.
      if (brief && (ran as any).result?.status === 'completed' && !(ran as any).isError) {
        const verdict = parseReport(brief.role, reportText(ran))
        if (verdict) await observe($, { kind: 'report', role: brief.role, verdict })
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
    const done = await next(e)
    if (e.agentId === undefined) {
      await observeMarker($)
      await observe($, { kind: 'main-turn-end', interrupted: e.reason === 'aborted' || e.reason === 'error' })
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

// Every Button is built once and handed back on each draw, so it keeps its press handle across
// redraws (see board-keep.mjs). Only the band's toggle and the VS Code fallback are Buttons now.
const keeper = buttonKeeper()

// The cup where a surface draws no SVG: in text, never an emoji (they draw unevenly).
const CUP_TEXT = ['   ) )  ( (', '.__________.', '|          |]', '|          |', "`----------'"]

// Glyphs where a surface draws no SVG (the terminal): one character per mark, its tone a theme key.
const GLYPH: Record<string, [string, string]> = {
  planned: ['○', 'inactive'], next: ['○', 'text'], queued: ['○', 'inactive'], running: ['●', 'claude'], lane: ['◉', 'claude'],
  blocked: ['✕', 'error'], findings: ['◐', 'warning'], person: ['◐', 'permission'], done: ['✓', 'success'], ready: ['✓', 'success'],
  'suite-ok': ['✓', 'success'], 'gate-red': ['✕', 'error'], 'suite-red': ['✕', 'error'],
}
const TONE: Record<string, any> = { permission: { color: 'permission' }, warning: { color: 'warning' }, error: { color: 'error' }, dim: { dimColor: true }, default: {} }
const toneOf = (t?: string) => TONE[t ?? 'dim'] ?? TONE.dim
const STATUS: Record<string, [string, string]> = {
  planned: ['planned', 'dim'], 'in-progress': ['in progress', 'claude'], blocked: ['blocked', 'error'],
  done: ['done', 'success'], unknown: ['unknown', 'dim'],
}
// The pane's cells to CSS pixels: an estimate on the low side, so a bar drawn this wide never
// overflows its slot and gets scaled (the pixels would blur).
const pxFor = (cells: number) => Math.max(120, Math.min(1400, Math.floor(cells * 7.4)))

// The band, one line: the cup, the run's chip while one pull runs, the words in theme keys
// (each brewing feature with its repo at a folder), who is needed, and the board toggle right.
// Each part sits in its own box with its own one-line Text; the ID gives way first.
function bandLine(els: any, b: any, nowMs: number, toggle: any, surface: string, single: boolean) {
  const { Box, Text, Svg } = els
  const rich = !!Svg && surface !== 'terminal'
  const running = !!b.running
  const part = (key: string, text: string, props: any, shrink: number) => (
    <Box key={key} flexShrink={shrink} overflow="hidden"><Text {...props} wrap="truncate-end">{text}</Text></Box>
  )
  const lead = rich
    ? <Box key="cup" flexShrink={0}><Svg alt={running ? 'brewing' : 'ristretto'} width={16} height={16} source={cup({ size: 16, live: running })} /></Box>
    : null
  let bar: any = null
  const words: any[] = []
  let need = 0
  if (running) {
    const ps = b.running.parts
    need = b.running.needYou
    const one = ps.length === 1 && ps[0].effort ? ps[0] : null
    if (one) {
      bar = rich
        ? <Box key="bar" flexShrink={0}><Svg alt={`${one.id} ${one.step}`} width={96} height={14} source={phaseLock((chip as any)({ phases: one.effort, red: one.red, width: 96 }), nowMs)} /></Box>
        : (
          <Box key="bar" flexShrink={0} flexDirection="row">
            {(terminalSegments as any)({ cells: 12, phases: one.effort, red: one.red, frame: 0 }).map((s: any, i: number) => (
              <Text key={`seg-${i}`} {...(s.state === 'done' ? { color: 'success' } : s.state === 'current' ? { color: one.red ? 'error' : 'claude' } : { color: 'inactive' })}>{s.text}</Text>
            ))}
          </Box>
        )
    }
    ps.forEach((p: any, i: number) => {
      if (i) words.push(part(`sep-${i}`, ' · ', { dimColor: true }, 0))
      if (p.tag) words.push(part(`tag-${i}`, `${p.tag} `, { dimColor: true }, 0))
      words.push(part(`id-${i}`, p.id, { bold: true }, 1))
      words.push(part(`step-${i}`, ` ${p.step}`, { color: p.red ? 'error' : 'claude' }, 0))
    })
  } else if (b.finished) {
    need = b.finished.needYou
    const where = single ? 'this branch' : `${b.finished.branches} brew branch${b.finished.branches === 1 ? '' : 'es'}`
    words.push(part('done', `${b.finished.done} done on ${where}`, { color: 'success' }, 0))
  } else {
    need = b.idle.needYou
    const n = b.idle.next
    if (n) {
      words.push(part('nx', 'next ', { color: 'claude' }, 0))
      if (n.tag) words.push(part('nt', `${n.tag} `, { dimColor: true }, 0))
      words.push(part('ni', n.id, { bold: true }, 1))
      words.push(part('nc', ` · ${b.idle.canStart} can start`, { dimColor: true }, 0))
    } else {
      words.push(part('none', 'nothing to start', { dimColor: true }, 0))
    }
  }
  return (
    <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}>
      <Box flexDirection="row" alignItems="center" gap={1} flexShrink={1} overflow="hidden">
        {lead}
        {bar}
        <Box flexDirection="row" flexShrink={1} overflow="hidden">
          {words}
          {need > 0 && part('you', ` · ${need} need you`, { color: 'permission' }, 0)}
        </Box>
      </Box>
      {toggle && <Box flexShrink={0}>{toggle}</Box>}
    </Box>
  )
}

async function drawPane($: any, e: any) {
  const els = $.ui.resolve(e) as any
  const { Box, Text, Button, Svg } = els
  // A press area is a Client: the desktop and the terminal draw it; VS Code resolves one but
  // drops it, so there a row presses by its Button.
  const Client = e.surface === 'desktop' || e.surface === 'terminal' ? els.Client : undefined
  if (!themeKnown) await readTheme($)
  // The terminal resolves an Svg but draws it as nothing: glyphs there.
  const rich = !!Svg && e.surface !== 'terminal'
  const canPress = e.surface !== 'mobile' && (!!Client || !!Button)
  const nowMs = await read($, drawnAt)
  const opened = await read($, folders)
  const cols = Math.max(30, Number(e.props.bodyColumns) || 48)
  const shownRepos = await read($, repos)
  const opts = await timelineOpts($, nowMs)
  const shownPage = canPress ? await read($, page) : null
  const allFiles = await read($, files)
  // A page's files are its own repo's, keyed by ID as the feature page reads them.
  const pageFiles = (folder: string | null | undefined) => Object.fromEntries(Object.entries(allFiles).filter(([k]) => k.startsWith(`${folder ?? ''}\u0000`)).map(([k, list]) => [k.split('\u0000')[1], list]))
  const pg: any = shownPage ? pageOf(shownRepos, shownPage, { ...opts, files: pageFiles((shownPage as any).folder), folders: opened }) : null
  const v: any = pg ? { kind: 'page', page: pg } : timelineOf(shownRepos, opts)

  // A new page stamps the time its clocks count from, then refreshes behind it: the press
  // returns before any file or git read, so the pane redraws on the first click.
  const go = (to: BoardPage | null) => void (async () => {
    await stamp($)
    await update($, page, () => to)
    if (to?.kind === 'feature') await loadFiles($, to.folder ?? null, to.id)
  })()
  const held = (key: string, look: string, run: () => void, build: (onPress: () => void) => any) =>
    keeper.keep(`pane|${e.surface}|${key}`, look, run, build)

  // ---- small pieces ----------------------------------------------------------------------------

  const img = (src: string, alt: string) => <Svg alt={alt} {...dims(src)} source={phaseLock(src, nowMs)} />
  const markEl = (glyph: string) => {
    if (rich) return img(mark(glyph), glyph)
    const [g, tone] = GLYPH[glyph] ?? ['○', 'inactive']
    return <Text color={tone}>{g}</Text>
  }
  const chevEl = () => (rich ? img(chevron({}), 'open') : <Text dimColor>›</Text>)
  // Sub-line space: a 1px-wide spacer image (stops growing past about 10px: stack two); none
  // where there are no images, a line being too much there.
  const strip = (tall: number, key: string) => (rich ? <Box key={key} flexShrink={0}><Svg alt="" width={1} height={tall} source={space(tall)} /></Box> : null)
  const titleGap = (key: string) => [strip(8, `${key}-a`), strip(8, `${key}-b`)]
  // A running time counts up by itself as an SVG clock; a finished time is plain text.
  const svgTime = (key: string, ms: number, format: 'clock' | 'dur', style: any = {}) => {
    if (!rich) return <Text key={`clk-${key}`} {...style}>{format === 'clock' ? elapsed(ms) : duration(ms)}</Text>
    const ink = INK[theme][style.color === 'claude' ? 'claude' : style.dimColor ? 'dim' : 'text']
    const c = svgClock({ ms, format, color: ink, bold: !!style.bold })
    return <Svg key={`clk-${key}`} alt={clockWords(ms, format)} width={c.width} height={c.height} source={c.svg} />
  }
  const tmEl = (t: any, key: string, style: any = {}) => (t && t.live ? svgTime(key, t.ms, 'clock', style) : <Text {...style}>{t ? duration(t.ms) : '—'}</Text>)
  const minEl = (t: any, key: string, style: any = {}) => (t && t.live ? svgTime(key, t.ms, 'dur', style) : <Text {...style}>{t ? duration(t.ms) : ''}</Text>)
  const md = (text: string, key: string, base: any = {}) =>
    inline(text).map((seg: any, i: number) =>
      seg.bold ? <Text key={`${key}-${i}`} bold>{seg.text}</Text> : seg.code ? <Text key={`${key}-${i}`} color="claude">{seg.text}</Text> : <Text key={`${key}-${i}`} {...base}>{seg.text}</Text>,
    )
  const note = (key: string, text: string, props: any = { dimColor: true }) => <Box key={key} flexDirection="column"><Text {...props} wrap="wrap">{text}</Text></Box>
  const headline = (key: string, left: any, right?: any) => (
    <Box key={key} flexDirection="row" alignItems="center">
      <Box flexGrow={1} flexShrink={1} overflow="hidden">{left}</Box>
      {right && <Box flexShrink={0} paddingLeft={1}>{right}</Box>}
    </Box>
  )
  const spaced = (key: string, items: any[]) => items.flatMap((x: any, i: number) => (i ? [strip(6, `${key}-sep-${i}`), x] : [x])).filter(Boolean)

  // A press area (board-press.tsx, a Client that draws one space and posts its clicks) laid over
  // an element: the whole line presses, with no highlight. Without a Client (VS Code) the caller
  // draws a Button instead; on mobile nothing presses.
  // The terminal paints a Client's space over the cell beneath it (a title's first letter, a
  // row's glyph): there the region draws nothing at all.
  const blank = e.surface === 'terminal'
  const pressArea = (id: string, run: () => void) => {
    if (!canPress || !Client) return null
    pressRuns.set(id, run)
    return (
      <Box key={`pa-${id}`} position="absolute" top={0} left={0} right={0} bottom={0}>
        <Client key={`pr-${id}`} module="./board-press.tsx" width="100%" height="100%" props={{ id: `run:${id}`, blank }} />
      </Box>
    )
  }
  const viaButton = canPress && !Client && !!Button
  const pressText = (key: string, look: string, run: () => void, kids: any) =>
    viaButton ? held(key, look, run, onPress => <Button key={key} plain onPress={onPress}>{kids}</Button>) : kids

  // A card in Claude's language: a hairline round border, no fill, the border's room its inset.
  const card = (key: string, blocks: any[]) => rich
    ? (
      <Box key={key} flexDirection="column" borderStyle="round" borderColor={HAIR[theme]}>
        {strip(6, `${key}-top`)}
        {blocks.filter(Boolean)}
        {strip(6, `${key}-end`)}
      </Box>
    )
    : <Box key={key} flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={1}>{blocks.filter(Boolean)}</Box>


  // A legend row: a coloured square or a mark, the ID, on the right what it waits on in its
  // tone, and a dim ›. The whole line presses.
  const lrow = (r: any, o: { hex?: string; right?: any; shrink?: boolean; strong?: boolean } = {}) => {
    const k = r.key
    const run = r.run ?? (() => go(r.open))
    const pressable = !!(r.open || r.run)
    const lead = o.hex && rich ? img(square(o.hex), r.glyph) : markEl(r.glyph)
    const id = r.tag
      ? <Text wrap="truncate-end">{[<Text key="tag" dimColor>{`${r.tag} `}</Text>, <Text key="id" bold={!!o.strong}>{r.id}</Text>]}</Text>
      : <Text bold={!!o.strong} wrap="truncate-end">{r.id}</Text>
    return (
      <Box key={`lrow-${k}`} flexDirection="row" alignItems="center" {...(pressable && Client ? { position: 'relative', overflow: 'hidden' } : {})}>
        <Box flexShrink={0} paddingRight={1}>{lead}</Box>
        <Box flexGrow={1} flexShrink={1} overflow="hidden" flexDirection="column">
          {pressable ? pressText(`open-${k}`, `${r.id}`, run, id) : id}
        </Box>
        {o.right && <Box flexShrink={o.shrink ? 1 : 0} overflow="hidden" paddingLeft={1}>{o.right}</Box>}
        {pressable && <Box flexShrink={0} paddingLeft={1}>{chevEl()}</Box>}
        {pressable && pressArea(k, run)}
      </Box>
    )
  }
  const detailEl = (r: any) => <Text {...toneOf(r.tone)} wrap="truncate-end">{r.detail}</Text>
  // A quiet way on, as Claude's "Show more": dim words, no chevron, the whole line presses.
  const more = (key: string, text: string, to: BoardPage) => (
    <Box key={`more-${key}`} flexDirection="row" position="relative">
      {pressText(`more-${key}`, text, () => go(to), <Text dimColor wrap="truncate-end">{text}</Text>)}
      {pressArea(`more-${key}`, () => go(to))}
    </Box>
  )

  // The effort bar as it is (board-effort.mjs), its phase names under it in the same width.
  const effortEl = (key: string, eff: any) => {
    if (!rich) {
      return (
        <Box key={key} flexDirection="row">
          {(terminalSegments as any)({ cells: Math.max(12, cols - 6), phases: eff.phases, red: eff.red, frame: 0 }).map((s: any, i: number) => (
            <Text key={`seg-${i}`} {...(s.state === 'done' ? { color: 'success' } : s.state === 'current' ? { color: eff.red ? 'error' : 'claude' } : { color: 'inactive' })}>{s.text}</Text>
          ))}
        </Box>
      )
    }
    const W = pxFor(cols - 2)
    return (
      <Box key={key} flexDirection="column" alignItems="center">
        <Svg alt={eff.phases.map((p: any) => `${p.name} ${p.state}`).join(', ')} width={W} height={21} source={phaseLock((tracker as any)({ width: W, phases: eff.phases, red: eff.red }), nowMs)} />
        <Svg alt={eff.phases.map((p: any) => (p.state === 'current' ? eff.step : p.name)).join(' · ')} width={W} height={14} source={(effortLabels as any)({ width: W, phases: eff.phases, red: eff.red, step: eff.step })} />
      </Box>
    )
  }
  // Role / Model / Time: two shared columns and a fixed time column; the live role in claude.
  const roleTable = (key: string, list: any[]) => {
    const line = (k: string, a: [string, any], b: [string, any], c: any) => (
      <Box key={k} flexDirection="row">
        <Box width={0} flexGrow={1} overflow="hidden"><Text {...a[1]} wrap="truncate-end">{a[0]}</Text></Box>
        <Box width={0} flexGrow={1} overflow="hidden"><Text {...b[1]} wrap="truncate-end">{b[0]}</Text></Box>
        <Box width={7} flexShrink={0} flexDirection="row" justifyContent="flex-end">{c}</Box>
      </Box>
    )
    const dim = { dimColor: true }
    return (
      <Box key={key} flexDirection="column">
        {line('role-head', ['Role', dim], ['Model', dim], <Text {...dim}>Time</Text>)}
        {list.map((r: any, i: number) => {
          const isLive = r.state === 'current'
          return line(`role-${i}`, [r.role, isLive ? { color: 'claude' } : {}], [r.model, dim], tmEl(r.time, `${key}-${i}`, isLive ? {} : dim))
        })}
      </Box>
    )
  }

  const backLine = (
    <Box key="back" flexDirection="row" alignItems="center">
      <Box flexShrink={0} position="relative" flexDirection="row" alignItems="center">
        {rich ? img(backArrow({}), 'back') : <Text dimColor>←</Text>}
        {pressText('back-btn', 'back', () => go(null), <Text dimColor>{' Board'}</Text>)}
        {pressArea('back', () => go(null))}
      </Box>
    </Box>
  )

  // Cards one text line apart: between the pane's top-level blocks the desktop lays out cells.
  const shell = (children: any[]) => {
    const out: any[] = []
    children.filter(Boolean).forEach((c: any, i: number) => {
      if (i) out.push(<Box key={`sep-${i}`} height={1} flexShrink={0} />)
      out.push(c)
    })
    return <Box flexDirection="column">{out}</Box>
  }

  // ---- what is drawn -------------------------------------------------------------------------

  if (v.kind === 'message') return <Text dimColor>{v.text}</Text>

  if (v.kind === 'page') {
    const p = v.page
    if (p.kind === 'feature') return shell([backLine, ...featureCards(p)])
    if (p.kind === 'history') {
      return shell([backLine, card('history', [
        headline('h-history', <Text bold>Done on the branch</Text>, <Text dimColor>{`${p.n} done`}</Text>),
        ...titleGap('h-g0'),
        ...p.rows.map((r: any) => doneRow(r)),
      ])])
    }
    if (p.kind === 'queue') {
      return shell([backLine, card('queue', [
        headline('q-head', <Text bold>Can start now</Text>, <Text dimColor>{`${p.eligible.length}`}</Text>),
        ...titleGap('q-g0'),
        ...p.eligible.map((r: any) => lrow(r, { right: detailEl(r) })),
        ...p.waiting.flatMap((g: any) => [
          strip(8, `q-${g.key}-g`),
          note(`q-${g.key}`, g.flight || 'other'),
          ...g.rows.map((r: any) => lrow(r, { right: detailEl(r), shrink: true })),
        ]),
      ])])
    }
  }

  // ---- the timeline ---------------------------------------------------------------------------

  const single = ownRoot !== null
  const head = headline('head', <Text bold wrap="truncate-end">{v.name || rootName}</Text>, version ? <Text dimColor>{`v${version}`}</Text> : undefined)
  const empty = !v.needs.total && !(v.done && v.done.total) && !v.atWork.length && !v.idle.length && !v.startNow.total && !v.next.total
  if (empty) {
    return shell([head, (
      <Box key="cup" flexDirection="column" alignItems="center" paddingY={1}>
        {rich ? img(cup({ size: 64, live: false }), 'roadmap clear') : CUP_TEXT.map((line, i) => <Text key={`cup-${i}`} color="claude">{line}</Text>)}
        <Text dimColor>roadmap clear</Text>
      </Box>
    )])
  }
  const caption = (key: string, text: string, props: any = { dimColor: true }) => <Box key={key} flexDirection="row"><Text {...props} wrap="truncate-end">{text}</Text></Box>
  const plugin = (/^(\d+\.\d+)/.exec(pluginFormat) || [])[1]
  const stale = !!plugin && shownRepos.some((r: any) => r.board.format.project && r.board.format.project !== plugin)

  const needs = v.needs.total > 0 && card('needs', [
    caption('nd-cap', `needs you · ${v.needs.total}`, { color: 'permission' }),
    strip(6, 'nd-g0'),
    ...v.needs.rows.map((r: any) => lrow(r, { right: detailEl(r), shrink: true })),
    v.needs.more > 0 && more('needs', `+${v.needs.more} more`, { kind: 'queue' }),
  ])

  const line: any[] = []
  if (v.done && v.done.total) {
    line.push(caption('dn-cap', `done on ${single ? 'this branch' : 'the brew branches'} · ${v.done.total}`))
    for (const g of v.done.groups) {
      if (g.flight) line.push(caption(`dn-f-${g.flight}`, g.flight))
      line.push(...g.rows.map((r: any) => doneRow(r)))
    }
    if (v.done.more > 0) line.push(more('done', `+${v.done.more} more`, { kind: 'history' }))
  }
  if (v.atWork.length || v.idle.length) {
    if (line.length) line.push(strip(8, 'aw-g'))
    line.push(caption('aw-cap', `at work · ${v.atWork.length}`))
    for (const w of v.atWork) line.push(...workEls(w))
    for (const i of v.idle) line.push(lrow({ key: `idle-${i.folder}`, glyph: 'done', tag: null, id: `${i.folder}: brew has nothing left it can pull` }, { right: <Text dimColor>{`${i.needYou} need you`}</Text>, shrink: true }))
  }
  if (v.startNow.total) {
    if (line.length) line.push(strip(8, 'sn-g'))
    line.push(caption('sn-cap', `can start now · ${v.startNow.total}`))
    line.push(...v.startNow.rows.map((r: any) => lrow(r, { right: detailEl(r), strong: r.glyph === 'next' })))
    if (v.startNow.more > 0) line.push(more('start', `+${v.startNow.more} more`, { kind: 'queue' }))
  }
  if (v.next.total) {
    if (line.length) line.push(strip(8, 'nx-g'))
    line.push(caption('nx-cap', `next · ${v.next.total}`))
    line.push(...v.next.rows.map((r: any) => lrow(r, { right: detailEl(r), shrink: true })))
    if (v.next.more > 0) line.push(more('next', `+${v.next.more} more`, { kind: 'queue' }))
  }
  const foot = (
    <Box key="foot" flexDirection="column">
      {v.foot.map((f: any, i: number) => (
        <Box key={`foot-${i}`} flexDirection="row" alignItems="center">
          {f.tag && <Box flexShrink={0} paddingRight={1}><Text dimColor>{f.tag}</Text></Box>}
          <Box flexGrow={1} flexShrink={1} overflow="hidden"><Text wrap="truncate-middle">{f.branch}</Text></Box>
          {f.note && <Box flexShrink={0} paddingLeft={1}><Text dimColor>{f.note}</Text></Box>}
        </Box>
      ))}
    </Box>
  )
  return shell([
    head,
    stale && note('format', 'written for another ristretto format — the next prep/pull/brew brings it up to date'),
    needs,
    line.length > 0 && <Box key="line" flexDirection="column">{line.filter(Boolean)}</Box>,
    foot,
  ])

  // ---- the rows -------------------------------------------------------------------------------

  // A feature at work: its row with the step and an SVG clock, then its card with the title, the
  // effort bar (the one special thing) and the session it runs in. A stopped one has no clock.
  function workEls(w: any) {
    const stopped = w.state === 'stopped'
    const right = (
      <Box flexDirection="row" alignItems="center">
        <Text {...(stopped ? { dimColor: true } : w.red ? { color: 'error' } : { color: 'claude' })} wrap="truncate-end">{w.step}</Text>
        {!stopped && <Box flexShrink={0} paddingLeft={1}>{svgTime(w.key, Math.max(0, nowMs - w.startedAt), 'clock', { bold: true })}</Box>}
        {stopped && w.since !== null && (
          <Box flexShrink={0} flexDirection="row">
            <Text dimColor>{' · '}</Text>
            {svgTime(`${w.key}-ago`, Math.max(0, nowMs - w.since), 'dur', { dimColor: true })}
            <Text dimColor>{' ago'}</Text>
          </Box>
        )}
      </Box>
    )
    const row = lrow({ key: w.key, glyph: stopped ? 'planned' : w.red ? 'gate-red' : 'running', tag: w.tag, id: w.id, open: w.open }, { right, strong: true, shrink: true })
    const sub = [w.label, w.waited].filter(Boolean).join(' · ')
    const box = card(`${w.key}-card`, [
      !!w.title && note(`${w.key}-t`, w.title),
      !stopped && !!w.effort && strip(6, `${w.key}-g`),
      !stopped && !!w.effort && effortEl(`${w.key}-e`, { phases: w.effort, red: w.red, step: w.step }),
      !!sub && strip(6, `${w.key}-g2`),
      !!sub && note(`${w.key}-s`, sub),
    ])
    return [row, box]
  }

  // A done feature: its time and its own split, never compared with another's.
  function doneRow(r: any) {
    return lrow(r, {
      right: (
        <Box flexDirection="row" alignItems="center">
          <Box flexShrink={0} width={5} flexDirection="row" justifyContent="flex-end"><Text dimColor>{r.meta ?? ''}</Text></Box>
          {rich && r.split && <Box flexShrink={0} paddingLeft={1}>{img(splitBar(r.split, { width: 64 }), splitAlt(r.split))}</Box>}
        </Box>
      ),
    })
  }

  // ---- pages ----------------------------------------------------------------------------------

  // A feature's page: what it is and where it stands, then what waits on the person, what done
  // means for it, its files, its review and its checks. Each says in words what to run in the chat.
  function featureCards(p: any): any[] {
    const d = p.details
    const [said, tone] = STATUS[p.status] ?? ['unknown', 'dim']
    // A decision the build took is information, already in force — never a question.
    const taken = d.decisions.filter((x: any) => x.taken)
    const asks = d.checks.some((x: any) => !x.done)
    const hint = p.status === 'blocked' ? `settle it in the chat: /ristretto:prep ${p.id}`
      : asks ? `say 'manual checks done' in the chat`
        : null
    const head = card('f-head', [
      <Box key="id" flexDirection="row" alignItems="center" gap={1}>
        <Box flexShrink={0}>{markEl(statusGlyph(p.status))}</Box>
        <Box flexGrow={1} flexShrink={1} overflow="hidden"><Text bold wrap="truncate-end">{p.id}</Text></Box>
      </Box>,
      p.title !== '' && note('title', plain(p.title)),
      strip(4, 'fh-g0'),
      <Box key="status"><Text {...(tone === 'dim' ? { dimColor: true } : { color: tone })} wrap="wrap">{p.waitingOn ? `${said} · waits on ${p.waitingOn}` : said}</Text></Box>,
      !!hint && note('hint', hint, { color: 'subtle' }),
      !!p.goal && strip(8, 'fh-g1'),
      !!p.goal && <Box key="goal"><Text wrap="wrap">{md(p.goal, 'goal')}</Text></Box>,
      d.missing && note('missing', 'plan not found'),
      d.deps.length > 0 && strip(8, 'fh-g3'),
      d.deps.length > 0 && note('deps', 'Depends on', { bold: true, dimColor: true }),
      ...d.deps.map((x: any) => lrow({
        key: `dep-${x.id}`, glyph: x.ok ? 'done' : x.status === 'blocked' ? 'blocked' : 'planned', id: x.id,
        open: x.status === 'missing' ? undefined : (siblingOf(x.id) ? { kind: 'feature', id: siblingOf(x.id)!.id, folder: siblingOf(x.id)!.folder } : { kind: 'feature', id: x.id, folder: p.tag ?? null }),
      }, { right: <Text dimColor wrap="truncate-end">{x.status === 'missing' ? '(not on the roadmap)' : x.status}</Text>, shrink: true })),
      !!p.split && strip(10, 'fh-g5'),
      !!p.split && headline('ft', <Text bold>Time</Text>, <Text dimColor>{`${duration(d.run.ms)}${d.run.runs > 1 ? ` · ${d.run.runs} runs` : ''}`}</Text>),
      !!p.split && rich && strip(6, 'ft-g0'),
      !!p.split && rich && <Box key="ft-bar" flexDirection="column" alignItems="center">{img(splitBar(p.split, { width: pxFor(cols - 4) }), splitAlt(p.split))}</Box>,
      !!p.split && (
        <Box key="ft-legend" flexDirection="row" flexWrap="wrap" columnGap={2}>
          {p.split.map((x: any) => (
            <Box key={`lg-${x.phase}`} flexDirection="row" alignItems="center" flexShrink={0}>
              {rich && <Svg alt={x.phase} width={12} height={8} source={`<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8" viewBox="0 0 12 8"><rect width="8" height="8" rx="2" fill="${(PHASE as any)[x.phase] ?? HUE.inactive}"/></svg>`} />}
              <Text>{`${x.phase} `}</Text>
              <Text dimColor>{duration(x.ms)}</Text>
            </Box>
          ))}
        </Box>
      ),
    ])

    const blockers = d.blockers.length > 0 && card('f-blockers', [
      headline('fb', <Text bold color="error">{p.waitingOn ? `Waiting on ${p.waitingOn}` : 'Blocked'}</Text>, <Text dimColor>{String(d.blockers.length)}</Text>),
      strip(4, 'fb-g0'),
      ...spaced('blk', d.blockers.map((b: string, i: number) => (
        <Box key={`blk-${i}`} flexDirection="row" gap={1} alignItems="flex-start">
          <Box flexShrink={0} width={2}><Text dimColor>{`${i + 1}.`}</Text></Box>
          <Box flexShrink={1}><Text wrap="wrap">{md(b, `blk-${i}`)}</Text></Box>
        </Box>
      ))),
    ])

    const acceptance = d.acceptance.length > 0 && card('f-acc', [
      headline('fa', <Text bold>Acceptance</Text>, <Text dimColor>{String(d.acceptance.length)}</Text>),
      strip(4, 'fa-g0'),
      ...spaced('acc', d.acceptance.map((a: any, i: number) => (
        <Box key={`acc-${i}`} flexDirection="row" gap={1} alignItems="flex-start">
          <Box flexShrink={0} width={2}>
            {a.proof ? markEl('done') : a.auto ? <Text dimColor>{`${i + 1}.`}</Text> : markEl('person')}
          </Box>
          {/* The proof line truncates: without overflow hidden its full width sets the column's, and the text runs out of the card. */}
          <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
            <Text wrap="wrap">{md(a.text, `acc-${i}`)}</Text>
            {a.proof && <Text dimColor wrap="truncate-end">{plain(a.proof)}</Text>}
          </Box>
        </Box>
      ))),
      d.unitemised && strip(6, 'fa-g1'),
      d.unitemised && note('fa-prose', "proof not itemised — the plan's Evidence covers these as prose"),
    ])

    const filesCard = p.files && card('f-files', [
      <Box key="ff-h" flexDirection="row" alignItems="center">
        <Box flexGrow={1} flexShrink={1} overflow="hidden">
          <Text wrap="truncate-end">
            {[
              <Text key="t" bold>Files</Text>,
              <Text key="n" dimColor>{` · ${p.files.n}`}</Text>,
              <Text key="a" color="success">{`  +${p.files.add}`}</Text>,
              <Text key="dl" color="error">{` −${p.files.del}`}</Text>,
            ]}
          </Text>
        </Box>
      </Box>,
      strip(6, 'ff-g'),
      ...p.files.rows.map((f: any) => {
        const isDir = f.kind === 'dir'
        const label = isDir ? `${f.empty ? ' ' : f.open ? '▾' : '▸'} ${f.name}` : f.name
        const flip = () => void update($, folders, (all: Record<string, Record<string, boolean>>) => ({ ...all, [p.id]: { ...(all[p.id] ?? {}), [f.path]: !f.open } }))
        const can = isDir && !f.empty
        return (
          <Box key={`file-${f.key}`} flexDirection="row" gap={1} paddingLeft={f.depth * 2} {...(can && Client ? { position: 'relative' } : {})}>
            <Box flexGrow={1} flexShrink={1} overflow="hidden" flexDirection="column">
              {can ? pressText(`dir-${p.id}-${f.path}`, label, flip, <Text bold wrap="truncate-end">{label}</Text>) : <Text bold={isDir} wrap="truncate-end">{label}</Text>}
            </Box>
            {f.bin
              ? <Box flexShrink={0}><Text dimColor>bin</Text></Box>
              : <Box flexShrink={0} flexDirection="row" gap={1}><Text color="success">{`+${f.add}`}</Text><Text color="error">{`−${f.del}`}</Text></Box>}
            {can && pressArea(`dir-${p.id}-${f.path}`, flip)}
          </Box>
        )
      }),
    ])

    const review = (d.review || d.gate || d.findings.length > 0 || d.run || d.commit) && card('f-review', [
      headline('fr', <Text bold {...(d.findings.length ? { color: 'warning' } : {})}>Review</Text>, d.findings.length ? <Text dimColor>{`${d.findings.length} finding${d.findings.length === 1 ? '' : 's'}`}</Text> : undefined),
      strip(4, 'fr-g0'),
      d.review && note('rv', d.review, {}),
      d.gate && note('gate', `gate ${d.gate}`),
      d.findings.length > 0 && strip(6, 'fr-g1'),
      ...spaced('fnd', d.findings.map((f: string, i: number) => (
        <Box key={`fnd-${i}`} flexDirection="row" gap={1} alignItems="flex-start">
          <Box flexShrink={0}>{markEl('findings')}</Box>
          <Box flexShrink={1}><Text wrap="wrap">{md(f, `fnd-${i}`)}</Text></Box>
        </Box>
      ))),
      (d.run || d.commit) && strip(6, 'fr-g2'),
      (d.run || d.commit) && note('rc', [d.run && `${p.split ? '' : `${duration(d.run.ms)} · `}${count(d.run.tokens.in + d.run.tokens.out)} tok`, d.commit && `commit ${d.commit}`].filter(Boolean).join('  ·  ')),
    ])

    // Manual checks: the plan's open boxes, ticked by the person's word.
    const boxes = d.checks
    const ticked = boxes.filter((x: any) => x.done).length
    const checks = boxes.length > 0 && card('f-checks', [
      headline('fc', <Text bold color={ticked === boxes.length ? 'success' : 'permission'}>Checks</Text>, <Text dimColor>{`${ticked} of ${boxes.length}`}</Text>),
      strip(4, 'fc-g0'),
      ...spaced('chk', boxes.map((x: any, i: number) => (
        <Box key={`chk-${i}`} flexDirection="row" gap={1} alignItems="flex-start">
          <Box flexShrink={0}>{markEl(x.done ? 'done' : 'person')}</Box>
          <Box flexShrink={1}><Text wrap="wrap" {...(x.done ? { dimColor: true } : {})}>{md(x.text, `chk-${i}`, x.done ? { dimColor: true } : {})}</Text></Box>
        </Box>
      ))),
      strip(6, 'fc-g1'),
      note('fc-note', "say 'manual checks done' in chat · the board never ticks", { color: 'subtle' }),
    ])

    // What the build decided on its own where a user could see it: in force unless overruled.
    const decided = taken.length > 0 && card('f-decided', [
      headline('fd', <Text bold>Decided while building</Text>, <Text dimColor>{String(taken.length)}</Text>),
      strip(4, 'fd-g0'),
      ...spaced('dec', taken.map((x: any, i: number) => (
        <Box key={`dec-${i}`} flexDirection="row" gap={1} alignItems="flex-start">
          <Box flexShrink={0} width={2}><Text dimColor>{`${i + 1}.`}</Text></Box>
          <Box flexShrink={1}><Text wrap="wrap">{md(x.text, `dec-${i}`)}</Text></Box>
        </Box>
      ))),
      strip(6, 'fd-g1'),
      note('fd-note', `in force · to change one, say so in chat: /ristretto:prep overrule ${p.id} — <what instead>`, { color: 'subtle' }),
    ])

    // What waits on the person comes right after the head.
    const home = p.status === 'blocked' ? blockers : asks ? checks : d.findings.length > 0 ? review : null
    return [head, home, acceptance, filesCard, ...[blockers, review, checks, decided].filter(x => x && x !== home)].filter(Boolean)
  }
}
