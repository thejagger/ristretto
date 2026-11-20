import { describe, expect, mock, test } from 'claude-code/testing'

// The board as the desktop shows it, on repos held in memory: files and git answered by hooks
// beneath the plugin. The Timeline (spec 2026-11-09): the branch decides the view, a folder of
// repos is one board with every row tagged, and the session doing a pull leaves its run in
// .ristretto/at-work.json for the board at the folder. The rendering rules the desktop taught us
// still hold: draw on change only, no clock read while drawing, presses without Buttons, theme keys.

const PANE = { title: 'ristretto', isFocused: false, bodyColumns: 52, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } as any
const BAND = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 80, scroll: { offset: 0, bodyRows: 4 }, view: {} } as any
const VIEW = { columns: 52, rows: 80, isFullscreen: true } as any
const ROOT = '/repo'
const NOW = Date.UTC(2026, 9, 14, 12, 0)
const THEME_KEYS = new Set(['text', 'subtle', 'inactive', 'claude', 'error', 'success', 'warning', 'permission'])
// v1: the step colours, both themes, and prep's brass, may colour text too.
const DARK_STEPS = { plan: '#A3A29C', build: '#E0896A', prove: '#3FB574', review: '#A58BE8', close: '#8FA1B6' }
const LIGHT_STEPS = { plan: '#6B6A66', build: '#B4532F', prove: '#1F7A4D', review: '#6B4FC0', close: '#55677C' }
const INKS = new Set([...THEME_KEYS, ...Object.values(DARK_STEPS), ...Object.values(LIGHT_STEPS), '#E8B64A'])
const REFS = 'for-each-ref --format=%(refname) refs/heads/main refs/remotes/origin/main refs/heads/master refs/remotes/origin/master refs/heads/development refs/remotes/origin/development refs/heads/develop refs/remotes/origin/develop'

const table = (rows: string[]) => ['# Ristretto Roadmap', '<!-- ristretto-format: 0.23 -->', '', '| Flight | Feature | Title | Tier | Status |', '|---|---|---|---|---|', ...rows, ''].join('\n')

const ROADMAP = table([
  '| a | d-old | An old one | normal | done |',
  '| a | d-here | Done here | normal | done |',
  '| a | human-here | Needs a person | normal | done |',
  '| a | review-here | Needs a look | normal | done |',
  '| b | blk | Blocked one | normal | blocked |',
  '| b | p1 | Planned 1 | normal | planned |',
  '| b | p2 | Planned 2 | normal | planned |',
  '| b | pw | Waits on blk | normal | planned |',
]) + '\n- **blk** — waiting on Anatol: the API doc\n'

type World = { files: Record<string, string>; git: Record<string, { exitCode: number; stdout: string }>; session: string; store?: Record<string, unknown>; mtimes?: Record<string, number>; writes: string[]; seen: string[]; spawns?: number; state?: Record<string, any>; opens?: number }

// git answers for one repo, keyed `<folder>|<argv>` at a folder ('' for the root repo).
function gitFor(prefix: string, head: string, log: string) {
  const k = (s: string) => (prefix ? `${prefix}|${s}` : s)
  return {
    [k('rev-parse --abbrev-ref HEAD')]: { exitCode: 0, stdout: `${head}\n` },
    [k(REFS)]: { exitCode: 0, stdout: 'refs/heads/main\n' },
    [k('log --format=%ct%x09%s refs/heads/main..HEAD --')]: { exitCode: 0, stdout: log },
    [k('rev-parse HEAD')]: { exitCode: 0, stdout: `${'c'.repeat(40)}\n` },
    [k(`diff --quiet --end-of-options ${'a'.repeat(40)} HEAD -- . :(exclude)docs/ristretto`)]: { exitCode: 0, stdout: '' },
    [k('rev-parse --absolute-git-dir')]: { exitCode: 0, stdout: `${ROOT}/${prefix ? `${prefix}/` : ''}.git\n` },
    [k('rev-parse --git-common-dir')]: { exitCode: 0, stdout: '.git\n' },
    [k('rev-parse --show-toplevel')]: { exitCode: 0, stdout: `${ROOT}${prefix ? `/${prefix}` : ''}\n` },
  }
}
const SUITE = JSON.stringify({ verdict: 'green', head: 'c'.repeat(40), tree: 'a'.repeat(40), at: 1, gates: 'test ✓', failing: '' })

function world(): World {
  return {
    session: 's1',
    writes: [],
    seen: [],
    files: {
      '.git/logs/refs/heads/main': 'one move\n',
      'docs/ristretto/roadmap.md': ROADMAP,
      'docs/ristretto/plans/human-here.md': '- Acceptance:\n  - [x] [human] a\n  - [ ] [human] b\n',
      'docs/ristretto/plans/review-here.md': '- Acceptance:\n  - [ ] [human] x\n  - [ ] [human] y\n\n## Open findings\n\n- block · a.js:1 · one\n- block · b.js:2 · two\n',
      'docs/ristretto/plans/pw.md': '- Depends: blk\n',
      '.ristretto/suite.json': SUITE,
    },
    git: gitFor('', 'brew/x', '1760440000\tdocs(blk): blocked\n1760430000\tfeat(review-here): r\n1760420000\tfeat(human-here): h\n1760410000\tfeat(d-here): d\n'),
  }
}

// sisi: api and web on brew branches, platform on main; web's session pulls web-order-title.
function folder(): World {
  const rec = { v: 1, session: 'w1', id: 'web-order-title', command: 'pull', unattended: true, title: '', startedAt: NOW - 720000, phase: 'coding', step: 'code', red: false, effort: [{ name: 'plan', state: 'done' }, { name: 'code', state: 'current', progress: 0.5 }, { name: 'review', state: 'todo' }, { name: 'close', state: 'todo' }], beat: NOW - 30000, endedAt: null }
  return {
    session: 's1',
    writes: [],
    seen: [],
    files: {
      'api/docs/ristretto/roadmap.md': table([
        '| backoffice-feedback | api-order-title | Bestelltitel neben der Nummer | normal | done |',
        '| backoffice-feedback | api-special-case-rules | Spezialfälle als Regel | normal | blocked |',
        '| backoffice-feedback | dup | The same id in api | normal | planned |',
      ]) + '\n- **api-special-case-rules** — waits on your collection of special cases\n',
      'api/.ristretto/suite.json': SUITE,
      'web/docs/ristretto/roadmap.md': table([
        '| backoffice-feedback | web-order-title | Bestelltitel im Office | normal | planned |',
        '| backoffice-feedback | web-orders-customer-filter | Nach Kunde filtern | easy | planned |',
        '| backoffice-feedback | web-flat-rate-orders | Pauschal im Office | normal | planned |',
        '| backoffice-feedback | dup | The same id in web | normal | planned |',
      ]),
      'web/docs/ristretto/plans/web-order-title.md': '- Depends: api/api-order-title\n',
      'web/docs/ristretto/plans/web-orders-customer-filter.md': '- Depends: api/api-order-title\n',
      'web/docs/ristretto/plans/web-flat-rate-orders.md': '- Depends: web-order-title\n',
      'web/.ristretto/at-work.json': JSON.stringify(rec),
      'web/.ristretto/pulling': 'w1',
      'platform/docs/ristretto/roadmap.md': table(['| p | plat-done | Done | normal | done |']),
      'notes/readme.md': 'not a repo',
      // A roadmap in a plain folder inside a git repo: git would answer with the parent's branch.
      'odd/docs/ristretto/roadmap.md': table(['| o | odd-one | Odd | normal | planned |']),
    },
    mtimes: { 'web/.ristretto/pulling': NOW - 30000 },
    git: {
      ...gitFor('api', 'feature/brew-2026-10-28', '1760000000\tfeat(api-order-title): t\n'),
      ...gitFor('web', 'feature/brew-2026-10-29', ''),
      ...gitFor('platform', 'main', ''),
      ...gitFor('odd', 'feature/parent', '1760000000\tfeat(odd-one): o\n'),
      'odd|rev-parse --show-toplevel': { exitCode: 0, stdout: `${ROOT}\n` },
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
  on('fs.exists', ($: any, e: any) => {
    w.seen.push(rel(e.path))
    return { value: rel(e.path) in w.files || isDir(e.path) } as any
  })
  on('fs.read', ($: any, e: any) => {
    w.seen.push(rel(e.path))
    if (/\.claude-plugin\/plugin\.json$/.test(String(e.path).replace(/\\/g, '/'))) return { value: JSON.stringify({ name: 'ristretto', version: '0.23.0' }) } as any
    if (!(rel(e.path) in w.files)) throw new Error(`ENOENT ${e.path}`)
    return { value: w.files[rel(e.path)] } as any
  })
  on('fs.write', ($: any, e: any) => {
    w.files[rel(e.path)] = e.text
    w.writes.push(rel(e.path))
    return { value: undefined } as any
  })
  on('fs.stat', ($: any, e: any) => {
    if (!(rel(e.path) in w.files) && !isDir(e.path)) throw new Error(`ENOENT ${e.path}`)
    return { value: { kind: isDir(e.path) ? 'dir' : 'file', size: 1, mtimeMs: w.mtimes?.[rel(e.path)] ?? (w.files[rel(e.path)] ?? '').length } } as any
  })
  on('fs.list', ($: any, e: any) => {
    const dir = rel(e.path) === ROOT ? '' : `${rel(e.path)}/`
    const names = new Set<string>()
    for (const f of Object.keys(w.files)) if (f.startsWith(dir)) names.add(f.slice(dir.length).split('/')[0])
    return { value: [...names].map(name => ({ name, kind: Object.keys(w.files).some(f => f.startsWith(`${dir}${name}/`)) ? 'dir' : 'file', size: 1, mtimeMs: 1, isLink: false })) } as any
  })
  on('process.run', ($: any, e: any) => {
    const key = (e.argv as string[]).slice(1).join(' ')
    w.spawns = (w.spawns ?? 0) + 1
    const at = rel(String(e.init?.cwd ?? ROOT))
    const prefix = at === ROOT || at === '' ? '' : at
    const hit = (e.argv as string[])[0] === 'git' ? w.git[prefix ? `${prefix}|${key}` : key] : undefined
    return { value: { exitCode: hit ? hit.exitCode : 1, stdout: hit ? hit.stdout : '', stderr: '' } } as any
  })
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme, provider: 'engine', isLocked: false }] }) as any)
  on('ui.open', () => { w.opens = (w.opens ?? 0) + 1; return { value: { isPlaced: true } } as any })
  // What the board last wrote to each of its values, as the engine keeps it.
  on('state.set', async ($: any, e: any, next: any) => { if (e.plugin === 'ristretto') w.state = { ...(w.state ?? {}), [e.key]: e.value }; return next(e) })
  mock.store(on, w.store ?? {})
}

async function start($: any, on: any, w = world(), theme = 'dark') {
  const clock = mock.clock(on, { now: NOW })
  install(on, w, theme)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true } as any)
  await clock.settle()
  return Object.assign(Object.create(clock), { w })
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
    if (c !== undefined && !INKS.has(c)) throw new Error(`${where}: text colour ${c} is not a theme key (${t.text})`)
  }
  for (const src of await svgs(ui)) if (src.length > 131072) throw new Error(`${where}: an SVG of ${src.length} chars`)
}
const pull = async ($: any, clock: any, id: string) => {
  await $.command.run({ command: 'ristretto:pull', args: `${id} unattended` } as any).catch(() => {})
  await $.tool.call({ tool: 'Agent', prompt: `> PLANNER for ristretto feature **${id}**`, description: 'plan', subagent_type: 'general-purpose' } as any).catch(() => {})
  await clock.settle()
}

describe('one repo: the four views (v1)', () => {
  const turnEnd = (answer: string) => ({ answer, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  const displayOnly = async (ui: any, where: string) => {
    expect((await ui.findAll({ type: 'Button' })).length).toBe(0)
    expect((await ui.findAll({ type: 'Client' })).length).toBe(0)
    for (const s of await ui.findAll({ type: 'Svg' })) if (!String(s.props.alt ?? '').trim()) throw new Error(`${where}: an Svg with no alt`)
    await holdsTheLook(ui, where)
  }
  const attended = async ($: any, clock: any, id: string) => {
    await $.command.run({ command: 'ristretto:pull', args: id } as any).catch(() => {})
    await $.tool.call({ tool: 'Agent', prompt: `> IMPLEMENTER for ristretto feature **${id}**`, description: 'build', subagent_type: 'general-purpose' } as any).catch(() => {})
    await clock.settle()
  }

  test('rest: whose turn it is: what to test, what is blocked, what comes next', async ($, on) => {
    await start($, on)
    const ui = await mount($)
    const t = await texts(ui)
    for (const w of ['TO TEST · 3', 'human-here', 'review-here', 'BLOCKED · 1', 'blk', 'waits on Anatol', 'NEXT', 'p1', 'Planned 1', 'p2', 'v0.23.0']) expect(t).toContain(w)
    // Merged long ago, not this branch's: nowhere.
    expect(t).not.toContain('d-old')
    expect((await ui.findAll({ type: 'Svg' }))[0].props.alt).toContain('YOUR TURN')
    await displayOnly(ui, 'rest')
  })

  test('rest with nothing waiting says READY', async ($, on) => {
    const w = world()
    w.files['docs/ristretto/roadmap.md'] = table(['| a | d-here | Done here | normal | done |', '| b | p1 | Planned 1 | normal | planned |'])
    await start($, on, w)
    const ui = await mount($)
    expect((await ui.findAll({ type: 'Svg' }))[0].props.alt).toContain('READY')
    expect(await texts(ui)).not.toContain('TO TEST')
  })

  test('brew: two done, the card at work, what comes next, on the rail', async ($, on) => {
    const clock = await start($, on)
    await pull($, clock, 'p1')
    const ui = await mount($)
    const t = await texts(ui)
    for (const w of ['Needs a person', 'Needs a look', 'Planned 1', 'Planned 2', 'Waits on blk']) expect(t).toContain(w)
    expect(t).not.toContain('Done here')
    const all = await ui.findAll({ type: 'Svg' })
    expect(all.filter((s: any) => s.props.width === 16).length).toBe(5)
    expect(all.some((s: any) => /^PLAN, step 1 \/ 5$/.test(s.props.alt))).toBe(true)
    expect(all[0].props.alt).toContain('brew')
    await displayOnly(ui, 'brew')
  })

  test('pull: the step as a word, the five steps in their colours, what to test after', async ($, on) => {
    const w = world()
    w.files['docs/ristretto/plans/p1.md'] = '- Acceptance:\n  - [ ] [human] look at it\n    how: open the pane\n'
    const clock = await start($, on, w)
    await attended($, clock, 'p1')
    const ui = await mount($)
    const t = await texts(ui)
    expect((await ui.findAll({ type: 'Svg' }))[0].props.alt).toContain('BUILD')
    for (const [name, hex] of Object.entries(DARK_STEPS)) {
      const el = (await ui.findAll({ type: 'Text' })).find((x: any) => x.text === name.toUpperCase())
      expect(el?.props.color).toBe(hex)
    }
    expect(t).toContain('FOR YOU, AFTER')
    expect(t).toContain('look at it')
    expect(t).toContain('Planned 1')
    await displayOnly(ui, 'pull')
  })

  test('pull on a light theme: the step names in the light inks', async ($, on) => {
    const clock = await start($, on, world(), 'light')
    await attended($, clock, 'p1')
    const ui = await mount($)
    const el = (await ui.findAll({ type: 'Text' })).find((x: any) => x.text === 'REVIEW')
    expect(el?.props.color).toBe('#6B4FC0')
  })

  test('prep: what is decided, what is open, what was found', async ($, on) => {
    await start($, on)
    await $.command.run({ command: 'ristretto:prep', args: 'p1' } as any).catch(() => {})
    await $.turn.complete(turnEnd('decided: Modes → Prep, pull, brew.\nopen: Init — its own mode?\nfound: A pane is cells.') as any).catch(() => {})
    const ui = await mount($)
    const t = await texts(ui)
    for (const w of ['DECIDED', 'Modes', 'Prep, pull, brew.', 'OPEN', 'its own mode?', 'FOUND', 'A pane is cells.', 'Planned 1']) expect(t).toContain(w)
    expect((await ui.findAll({ type: 'Svg' }))[0].props.alt).toContain('POINTS SETTLED')
    await displayOnly(ui, 'prep')
  })

  test('no roadmap: one line and no image', async ($, on) => {
    const w = world()
    delete w.files['docs/ristretto/roadmap.md']
    await start($, on, w)
    const ui = await mount($)
    expect((await ui.findAll({ type: 'Svg' })).length).toBe(0)
    expect(await texts(ui)).toContain('/ristretto:prep')
  })

  test('the terminal: text only, the mode and the step', async ($, on) => {
    const clock = await start($, on)
    let ui = await mount($, 'terminal')
    expect((await ui.findAll({ type: 'Svg' })).length).toBe(0)
    expect(await texts(ui)).toContain('REST YOUR TURN')
    await ui.unmount()
    await attended($, clock, 'p1')
    ui = await mount($, 'terminal')
    const t = await texts(ui)
    expect(t).toContain('PULL BUILD')
    expect(t).toContain('● build')
  })

  test('brew detection by the orchestrating marker is gone', async ($, on) => {
    const w = world()
    await start($, on, w)
    await mount($)
    expect(w.seen.some(p => p.includes('orchestrating'))).toBe(false)
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

  test('a pull at work here: the SVG clock, the meter phase-locked', async ($, on) => {
    const clock = await start($, on)
    await pull($, clock, 'p1')
    const ui = await mount($)
    expect(await texts(ui)).toContain('p1')
    const src = await svgs(ui)
    expect(src.some((s: string) => /steps\(10\) infinite/.test(s))).toBe(true)
    expect(src.some((s: string) => /height="21"/.test(s) && /animation-delay/.test(s))).toBe(true)
    await holdsTheLook(ui, 'at work')
  })
})

describe('the at-work record', () => {
  test('a pull the brewer sends arrives as a Skill call: the record still says pull, unattended', async ($, on) => {
    const w = world()
    const clock = await start($, on, w)
    await $.tool.call({ tool: 'Skill', skill: 'ristretto:pull', args: 'p1 unattended' } as any).catch(() => {})
    await $.tool.call({ tool: 'Agent', prompt: '> PLANNER for ristretto feature **p1**', description: 'plan', subagent_type: 'general-purpose' } as any).catch(() => {})
    await clock.settle()
    const rec = JSON.parse(w.files['.ristretto/at-work.json'])
    expect(rec.id).toBe('p1')
    expect(rec.command).toBe('pull')
    expect(rec.unattended).toBe(true)
  })

  test('a pull here writes it once per shown change; the heartbeat after a minute redraws nothing', async ($, on) => {
    const w = world()
    const clock = await start($, on, w)
    await pull($, clock, 'p1')
    const rec = JSON.parse(w.files['.ristretto/at-work.json'])
    expect(rec.id).toBe('p1')
    expect(rec.session).toBe('s1')
    expect(rec.unattended).toBe(true)
    const writes = w.writes.length
    const ui = await mount($)
    const t0 = await texts(ui)
    await clock.advance(30_000)
    await clock.settle()
    expect(w.writes.length).toBe(writes)
    await clock.advance(35_000)
    await clock.settle()
    expect(w.writes.length).toBe(writes + 1)
    const beat = JSON.parse(w.files['.ristretto/at-work.json'])
    expect(beat.beat).toBeGreaterThan(rec.beat)
    expect(beat.startedAt).toBe(rec.startedAt)
    await ui.drawn()
    expect(await texts(ui)).toBe(t0)
  })

  test('the run ending (the session moving on) writes endedAt', async ($, on) => {
    const w = world()
    const clock = await start($, on, w)
    await pull($, clock, 'p1')
    // The session moves on (`pull next` before it names its feature): the run it left has ended.
    await $.command.run({ command: 'ristretto:pull', args: 'next' } as any).catch(() => {})
    await clock.settle()
    expect(JSON.parse(w.files['.ristretto/at-work.json']).endedAt).not.toBeNull()
  })
})

describe('two sessions, one repo', () => {
  test('a session that lost the pull never overwrites the record of the one that took it', async ($, on) => {
    const w = world()
    w.files['.ristretto/pulling'] = 's1'
    w.mtimes = { '.ristretto/pulling': NOW }
    const clock = await start($, on, w)
    await pull($, clock, 'p1')
    await clock.advance(5000)
    await clock.settle()
    // Another session took the pull over and wrote its own record.
    const theirs = { ...JSON.parse(w.files['.ristretto/at-work.json']), session: 's2', id: 'p2', beat: NOW + 5000 }
    w.files['.ristretto/at-work.json'] = JSON.stringify(theirs)
    w.files['.ristretto/pulling'] = 's2'
    w.mtimes = { '.ristretto/pulling': NOW + 5000 }
    await clock.advance(5000)
    await clock.settle()
    await clock.advance(65000)
    await clock.settle()
    expect(JSON.parse(w.files['.ristretto/at-work.json'])).toEqual(theirs)
  })
})

describe('the poll', () => {
  test('a gate touching the marker, or a heartbeat, re-reads those two files and runs no git', async ($, on) => {
    const w = folder()
    const clock = await start($, on, w)
    await mount($)
    const before = w.spawns ?? 0
    w.mtimes = { ...w.mtimes, 'web/.ristretto/pulling': NOW + 4000 }
    w.files['web/.ristretto/at-work.json'] = JSON.stringify({ ...JSON.parse(w.files['web/.ristretto/at-work.json']), beat: NOW + 4000 })
    await clock.advance(5000)
    await clock.settle()
    expect(w.spawns ?? 0).toBe(before)
  })
})

describe('a record a dead session left', () => {
  test('is replaced by the next pull here', async ($, on) => {
    const w = world()
    w.files['.ristretto/pulling'] = 's1'
    w.mtimes = { '.ristretto/pulling': NOW }
    w.files['.ristretto/at-work.json'] = JSON.stringify({ v: 1, session: 's9', id: 'p2', command: 'pull', unattended: true, title: '', startedAt: NOW - 7200000, phase: 'coding', step: 'code', red: false, effort: [], beat: NOW - 3600000, endedAt: null })
    const clock = await start($, on, w)
    await pull($, clock, 'p1')
    const rec = JSON.parse(w.files['.ristretto/at-work.json'])
    expect(rec.session).toBe('s1')
    expect(rec.id).toBe('p1')
  })
})

describe('a folder of repos', () => {
  test('every repo on one board: the web session at work, tagged; what api did on its branch', async ($, on) => {
    const w = folder()
    await start($, on, w)
    const ui = await mount($)
    const t = await texts(ui)
    for (const s of ['api · api-order-title', 'Bestelltitel neben der Nummer', 'web · web-order-title', 'Bestelltitel im Office']) expect(t).toContain(s)
    expect(t).not.toContain('feature/parent')
    expect(t).not.toContain('notes')
    // A record an older build wrote says `code`: the card says BUILD.
    expect((await ui.findAll({ type: 'Svg' })).some((s: any) => /^BUILD, step 2 \/ 4$/.test(s.props.alt))).toBe(true)
    await holdsTheLook(ui, 'folder')
  })

  test('a session that went quiet: stopped after its phase, the owner\'s to look at', async ($, on) => {
    const w = folder()
    const rec = JSON.parse(w.files['web/.ristretto/at-work.json'])
    w.files['web/.ristretto/at-work.json'] = JSON.stringify({ ...rec, beat: NOW - 20 * 60000 })
    await start($, on, w)
    const ui = await mount($)
    expect(await texts(ui)).toContain('stopped after plan')
    expect((await ui.findAll({ type: 'Svg' }))[0].props.alt).toContain('YOUR TURN')
  })

  test('after the merge: every repo on main, nothing done here, nothing brewing', async ($, on) => {
    const w = folder()
    for (const f of ['api', 'web']) w.git[`${f}|rev-parse --abbrev-ref HEAD`] = { exitCode: 0, stdout: 'main\n' }
    delete w.files['web/.ristretto/at-work.json']
    delete w.files['web/.ristretto/pulling']
    await start($, on, w)
    const ui = await mount($)
    const t = await texts(ui)
    expect(t).not.toContain('api-order-title')
    expect(t).toContain('api-special-case-rules')
    expect((await ui.findAll({ type: 'Svg' }))[0].props.alt).toContain('rest')
  })

  test('the band names the brewing feature with its repo', async ($, on) => {
    await start($, on, folder())
    const all = await (await band($)).findAll({ type: 'Svg' })
    expect(all.length).toBe(1)
    expect(all[0].props.alt).toContain('web-order-title')
    expect(all[0].props.alt).toContain('BUILD')
  })
})

describe('the band (v1): the chip above the prompt', () => {
  test('during a brew: one image, 44px high, naming the mode and the step; no Button', async ($, on) => {
    const clock = await start($, on)
    await pull($, clock, 'p1')
    const ui = await band($)
    const all = await ui.findAll({ type: 'Svg' })
    expect(all.length).toBe(1)
    expect(all[0].props.height).toBe(44)
    expect(all[0].props.alt).toContain('BREW')
    expect(all[0].props.alt).toContain('p1')
    expect(all[0].props.alt).toContain('PLAN')
    expect((await ui.findAll({ type: 'Button' })).length).toBe(0)
    expect(String(all[0].props.source)).toContain('width="100%"')
  })

  test('at rest: whose turn it is', async ($, on) => {
    await start($, on)
    const all = await (await band($)).findAll({ type: 'Svg' })
    expect(all[0].props.alt).toContain('YOUR TURN')
  })

  test('no roadmap: the band draws nothing of its own', async ($, on) => {
    const w = world()
    delete w.files['docs/ristretto/roadmap.md']
    // This hook stands for the engine's own band.
    on('ui.render', { component: 'AbovePrompt' } as any, ($: any, e: any) => ($.ui.resolve(e) as any).Text({ children: 'engine' }))
    await start($, on, w)
    const ui = await band($)
    expect((await ui.findAll({ type: 'Svg' })).length).toBe(0)
    expect(await texts(ui)).toBe('engine')
  })

  test('the terminal: one line of text, no emoji', async ($, on) => {
    await start($, on)
    const ui = await band($, 'terminal')
    const all = await ui.findAll({ type: 'Text' })
    expect(all.length).toBe(1)
    expect(all[0].text).toContain('YOUR TURN')
    expect(all[0].text).not.toContain('☕')
  })
})

describe('v1: the steps, prep and its pins', () => {
  const turnEnd = (answer: string, more: any = {}) => ({ answer, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', ...more })
  const shown = { isFullscreen: true, columns: 120 }

  test('verify, /code-review and close.js move a run through prove, review and close', async ($, on) => {
    const clock = await start($, on)
    await $.command.run({ command: 'ristretto:pull', args: 'p1' } as any).catch(() => {})
    await $.tool.call({ tool: 'Agent', prompt: '> IMPLEMENTER for ristretto feature **p1**', description: 'build', subagent_type: 'general-purpose' } as any).catch(() => {})
    await clock.settle()
    expect(clock.w.state!.live.phase).toBe('coding')
    await clock.advance(60000)
    await $.tool.call({ tool: 'Bash', command: 'node "/p/scripts/gate.js" verify' } as any).catch(() => {})
    expect(clock.w.state!.live.phase).toBe('proving')
    await $.tool.call({ tool: 'Skill', skill: 'code-review', args: 'high /repo' } as any).catch(() => {})
    expect(clock.w.state!.live.phase).toBe('review')
    await $.tool.call({ tool: 'Bash', command: 'node "/p/scripts/close.js" p1 --input .ristretto/close-p1.json' } as any).catch(() => {})
    expect(clock.w.state!.live.phase).toBe('closing')
    // The time each step took is kept for the drawing, by step name.
    const started = clock.w.state!.started
    expect(started.id).toBe('p1')
    expect(Object.keys(started.steps ?? {})).toContain('build')
  })

  test('a typed /code-review is a review too', async ($, on) => {
    const clock = await start($, on)
    await $.command.run({ command: 'ristretto:pull', args: 'p1' } as any).catch(() => {})
    await $.tool.call({ tool: 'Agent', prompt: '> IMPLEMENTER for ristretto feature **p1**', description: 'build', subagent_type: 'general-purpose' } as any).catch(() => {})
    await clock.settle()
    await $.command.run({ command: 'code-review', args: 'high /repo' } as any).catch(() => {})
    expect(clock.w.state!.live.phase).toBe('review')
  })

  test('prep pins what its answers decide; a subagent pins nothing', async ($, on) => {
    const { w } = await start($, on)
    await $.command.run({ command: 'ristretto:prep', args: 'R-33 the board' } as any).catch(() => {})
    expect(w.state!.prep.id).toBe('R-33')
    await $.turn.complete(turnEnd('Here we are.\n\ndecided: Modes → Prep, pull, brew.\nopen: Init — its own mode?\nfound: A pane is cells.') as any).catch(() => {})
    let pins = w.state!.pins
    expect(pins.points).toEqual([{ topic: 'Init', question: 'its own mode?', ruling: null }, { topic: 'Modes', question: '', ruling: 'Prep, pull, brew.' }])
    expect(pins.found).toEqual(['A pane is cells.'])
    await $.turn.complete(turnEnd('decided: Other → x', { agentId: 'sub1' }) as any).catch(() => {})
    pins = w.state!.pins
    expect(pins.points.length).toBe(2)
  })

  test('a build ends prep, clears its pins and opens the pane where it docks', async ($, on) => {
    const { w } = await start($, on)
    const opened0 = w.opens ?? 0
    await $.command.run({ command: 'ristretto:prep', args: '', presentation: { ...shown, isFullscreen: false } } as any).catch(() => {})
    expect((w.opens ?? 0) - opened0).toBe(0)
    await $.command.run({ command: 'ristretto:prep', args: '', presentation: shown } as any).catch(() => {})
    expect((w.opens ?? 0) - opened0).toBe(1)
    await $.turn.complete(turnEnd('decided: A → B') as any).catch(() => {})
    await $.command.run({ command: 'ristretto:pull', args: 'p1', presentation: shown } as any).catch(() => {})
    expect(w.state!.prep).toBe(null)
    expect(w.state!.pins.points).toEqual([])
    expect((w.opens ?? 0) - opened0).toBe(2)
  })
})
