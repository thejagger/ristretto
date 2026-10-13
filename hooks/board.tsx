import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, BoardDomain, BoardFile, BoardLive, BoardPage, BoardPlan, BoardRecord, BoardRun } from '../types'
import { EMPTY_BOARD, bandOf, bar, duration, fold, formatOf, inline, markerState, plain, parseBrief, parseReport, parseRoadmap, reportText, view } from './board-model.mjs'
import { EMPTY_DOMAIN, entriesOf, markOlder } from './board-domain.mjs'
import { featureLogArgs, parseNumstat, sumFiles } from './board-files.mjs'
import { buttonKeeper } from './board-keep.mjs'
import { parseChecks, parsePlan } from './board-plan.mjs'
import { addGate, addTokens, count, endRun, keep, markPhase, track } from './board-runs.mjs'

// The roadmap board: a read-only view of docs/ristretto/roadmap.md and of the run this session
// is doing, plus buttons that start pull/shot/brew the way typing them would. It observes and
// never answers: every hook passes its event on unchanged. Decisions live in board-model.mjs.

const PANE = 'ristretto-board'
const ROADMAP = 'docs/ristretto/roadmap.md'
const CHECKS = 'docs/ristretto/manual-checks.md'
const MARKER = '.ristretto/pulling'

// A repo file by its absolute path. A relative path would resolve against the working
// directory, which a shell `cd` in the session moves: one `cd docs/ristretto/plans` and the
// board said there was no roadmap. The project root does not move with it.
async function repo($: EngineInterface, path: string) {
  return `${await $.session.root()}/${path}`
}

const board = atom({ plugin: 'ristretto', key: 'board' } as const, EMPTY_BOARD as Board)
const live = atom({ plugin: 'ristretto', key: 'live' } as const, null as BoardLive | null)
const elsewhere = atom({ plugin: 'ristretto', key: 'elsewhere' } as const, false)
const showDone = atom({ plugin: 'ristretto', key: 'showDone' } as const, false)
const tick = atom({ plugin: 'ristretto', key: 'tick' } as const, 0)
const page = atom({ plugin: 'ristretto', key: 'page' } as const, null as BoardPage | null)
const domain = atom({ plugin: 'ristretto', key: 'domain' } as const, EMPTY_DOMAIN as BoardDomain)
// The one fact opened to its full text, as `<file>\u0000<title>`.
// Whether the board's pane is open: the band's open/close follows it.
const paneOpen = atom({ plugin: 'ristretto', key: 'paneOpen' } as const, false)
const openFact = atom({ plugin: 'ristretto', key: 'openFact' } as const, null as string | null)
// A feature's files (its commits, found by ID), and the folders opened by hand.
const files = atom({ plugin: 'ristretto', key: 'files' } as const, {} as Record<string, BoardFile[]>)
const folders = atom({ plugin: 'ristretto', key: 'folders' } as const, {} as Record<string, Record<string, boolean>>)
const run = atom({ plugin: 'ristretto', key: 'run' } as const, null as BoardRun | null)
const runs = atom({ plugin: 'ristretto', key: 'runs' } as const, [] as BoardRecord[])

let roadmapMtime = -1
let timers: { cancel: () => void }[] = []
let storeKey = ''

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
      await update($, board, () => ({ ...EMPTY_BOARD, error: 'no-roadmap' }))
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
        plans[row.id] = parsePlan(String(await $.fs.read(await repo($, `docs/ristretto/${row.plan}`))))
      } catch {
        // The opened row says its plan was not found.
      }
      if (row.status === 'blocked' && !row.reason) row.reason = plans[row.id]?.blockers[0] ?? ''
    }
    let checks: Record<string, { done: boolean; text: string }[]> = {}
    try {
      if (await $.fs.exists(await repo($, CHECKS))) checks = parseChecks(String(await $.fs.read(await repo($, CHECKS))))
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
    await update($, board, () => ({ name, rows: parsed.rows, format: { project: parsed.format, plugin }, error: parsed.error, plans, checks }))
    roadmapMtime = mtime
    const shownRow = opened ? parsed.rows.find(r => r.id === opened) : null
    if (shownRow) await loadFiles($, shownRow.id, shownRow.commit)
  } catch (err) {
    roadmapMtime = -1 // a failed read is retried by the next poll, not kept until the file changes
    await update($, board, b => ({ ...b, error: String(err).slice(0, 80) }))
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
    await update($, files, all => ({ ...all, [id]: list }))
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
    await update($, domain, () => ({ tree: markOlder(tree) }))
  } catch {
    // The next poll tries again.
  }
}

async function observe($: EngineInterface, obs: Parameters<typeof fold>[1]) {
  try {
    const now = await $.clock.now()
    await update($, live, l => fold(l, obs, now))
    await account($)
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
  if (!moved || !closing) return
  await refreshBoard($)
  const ended: BoardRun = closing
  const status = (await read($, board)).rows.find(r => r.id === ended.id)?.status ?? 'unknown'
  // Another session in this repo may have kept runs since this one loaded them: add to what
  // the store holds now, not to this session's copy.
  const stored = storeKey ? await $.store.get(storeKey) : null
  const next = keep(Array.isArray(stored) ? (stored as BoardRecord[]) : await read($, runs), endRun(ended, now, status))
  await update($, runs, () => next)
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
    await update($, elsewhere, () => state === 'other')
    await observe($, { kind: 'marker', state })
  } catch {
    // The next poll tries again.
  }
}

async function poll($: EngineInterface) {
  try {
    await observeMarker($)
    const mtime = (await $.fs.exists(await repo($, ROADMAP))) ? (await $.fs.stat(await repo($, ROADMAP))).mtimeMs : -1
    if (mtime !== roadmapMtime) await refreshBoard($)
    await refreshDomain($)
  } catch {
    // The next tick tries again.
  }
}

// Elapsed times move once a second while a phase is running; nothing redraws otherwise.
async function advanceClock($: EngineInterface) {
  try {
    const current = await read($, live)
    if (current && current.id && current.phase && current.phase !== 'interrupted') {
      const now = await $.clock.now()
      await update($, tick, () => now)
    }
  } catch {
    // A missed tick is the next tick's.
  }
}

// Where the surface draws SVG (the desktop app), status reads as shape and color instead of
// glyphs. SVG cannot read the theme, so these are mid-tone hues that hold on light and dark.
// Error is a true red: next to Claude's orange, a redder orange read as the same thing.
const HUE: Record<string, string> = {
  claude: '#D97757',
  success: '#3FA66B',
  warning: '#D49A3A',
  error: '#E5484D',
  permission: '#5B8DEF',
  inactive: '#8A8A8A',
}

// The summary's progress as one stacked pill, a segment per status in the view's order, where
// the surface draws SVG: box-drawing glyphs are wider than a cell there, so a text bar wraps.
// What is still planned is the faint track the rest fills; a thin gap parts two segments, so
// neighbours of close hues still read as two.
function statusBarSvg(segments: { status: string; n: number; tone: string }[]) {
  const total = segments.reduce((sum, s) => sum + s.n, 0) || 1
  const gap = 5
  const span = 1000 - gap * (segments.length - 1)
  let x = 0
  const parts = segments.map(s => {
    const w = (span * s.n) / total
    const rect = `<rect x="${x.toFixed(1)}" width="${w.toFixed(1)}" height="8" fill="${HUE[s.tone] ?? HUE.inactive}"${s.status === 'planned' || s.status === 'unknown' ? ' fill-opacity="0.25"' : ''}/>`
    x += w + gap
    return rect
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="8" viewBox="0 0 1000 8" preserveAspectRatio="none"><clipPath id="pill"><rect width="1000" height="8" rx="4"/></clipPath><g clip-path="url(#pill)">${parts.join('')}</g></svg>`
}

// Where one finished feature's time went, as its own proportions — never against another
// feature's, since every feature is different. Phase colors match the text labels' theme keys.
const SPLIT_TONE: Record<string, string> = { plan: 'inactive', code: 'claude', review: 'permission', close: 'success' }
function splitSvg(split: { phase: string; ms: number }[], width: number) {
  const total = split.reduce((sum, s) => sum + s.ms, 0) || 1
  const gap = split.length > 1 ? 2 : 0
  const span = width - gap * (split.length - 1)
  let x = 0
  const parts = split.map(s => {
    const w = Math.max(1.5, (span * s.ms) / total)
    const rect = `<rect x="${x.toFixed(1)}" width="${w.toFixed(1)}" height="6" fill="${HUE[SPLIT_TONE[s.phase]] ?? HUE.inactive}"/>`
    x += w + gap
    return rect
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="6" viewBox="0 0 ${width} 6" preserveAspectRatio="none"><clipPath id="split"><rect width="${width}" height="6" rx="3"/></clipPath><g clip-path="url(#split)">${parts.join('')}</g></svg>`
}

// A chip as a rounded pill: tinted fill, text in the hue. The width is estimated from the
// text, since an image cannot measure itself; 6.7px a character at 11.5px holds for labels.
function chipSvg(text: string, tone: string) {
  const hue = HUE[tone] ?? HUE.inactive
  const width = Math.ceil(text.length * 6.7) + 16
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="18" viewBox="0 0 ${width} 18"><rect width="${width}" height="18" rx="9" fill="${hue}" fill-opacity="0.16"/><text x="${width / 2}" y="12.6" text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="11.5" fill="${hue}">${safe}</text></svg>`
}

// One icon per status, so a row reads at a glance without a word: a play mark for what can
// start, traffic signs for what is stopped or needs a look, a person for what waits on you.
function iconSvg(status: string) {
  const shapes: Record<string, string> = {
    planned: `<path d="M4.5 2.6v8.8l7-4.4z" fill="none" stroke="${HUE.inactive}" stroke-width="1.4" stroke-linejoin="round"/>`,
    'in-progress': `<path d="M4.5 2.6v8.8l7-4.4z" fill="${HUE.claude}" stroke="${HUE.claude}" stroke-width="1.4" stroke-linejoin="round"/>`,
    blocked: `<path d="M4.6 1h4.8L13 4.6v4.8L9.4 13H4.6L1 9.4V4.6z" fill="${HUE.error}"/><rect x="3.8" y="6.2" width="6.4" height="1.6" rx=".4" fill="#fff"/>`,
    'needs-review': `<path d="M7 1.3l6 11.2H1z" fill="${HUE.warning}" stroke="${HUE.warning}" stroke-width="1" stroke-linejoin="round"/><rect x="6.35" y="4.8" width="1.3" height="4" rx=".5" fill="#fff"/><circle cx="7" cy="10.4" r=".8" fill="#fff"/>`,
    'needs-human': `<circle cx="7" cy="4.4" r="2.6" fill="${HUE.permission}"/><path d="M1.8 13c0-3 2.3-4.8 5.2-4.8s5.2 1.8 5.2 4.8z" fill="${HUE.permission}"/>`,
    done: `<circle cx="7" cy="7" r="6" fill="${HUE.success}"/><path d="M4.3 7.2l1.9 1.9 3.6-3.9" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
    // Domain facts: an open book, so the person icon only ever means "you have something to do".
    facts: `<path d="M7 3.2C5.6 2.2 3.6 1.9 1.6 2.2v8.6c2-.3 4 0 5.4 1 1.4-1 3.4-1.3 5.4-1V2.2c-2-.3-4 0-5.4 1z" fill="none" stroke="${HUE.inactive}" stroke-width="1.2" stroke-linejoin="round"/><path d="M7 3.2v8.6" stroke="${HUE.inactive}" stroke-width="1.2"/>`,
    'fact-conflict': `<path d="M7 3.2C5.6 2.2 3.6 1.9 1.6 2.2v8.6c2-.3 4 0 5.4 1 1.4-1 3.4-1.3 5.4-1V2.2c-2-.3-4 0-5.4 1z" fill="none" stroke="${HUE.warning}" stroke-width="1.2" stroke-linejoin="round"/><path d="M7 3.2v8.6" stroke="${HUE.warning}" stroke-width="1.2"/><circle cx="11" cy="3" r="2.6" fill="${HUE.warning}"/><rect x="10.45" y="1.4" width="1.1" height="2" rx=".4" fill="#fff"/><circle cx="11" cy="4.3" r=".55" fill="#fff"/>`,
  }
  const shape = shapes[status] ?? `<circle cx="7" cy="7" r="5" fill="none" stroke="${HUE.inactive}" stroke-width="1.4"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">${shape}</svg>`
}

// The cup the summary card carries, steam and all.
const CUP = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path d="M6.5 1.8c-.9 1 .9 1.8 0 2.9M9.5 1.8c-.9 1 .9 1.8 0 2.9M12.5 1.8c-.9 1 .9 1.8 0 2.9" fill="none" stroke="${HUE.inactive}" stroke-width="1.2" stroke-linecap="round"/><path d="M3 7h12v5.5a4.5 4.5 0 0 1-4.5 4.5h-3A4.5 4.5 0 0 1 3 12.5z" fill="${HUE.claude}"/><path d="M15 8.5h1.3a2.2 2.2 0 0 1 0 4.4H15" fill="none" stroke="${HUE.claude}" stroke-width="1.6"/><rect x="2" y="17.6" width="14" height="1.4" rx=".7" fill="${HUE.claude}" fill-opacity=".55"/></svg>`

// The run's steps as a tracker: dots on a line, done green with a tick, the current one in
// Claude's accent with a ring, the rest hollow; each labelled underneath. A step is drawn at a
// fixed size and only the lines between steps stretch, so a wide pane spreads the steps out
// instead of scaling them up. A step carries the stubs of its lines up to its edges.
const STEP = 72
const trackLine = (done: boolean, x1: number, x2: number) =>
  `<rect x="${x1}" y="8" width="${Math.max(0, x2 - x1)}" height="2" fill="${done ? HUE.success : HUE.inactive}" fill-opacity="${done ? 1 : 0.4}"/>`
function stepSvg(st: { label: string; state: string }, into: boolean | null, out: boolean | null) {
  const c = STEP / 2
  const parts: string[] = []
  if (into !== null) parts.push(trackLine(into, 0, c - 6))
  if (out !== null) parts.push(trackLine(out, c + 6, STEP))
  if (st.state === 'done') {
    parts.push(`<circle cx="${c}" cy="9" r="6" fill="${HUE.success}"/><path d="M${c - 3} 9.2l2 2 4-4.4" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`)
  } else if (st.state === 'current') {
    parts.push(`<circle cx="${c}" cy="9" r="8" fill="${HUE.claude}" fill-opacity="0.25"/><circle cx="${c}" cy="9" r="5" fill="${HUE.claude}"/>`)
  } else {
    parts.push(`<circle cx="${c}" cy="9" r="5" fill="none" stroke="${HUE.inactive}" stroke-width="1.5"/>`)
  }
  const hue = st.state === 'done' ? HUE.success : st.state === 'current' ? HUE.claude : HUE.inactive
  const weight = st.state === 'current' ? 600 : 400
  parts.push(`<text x="${c}" y="32" text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="12" font-weight="${weight}" fill="${hue}">${st.label}</text>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${STEP}" height="38" viewBox="0 0 ${STEP} 38">${parts.join('')}</svg>`
}

// The stretch of line between two steps: as wide as the pane leaves it, never taller.
function lineSvg(done: boolean) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="18" viewBox="0 0 1000 18" preserveAspectRatio="none">${trackLine(done, 0, 1000)}</svg>`
}

function isRoadmap(path: unknown) {
  return typeof path === 'string' && path.replace(/\\/g, '/').endsWith(ROADMAP)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    for (const timer of timers) timer.cancel()
    timers = [$.clock.every(5000, () => void poll($)), $.clock.every(1000, () => void advanceClock($))]
    // Run records live in the engine's store, per repo, so the history outlives the session.
    storeKey = `runs:${await $.session.root()}`
    const kept = await $.store.get(storeKey)
    await update($, runs, () => (Array.isArray(kept) ? (kept as BoardRecord[]) : []))
    await refreshBoard($)
    await refreshDomain($, true)
    await poll($)
    return started
  })

  // The band above the prompt: how far the roadmap is, what is blocked, what runs now, and
  // open/close for the pane — the way back to it after closing it. Only where there is a roadmap.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, live)
    const band = bandOf(await read($, board), current, Math.max(await read($, tick), current?.since ?? 0), await read($, elsewhere))
    if (!band) return next(e)
    const { Box, Text, Button, Svg } = $.ui.resolve(e) as any
    const rich = Svg !== undefined
    const canPress = e.surface !== 'mobile' && Button !== undefined
    const open = await read($, paneOpen)
    const rest = band.total - band.done - band.blocked
    const segments = [
      { status: 'done', n: band.done, tone: 'success' },
      { status: 'blocked', n: band.blocked, tone: 'error' },
      { status: 'planned', n: rest, tone: 'inactive' },
    ].filter(x => x.n > 0)
    const filled = bar(band.done, band.total, 8)
    return (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
        <Box flexDirection="row" gap={1} alignItems="center" flexShrink={1} overflow="hidden">
          {rich ? <Svg alt="ristretto" width={16} height={16} source={CUP} /> : <Text>☕</Text>}
          <Box flexShrink={0}><Text>{`${band.done}/${band.total}`}</Text></Box>
          {rich ? (
            <Box flexShrink={0}><Svg alt={`${band.done} of ${band.total} brewed`} width={60} height={6} source={statusBarSvg(segments)} /></Box>
          ) : (
            <Box flexShrink={0}><Text color="success">{'━'.repeat(filled.filled)}</Text><Text color="inactive">{'─'.repeat(filled.empty)}</Text></Box>
          )}
          {band.blocked > 0 && (
            <Box flexShrink={0} flexDirection="row" gap={1} alignItems="center">
              {rich ? <Svg alt="blocked" width={12} height={12} source={iconSvg('blocked')} /> : <Text color="error">✕</Text>}
              <Text color="error">{`${band.blocked}`}</Text>
            </Box>
          )}
          {band.running && (
            <Box flexShrink={1} overflow="hidden">
              <Text wrap="truncate-end">
                <Text color="claude">● </Text>
                {band.running.id && <Text bold>{`${band.running.id} `}</Text>}
                <Text dimColor>{`${band.running.what}${band.running.clock ? ` ${band.running.clock}` : ''}`}</Text>
              </Text>
            </Box>
          )}
        </Box>
        {canPress && (
          <Box flexShrink={0}>
            {open
              ? keeper.keep(`band|${e.surface}|close`, 'close', () => void closePane($), onPress => <Button key="band-toggle" label="close" onPress={onPress} />)
              : keeper.keep(`band|${e.surface}|open`, 'open', () => void openPane($), onPress => <Button key="band-toggle" label="open" onPress={onPress} />)}
          </Box>
        )}
      </Box>
    )
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
    if (hit) await observe($, { kind: 'command', command: hit[1] as 'pull' | 'shot' | 'brew', args: e.args })
    return next(e)
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const brief = parseBrief(String(e.prompt ?? ''))
    if (brief) await observe($, { kind: 'brief', ...brief })
    const ran = await next(e)
    // Only a finished agent has reported: a background, failed or denied one has not.
    if (brief && (ran as any).result?.status === 'completed' && !(ran as any).isError) {
      const verdict = parseReport(brief.role, reportText(ran))
      if (verdict) await observe($, { kind: 'report', role: brief.role, verdict })
    }
    return ran
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
  // tokens as it is answered: a pull's implementer and closer work in the main loop, whose
  // turn only completes after the run has closed. The response streams through untouched.
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
    }
    return done
  })

  // An overview of one-liners; a row's › opens its page — a feature, or the domain facts — and
  // ← goes back. Text colors are theme keys, so light and dark both hold; shapes are SVG in HUE
  // where the surface draws it. Mobile has no buttons: it shows the overview only.
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
// redraws (see board-keep.mjs): a click on the drawing just replaced still runs.
const keeper = buttonKeeper()

async function drawPane($: any, e: any) {
  {
    const { Box, Text, Button, Svg } = $.ui.resolve(e) as any
    const canPress = e.surface !== 'mobile' && Button !== undefined
    const current = await read($, live)
    const now = Math.max(await read($, tick), current?.since ?? 0)
    const showing = await read($, showDone)
    const boardValue = await read($, board)
    const facts = await read($, domain)
    const v = view(boardValue, current, now, await read($, elsewhere), {
      showDone: showing,
      page: canPress ? await read($, page) : null,
      plans: boardValue.plans,
      checks: boardValue.checks,
      files: await read($, files),
      folders: await read($, folders),
      runs: await read($, runs),
      domain: facts,
    })
    // Switch the page at once and refresh behind it: the press returns before any file or git
    // read, so the pane can redraw on the first click.
    const goTo = async (to: BoardPage | null) => {
      await update($, page, () => to)
      void (async () => {
        await refreshBoard($)
        if (to?.kind === 'domain') await refreshDomain($, true)
      })()
    }
    const held = (key: string, look: string, run: () => void, build: (onPress: () => void) => any) =>
      keeper.keep(`pane|${e.surface}|${key}`, look, run, build)
    const inner = Math.max(10, Math.min(30, (e.props.bodyColumns ?? 40) - 6))
    const rich = Svg !== undefined
    const rows = rich ? 1 : 0
    const SIGN: Record<string, string> = { start: '▶', 'brew all': '☕ brew all' }
    // A button never shrinks or wraps: its own box keeps its width.
    // Each action carries its own key from the model: one button per key, never the same kept
    // button twice in a drawing (two rows solving with `prep facts` share a command, not a key).
    const press = (action: { key: string; label: string; command: string; args: string }, primary = false, label?: string) =>
      canPress && (
        <Box key={`press-${action.key}-${label ?? ''}`} flexShrink={0}>
          {held(
            action.key + (label ? `-${label}` : ''),
            `${label ?? (rich ? SIGN[action.label] ?? action.label : action.label)}|${primary}`,
            () => void $.command.run({ command: action.command, args: action.args }),
            onPress => <Button
              label={label ?? (rich ? SIGN[action.label] ?? action.label : action.label)}
              variant={primary ? 'primary' : undefined}
              onPress={onPress}
            />,
          )}
        </Box>
      )
    const act = (key: string, label: string, run: () => void, plain = false) =>
      canPress && (
        <Box key={key} flexShrink={0}>
          {/* The engine takes `plain` only as true or absent: a false value refuses the whole page. */}
          {held(key, `${label}|${plain}`, run, plain
            ? onPress => <Button label={label} plain dimColor onPress={onPress} />
            : onPress => <Button label={label} onPress={onPress} />)}
        </Box>
      )
    const more = (to: BoardPage) => act(`more-${to.kind}-${(to as any).id ?? ''}`, '›', () => void goTo(to), true)
    const back = (where: string) => (
      <Box key="back" flexDirection="row">{act('back', `← ${where.charAt(0).toUpperCase()}${where.slice(1)}`, () => void goTo(null), true)}</Box>
    )
    const mark = (r: any) =>
      rich ? <Svg alt={r.tag || r.status} width={14} height={14} source={iconSvg(r.status)} /> : <Text color={r.tone}>{r.mark}</Text>
    const chip = (key: string, text: string, tone: string) =>
      rich ? <Svg key={key} alt={text} source={chipSvg(text, tone)} /> : <Text key={key} color={tone}>{text}</Text>
    const heading = (key: string, title: string) =>
      rich ? <Text key={key} bold dimColor>{title.charAt(0).toUpperCase() + title.slice(1)}</Text> : <Text key={key} dimColor bold>{title.toUpperCase()}</Text>
    const md = (text: string, key: string) =>
      inline(text).map((seg: any, i: number) =>
        seg.bold ? <Text key={`${key}-${i}`} bold>{seg.text}</Text> : seg.code ? <Text key={`${key}-${i}`} color="claude">{seg.text}</Text> : seg.text,
      )
    const card = (key: string, tone: string, children: any) => (
      <Box key={key} flexDirection="column" borderStyle="round" borderColor={tone} paddingX={1} paddingY={rich ? 1 : 0} gap={rich ? 1 : 0}>{children}</Box>
    )

    // One line per feature: mark, name, what it says, its numbers in a right-hand column, its
    // action, and › to its page.
    const row = (r: any, dim = false) => (
      <Box key={r.key} flexDirection="row" gap={1} alignItems="center">
        {mark(r)}
        {/* The name is the row's button: a target as wide as the name, not a one-glyph › alone. */}
        <Box flexShrink={0}>{canPress ? held(`name-${r.key}`, `${r.id}|${dim}`, () => void goTo({ kind: 'feature', id: r.id }), onPress => <Button key={`name-${r.key}`} plain onPress={onPress}><Text bold={!dim} dimColor={dim}>{r.id}</Text></Button>) : <Text bold={!dim} dimColor={dim}>{r.id}</Text>}</Box>
        {r.waiting.length > 0
          ? chip(`tag-${r.key}`, `waits on ${r.waiting[0].id}${r.waiting.length > 1 ? ` +${r.waiting.length - 1}` : ''}`, 'inactive')
          : r.tag !== '' && (!rich || r.tag === 'easy') && chip(`tag-${r.key}`, r.tag, r.tone)}
        <Box flexGrow={1} flexShrink={1} overflow="hidden"><Text dimColor wrap="truncate-end">{dim ? '' : r.detail}</Text></Box>
        {r.run !== undefined && <Box flexShrink={0}><Text dimColor>{r.run ? duration(r.run.ms) : '—'}</Text></Box>}
        {rich && r.split && <Box flexShrink={0}><Svg alt={r.split.map((s: any) => `${s.phase} ${duration(s.ms)}`).join(', ')} width={64} height={6} source={splitSvg(r.split, 64)} /></Box>}
        {r.action && press(r.action)}
        {more({ kind: 'feature', id: r.id })}
      </Box>
    )

    if (v.kind === 'message') return <Text dimColor>{v.text}</Text>

    if (v.kind === 'page' && v.page.kind === 'feature') {
      const p = v.page
      const d = p.details
      return (
        <Box flexDirection="column" gap={1}>
          {back(p.back)}
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1} alignItems="center">{mark(p)}<Text bold>{p.id}</Text></Box>
            {p.title !== '' && <Text dimColor wrap="wrap">{p.title}</Text>}
          </Box>
          {p.goal && <Text wrap="wrap">{md(p.goal, 'goal')}</Text>}
          {d.deps.length > 0 && (
            <Box flexDirection="row" columnGap={2} flexWrap="wrap" alignItems="center">
              <Text dimColor>depends on</Text>
              {d.deps.map((x: any) => (
                <Box key={`dep-${x.id}`} flexDirection="row" gap={1} alignItems="center">
                  {mark({ status: x.ok ? 'done' : x.status === 'missing' ? 'unknown' : x.status, tone: x.ok ? 'success' : 'inactive', mark: x.ok ? '✓' : '○', tag: x.status })}
                  <Text dimColor={!x.ok}>{x.id}{x.status === 'missing' ? ' (not on the roadmap)' : ''}</Text>
                </Box>
              ))}
            </Box>
          )}
          {d.missing && <Text dimColor>plan not found</Text>}
          {p.split && card('split', 'inactive', <>
            <Text bold dimColor>{`${rich ? 'Time' : 'TIME'} · ${duration(d.run.ms)}${d.run.runs > 1 ? ` · ${d.run.runs} runs` : ''}`}</Text>
            {rich && <Svg alt="time split" height={6} source={splitSvg(p.split, 1000)} />}
            <Box flexDirection="row" columnGap={2} flexWrap="wrap">
              {p.split.map((s: any) => <Text key={`sp-${s.phase}`} color={SPLIT_TONE[s.phase]}>{`${s.phase} ${duration(s.ms)}`}</Text>)}
            </Box>
          </>)}
          {d.blockers.length > 0 && card('blockers', 'error', <>
            <Text bold dimColor>{p.waitingOn ? `Waiting on ${p.waitingOn}` : 'Blocked'}</Text>
            {d.blockers.map((b: string, i: number) => (
              <Box key={`blk-${i}`} flexDirection="row" gap={1} alignItems="flex-start">
                <Box flexShrink={0}><Text dimColor>{`${i + 1}.`}</Text></Box>
                <Box flexShrink={1}><Text wrap="wrap">{md(b, `blk-${i}`)}</Text></Box>
              </Box>
            ))}
            {d.action?.chat && (
              <Box flexDirection="column" gap={rich ? 1 : 0}>
                <Box flexDirection="row">{press(d.action, true, 'solve in chat')}</Box>
                <Text dimColor wrap="wrap">{`Opens /${d.action.command} ${d.action.args} in the chat. Once it's settled, the plan is updated and the feature is planned again.`}</Text>
              </Box>
            )}
          </>)}
          {d.acceptance.length > 0 && card('acceptance', 'inactive', <>
            <Text bold dimColor>{rich ? 'Acceptance' : 'ACCEPTANCE'}</Text>
            <Box flexDirection="column" gap={rows}>
              {d.acceptance.map((a: any, i: number) => (
                <Box key={`acc-${i}`} flexDirection="row" gap={1} alignItems="flex-start">
                  <Box flexShrink={0}>
                    {a.proof ? mark({ status: 'done', tone: 'success', mark: '✓', tag: 'proved' }) : a.auto ? <Text dimColor>{`${i + 1}.`}</Text> : mark({ status: 'needs-human', tone: 'permission', mark: '◐', tag: 'checked by a person' })}
                  </Box>
                  {/* The proof line truncates: without overflow hidden its full width sets the column's, and the text runs out of the card. */}
                  <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
                    <Text wrap="wrap">{md(a.text, `acc-${i}`)}</Text>
                    {a.proof && <Text dimColor wrap="truncate-end">{plain(a.proof)}</Text>}
                  </Box>
                </Box>
              ))}
            </Box>
            {d.unitemised && <Text dimColor wrap="wrap">proof not itemised — the plan's Evidence covers these as prose</Text>}
          </>)}
          {p.files && card('files', 'inactive', <>
            <Text bold dimColor>{p.files.planned ? `${rich ? 'Files' : 'FILES'} · planned` : `${rich ? 'Files' : 'FILES'} · ${p.files.n} · +${p.files.add} −${p.files.del}`}</Text>
            {p.files.rows.map((f: any) => {
              const label = f.kind === 'dir' ? `${f.empty ? ' ' : f.open ? '▾' : '▸'} ${f.name}` : f.name
              const flip = () => void update($, folders, (all: Record<string, Record<string, boolean>>) => ({ ...all, [p.id]: { ...(all[p.id] ?? {}), [f.path]: !f.open } }))
              return (
                <Box key={`file-${f.key}`} flexDirection="row" gap={1} marginLeft={f.depth * 2}>
                  <Box flexGrow={1} flexShrink={1} overflow="hidden">
                    {f.kind === 'dir' && !f.empty && canPress
                      ? held(`dir-${p.id}-${f.path}`, label, flip, onPress => <Button key={`dir-${f.path}`} plain onPress={onPress}><Text bold>{label}</Text></Button>)
                      : <Text bold={f.kind === 'dir'} wrap="truncate-end">{label}</Text>}
                  </Box>
                  {!p.files.planned && (f.bin
                    ? <Box flexShrink={0}><Text dimColor>bin</Text></Box>
                    : <Box flexShrink={0} flexDirection="row" gap={1}><Text color="success">{`+${f.add}`}</Text><Text color="error">{`−${f.del}`}</Text></Box>)}
                </Box>
              )
            })}
          </>)}
          {(d.review || d.gate || d.findings.length > 0 || d.run || d.commit) && card('review', d.findings.length > 0 ? 'warning' : 'inactive', <>
            <Text bold dimColor>{rich ? 'Review' : 'REVIEW'}</Text>
            {d.review && <Text wrap="wrap">{d.review}</Text>}
            {d.gate && <Text dimColor wrap="wrap">{`gate ${d.gate}`}</Text>}
            {d.findings.map((f: string, i: number) => (
              <Box key={`fnd-${i}`} flexDirection="row" gap={1} alignItems="flex-start">{mark({ status: 'needs-review', tone: 'warning', mark: '!', tag: 'finding' })}<Box flexShrink={1}><Text wrap="wrap">{md(f, `fnd-${i}`)}</Text></Box></Box>
            ))}
            {(d.run || d.commit) && <Text dimColor wrap="wrap">{[d.run && `${p.split ? '' : `${duration(d.run.ms)} · `}${count(d.run.tokens.in + d.run.tokens.out)} tok`, d.commit && `commit ${d.commit}`].filter(Boolean).join('  ·  ')}</Text>}
          </>)}
          {d.checks.length > 0 && card('checks', 'permission', <>
            <Text bold dimColor>{rich ? 'Checks' : 'CHECKS'}</Text>
            {d.checks.map((c: any, i: number) => (
              <Box key={`chk-${i}`} flexDirection="row" gap={1} alignItems="flex-start">{c.done ? mark({ status: 'done', tone: 'success', mark: '☑', tag: 'checked' }) : mark({ status: 'needs-human', tone: 'permission', mark: '☐', tag: 'to check' })}<Box flexShrink={1}><Text dimColor={c.done} wrap="wrap">{md(c.text, `chk-${i}`)}</Text></Box></Box>
            ))}
          </>)}
          {d.action && !d.action.chat && <Box flexDirection="row">{press(d.action, true)}</Box>}
        </Box>
      )
    }

    if (v.kind === 'page' && v.page.kind === 'domain') {
      const p = v.page
      const opened = await read($, openFact)
      return (
        <Box flexDirection="column" gap={1}>
          {back(p.back)}
          <Box flexDirection="column">
            <Text bold>Domain facts</Text>
            <Text dimColor wrap="wrap">{`${p.n} facts · ${p.binding} binding${p.conflicts ? ` · ${p.conflicts} in conflict` : ''} · binding facts hold the builder and the reviewer; the rest is context`}</Text>
          </Box>
          {p.groups.map((g: any) => (
            <Box key={`df-${g.file}`} flexDirection="column" gap={rows}>
              <Text dimColor>{`${g.name} · ${g.rows.length}`}</Text>
              {g.rows.map((f: any) => {
                const id = `${g.file}\u0000${f.title}`
                const toggle = () => void update($, openFact, (o: string | null) => (o === id ? null : id))
                return (
                  <Box key={`fact-${id}`} flexDirection="column">
                    <Box flexDirection="row" gap={1} alignItems="center">
                      {rich ? <Svg alt={f.conflict ? 'in conflict' : 'fact'} width={14} height={14} source={iconSvg(f.conflict ? 'fact-conflict' : 'facts')} /> : <Text color={f.conflict ? 'warning' : 'inactive'}>{f.conflict ? '!' : '·'}</Text>}
                      <Box flexShrink={0}>{canPress ? held(`title-${id}`, `${f.title}|${opened === id}`, toggle, onPress => <Button key={`title-${id}`} plain onPress={onPress}><Text bold>{f.title}</Text></Button>) : <Text bold>{f.title}</Text>}</Box>
                      {f.state === 'confirmed' && chip(`bind-${id}`, 'binding', 'success')}
                      {f.older && chip(`old-${id}`, 'older version', 'warning')}
                      <Box flexGrow={1} flexShrink={1} overflow="hidden"><Text dimColor wrap="truncate-end">{f.conflict ? `conflict: ${f.conflict.what}` : plain(f.text)}</Text></Box>
                    </Box>
                    {opened === id && card(`full-${id}`, f.conflict ? 'warning' : 'inactive', <>
                      <Text wrap="wrap">{md(f.text, `full-${id}`)}</Text>
                      {f.source !== '' && <Text dimColor wrap="wrap">{f.source}</Text>}
                      {f.by !== '' && <Text dimColor wrap="wrap">{f.by}</Text>}
                      {f.conflict && <Text color="warning" wrap="wrap">{`conflict: ${f.conflict.what}${f.conflict.source ? ` (${f.conflict.source})` : ''}${f.conflict.by ? `, noticed by ${f.conflict.by}` : ''}`}</Text>}
                    </>)}
                  </Box>
                )
              })}
            </Box>
          ))}
        </Box>
      )
    }

    if (v.kind === 'cup') {
      return (
        <Box flexDirection="column" alignItems="center" paddingY={1}>
          {rich && <Svg alt="all brewed" width={64} height={64} source={CUP} />}
          {!rich && ['   ) )  ( (', '.__________.', '|          |]', '|          |', "`----------'"].map((line, i) => (
            <Text key={`cup-${i}`} color="claude">{line}</Text>
          ))}
          <Text bold>all {v.total} brewed</Text>
          <Text dimColor>roadmap clear</Text>
        </Box>
      )
    }

    const filled = bar(v.summary.done, v.summary.total, inner)
    return (
      <Box flexDirection="column" gap={1}>
        <Box key="summary" flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={1} paddingY={rich ? 1 : 0} gap={rich ? 1 : 0}>
          <Box flexDirection="row" justifyContent="space-between">
            <Box flexDirection="row" gap={1} alignItems="center">
              {rich ? <Svg alt="ristretto" width={20} height={20} source={CUP} /> : <Text>☕</Text>}
              <Text bold>{v.summary.name}</Text>
            </Box>
            {v.summary.action && press(v.summary.action, true)}
          </Box>
          {Svg ? (
            <Svg alt={v.summary.segments.map((s: any) => `${s.n} ${s.status}`).join(', ')} height={8} source={statusBarSvg(v.summary.segments)} />
          ) : (
            <Box flexDirection="row">
              <Text color="claude">{'━'.repeat(filled.filled)}</Text>
              <Text color="inactive">{'─'.repeat(filled.empty)}</Text>
            </Box>
          )}
          <Box flexDirection="row" gap={2} alignItems="center">
            <Text>{v.summary.done} of {v.summary.total} brewed</Text>
            {v.summary.counts.map((c: any) =>
              rich ? (
                <Box key={c.text} flexDirection="row" gap={1} alignItems="center">
                  <Svg alt={c.text} width={14} height={14} source={iconSvg(c.status)} />
                  <Text color={c.tone}>{c.n}</Text>
                </Box>
              ) : chip(c.text, c.text, c.tone),
            )}
          </Box>
          {v.summary.facts && (
            <Box flexDirection="row" justifyContent="space-between" alignItems="center">
              <Box flexDirection="row" gap={1} alignItems="center" flexShrink={1}>
                {rich ? <Svg alt="domain facts" width={14} height={14} source={iconSvg('facts')} /> : <Text dimColor>📖</Text>}
                {canPress
                  ? held('name-facts', `${v.summary.facts.n}|${v.summary.facts.binding}`, () => void goTo({ kind: 'domain' }), onPress => <Button key="name-facts" plain onPress={onPress}><Text dimColor>{`${v.summary.facts.n} domain facts · ${v.summary.facts.binding} binding`}</Text></Button>)
                  : <Text dimColor>{`${v.summary.facts.n} domain facts · ${v.summary.facts.binding} binding`}</Text>}
              </Box>
              {more({ kind: 'domain' })}
            </Box>
          )}
        </Box>

        {v.notices.map((n: any) => <Text key={n.key} dimColor wrap="truncate-end">⚙ {n.text}</Text>)}

        {v.now && (
          <Box key="now" flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1} paddingY={rich ? 1 : 0}>
            {v.now.steps ? (
              <>
                <Box flexDirection="row" justifyContent="space-between">
                  <Text color="claude" bold>{rich ? v.now.id : `▶ ${v.now.id}`}</Text>
                  <Text dimColor>{v.now.clock || v.now.status}</Text>
                </Box>
                <Text dimColor wrap="truncate-end">{v.now.detail}</Text>
                {rich ? (
                  <Box flexDirection="row" alignItems="flex-start">
                    {v.now.steps.flatMap((s: any, i: number, all: any[]) => {
                      const reached = (j: number) => all[j].state !== 'todo'
                      const step = <Svg key={`step-${i}`} alt={`${s.label}: ${s.state}`} width={STEP} height={38} source={stepSvg(s, i > 0 ? reached(i) : null, i < all.length - 1 ? reached(i + 1) : null)} />
                      return i === 0 ? [step] : [<Box key={`line-${i}`} flexDirection="column" flexGrow={1} flexShrink={1}><Svg alt="" height={18} source={lineSvg(reached(i))} /></Box>, step]
                    })}
                  </Box>
                ) : (
                  <Box flexDirection="row" gap={2}>
                    {v.now.steps.map((s: any) => (
                      <Text key={s.label} color={s.state === 'done' ? 'success' : s.state === 'current' ? 'claude' : 'inactive'} bold={s.state === 'current'}>
                        {s.state === 'done' ? '✓' : s.state === 'current' ? '●' : '○'} {s.label}
                      </Text>
                    ))}
                  </Box>
                )}
                {v.now.gate && <Box flexDirection="row">{chip('gate', v.now.gate.text, v.now.gate.tone)}</Box>}
              </>
            ) : (
              <Text color="claude" bold>{rich ? v.now.text : `▶ ${v.now.text}`}</Text>
            )}
          </Box>
        )}

        {v.sections.map((section: any) => (
          <Box key={section.key} flexDirection="column" gap={rows}>
            {heading(`h-${section.key}`, section.title)}
            {section.groups.map((group: any) => (
              <Box key={group.key} flexDirection="column" gap={rows}>
                {section.groups.some((g: any) => g.flight) && <Text dimColor>{group.flight || 'other'}</Text>}
                {group.rows.map((r: any) => row(r))}
              </Box>
            ))}
            {section.conflicts && <Text key="h-conflicts" dimColor>domain facts</Text>}
            {(section.conflicts ?? []).map((c: any) => (
              <Box key={c.key} flexDirection="row" gap={1} alignItems="center">
                {rich ? <Svg alt="fact in conflict" width={14} height={14} source={iconSvg('fact-conflict')} /> : <Text color="warning">!</Text>}
                <Box flexShrink={0}>{canPress ? held(`name-${c.key}`, c.title, () => void goTo({ kind: 'domain' }), onPress => <Button key={`name-${c.key}`} plain onPress={onPress}><Text bold>{c.title}</Text></Button>) : <Text bold>{c.title}</Text>}</Box>
                <Box flexGrow={1} flexShrink={1} overflow="hidden"><Text dimColor wrap="truncate-end">{`conflict: ${c.what}`}</Text></Box>
                {c.action && press(c.action)}
                {act(`more-${c.key}`, '›', () => void goTo({ kind: 'domain' }), true)}
              </Box>
            ))}
          </Box>
        ))}

        {v.done && (
          <Box key="done" flexDirection="column" gap={rows}>
            <Box flexDirection="row" gap={2} alignItems="center">
              {heading('h-done', `done · ${v.done.count}`)}
            </Box>
            {v.done.rows.map((r: any) => row(r, true))}
            {canPress && (v.done.more > 0 || showing) && (
              <Box flexDirection="row">
                {act('toggle-done', showing ? v.done.toggle.label : `${v.done.toggle.label} ${v.done.count}`, () => void update($, showDone, (x: boolean) => !x), true)}
              </Box>
            )}
          </Box>
        )}
      </Box>
    )
  }
}

