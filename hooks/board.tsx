import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, BoardBranch, BoardBrew, BoardDomain, BoardFile, BoardLive, BoardPage, BoardPlan, BoardRecord, BoardRole, BoardRun, BoardStarted, BoardSuite } from '../types'
import { EMPTY_BOARD, bandOf, duration, elapsed, fold, formatOf, inline, mainRoleOf, markerState, plain, parseBrief, parseReport, parseRoadmap, reportText, view } from './board-model.mjs'
import { EMPTY_DOMAIN, entriesOf, markOlder } from './board-domain.mjs'
import { featureIdOf, featureLogArgs, isDocs, parseNumstat, sumFiles } from './board-files.mjs'
import { baseArgs, branchOf, defaultBranch, headArgs, logArgs, parseBase, parseLog, shortHeadArgs, suiteArgs, suiteOf } from './board-branch.mjs'
import { chip, terminalSegments, tracker } from './board-effort.mjs'
import { HAIR, HUE, INK, LEGEND, PHASE, back as backArrow, chev12, chevron, clockWords, cup, dims, effortLabels, mark, phaseLock, space, splitAlt, splitBar, square, stacked, svgClock } from './board-svg.mjs'
import { buttonKeeper } from './board-keep.mjs'
import { parseChecks, parsePlan } from './board-plan.mjs'
import { addGate, addRole, addTokens, closeRole, count, endRun, keep, markPhase, spawnModel, track } from './board-runs.mjs'

// The roadmap board: a read-only view of docs/ristretto/roadmap.md, of the branch the session is
// on and of the run this session is doing. It observes and never answers: every hook passes its
// event on unchanged, and the board starts nothing (the person acts in the chat). Decisions live
// in board-model.mjs; this module reads, keeps state and draws.
//
// How it draws (the desktop, measured; spec 0.2): only when something changes, never on a timer.
// A drawing never reads the clock (the engine redraws a drawing that did, every few seconds, and
// every redraw rebuilds every image and resets every hover): handlers stamp the time they changed
// what is shown in `drawnAt`, running times are SVG clocks that count up by themselves, and the
// animated images are phase-locked to that stamp.

const PANE = 'ristretto-board'
const ROADMAP = 'docs/ristretto/roadmap.md'
const CHECKS = 'docs/ristretto/manual-checks.md'
const MARKER = '.ristretto/pulling'
const ORCHESTRATING = '.ristretto/orchestrating'
const SUITE = '.ristretto/suite.json'

// A repo file by its absolute path. A relative path would resolve against the working
// directory, which a shell `cd` in the session moves: one `cd docs/ristretto/plans` and the
// board said there was no roadmap. The project root does not move with it.
async function repo($: EngineInterface, path: string) {
  return `${await $.session.root()}/${path}`
}

const board = atom({ plugin: 'ristretto', key: 'board' } as const, EMPTY_BOARD as Board)
const live = atom({ plugin: 'ristretto', key: 'live' } as const, null as BoardLive | null)
const elsewhere = atom({ plugin: 'ristretto', key: 'elsewhere' } as const, false)
const page = atom({ plugin: 'ristretto', key: 'page' } as const, null as BoardPage | null)
const domain = atom({ plugin: 'ristretto', key: 'domain' } as const, EMPTY_DOMAIN as BoardDomain)
// Whether the board's pane is open: the band's toggle follows it.
const paneOpen = atom({ plugin: 'ristretto', key: 'paneOpen' } as const, false)
// The one fact opened to its full text, as `<file>\u0000<title>`.
const openFact = atom({ plugin: 'ristretto', key: 'openFact' } as const, null as string | null)
// A feature's files (its commits, found by ID), and the folders opened by hand.
const files = atom({ plugin: 'ristretto', key: 'files' } as const, {} as Record<string, BoardFile[]>)
const folders = atom({ plugin: 'ristretto', key: 'folders' } as const, {} as Record<string, Record<string, boolean>>)
// The run in progress, counted as it goes (tokens, gate time): the drawing never reads it, so a
// token count never redraws the pane. `started` is what the drawing needs of it.
const run = atom({ plugin: 'ristretto', key: 'run' } as const, null as BoardRun | null)
const started = atom({ plugin: 'ristretto', key: 'started' } as const, null as BoardStarted | null)
const runs = atom({ plugin: 'ristretto', key: 'runs' } as const, [] as BoardRecord[])
const branch = atom({ plugin: 'ristretto', key: 'branch' } as const, null as BoardBranch | null)
const suite = atom({ plugin: 'ristretto', key: 'suite' } as const, null as BoardSuite | null)
const brew = atom({ plugin: 'ristretto', key: 'brew' } as const, null as BoardBrew | null)
const roles = atom({ plugin: 'ristretto', key: 'roles' } as const, {} as Record<string, BoardRole[]>)
const drawnAt = atom({ plugin: 'ristretto', key: 'drawnAt' } as const, 0)
// Cards folded by their title, by card key, for the session.
const folds = atom({ plugin: 'ristretto', key: 'folds' } as const, {} as Record<string, boolean>)

let roadmapMtime = -1
let checksMtime = -1
let timers: { cancel: () => void }[] = []
let storeKey = ''
let brewKey = ''
let gitDir: string | null | undefined
// The base ref's reflog (`<common git dir>/logs/<ref>`), once the branch is read.
let baseLog: string | null = null
let lastSig = ''

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

async function refreshBoard($: EngineInterface) {
  try {
    if (!(await $.fs.exists(await repo($, ROADMAP)))) {
      roadmapMtime = -1
      { const v = { ...EMPTY_BOARD, error: 'no-roadmap' }; if (!same(await read($, board), v)) { await update($, board, () => v); await stamp($) } }
      return
    }
    const mtime = (await $.fs.stat(await repo($, ROADMAP))).mtimeMs
    const parsed = parseRoadmap(String(await $.fs.read(await repo($, ROADMAP))))
    // What each open plan says, plus the opened row's plan whatever its status; and the
    // manual checks. A plan that cannot be read is simply absent. A blocked row with no
    // reason in the roadmap says why from its plan's Blockers.
    const shownPage = await read($, page)
    const opened = shownPage?.kind === 'feature' ? shownPage.id : null
    const plans: Record<string, BoardPlan> = {}
    for (const row of parsed.rows) {
      if (!row.plan || (row.status === 'done' && row.id !== opened)) continue
      try {
        plans[row.id] = parsePlan(String(await $.fs.read(await repo($, `docs/ristretto/${row.plan}`)))) as BoardPlan
      } catch {
        // The opened row says its plan was not found.
      }
      if (row.status === 'blocked' && !row.reason) row.reason = plans[row.id]?.blockers[0] ?? ''
    }
    let checks: Record<string, { done: boolean; text: string }[]> = {}
    try {
      if (await $.fs.exists(await repo($, CHECKS))) {
        checksMtime = (await $.fs.stat(await repo($, CHECKS))).mtimeMs
        checks = parseChecks(String(await $.fs.read(await repo($, CHECKS)))) as typeof checks
      } else checksMtime = -1
    } catch {
      // No checks to show.
    }
    let plugin = ''
    try {
      plugin = formatOf(await $.fs.read(`${$.plugin.root}/scripts/version.js`))
    } catch {
      // Without the plugin's format the format line is skipped; the board itself still draws.
    }
    const name = (await $.session.root()).split(/[\\/]/).filter(Boolean).pop() || 'roadmap'
    { const v = { name, rows: parsed.rows, format: { project: parsed.format, plugin }, error: parsed.error, plans, checks }; if (!same(await read($, board), v)) { await update($, board, () => v); await stamp($) } }
    roadmapMtime = mtime
    const shownRow = opened ? parsed.rows.find(r => r.id === opened) : null
    if (shownRow) await loadFiles($, shownRow.id, shownRow.commit)
  } catch (err) {
    roadmapMtime = -1 // a failed read is retried by the next poll, not kept until the file changes
    { const v = { ...(await read($, board)), error: String(err).slice(0, 80) }; if (!same(await read($, board), v)) { await update($, board, () => v); await stamp($) } }
  }
}

// What a feature's commits changed, found by its ID in their subjects (`feat(<ID>): …`), re-read
// whenever its page opens or the roadmap changes — a squash or a fix after review shows at once.
// A row from before that rule may only carry a hash in its Commit cell: that is the roadmap's
// text, not a trusted argument, so only a hash reaches git, after --end-of-options.
async function loadFiles($: EngineInterface, id: string, commit: string) {
  try {
    const root = await $.session.root()
    const byId = await $.process.run(['git', ...featureLogArgs(id)], { cwd: root })
    let list = byId.exitCode === 0 ? sumFiles(parseNumstat(byId.stdout)) : []
    if (list.length === 0 && /^[0-9a-f]{4,40}$/i.test(commit)) {
      const shown = await $.process.run(['git', 'show', '--numstat', '--format=', '--end-of-options', commit], { cwd: root })
      if (shown.exitCode === 0) list = parseNumstat(shown.stdout)
    }
    { const v = { ...(await read($, files)), [id]: list }; if (!same(await read($, files), v)) { await update($, files, () => v); await stamp($) } }
  } catch {
    // The card shows the plan's files meanwhile; the next refresh tries again.
  }
}

const DOMAIN = 'docs/ristretto/domain'
let domainSig = ''

// Domain facts as the files say them, re-read when a file changes. The board only shows them:
// a fact becomes binding, or a conflict is settled, in the chat (prep).
async function refreshDomain($: EngineInterface, force = false) {
  try {
    const dir = `${await $.session.root()}/${DOMAIN}`
    const listed = (await $.fs.exists(dir)) ? (await $.fs.list(dir)).filter(e => e.kind === 'file' && e.name.endsWith('.md')) : []
    const sig = listed.map(e => `${e.name}:${e.mtimeMs}`).sort().join('|')
    if (!force && sig === domainSig) return
    domainSig = sig
    const tree = []
    for (const e of listed) tree.push(...entriesOf(e.name, String(await $.fs.read(`${dir}/${e.name}`))))
    { const v = { tree: markOlder(tree) }; if (!same(await read($, domain), v)) { await update($, domain, () => v); await stamp($) } }
  } catch {
    // The next poll tries again.
  }
}

// git, from the session root, by argv: never a shell.
async function git($: EngineInterface, args: string[]) {
  try {
    return await $.process.run(['git', ...args], { cwd: await $.session.root() })
  } catch {
    return { exitCode: 1, stdout: '', stderr: '' }
  }
}

// The branch, its base and the features on it (spec 4.1–4.3). Not a git repo: no Branch card.
async function refreshBranch($: EngineInterface) {
  try {
    const at = await git($, headArgs)
    if (at.exitCode !== 0) {
      { const v = null; if (!same(await read($, branch), v)) { await update($, branch, () => v); await stamp($) } }
      return
    }
    let head = at.stdout.trim()
    if (head === 'HEAD') head = (await git($, shortHeadArgs)).stdout.trim() || 'HEAD'
    const origin = await git($, baseArgs.originHead)
    const listed = await git($, baseArgs.refs)
    const originHead = origin.exitCode === 0 ? origin.stdout : ''
    const refs = listed.exitCode === 0 ? listed.stdout : ''
    // Whether local main is behind origin/main: refs from git's own output, never an option.
    const have = new Set(refs.split(/\r?\n/).map(s => s.trim()).filter(Boolean))
    const behind = new Map<string, boolean>()
    for (const n of ['main', 'master']) {
      const local = `refs/heads/${n}`
      const remote = `refs/remotes/origin/${n}`
      if (have.has(local) && (have.has(remote) || originHead.trim() === remote)) {
        behind.set(`${local}|${remote}`, (await git($, ['merge-base', '--is-ancestor', local, remote])).exitCode === 0)
      }
    }
    const base = parseBase({ head, originHead, refs, isAncestor: (a: string, b: string) => behind.get(`${a}|${b}`) ?? false })
    let commits: { at: number; subject: string }[] = []
    baseLog = null
    if (base) {
      const common = (await git($, ['rev-parse', '--git-common-dir'])).stdout.trim()
      if (common) baseLog = `${/^([A-Za-z]:)?[\\/]/.test(common) ? common : `${await $.session.root()}/${common}`}/logs/${base.ref}`
      const log = await git($, logArgs(base.ref))
      if (log.exitCode === 0) commits = parseLog(log.stdout) as typeof commits
    }
    // A feature is a roadmap row, or an archived plan of one that left the roadmap.
    const rows = new Set((await read($, board)).rows.map(r => r.id))
    const archived = new Set<string>()
    for (const c of commits) {
      const id = isDocs(c.subject) ? null : featureIdOf(c.subject)
      if (id && !rows.has(id) && !archived.has(id) && (await $.fs.exists(await repo($, `docs/ristretto/plans/archived/${id}.md`)))) archived.add(id)
    }
    const onDefault = head === defaultBranch({ originHead, refs })
    const next = branchOf({ head, base, commits, known: (id: string) => rows.has(id) || archived.has(id), runs: await read($, runs), now: await $.clock.now(), onDefault })
    { const v = next; if (!same(await read($, branch), v)) { await update($, branch, () => v); await stamp($) } }
  } catch {
    // The next turn tries again.
  }
}

// The full-suite verdict, current only while it proves the code that is there (spec 4.5).
async function readSuite($: EngineInterface) {
  try {
    let record: any = null
    try {
      if (await $.fs.exists(await repo($, SUITE))) record = JSON.parse(String(await $.fs.read(await repo($, SUITE))))
    } catch {
      record = null // half-written or unreadable: unproven
    }
    const at = await git($, ['rev-parse', 'HEAD'])
    const head = at.exitCode === 0 ? at.stdout.trim() : null
    const args = suiteArgs(record?.tree)
    const treeMatches = args ? (await git($, args)).exitCode === 0 : false
    { const v = suiteOf(record, { treeMatches, head }); if (!same(await read($, suite), v)) { await update($, suite, () => v); await stamp($) } }
  } catch {
    // The next turn tries again.
  }
}

// A cheap signature of what git and the suite record are: the poll reads the branch again only
// when it moved (a commit, a checkout, a verify).
async function gitSig($: EngineInterface) {
  try {
    if (gitDir === undefined) {
      const at = await git($, ['rev-parse', '--absolute-git-dir'])
      gitDir = at.exitCode === 0 ? at.stdout.trim() : null
    }
    const paths = [...(gitDir ? [`${gitDir}/HEAD`, `${gitDir}/logs/HEAD`] : []), ...(baseLog ? [baseLog] : []), await repo($, SUITE)]
    const parts: string[] = []
    for (const p of paths) {
      try {
        parts.push(String((await $.fs.stat(p)).mtimeMs))
      } catch {
        parts.push('-')
      }
    }
    return parts.join('|')
  } catch {
    return ''
  }
}

async function observe($: EngineInterface, obs: Parameters<typeof fold>[1]) {
  try {
    const now = await $.clock.now()
    const before = await read($, live)
    const after = fold(before, obs, now)
    { const v = after; if (!same(await read($, live), v)) { await update($, live, () => v); await stamp($) } }
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
    await settleBrew($, after, obs)
  } catch {
    // An observation that fails leaves the board as it was; it must never fail the event.
  }
}

// This brew's snapshot: a check re-run's brief joins it; the run's end clears it.
async function settleBrew($: EngineInterface, after: BoardLive | null, obs: any) {
  const snap = await read($, brew)
  if (!snap) return
  if (!after) {
    { const v = null; if (!same(await read($, brew), v)) { await update($, brew, () => v); await stamp($) } }
    if (brewKey) await $.store.set(brewKey, null)
    return
  }
  if (after.command === 'brew' && obs.kind === 'brief' && !snap.ids.includes(obs.id)) {
    const next = { ...snap, ids: [...snap.ids, obs.id], reruns: [...snap.reruns, obs.id] }
    { const v = next; if (!same(await read($, brew), v)) { await update($, brew, () => v); await stamp($) } }
    if (brewKey) await $.store.set(brewKey, next)
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
  if (!closing) return
  await refreshBoard($)
  const ended: BoardRun = closing
  const status = (await read($, board)).rows.find(r => r.id === ended.id)?.status ?? 'unknown'
  // Another session in this repo may have kept runs since this one loaded them: add to what
  // the store holds now, not to this session's copy.
  const stored = storeKey ? await $.store.get(storeKey) : null
  const next = keep(Array.isArray(stored) ? (stored as BoardRecord[]) : await read($, runs), endRun(ended, now, status))
  { const v = next; if (!same(await read($, runs), v)) { await update($, runs, () => v); await stamp($) } }
  if (storeKey) await $.store.set(storeKey, next)
}

// Whose run the marker is, from the session id gate.js writes into it and its age.
async function observeMarker($: EngineInterface) {
  try {
    let owner: string | null = null
    let idleMs: number | null = null
    if (await $.fs.exists(await repo($, MARKER))) {
      owner = String(await $.fs.read(await repo($, MARKER))).trim()
      idleMs = (await $.clock.now()) - (await $.fs.stat(await repo($, MARKER))).mtimeMs
    }
    const state = markerState(owner, idleMs, await $.session.id())
    { const v = state === 'other'; if (!same(await read($, elsewhere), v)) { await update($, elsewhere, () => v); await stamp($) } }
    await observe($, { kind: 'marker', state })
    // A run this session armed but did not see start (a restart mid-brew): only brew writes the
    // orchestrating marker, so that says which command it is.
    const current = await read($, live)
    if (current && !current.command && (await $.fs.exists(await repo($, ORCHESTRATING)))) { const v = { ...current, command: 'brew' as const }; if (!same(await read($, live), v)) { await update($, live, () => v); await stamp($) } }
  } catch {
    // The next poll tries again.
  }
}

// Every 5 s: what changed on disk, read again; nothing changed, nothing written.
async function poll($: EngineInterface) {
  try {
    await observeMarker($)
    const exists = await $.fs.exists(await repo($, ROADMAP))
    const mtime = exists ? (await $.fs.stat(await repo($, ROADMAP))).mtimeMs : -1
    const checks = (await $.fs.exists(await repo($, CHECKS))) ? (await $.fs.stat(await repo($, CHECKS))).mtimeMs : -1
    if (mtime !== roadmapMtime || checks !== checksMtime) await refreshBoard($)
    await refreshDomain($)
    const sig = await gitSig($)
    if (sig !== lastSig) {
      lastSig = sig
      await refreshBranch($)
      await readSuite($)
    }
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const begun = await next(e)
    for (const timer of timers) timer.cancel()
    // The one timer: a poll that writes only what changed. No clock tick: running times count up
    // inside their SVG.
    timers = [$.clock.every(5000, () => void poll($))]
    const root = await $.session.root()
    // Run records live in the engine's store, per repo, so the history outlives the session.
    storeKey = `runs:${root}`
    brewKey = `brew:${root}:${await $.session.id()}`
    gitDir = undefined
    const kept = await $.store.get(storeKey)
    await update($, runs, () => (Array.isArray(kept) ? (kept as BoardRecord[]) : []))
    // A brew this session was running before a restart keeps its snapshot while the marker is ours.
    const snap = (await $.store.get(brewKey)) as BoardBrew | null
    if (snap && Array.isArray(snap.ids)) await update($, brew, () => snap)
    await readTheme($)
    await refreshBoard($)
    await refreshDomain($, true)
    await refreshBranch($)
    await readSuite($)
    await poll($)
    lastSig = await gitSig($)
    if (snap && !(await read($, live))) {
      await update($, brew, () => null)
      await $.store.set(brewKey, null)
    }
    await stamp($)
    return begun
  })

  // A press area (board-press.tsx) was clicked: a card's title folds it, a row runs its press.
  on('ui.message', async ($, e, next) => {
    const id = (e.data as any)?.press
    if (typeof id === 'string' && id.startsWith('run:')) {
      pressRuns.get(id.slice(4))?.()
      return {}
    }
    if (typeof id === 'string' && id.startsWith('fold:')) {
      await toggleFold($, id.slice(5))
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
      const boardValue = await read($, board)
      const b = bandOf(boardValue, await read($, live), await read($, elsewhere), {
        branch: await read($, branch), suite: await read($, suite), plans: boardValue.plans, checks: boardValue.checks, domain: await read($, domain),
      })
      if (!b) return next(e)
      const els = $.ui.resolve(e) as any
      let toggle: any = null
      if (els.Button && e.surface !== 'mobile') {
        const open = await read($, paneOpen)
        const label = open ? 'hide board' : 'board'
        toggle = keeper.keep(`band|${e.surface}|toggle`, label, () => void (open ? closePane($) : openPane($)), (onPress: () => void) => <els.Button key="band-toggle" onPress={onPress}>{label}</els.Button>)
      }
      return bandLine(els, b, await read($, drawnAt), toggle, e.surface)
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
    if (e.command === 'ristretto:status' && e.args.trim() === '' && e.presentation.isFullscreen && (await $.fs.exists(await repo($, ROADMAP)))) {
      await refreshBoard($)
      await openPane($)
      return { text: 'Roadmap opened in the side pane — /ristretto:status <filter> prints it as text.' }
    }
    const hit = /^ristretto:(pull|shot|brew)$/.exec(e.command)
    if (hit) {
      try {
        // brew's set as it starts: every planned row and every check re-run waiting (spec 4.6).
        if (hit[1] === 'brew') {
          const b = await read($, board)
          const reruns = b.rows.filter(r => r.status === 'needs-human' && (b.checks[r.id] ?? []).length > 0 && (b.checks[r.id] ?? []).every(c => c.done)).map(r => r.id)
          const snap = { startedAt: await $.clock.now(), ids: [...b.rows.filter(r => r.status === 'planned').map(r => r.id), ...reruns], reruns }
          { const v = snap; if (!same(await read($, brew), v)) { await update($, brew, () => v); await stamp($) } }
          if (brewKey) await $.store.set(brewKey, snap)
        }
      } catch {
        // Without the snapshot the Brewing card shows no tally.
      }
      await observe($, { kind: 'command', command: hit[1] as 'pull' | 'shot' | 'brew', args: e.args })
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
    if (isRoadmap(e.file_path)) await refreshBoard($)
    return ran
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (isRoadmap(e.file_path)) await refreshBoard($)
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
    await refreshBoard($)
    if (e.agentId === undefined) {
      await observeMarker($)
      await observe($, { kind: 'main-turn-end', interrupted: e.reason === 'aborted' || e.reason === 'error' })
      await refreshBranch($)
      await readSuite($)
      lastSig = await gitSig($)
    }
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

async function toggleFold($: EngineInterface, cardKey: string) {
  await update($, folds, (all: Record<string, boolean>) => ({ ...all, [cardKey]: !all[cardKey] }))
  await stamp($)
}

// Every Button is built once and handed back on each draw, so it keeps its press handle across
// redraws (see board-keep.mjs). Only the band's toggle and the VS Code fallback are Buttons now.
const keeper = buttonKeeper()

// The cup where a surface draws no SVG: in text, never an emoji (they draw unevenly).
const CUP_TEXT = ['   ) )  ( (', '.__________.', '|          |]', '|          |', "`----------'"]

// Glyphs where a surface draws no SVG (the terminal): one character per mark, its tone a theme key.
const GLYPH: Record<string, [string, string]> = {
  planned: ['○', 'inactive'], next: ['○', 'text'], queued: ['○', 'inactive'], running: ['●', 'claude'], lane: ['◉', 'claude'],
  blocked: ['✕', 'error'], 'needs-review': ['◐', 'warning'], 'needs-human': ['◐', 'permission'], done: ['✓', 'success'], ready: ['✓', 'success'],
  'suite-ok': ['✓', 'success'], 'gate-red': ['✕', 'error'], 'suite-red': ['✕', 'error'], facts: ['·', 'inactive'], 'fact-conflict': ['!', 'warning'],
}
const TONE: Record<string, any> = { permission: { color: 'permission' }, warning: { color: 'warning' }, error: { color: 'error' }, dim: { dimColor: true }, default: {} }
const toneOf = (t?: string) => TONE[t ?? 'dim'] ?? TONE.dim
const STATUS: Record<string, [string, string]> = {
  planned: ['planned', 'dim'], 'in-progress': ['in progress', 'claude'], blocked: ['blocked', 'error'], 'needs-human': ['needs a person', 'permission'],
  'needs-review': ['needs review', 'warning'], done: ['done', 'success'], unknown: ['unknown', 'dim'],
}
const GLYPH_OF: Record<string, string> = { planned: 'planned', 'in-progress': 'running', blocked: 'blocked', 'needs-human': 'needs-human', 'needs-review': 'needs-review', done: 'done', unknown: 'planned' }
// The pane's cells to CSS pixels: an estimate on the low side, so a bar drawn this wide never
// overflows its slot and gets scaled (the pixels would blur).
const pxFor = (cells: number) => Math.max(120, Math.min(1400, Math.floor(cells * 7.4)))

// The band, one line: the cup, the run's chip while one runs, the words in theme keys, who is
// needed, and the board toggle right. Each part sits in its own box with its own one-line Text;
// the ID gives way first; a part that starts a box starts with a no-break space.
function bandLine(els: any, b: any, nowMs: number, toggle: any, surface: string) {
  const { Box, Text, Svg } = els
  const rich = !!Svg && surface !== 'terminal'
  const running = !!b.running
  const part = (key: string, text: string, props: any, shrink: number) => (
    <Box key={key} flexShrink={shrink} overflow="hidden"><Text {...props} wrap="truncate-end">{text}</Text></Box>
  )
  const lead = rich
    ? <Box key="cup" flexShrink={0}><Svg alt={running ? 'brewing' : 'ristretto'} width={16} height={16} source={cup({ size: 16, live: running && !!b.running.id })} /></Box>
    : null
  let bar: any = null
  let words: any[]
  let need = 0
  if (running) {
    const r = b.running
    need = r.needYou
    if (r.effort) {
      bar = rich
        ? <Box key="bar" flexShrink={0}><Svg alt={`${r.id} ${r.step}`} width={96} height={14} source={phaseLock((chip as any)({ phases: r.effort.phases, red: r.red, width: 96 }), nowMs)} /></Box>
        : (
          <Box key="bar" flexShrink={0} flexDirection="row">
            {(terminalSegments as any)({ cells: 12, phases: r.effort.phases, red: r.red, frame: 0 }).map((s: any, i: number) => (
              <Text key={`seg-${i}`} {...(s.state === 'done' ? { color: 'success' } : s.state === 'current' ? { color: r.red ? 'error' : 'claude' } : { color: 'inactive' })}>{s.text}</Text>
            ))}
          </Box>
        )
    }
    words = r.id
      ? [part('id', r.id, { bold: true }, 1), part('step', ` ${r.step}`, { color: r.red ? 'error' : 'claude' }, 0)]
      : [part('step', r.step, { dimColor: true }, 1)]
  } else if (b.idle.ready) {
    words = [part('ready', 'ready to ship', { color: 'success' }, 0)]
  } else {
    need = b.idle.needYou
    words = [part('open', `${b.idle.open} open`, {}, 0)]
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
  const current = await read($, live)
  const boardValue = await read($, board)
  const facts = await read($, domain)
  const folded = await read($, folds)
  const opened = await read($, folders)
  const cols = Math.max(30, Number(e.props.bodyColumns) || 48)
  const begun = await read($, started)
  const v: any = view(boardValue, current, await read($, elsewhere), {
    page: canPress ? await read($, page) : null,
    plans: boardValue.plans,
    checks: boardValue.checks,
    files: await read($, files),
    folders: opened,
    runs: await read($, runs),
    domain: facts,
    branch: await read($, branch),
    suite: await read($, suite),
    snapshot: await read($, brew),
    roles: await read($, roles),
    run: begun,
    drawnAt: nowMs,
  })

  // A new page stamps the time its clocks count from, then refreshes behind it: the press
  // returns before any file or git read, so the pane redraws on the first click.
  const go = (to: BoardPage | null) => void (async () => {
    await stamp($)
    await update($, page, () => to)
    await refreshBoard($)
    if (to?.kind === 'domain') await refreshDomain($, true)
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
  const pressArea = (id: string, run: () => void) => {
    if (!canPress || !Client) return null
    pressRuns.set(id, run)
    return (
      <Box key={`pa-${id}`} position="absolute" top={0} left={0} right={0} bottom={0}>
        <Client key={`pr-${id}`} module="./board-press.tsx" width="100%" height="100%" props={{ id: `run:${id}` }} />
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

  // A title that folds its card: bold, a small chevron, and while folded a dim summary right.
  const foldTitle = (cardKey: string, title: string, summary: any) => {
    const isFolded = !!folded[cardKey]
    const chev = rich ? img(chev12(isFolded ? 'right' : 'down'), isFolded ? 'open' : 'fold') : <Text dimColor>{isFolded ? '›' : '˅'}</Text>
    const run = () => void toggleFold($, cardKey)
    return (
      <Box key={`fold-${cardKey}`} flexDirection="row" alignItems="center">
        <Box flexShrink={0} position="relative" flexDirection="row" alignItems="center">
          {pressText(`fold-${cardKey}`, `${title}|${isFolded}`, run, <Text bold>{`${title} `}</Text>)}
          {chev}
          {canPress && Client && (
            <Box position="absolute" top={0} left={0} right={0} bottom={0}>
              <Client key={`fold-${cardKey}`} module="./board-press.tsx" width="100%" height="100%" props={{ id: `fold:${cardKey}` }} />
            </Box>
          )}
        </Box>
        <Box flexGrow={1} />
        {isFolded && summary && <Box flexShrink={1} overflow="hidden">{summary}</Box>}
      </Box>
    )
  }
  const isFolded = (k: string) => !!folded[k]

  // A legend row: a coloured square or a mark, the ID, on the right what it waits on in its
  // tone, and a dim ›. The whole line presses.
  const lrow = (r: any, o: { hex?: string; right?: any; shrink?: boolean; strong?: boolean } = {}) => {
    const k = r.key
    const run = r.run ?? (() => go(r.open))
    const pressable = !!(r.open || r.run)
    const lead = o.hex && rich ? img(square(o.hex), r.glyph) : markEl(r.glyph)
    const id = <Text bold={!!o.strong} wrap="truncate-end">{r.id}</Text>
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
  const detailEl = (r: any) => <Text {...toneOf(r.tone)} wrap="truncate-end">{`${r.detail}${r.tag === 'next' ? ' · next' : ''}`}</Text>
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

  if (v.kind === 'cup') {
    return (
      <Box flexDirection="column" alignItems="center" paddingY={1}>
        {rich ? img(cup({ size: 64, live: false }), 'all brewed') : CUP_TEXT.map((line, i) => <Text key={`cup-${i}`} color="claude">{line}</Text>)}
        <Text bold>{`all ${v.total} brewed`}</Text>
        <Text dimColor>roadmap clear</Text>
      </Box>
    )
  }

  if (v.kind === 'page') {
    const p = v.page
    if (p.kind === 'feature') return shell([backLine, ...featureCards(p)])
    if (p.kind === 'domain') return shell([backLine, ...domainCards(p, await read($, openFact))])
    if (p.kind === 'history') {
      return shell([backLine, card('history', [
        headline('h-history', <Text bold>History</Text>, <Text dimColor>{`${p.n} done`}</Text>),
        ...titleGap('h-g0'),
        ...p.rows.map((r: any) => doneRow(r)),
      ])])
    }
    if (p.kind === 'queue') {
      return shell([backLine, card('queue', [
        headline('q-head', <Text bold>Up next</Text>, <Text dimColor>{`${p.eligible.length} ready`}</Text>),
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

  const out: any[] = v.notices.map((n: any) => <Text key={n.key} dimColor wrap="truncate-end">{n.text}</Text>)
  for (const c of v.cards) {
    if (c.kind === 'brewing') out.push(brewingCard(c))
    else if (c.kind === 'branch') out.push(branchCard(c))
    else if (c.kind === 'needs') out.push(needsCard(c))
    else if (c.kind === 'next') out.push(nextCard(c))
    else if (c.kind === 'done') out.push(doneCard(c))
    else if (c.kind === 'facts') out.push(factsCard(c))
  }
  return shell(out)

  // ---- the cards ------------------------------------------------------------------------------

  // The branch, like Claude's Context card: a headline, a stacked bar of its features by state,
  // a legend of what holds it, and a footer. Never "ahead of" anything.
  function branchCard(c: any) {
    const summary = c.ready
      ? <Text color="success" wrap="truncate-end">ready to ship</Text>
      : <Text dimColor wrap="truncate-end">{c.holds.length ? `${c.holds.length} hold it` : c.footer}</Text>
    const head = foldTitle('branch', 'Branch', summary)
    if (isFolded('branch')) return card('branch', [head])
    const hex = (x: any) => (x.glyph === 'needs-review' ? LEGEND.review : x.glyph === 'needs-human' ? LEGEND.human : undefined)
    const holders = c.holds.map((x: any) => lrow(x, { hex: hex(x), right: detailEl(x), shrink: true }))
    if (c.compact) {
      return card('branch', [head, ...titleGap('bn-g0'), ...(c.ready ? [headline('bn-ready', <Text color="success">ready to ship</Text>)] : holders.length ? holders : [note('bn-none', c.footer)])])
    }
    if (!c.scoped) {
      return card('branch', [
        head,
        ...titleGap('bn-g0'),
        headline('bn-head', <Text bold wrap="truncate-middle">{c.branch}</Text>),
        strip(6, 'bn-g1'),
        note('bn-foot', c.footer),
      ])
    }
    return card('branch', [
      head,
      ...titleGap('bn-g0'),
      headline('bn-head', <Text bold wrap="truncate-middle">{c.branch}</Text>, <Text dimColor>{`${c.features} feature${c.features === 1 ? '' : 's'}`}</Text>),
      strip(6, 'bn-g1'),
      rich && <Box key="bn-bar" flexDirection="row">{img(stacked([{ n: c.bar.done, hex: LEGEND.done }, { n: c.bar.review, hex: LEGEND.review }, { n: c.bar.human, hex: LEGEND.human }], pxFor(cols - 4), theme), `${c.bar.done} done, ${c.holds.length} hold it`)}</Box>,
      strip(8, 'bn-g2'),
      ...(c.ready
        ? [headline('bn-ready', <Text color="success">ready to ship</Text>, <Text dimColor>{`${c.done} done`}</Text>)]
        : [
          ...holders,
          headline('bn-done', (
            <Box flexDirection="row" alignItems="center">
              <Box flexShrink={0} paddingRight={1}>{rich ? img(square(LEGEND.done), 'done') : markEl('done')}</Box>
              <Text dimColor>{`${c.done} done`}</Text>
            </Box>
          )),
        ]),
      strip(8, 'bn-g3'),
      note('bn-foot', c.footer, c.suite.state === 'red' ? { color: 'error' } : { dimColor: true }),
    ])
  }

  // The run: the feature at work with its clock, the effort bar (the one special thing), the
  // gate line when red, Role / Model / Time, the rest of this brew, and the tally as the footer.
  function brewingCard(c: any) {
    const lane = c.inset
    const restRight = (r: any) => (
      <Box flexDirection="row" alignItems="center">
        <Text {...toneOf(r.tone)} wrap="truncate-end">{r.detail}</Text>
        {r.meta ? <Box flexShrink={0} paddingLeft={1}><Text dimColor>{r.meta}</Text></Box> : null}
      </Box>
    )
    const t = c.tally
    const foot = t && (
      <Box key="bw-foot" flexDirection="row">
        <Text dimColor>{'brew\u00a0'}</Text>
        {minEl(c.clock, 'brew', { dimColor: true })}
        <Text dimColor wrap="truncate-end">{`\u00a0· ${t.brewed} of ${t.total} brewed${t.blocked ? ` · ${t.blocked} blocked` : ''}${t.toGo ? ` · ${t.toGo} to go` : ''}`}</Text>
      </Box>
    )
    // The rest of this brew and its tally: drawn between features too, and after a restart
    // mid-brew before the next brief names the feature at work.
    const rest = [
      c.rows.length > 0 && strip(10, 'bw-g4'),
      ...c.rows.map((r: any) => lrow(r, { right: restRight(r), shrink: true })),
      (c.more > 0 || c.moreBrewed > 0) && more('brew-more', [c.more > 0 ? `+${c.more} queued` : '', c.moreBrewed > 0 ? `+${c.moreBrewed} brewed` : ''].filter(Boolean).join(' · '), { kind: 'queue' }),
      !!foot && strip(8, 'bw-g6'),
      foot,
    ]
    if (!lane) {
      const head = foldTitle('brewing', c.title, <Text dimColor wrap="truncate-end">{c.text ?? 'starting'}</Text>)
      if (isFolded('brewing')) return card('brewing', [head])
      return card('brewing', [head, ...titleGap('bw-g0'), note('bw-text', c.text ?? 'starting'), ...rest])
    }
    const step = lane.status
    const summary = (
      <Text wrap="truncate-end">{[
        <Text key="i">{lane.id}</Text>,
        <Text key="s" {...(lane.red ? { color: 'error' } : { color: 'claude' })}>{`\u00a0${lane.red ? 'gate red' : step}`}</Text>,
      ]}</Text>
    )
    const head = foldTitle('brewing', c.title, summary)
    if (isFolded('brewing')) return card('brewing', [head])
    const open = () => go({ kind: 'feature', id: lane.id })
    return card('brewing', [
      head,
      ...titleGap('bw-g0'),
      <Box key="bw-head" flexDirection="row" alignItems="center" {...(Client ? { position: 'relative', overflow: 'hidden' } : {})}>
        <Box flexShrink={0} paddingRight={1}>{markEl(lane.red ? 'gate-red' : 'running')}</Box>
        <Box flexGrow={1} flexShrink={1} overflow="hidden">{pressText('open-bw-head', lane.id, open, <Text bold wrap="truncate-end">{lane.id}</Text>)}</Box>
        <Box flexShrink={0} paddingLeft={1}>{tmEl(lane.elapsed, 'bw-head', { bold: true })}</Box>
        {pressArea('bw-head', open)}
      </Box>,
      !!lane.title && <Box key="bw-title"><Text dimColor wrap="truncate-end">{lane.title}</Text></Box>,
      strip(8, 'bw-g1'),
      effortEl('bw-effort', lane.effort),
      lane.gate && strip(6, 'bw-g2'),
      lane.gate && (
        <Box key="bw-gate" flexDirection="row" alignItems="center" gap={1}>
          <Box flexShrink={0}>{markEl('gate-red')}</Box>
          <Box flexShrink={1}><Text color="error" wrap="wrap">{lane.gate.text}</Text></Box>
        </Box>
      ),
      lane.roles.length > 0 && strip(8, 'bw-g3'),
      lane.roles.length > 0 && roleTable('bw-roles', lane.roles),
      ...rest,
    ])
  }


  function needsCard(c: any) {
    const head = foldTitle('needs', 'Needs you', <Text color="permission">{`${c.rows.length}`}</Text>)
    if (isFolded('needs')) return card('needs', [head])
    return card('needs', [head, ...titleGap('nd-g0'), ...c.rows.map((r: any) => lrow(r, { right: detailEl(r), shrink: true }))])
  }

  function nextCard(c: any) {
    const extra = [c.more > 0 ? `+${c.more} more` : '', c.waiting > 0 ? `${c.waiting} waiting on others` : ''].filter(Boolean).join(' · ')
    const head = foldTitle('next', 'Up next', <Text dimColor>{`${c.eligible} ready${c.waiting ? ` · ${c.waiting} waiting` : ''}`}</Text>)
    if (isFolded('next')) return card('next', [head])
    return card('next', [
      head,
      ...titleGap('nx-g0'),
      ...c.rows.map((r: any) => lrow(r, { right: detailEl(r) })),
      !!extra && strip(6, 'nx-g1'),
      !!extra && more('next', extra, { kind: 'queue' }),
    ])
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

  function doneCard(c: any) {
    const where = c.recent ? 'recently' : `${c.n} on this branch`
    if (c.compact) {
      return card('done', [lrow({ key: 'done-compact', glyph: 'done', id: 'Done', open: { kind: 'history' } }, { right: <Text dimColor wrap="truncate-end">{`${where} · ${c.total} in all`}</Text>, shrink: true })])
    }
    const title = c.recent ? 'Recently done' : 'Done'
    const head = foldTitle('done', title, <Text dimColor>{c.recent ? `${c.total} in all` : where}</Text>)
    if (isFolded('done')) return card('done', [head])
    return card('done', [
      head,
      ...titleGap('dn-g0'),
      headline('dn-head', <Text bold>{c.recent ? `${c.rows.length} newest` : where}</Text>, <Text dimColor>{`${c.total} in all`}</Text>),
      c.rows.length > 0 && strip(6, 'dn-g1'),
      ...c.rows.map((r: any) => doneRow(r)),
      strip(6, 'dn-g2'),
      more('history', 'History', { kind: 'history' }),
    ])
  }

  // The facts: one line, as the side pane's "› MCP tools 262".
  function factsCard(c: any) {
    return card('facts', [
      lrow({ key: 'facts', glyph: c.conflicts ? 'fact-conflict' : 'facts', id: 'Domain facts', open: { kind: 'domain' } }, {
        right: (
          <Text wrap="truncate-end">{[
            <Text key="n" dimColor>{`${c.n} · ${c.binding} binding`}</Text>,
            ...(c.conflicts ? [<Text key="c" color="warning">{` · ${c.conflicts} in conflict`}</Text>] : []),
          ]}</Text>
        ),
        shrink: true,
      }),
    ])
  }

  // ---- pages ----------------------------------------------------------------------------------

  // A feature's page: what it is and where it stands, then what waits on the person, what done
  // means for it, its files, its review and its checks. Each says in words what to run in the chat.
  function featureCards(p: any): any[] {
    const d = p.details
    const [said, tone] = STATUS[p.status] ?? ['unknown', 'dim']
    const hint = p.status === 'blocked' ? `settle it in the chat: /ristretto:prep ${p.id} deep`
      : p.status === 'needs-review' ? `judge it in the chat: /ristretto:pull ${p.id}`
        : p.status === 'needs-human' && d.checks.length && d.checks.every((x: any) => x.done) ? `checks ticked: /ristretto:pull ${p.id} runs them again`
          : null
    const head = card('f-head', [
      <Box key="id" flexDirection="row" alignItems="center" gap={1}>
        <Box flexShrink={0}>{markEl(GLYPH_OF[p.status] ?? 'planned')}</Box>
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
        open: x.status === 'missing' ? undefined : { kind: 'feature', id: x.id },
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
            {a.proof ? markEl('done') : a.auto ? <Text dimColor>{`${i + 1}.`}</Text> : markEl('needs-human')}
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
              <Text key="n" dimColor>{` · ${p.files.planned ? 'planned' : p.files.n}`}</Text>,
              ...(p.files.planned ? [] : [<Text key="a" color="success">{`  +${p.files.add}`}</Text>, <Text key="dl" color="error">{` −${p.files.del}`}</Text>]),
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
            {!p.files.planned && (f.bin
              ? <Box flexShrink={0}><Text dimColor>bin</Text></Box>
              : <Box flexShrink={0} flexDirection="row" gap={1}><Text color="success">{`+${f.add}`}</Text><Text color="error">{`−${f.del}`}</Text></Box>)}
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
          <Box flexShrink={0}>{markEl('needs-review')}</Box>
          <Box flexShrink={1}><Text wrap="wrap">{md(f, `fnd-${i}`)}</Text></Box>
        </Box>
      ))),
      (d.run || d.commit) && strip(6, 'fr-g2'),
      (d.run || d.commit) && note('rc', [d.run && `${p.split ? '' : `${duration(d.run.ms)} · `}${count(d.run.tokens.in + d.run.tokens.out)} tok`, d.commit && `commit ${d.commit}`].filter(Boolean).join('  ·  ')),
    ])

    const ticked = d.checks.filter((x: any) => x.done).length
    const checks = d.checks.length > 0 && card('f-checks', [
      headline('fc', <Text bold color={ticked === d.checks.length ? 'success' : 'permission'}>Checks</Text>, <Text dimColor>{`${ticked} of ${d.checks.length}`}</Text>),
      strip(4, 'fc-g0'),
      ...spaced('chk', d.checks.map((x: any, i: number) => (
        <Box key={`chk-${i}`} flexDirection="row" gap={1} alignItems="flex-start">
          <Box flexShrink={0}>{markEl(x.done ? 'done' : 'needs-human')}</Box>
          <Box flexShrink={1}><Text wrap="wrap" {...(x.done ? { dimColor: true } : {})}>{md(x.text, `chk-${i}`, x.done ? { dimColor: true } : {})}</Text></Box>
        </Box>
      ))),
      strip(6, 'fc-g1'),
      note('fc-note', 'ticked in docs/ristretto/manual-checks.md · the board never ticks', { color: 'subtle' }),
    ])

    // What waits on the person comes right after the head.
    const home = p.status === 'blocked' ? blockers : p.status === 'needs-review' ? review : p.status === 'needs-human' ? checks : null
    return [head, home, acceptance, filesCard, ...[blockers, review, checks].filter(x => x && x !== home)].filter(Boolean)
  }

  // The facts as information: per file, in conflict first, then binding, then context. A fact
  // opens to its full text in place; nothing is confirmed or settled here (that is prep's).
  function domainCards(p: any, openedFact: string | null): any[] {
    const cards: any[] = [card('d-head', [
      headline('dh', <Text bold {...(p.conflicts ? { color: 'warning' } : {})}>Domain facts</Text>, <Text dimColor>{String(p.n)}</Text>),
      strip(4, 'dh-g'),
      note('dh-sum', `${p.binding} binding${p.conflicts ? ` · ${p.conflicts} in conflict` : ''} · binding facts hold the builder and the reviewer; the rest is context · settled in the chat (prep)`),
    ])]
    for (const g of p.groups) {
      cards.push(card(`d-${g.file}`, [
        headline(`dg-${g.file}`, <Text bold>{g.name}</Text>, <Text dimColor>{String(g.rows.length)}</Text>),
        strip(4, `dg-${g.file}-g`),
        ...g.rows.flatMap((f: any) => {
          const id = `${g.file}\u0000${f.title}`
          const isOpen = openedFact === id
          const tags = [f.state === 'confirmed' ? 'binding' : '', f.older ? 'older version' : '', f.conflict ? 'in conflict' : ''].filter(Boolean).join(' · ')
          const r = lrow({
            key: `fact-${g.file}-${f.title}`, glyph: f.conflict ? 'fact-conflict' : 'facts', id: plain(f.title),
            run: () => void (async () => {
              await update($, openFact, (o: string | null) => (o === id ? null : id))
              await stamp($)
            })(),
          }, { right: <Text {...(f.conflict ? { color: 'warning' } : f.state === 'confirmed' ? { color: 'success' } : { dimColor: true })} wrap="truncate-end">{tags || plain(f.text)}</Text>, shrink: true })
          if (!isOpen) return [r]
          return [r, (
            <Box key={`full-${g.file}-${f.title}`} flexDirection="column" paddingLeft={2}>
              <Text wrap="wrap">{md(f.text, `ft-${f.title}`)}</Text>
              {f.source !== '' && <Text dimColor wrap="wrap">{f.source}</Text>}
              {f.by !== '' && <Text color="subtle" wrap="wrap">{f.by}</Text>}
              {f.conflict && <Text color="warning" wrap="wrap">{`conflict: ${plain(f.conflict.what)}${f.conflict.source ? ` (${f.conflict.source})` : ''}${f.conflict.by ? `, noticed by ${f.conflict.by}` : ''}`}</Text>}
            </Box>
          )]
        }),
      ]))
    }
    return cards
  }
}
