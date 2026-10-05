import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, BoardLive, BoardPlan, BoardRecord, BoardRun } from '../types'
import { EMPTY_BOARD, bar, docks, elapsed, fold, markerState, parseBrief, parseReport, parseRoadmap, reportText, view } from './board-model.mjs'
import { parseChecks, parsePlan } from './board-plan.mjs'
import { addGate, addTokens, count, endRun, keep, money, track } from './board-runs.mjs'

// The roadmap board: a read-only view of docs/ristretto/roadmap.md and of the run this session
// is doing, plus buttons that start pull/shot/brew the way typing them would. It observes and
// never answers: every hook passes its event on unchanged. Decisions live in board-model.mjs.

const PANE = 'ristretto-board'
const ROADMAP = 'docs/ristretto/roadmap.md'
const CHECKS = 'docs/ristretto/manual-checks.md'
const MARKER = '.ristretto/pulling'

const board = atom({ plugin: 'ristretto', key: 'board' } as const, EMPTY_BOARD as Board)
const live = atom({ plugin: 'ristretto', key: 'live' } as const, null as BoardLive | null)
const elsewhere = atom({ plugin: 'ristretto', key: 'elsewhere' } as const, false)
const showDone = atom({ plugin: 'ristretto', key: 'showDone' } as const, false)
const tick = atom({ plugin: 'ristretto', key: 'tick' } as const, 0)
const openRow = atom({ plugin: 'ristretto', key: 'open' } as const, null as string | null)
const run = atom({ plugin: 'ristretto', key: 'run' } as const, null as BoardRun | null)
const runs = atom({ plugin: 'ristretto', key: 'runs' } as const, [] as BoardRecord[])

let roadmapMtime = -1
let hasRoadmap = false
let autoOpened = false
let docked = false
let timers: { cancel: () => void }[] = []
let storeKey = ''

// Unasked, the pane opens once, and only where it docks beside the transcript; on the
// terminal's main screen it would land inline, so there /ristretto:status prints it as text.
// Tried from both sides — the render that learns the layout docks, and the read that learns
// there is a roadmap — so neither has to happen first.
function maybeAutoOpen($: EngineInterface) {
  if (autoOpened || !hasRoadmap || !docked) return
  autoOpened = true
  void $.ui.open({ id: PANE, title: 'ristretto' })
}

async function refreshBoard($: EngineInterface) {
  try {
    hasRoadmap = await $.fs.exists(ROADMAP)
    if (!hasRoadmap) {
      roadmapMtime = -1
      await update($, board, () => ({ ...EMPTY_BOARD, error: 'no-roadmap' }))
      return
    }
    const mtime = (await $.fs.stat(ROADMAP)).mtimeMs
    const parsed = parseRoadmap(String(await $.fs.read(ROADMAP)))
    // What each open plan says, plus the opened row's plan whatever its status; and the
    // manual checks. A plan that cannot be read is simply absent. A blocked row with no
    // reason in the roadmap says why from its plan's Blockers.
    const opened = await read($, openRow)
    const plans: Record<string, BoardPlan> = {}
    for (const row of parsed.rows) {
      if (!row.plan || (row.status === 'done' && row.id !== opened)) continue
      try {
        plans[row.id] = parsePlan(String(await $.fs.read(`docs/ristretto/${row.plan}`)))
      } catch {
        // The opened row says its plan was not found.
      }
      if (row.status === 'blocked' && !row.reason) row.reason = plans[row.id]?.blockers[0] ?? ''
    }
    let checks: Record<string, { done: boolean; text: string }[]> = {}
    try {
      if (await $.fs.exists(CHECKS)) checks = parseChecks(String(await $.fs.read(CHECKS)))
    } catch {
      // No checks to show.
    }
    let plugin = ''
    try {
      plugin = JSON.parse(String(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`))).version || ''
    } catch {
      // Without the plugin's version the format line is skipped; the board itself still draws.
    }
    const name = (await $.session.cwd()).split(/[\\/]/).filter(Boolean).pop() || 'roadmap'
    await update($, board, () => ({ name, rows: parsed.rows, format: { project: parsed.format, plugin }, error: parsed.error, plans, checks }))
    roadmapMtime = mtime
    maybeAutoOpen($)
  } catch (err) {
    roadmapMtime = -1 // a failed read is retried by the next poll, not kept until the file changes
    await update($, board, b => ({ ...b, error: String(err).slice(0, 80) }))
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
  const usd = (await $.session.usage()).cost?.usd ?? null
  const before = await read($, run)
  const step = track(before, await read($, live), now, usd)
  if (step.run === before) return
  // Tokens and gate time keep arriving while this ran: only the call that still finds the run
  // it read moves it on, and it closes the run as it stands then, counts included.
  let moved = false
  let closing: BoardRun | null = null
  await update($, run, r => {
    if ((r?.id ?? null) !== (before?.id ?? null)) return r
    moved = true
    closing = r
    return step.run
  })
  if (!moved || !closing) return
  await refreshBoard($)
  const ended: BoardRun = closing
  const status = (await read($, board)).rows.find(r => r.id === ended.id)?.status ?? 'unknown'
  // Another session in this repo may have kept runs since this one loaded them: add to what
  // the store holds now, not to this session's copy.
  const stored = storeKey ? await $.store.get(storeKey) : null
  const next = keep(Array.isArray(stored) ? (stored as BoardRecord[]) : await read($, runs), endRun(ended, now, usd, status))
  await update($, runs, () => next)
  if (storeKey) await $.store.set(storeKey, next)
}

// Whose run the marker is, from the session id gate.js writes into it and its age.
async function observeMarker($: EngineInterface) {
  try {
    let owner: string | null = null
    let idleMs: number | null = null
    if (await $.fs.exists(MARKER)) {
      owner = String(await $.fs.read(MARKER)).trim()
      idleMs = (await $.clock.now()) - (await $.fs.stat(MARKER)).mtimeMs
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
    const mtime = (await $.fs.exists(ROADMAP)) ? (await $.fs.stat(ROADMAP)).mtimeMs : -1
    if (mtime !== roadmapMtime) await refreshBoard($)
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
const HUE: Record<string, string> = {
  claude: '#D97757',
  success: '#3FA66B',
  warning: '#D49A3A',
  error: '#D9614C',
  permission: '#5B8DEF',
  inactive: '#8A8A8A',
}

// The summary's progress as one stacked pill, a segment per status in the view's order, where
// the surface draws SVG: box-drawing glyphs are wider than a cell there, so a text bar wraps.
// What is still planned is the faint track the rest fills.
function statusBarSvg(segments: { status: string; n: number; tone: string }[]) {
  const total = segments.reduce((sum, s) => sum + s.n, 0) || 1
  let x = 0
  const parts = segments.map(s => {
    const w = (1000 * s.n) / total
    const rect = `<rect x="${x.toFixed(1)}" width="${w.toFixed(1)}" height="8" fill="${HUE[s.tone] ?? HUE.inactive}"${s.status === 'planned' || s.status === 'unknown' ? ' fill-opacity="0.25"' : ''}/>`
    x += w
    return rect
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="8" viewBox="0 0 1000 8" preserveAspectRatio="none"><clipPath id="pill"><rect width="1000" height="8" rx="4"/></clipPath><g clip-path="url(#pill)">${parts.join('')}</g></svg>`
}

// A run's length against the longest one shown, its gate time drawn solid from the start.
function runBarSvg(ms: number, gateMs: number, maxMs: number) {
  const w = Math.max(6, Math.round((160 * ms) / (maxMs || 1)))
  const g = Math.min(w, Math.round((160 * gateMs) / (maxMs || 1)))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="6" viewBox="0 0 160 6"><rect width="${w}" height="6" rx="3" fill="${HUE.claude}" fill-opacity="0.3"/><rect width="${g}" height="6" rx="3" fill="${HUE.claude}"/></svg>`
}

// Gate minutes per run as a small line, oldest left, the latest run a dot.
function sparkSvg(values: number[]) {
  const max = Math.max(1, ...values)
  const step = values.length > 1 ? 120 / (values.length - 1) : 0
  const at = values.map((v, i) => [i * step + 3, 17 - (14 * v) / max])
  const pts = at.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const [lx, ly] = at[at.length - 1]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="126" height="20" viewBox="0 0 126 20"><polyline points="${pts}" fill="none" stroke="${HUE.claude}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.4" fill="${HUE.claude}"/></svg>`
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
    await poll($)
    return started
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    docked = docks(e.viewport)
    maybeAutoOpen($)
    return next(e)
  })

  on('command.run', async ($, e, next) => {
    // A bare /ristretto:status opens the board where it docks beside the transcript, at once
    // and with no model turn; a filter, or a layout that would put it inline, gets the text
    // roadmap from commands/status.md as before.
    if (e.command === 'ristretto:status' && e.args.trim() === '' && e.presentation.isFullscreen && (await $.fs.exists(ROADMAP))) {
      await refreshBoard($)
      await $.ui.open({ id: PANE, title: 'ristretto' })
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

  // deun's layout in Claude's colors: a summary card, a run card, what needs a person, what is
  // next, what happened. A row opens (▸) to a card of its details. Text colors are theme keys,
  // so light and dark both hold; shapes are SVG in HUE where the surface draws it.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Svg } = $.ui.resolve(e) as any
    const canPress = e.surface !== 'mobile' && Button !== undefined
    const current = await read($, live)
    const now = Math.max(await read($, tick), current?.since ?? 0)
    const showing = await read($, showDone)
    const boardValue = await read($, board)
    const v = view(boardValue, current, now, await read($, elsewhere), {
      showDone: showing,
      open: await read($, openRow),
      plans: boardValue.plans,
      checks: boardValue.checks,
      runs: await read($, runs),
    })
    // One row open at a time; opening a done row reads its archived plan.
    const toggleRow = async (id: string) => {
      await update($, openRow, (o: string | null) => (o === id ? null : id))
      await refreshBoard($)
    }
    const inner = Math.max(10, Math.min(30, (e.props.bodyColumns ?? 40) - 6))
    const rich = Svg !== undefined
    // On desktop a button carries a sign rather than a word; the terminal keeps the word.
    const SIGN: Record<string, string> = { start: '▶', 'brew all': '☕ brew all' }
    const press = (action: { label: string; command: string; args: string }, primary = false) =>
      canPress && (
        <Button
          key={`press-${action.command}-${action.args}`}
          label={rich ? SIGN[action.label] ?? action.label : action.label}
          variant={primary ? 'primary' : undefined}
          onPress={() => void $.command.run({ command: action.command, args: action.args })}
        />
      )
    // A native button and a pill are taller than a text row on desktop: a line between rows
    // keeps them from touching. The terminal's rows are one cell and stay tight.
    const rows = rich ? 1 : 0
    const mark = (r: any) =>
      rich ? (
        <Svg alt={r.tag || r.status} width={14} height={14} source={iconSvg(r.status)} />
      ) : (
        <Text color={r.tone}>{r.mark}</Text>
      )
    const chip = (key: string, text: string, tone: string) =>
      rich ? (
        <Svg key={key} alt={text} source={chipSvg(text, tone)} />
      ) : (
        <Text key={key} color={tone}>{text}</Text>
      )
    const heading = (key: string, title: string) =>
      rich ? (
        <Text key={key} bold dimColor>{title.charAt(0).toUpperCase() + title.slice(1)}</Text>
      ) : (
        <Text key={key} dimColor bold>{title.toUpperCase()}</Text>
      )
    // Run bars share one scale: the longest run shown is full width.
    const longest = Math.max(1, ...((v as any).done?.rows ?? []).map((r: any) => r.run?.ms ?? 0))
    // A run in one line: how long, what it cost, how many tokens, how long the gates took.
    const runLine = (rec: any) =>
      [elapsed(rec.ms), money(rec.usd), `${count(rec.tokens.in + rec.tokens.out)} tok`, `gate ${elapsed(rec.gates.ms)}${rec.gates.red ? ` · ${rec.gates.red} red` : ''}`].join(' · ')
    // An opened row's card, in the row's color and indented under it: what it waits on, what
    // done means for it (with the proof once done), what stops it, and what its run cost.
    const detailsCard = (r: any) => {
      const d = r.details
      const facts = [d.review, d.gate && `gate ${d.gate}`, d.commit && `commit ${d.commit}`, d.run && runLine(d.run)].filter(Boolean)
      return (
        <Box key={`details-${r.key}`} flexDirection="column" marginLeft={2} borderStyle="round" borderColor={r.tone} paddingX={1} paddingY={rich ? 1 : 0} gap={rich ? 1 : 0}>
          {d.missing && <Text dimColor>plan not found</Text>}
          {d.deps.length > 0 && (
            <Box flexDirection="row" columnGap={2} rowGap={0} flexWrap="wrap" alignItems="center">
              <Text dimColor>depends on</Text>
              {d.deps.map((x: any) => (
                <Box key={`dep-${x.id}`} flexDirection="row" gap={1} alignItems="center">
                  {mark({ status: x.ok ? 'done' : x.status === 'missing' ? 'unknown' : x.status, tone: x.ok ? 'success' : 'inactive', mark: x.ok ? '✓' : '○', tag: x.status })}
                  <Text dimColor={!x.ok}>{x.id}{x.status === 'missing' ? ' (not on the roadmap)' : ''}</Text>
                </Box>
              ))}
            </Box>
          )}
          {d.acceptance.length > 0 && (
            <Box flexDirection="column">
              <Text bold dimColor>{rich ? 'Acceptance' : 'ACCEPTANCE'}</Text>
              {d.acceptance.map((a: any, i: number) => (
                <Box key={`acc-${i}`} flexDirection="column" marginTop={rich ? 1 : 0}>
                  <Box flexDirection="row" gap={1}>
                    {a.proof
                      ? mark({ status: 'done', tone: 'success', mark: '✓', tag: 'proved' })
                      : a.auto
                        ? <Text dimColor>{i + 1}.</Text>
                        : mark({ status: 'needs-human', tone: 'permission', mark: '◐', tag: 'checked by a person' })}
                    <Box flexShrink={1}>
                      <Text wrap="wrap">{a.text}</Text>
                    </Box>
                  </Box>
                  {a.proof && (
                    <Box marginLeft={rich ? 3 : 2}>
                      <Text dimColor wrap="truncate-end">{a.proof}</Text>
                    </Box>
                  )}
                </Box>
              ))}
            </Box>
          )}
          {d.unitemised && <Text dimColor wrap="wrap">proof not itemised — the plan's Evidence covers these as prose</Text>}
          {d.blockers.map((b: string, i: number) => (
            <Box key={`blk-${i}`} flexDirection="row" gap={1}>
              {mark({ status: 'blocked', tone: 'error', mark: '✕', tag: 'blocker' })}
              <Box flexShrink={1}><Text color="error" wrap="wrap">{b}</Text></Box>
            </Box>
          ))}
          {d.findings.map((f: string, i: number) => (
            <Box key={`fnd-${i}`} flexDirection="row" gap={1}>
              {mark({ status: 'needs-review', tone: 'warning', mark: '!', tag: 'finding' })}
              <Box flexShrink={1}><Text wrap="wrap">{f}</Text></Box>
            </Box>
          ))}
          {d.checks.map((c: any, i: number) => (
            <Box key={`chk-${i}`} flexDirection="row" gap={1}>
              {c.done ? mark({ status: 'done', tone: 'success', mark: '☑', tag: 'checked' }) : mark({ status: 'needs-human', tone: 'permission', mark: '☐', tag: 'to check' })}
              <Box flexShrink={1}><Text dimColor={c.done} wrap="wrap">{c.text}</Text></Box>
            </Box>
          ))}
          {facts.length > 0 && <Text dimColor wrap="wrap">{facts.join('  ·  ')}</Text>}
          {d.action && <Box flexDirection="row">{press(d.action, true)}</Box>}
        </Box>
      )
    }
    const row = (r: any, dim = false) => (
      <Box key={r.key} flexDirection="column" gap={rows}>
        <Box flexDirection="row" gap={1} alignItems="center">
          {canPress && (
            <Button key={`open-${r.key}`} label={r.toggle.open ? '▾' : '▸'} plain dimColor onPress={() => void toggleRow(r.id)} />
          )}
          {mark(r)}
          <Text bold={!dim} dimColor={dim}>{r.id}</Text>
          {r.waiting.length > 0
            ? chip(`tag-${r.key}`, `waits on ${r.waiting.map((w: any) => w.id).join(', ')}`, 'inactive')
            : r.tag !== '' && (!rich || r.tag === 'easy') && chip(`tag-${r.key}`, r.tag, r.tone)}
          <Box flexGrow={1} flexShrink={1} overflow="hidden">
            <Text dimColor wrap="truncate-end">{r.detail}</Text>
          </Box>
          {r.run !== undefined && <Text dimColor>{r.run ? `${elapsed(r.run.ms)} · ${money(r.run.usd)}` : '—'}</Text>}
          {r.action && press(r.action)}
        </Box>
        {r.run && (
          <Box flexDirection="row" gap={1} alignItems="center" marginLeft={canPress ? 4 : 2}>
            {rich && <Svg alt={`${elapsed(r.run.ms)}, gates ${elapsed(r.run.gates.ms)}`} width={160} height={6} source={runBarSvg(r.run.ms, r.run.gates.ms, longest)} />}
            <Text dimColor>{`${count(r.run.tokens.in + r.run.tokens.out)} tok · gate ${elapsed(r.run.gates.ms)}${r.run.gates.red ? ` · ${r.run.gates.red} red` : ''}`}</Text>
          </Box>
        )}
        {r.details && detailsCard(r)}
      </Box>
    )

    if (v.kind === 'message') return <Text dimColor>{v.text}</Text>
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
            <Text>
              {v.summary.done} of {v.summary.total} brewed
            </Text>
            {v.summary.counts.map((c: any) =>
              rich ? (
                <Box key={c.text} flexDirection="row" gap={1} alignItems="center">
                  <Svg alt={c.text} width={14} height={14} source={iconSvg(c.status)} />
                  <Text color={c.tone}>{c.n}</Text>
                </Box>
              ) : (
                chip(c.text, c.text, c.tone)
              ),
            )}
          </Box>
        </Box>

        {v.notices.map((n: any) => (
          <Text key={n.key} dimColor wrap="truncate-end">⚙ {n.text}</Text>
        ))}

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
                      const step = (
                        <Svg
                          key={`step-${i}`}
                          alt={`${s.label}: ${s.state}`}
                          width={STEP}
                          height={38}
                          source={stepSvg(s, i > 0 ? reached(i) : null, i < all.length - 1 ? reached(i + 1) : null)}
                        />
                      )
                      return i === 0
                        ? [step]
                        : [
                            <Box key={`line-${i}`} flexDirection="column" flexGrow={1} flexShrink={1}>
                              <Svg alt="" height={18} source={lineSvg(reached(i))} />
                            </Box>,
                            step,
                          ]
                    })}
                  </Box>
                ) : (
                <Box flexDirection="row" gap={2}>
                  {v.now.steps.map((s: any) => (
                    <Text
                      key={s.label}
                      color={s.state === 'done' ? 'success' : s.state === 'current' ? 'claude' : 'inactive'}
                      bold={s.state === 'current'}
                    >
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
          <Box key={section.key} flexDirection="column">
            {heading(`h-${section.key}`, section.title)}
            {section.groups.map((group: any) => (
              <Box key={group.key} flexDirection="column" marginTop={rich ? 1 : 0}>
                {section.groups.some((g: any) => g.flight) && (
                  <Text dimColor>{group.flight || 'other'}</Text>
                )}
                <Box flexDirection="column" gap={rows}>{group.rows.map((r: any) => row(r))}</Box>
              </Box>
            ))}
          </Box>
        ))}

        {v.done && (
          <Box key="done" flexDirection="column">
            <Box flexDirection="row" gap={2} alignItems="center">
              {heading('h-done', `done · ${v.done.count}`)}
              {v.done.trend.length > 1 && (
                <Box flexDirection="row" gap={1} alignItems="center">
                  {rich && <Svg alt={`gate minutes per run: ${v.done.trend.join(', ')}`} width={126} height={20} source={sparkSvg(v.done.trend)} />}
                  <Text dimColor>{rich ? 'gate time' : `gate min ${v.done.trend.join(' ')}`}</Text>
                </Box>
              )}
            </Box>
            <Box flexDirection="column" gap={rows} marginTop={rows}>{v.done.rows.map((r: any) => row(r, true))}</Box>
            {canPress && (v.done.more > 0 || showing) && (
              <Box flexDirection="row" marginTop={rows}>
                <Button
                  key="toggle-done"
                  label={showing ? v.done.toggle.label : `${v.done.toggle.label} ${v.done.count}`}
                  plain
                  dimColor
                  onPress={() => update($, showDone, (x: boolean) => !x)}
                />
              </Box>
            )}
          </Box>
        )}
      </Box>
    )
  })
}
