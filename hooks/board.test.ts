import { describe, expect, mock, test } from 'claude-code/testing'

// The board as the desktop shows it, on a small repo held in memory: files and git answered by
// hooks beneath the plugin. What a person sees (cards, rows, the band), what presses, and the
// rendering rules the desktop taught us (spec 0.2): draw on change only, no clock read while
// drawing, presses without Buttons, hairline cards, theme-key text.

const PANE = { title: 'ristretto', isFocused: false, bodyColumns: 52, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } as any
const BAND = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 80, scroll: { offset: 0, bodyRows: 4 }, view: {} } as any
const VIEW = { columns: 52, rows: 80, isFullscreen: true } as any
const ROOT = '/repo'
const THEME_KEYS = new Set(['text', 'subtle', 'inactive', 'claude', 'error', 'success', 'warning', 'permission'])

const ROADMAP = [
  '# Ristretto Roadmap',
  '<!-- ristretto-format: 0.22 -->',
  '',
  '| Flight | Feature | Title | Tier | Status |',
  '|---|---|---|---|---|',
  '| a | d-old | An old one | normal | done |',
  '| a | d-here | Done here | normal | done |',
  '| a | human-here | Needs a person | normal | done |',
  '| a | review-here | Needs a look | normal | done |',
  '| b | blk | Blocked one | normal | blocked |',
  '| b | p1 | Planned 1 | normal | planned |',
  '| b | p2 | Planned 2 | normal | planned |',
  '| b | pw | Waits on blk | normal | planned |',
  '',
  '- **blk** — waiting on Anatol: the API doc',
].join('\n')

type World = { files: Record<string, string>; git: Record<string, { exitCode: number; stdout: string }>; session: string; store?: Record<string, unknown>; mtimes?: Record<string, number> }

function world(): World {
  return {
    session: 's1',
    files: {
      '.git/logs/refs/heads/main': 'one move\n',
      'docs/ristretto/roadmap.md': ROADMAP,
      'docs/ristretto/plans/human-here.md': '- Acceptance:\n  - [x] [human] a\n  - [ ] [human] b\n',
      'docs/ristretto/plans/review-here.md': '- Acceptance:\n  - [ ] [human] x\n  - [ ] [human] y\n\n## Open findings\n\n- block · a.js:1 · one\n- block · b.js:2 · two\n',
      'docs/ristretto/plans/pw.md': '- Depends: blk\n',
      '.ristretto/suite.json': JSON.stringify({ verdict: 'green', head: 'c'.repeat(40), tree: 'a'.repeat(40), at: 1, gates: 'test ✓', failing: '' }),
    },
    git: {
      'rev-parse --abbrev-ref HEAD': { exitCode: 0, stdout: 'brew/x\n' },
      'for-each-ref --format=%(refname) refs/heads/main refs/heads/master refs/remotes/origin/main refs/remotes/origin/master': { exitCode: 0, stdout: 'refs/heads/main\n' },
      'log --format=%ct%x09%s refs/heads/main..HEAD --': {
        exitCode: 0,
        stdout: '1760440000\tdocs(blk): blocked\n1760430000\tfeat(review-here): r\n1760420000\tfeat(human-here): h\n1760410000\tfeat(d-here): d\n',
      },
      'rev-parse HEAD': { exitCode: 0, stdout: `${'c'.repeat(40)}\n` },
      [`diff --quiet --end-of-options ${'a'.repeat(40)} HEAD -- . :(exclude)docs/ristretto`]: { exitCode: 0, stdout: '' },
      'rev-parse --absolute-git-dir': { exitCode: 0, stdout: '/repo/.git\n' },
      'rev-parse --git-common-dir': { exitCode: 0, stdout: '.git\n' },
    },
  }
}

// Files and git beneath the plugin, the app theme, the session.
function install(on: any, w: World, theme = 'dark') {
  // The engine hands paths over resolved: `C:\repo\docs\…` on Windows.
  const rel = (p: string) => String(p).replace(/\\/g, '/').replace(/^[A-Za-z]:/, '').replace(`${ROOT}/`, '')
  const isDir = (p: string) => Object.keys(w.files).some(f => f.startsWith(`${rel(p)}/`))
  on('session.root', () => ({ value: ROOT }) as any)
  on('session.id', () => ({ value: w.session }) as any)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as any)
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd ?? ROOT }) as any)
  on('fs.exists', ($: any, e: any) => ({ value: rel(e.path) in w.files || isDir(e.path) }) as any)
  on('fs.read', ($: any, e: any) => {
    if (!(rel(e.path) in w.files)) throw new Error(`ENOENT ${e.path}`)
    return { value: w.files[rel(e.path)] } as any
  })
  on('fs.stat', ($: any, e: any) => {
    if (!(rel(e.path) in w.files) && !isDir(e.path)) throw new Error(`ENOENT ${e.path}`)
    return { value: { kind: isDir(e.path) ? 'dir' : 'file', size: 1, mtimeMs: w.mtimes?.[rel(e.path)] ?? (w.files[rel(e.path)] ?? '').length } } as any
  })
  on('fs.list', () => ({ value: [] }) as any)
  on('process.run', ($: any, e: any) => {
    const key = (e.argv as string[]).slice(1).join(' ')
    const hit = (e.argv as string[])[0] === 'git' ? w.git[key] : undefined
    return { value: { exitCode: hit ? hit.exitCode : 1, stdout: hit ? hit.stdout : '', stderr: '' } } as any
  })
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme, provider: 'engine', isLocked: false }] }) as any)
  on('ui.open', () => ({ value: { isPlaced: true } }) as any)
  mock.store(on, w.store ?? {})
}

async function start($: any, on: any, w = world(), theme = 'dark') {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 14, 12, 0) })
  install(on, w, theme)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true } as any)
  await clock.settle()
  return clock
}

const mount = ($: any, surface: 'desktop' | 'terminal' | 'mobile' | 'vscode' = 'desktop') =>
  $.ui.mount({ plugin: 'ristretto', surface, component: 'Pane', requestId: 'ristretto-board', props: PANE, viewport: VIEW } as any)
const band = ($: any, surface: 'desktop' | 'terminal' = 'desktop') =>
  $.ui.mount({ plugin: 'ristretto', surface, component: 'AbovePrompt', props: BAND, viewport: VIEW } as any)

async function texts(ui: any) {
  return (await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join('\n')
}
async function svgs(ui: any) {
  return (await ui.findAll({ type: 'Svg' })).map((s: any) => String(s.props.source))
}
async function press(ui: any, key: string) {
  await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: key } as any)
  await ui.pointer({ type: 'up', x: 1, y: 0, button: 'left', in: key } as any)
}
async function holdsTheLook(ui: any, where: string) {
  for (const t of await ui.findAll({ type: 'Text' })) {
    const c = t.props.color
    if (c !== undefined && !THEME_KEYS.has(c)) throw new Error(`${where}: text colour ${c} is not a theme key (${t.text})`)
  }
  for (const src of await svgs(ui)) if (src.length > 131072) throw new Error(`${where}: an SVG of ${src.length} chars`)
}

describe('the overview', () => {
  test('idle: the branch first, what holds it, what needs you, what is next, what is done', async ($, on) => {
    await start($, on)
    const ui = await mount($)
    const t = await texts(ui)
    for (const w of ['Branch', 'brew/x', '3 features', '1 check open', '2 findings · 2 checks open', 'suite green', 'last commit', 'Needs you', 'blk', 'waits on Anatol',
      'Up next', 'p1', 'next', 'p2', 'queued', '1 waiting on others', 'Done', '1 on this branch', '2 in all', 'History']) {
      expect(t).toContain(w)
    }
    // A blocked feature whose only commit is its roadmap edit does not hold the branch.
    expect(t).not.toMatch(/blocked · waits on Anatol/)
    expect(t).not.toContain('ahead')
    await holdsTheLook(ui, 'idle')
  })

  test('cards are Claude\'s: a hairline round border, no fill', async ($, on) => {
    await start($, on)
    const ui = await mount($)
    const cards = (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.borderStyle === 'round')
    expect(cards.length).toBeGreaterThan(3)
    for (const c of cards) {
      expect(c.props.borderColor).toBe('#2D2D2D')
      expect(c.props.backgroundColor).toBeUndefined()
    }
  })

  test('the light theme takes the light hairline; text stays theme keys', async ($, on) => {
    await start($, on, world(), 'light')
    const ui = await mount($)
    const cards = (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.borderStyle === 'round')
    for (const c of cards) expect(c.props.borderColor).toBe('#E3E1DA')
    await holdsTheLook(ui, 'light')
  })

  test('no Button in the pane: titles fold, rows open their page, ← Board goes back', async ($, on) => {
    await start($, on)
    const ui = await mount($)
    expect((await ui.findAll({ type: 'Button' })).length).toBe(0)
    // The title folds its card, a summary on the right; again unfolds it.
    await press(ui, 'fold-next')
    let t = await texts(ui)
    expect(t).toContain('2 ready · 1 waiting')
    expect(t).not.toContain('queued')
    await press(ui, 'fold-next')
    expect(await texts(ui)).toContain('queued')
    // A row presses anywhere on its line.
    await press(ui, 'pr-hold-review-here')
    t = await texts(ui)
    expect(t).toContain('Needs a look')
    expect(t).toContain('Review')
    expect(t).toContain('one')
    expect(t).toContain('Board')
    await press(ui, 'pr-back')
    expect(await texts(ui)).toContain('Up next')
    // History and the queue are pages too.
    await press(ui, 'pr-more-history')
    expect(await texts(ui)).toContain('d-old')
    await press(ui, 'pr-back')
    await press(ui, 'pr-more-next')
    expect(await texts(ui)).toContain('waits on blk')
  })

  test('VS Code has no press areas: a row opens by its ID\'s Button; mobile draws the overview with no presses', async ($, on) => {
    await start($, on)
    const vs = await mount($, 'vscode')
    // VS Code draws no Client: the ID is the row's Button, a title folds by its Button, ← Board goes back.
    expect((await vs.findAll({ type: 'Client' })).length).toBe(0)
    await vs.press({ key: 'fold-next' })
    expect(await texts(vs)).not.toContain('queued')
    await vs.press({ key: 'fold-next' })
    await vs.press({ key: 'open-hold-review-here' })
    expect(await texts(vs)).toContain('Needs a look')
    await vs.press({ key: 'back-btn' })
    expect(await texts(vs)).toContain('Up next')
    const phone = await mount($, 'mobile')
    expect((await phone.findAll({ type: 'Button' })).length).toBe(0)
    expect(await texts(phone)).toContain('brew/x')
  })

  test('the terminal draws the overview in glyphs', async ($, on) => {
    await start($, on)
    const ui = await mount($, 'terminal')
    const t = await texts(ui)
    expect(t).toContain('brew/x')
    expect(t).toContain('1 check open')
    // The terminal resolves an Svg but draws it as an empty box: marks must be glyphs there.
    expect(t).toMatch(/[✓◐○✕]/)
    expect((await ui.findAll({ type: 'Svg' })).length).toBe(0)
    // A press area's space would cover the cell under it there (a title's first letter, a
    // row's glyph): in the terminal every press area draws nothing; the desktop keeps its space.
    const areas = await ui.findAll({ type: 'Client' })
    expect(areas.length).toBeGreaterThan(0)
    for (const a of areas) expect(a.props.props.blank).toBe(true)
    for (const a of await (await mount($, 'desktop')).findAll({ type: 'Client' })) expect(a.props.props.blank).toBe(false)
  })
})

describe('the rendering rules', () => {
  test('time passing redraws nothing: no clock tick, no clock read while drawing', async ($, on) => {
    const clock = await start($, on)
    const ui = await mount($)
    const t0 = await texts(ui)
    const s0 = await svgs(ui)
    await clock.advance(12_000)
    await ui.drawn()
    expect(await texts(ui)).toBe(t0)
    expect(await svgs(ui)).toEqual(s0)
  })

  test('a running brew: the feature at work with its SVG clock, the effort bar phase-locked, the roles', async ($, on) => {
    const clock = await start($, on)
    await $.command.run({ command: 'ristretto:brew', args: '' } as any).catch(() => {})
    await $.tool.call({ tool: 'Agent', prompt: '> PLANNER for ristretto feature **p1**', description: 'plan', subagent_type: 'general-purpose' } as any).catch(() => {})
    await clock.settle()
    const ui = await mount($)
    const t = await texts(ui)
    expect(t).toContain('Brewing')
    expect(t).toContain('p1')
    const src = await svgs(ui)
    // The running time is an SVG whose digits a stepped animation rolls; the bar is phase-locked.
    expect(src.some((s: string) => /steps\(10\) infinite/.test(s))).toBe(true)
    expect(src.some((s: string) => /height="21"/.test(s) && /animation-delay/.test(s))).toBe(true)
    const s0 = await svgs(ui)
    await clock.advance(7000)
    await ui.drawn()
    expect(await svgs(ui)).toEqual(s0)
    await holdsTheLook(ui, 'running')
  })
})

describe('between features', () => {
  test('a brew between features (or restarted mid-brew) still shows the rest of the brew and its tally', async ($, on) => {
    const clock = await start($, on)
    await $.command.run({ command: 'ristretto:brew', args: '' } as any).catch(() => {})
    await clock.settle()
    const ui = await mount($)
    const t = await texts(ui)
    expect(t).toContain('Brewing')
    expect(t).toContain('starting')
    expect(t).toContain('p1')
    expect(t).toContain('next')
    expect(t).toMatch(/0 of \d+ brewed/)
  })
})

describe('the edges', () => {
  test('the terminal draws no emoji: the band starts with its counts, the cup is drawn in text', async ($, on) => {
    const w = world()
    w.files['docs/ristretto/roadmap.md'] = ROADMAP.split('\n').map(l => l.replace(/\| (blocked|planned) \|$/, '| done |')).join('\n')
    // Every box ticked and no finding left: nothing asks a person.
    w.files['docs/ristretto/plans/human-here.md'] = '- Acceptance:\n  - [x] [human] a\n'
    w.files['docs/ristretto/plans/review-here.md'] = '- Acceptance:\n  - [x] [human] x\n'
    await start($, on, w)
    const term = await band($, 'terminal')
    expect(await texts(term)).not.toContain('☕')
    const cupPane = await mount($, 'terminal')
    const t = await texts(cupPane)
    expect(t).toContain('brewed')
    expect(t).not.toContain('☕')
  })

  test('the base branch moving (a fetch, a merge elsewhere) is read on the next poll', async ($, on) => {
    const w = world()
    const clock = await start($, on, w)
    const ui = await mount($)
    expect(await texts(ui)).toContain('3 features')
    // main took d-here: only two features are ahead of it now.
    w.git['log --format=%ct%x09%s refs/heads/main..HEAD --'] = { exitCode: 0, stdout: '1760430000\tfeat(review-here): r\n1760420000\tfeat(human-here): h\n' }
    w.files['.git/logs/refs/heads/main'] = 'one move\nanother move\n'
    await clock.advance(5000)
    await clock.settle()
    await ui.drawn()
    expect(await texts(ui)).toContain('2 features')
  })

  test('a brew snapshot is kept per session: a restart finds its own, never another session\'s', async ($, on) => {
    const now = Date.UTC(2026, 9, 14, 12, 0)
    const snap = { startedAt: now - 600000, ids: ['p1', 'p2', 'pw'], reruns: [] }
    // Restarted mid-brew: the marker is this session's, brew's orchestrating marker is there.
    const mine = world()
    mine.files['.ristretto/pulling'] = 's1'
    mine.files['.ristretto/orchestrating'] = ''
    mine.mtimes = { '.ristretto/pulling': now }
    mine.store = { 'brew:/repo:s1': snap }
    await start($, on, mine)
    expect(await texts(await mount($))).toMatch(/0 of 2 brewed/)
  })

  test('another session\'s brew snapshot is not taken (nor cleared) by this one', async ($, on) => {
    const now = Date.UTC(2026, 9, 14, 12, 0)
    const w = world()
    w.files['.ristretto/pulling'] = 's1'
    w.files['.ristretto/orchestrating'] = ''
    w.mtimes = { '.ristretto/pulling': now }
    w.store = { 'brew:/repo:s2': { startedAt: now - 600000, ids: ['p1', 'p2', 'pw'], reruns: [] } }
    await start($, on, w)
    expect(await texts(await mount($))).not.toMatch(/of 2 brewed/)
  })

})

describe('the band', () => {
  test('idle: what is open and who is needed; the board toggle', async ($, on) => {
    await start($, on)
    const ui = await band($)
    const t = await texts(ui)
    expect(t).toContain('4 open')
    expect(t).toContain('1 need you')
    expect(t).not.toMatch(/ahead|\d+\/\d+/)
    expect((await ui.findAll({ type: 'Button' })).length).toBe(1)
  })

  test('running: the cup, a 96px chip, the ID and its step', async ($, on) => {
    const clock = await start($, on)
    await $.command.run({ command: 'ristretto:brew', args: '' } as any).catch(() => {})
    await $.tool.call({ tool: 'Agent', prompt: '> PLANNER for ristretto feature **p1**', description: 'plan', subagent_type: 'general-purpose' } as any).catch(() => {})
    await clock.settle()
    const ui = await band($)
    const t = await texts(ui)
    expect(t).toContain('p1')
    expect(t).toContain('plan')
    expect((await svgs(ui)).some((s: string) => /width="96" height="14"/.test(s))).toBe(true)
    const term = await band($, 'terminal')
    expect(await texts(term)).toMatch(/[▓▒░·█▪]/)
  })
})
