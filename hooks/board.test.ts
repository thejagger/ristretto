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

type World = { files: Record<string, string>; git: Record<string, { exitCode: number; stdout: string }>; session: string; store?: Record<string, unknown>; mtimes?: Record<string, number>; writes: string[]; seen: string[]; spawns?: number }

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
  on('ui.open', () => ({ value: { isPlaced: true } }) as any)
  mock.store(on, w.store ?? {})
}

async function start($: any, on: any, w = world(), theme = 'dark') {
  const clock = mock.clock(on, { now: NOW })
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
const pull = async ($: any, clock: any, id: string) => {
  await $.command.run({ command: 'ristretto:pull', args: `${id} unattended` } as any).catch(() => {})
  await $.tool.call({ tool: 'Agent', prompt: `> PLANNER for ristretto feature **${id}**`, description: 'plan', subagent_type: 'general-purpose' } as any).catch(() => {})
  await clock.settle()
}

describe('one repo on a brew branch', () => {
  test('the branch story: needs you, done on this branch, can start now, next, the foot, the version', async ($, on) => {
    await start($, on)
    const ui = await mount($)
    const t = await texts(ui)
    for (const w of ['repo', 'v0.23.0', 'needs you · 3', 'blk', 'waits on Anatol', '1 check open', '2 findings · 2 checks open',
      'done on this branch · 1', 'd-here', 'can start now · 2', 'p1', 'next', 'p2', 'next · 1', 'pw', 'waits for blk', 'brew/x', 'suite green']) {
      expect(t).toContain(w)
    }
    // Merged long ago, not this branch's: no row. Nothing of the old cards is left.
    expect(t).not.toContain('d-old')
    for (const gone of ['Brewing', 'Branch', 'Domain facts', 'Up next', 'History', 'ahead']) expect(t).not.toContain(gone)
    await holdsTheLook(ui, 'branch view')
  })

  test('rows open their page, ← Board goes back; no Button in the pane', async ($, on) => {
    await start($, on)
    const ui = await mount($)
    expect((await ui.findAll({ type: 'Button' })).length).toBe(0)
    await press(ui, 'pr-need--review-here')
    let t = await texts(ui)
    expect(t).toContain('Needs a look')
    expect(t).toContain('Board')
    await press(ui, 'pr-back')
    expect(await texts(ui)).toContain('can start now')
  })

  test('the terminal draws the timeline in glyphs, press areas blank', async ($, on) => {
    await start($, on)
    const ui = await mount($, 'terminal')
    const t = await texts(ui)
    expect(t).toContain('brew/x')
    expect(t).toMatch(/[✓◐○✕]/)
    expect((await ui.findAll({ type: 'Svg' })).length).toBe(0)
    for (const a of await ui.findAll({ type: 'Client' })) expect(a.props.props.blank).toBe(true)
  })

  test('on the base branch only what is open: no done rows', async ($, on) => {
    const w = world()
    w.git['rev-parse --abbrev-ref HEAD'] = { exitCode: 0, stdout: 'main\n' }
    await start($, on, w)
    const t = await texts(await mount($))
    expect(t).toContain('can start now')
    expect(t).not.toContain('done on')
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

  test('a pull at work here: the SVG clock, the effort bar phase-locked, its session line', async ($, on) => {
    const clock = await start($, on)
    await pull($, clock, 'p1')
    const ui = await mount($)
    const t = await texts(ui)
    expect(t).toContain('at work · 1')
    expect(t).toContain('p1')
    expect(t).toContain('session “repo: brew” · unattended')
    const src = await svgs(ui)
    expect(src.some((s: string) => /steps\(10\) infinite/.test(s))).toBe(true)
    expect(src.some((s: string) => /height="21"/.test(s) && /animation-delay/.test(s))).toBe(true)
    await holdsTheLook(ui, 'at work')
  })
})

describe('the at-work record', () => {
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
  test('every repo on one board: needs you tagged, the web session at work, the foot per repo', async ($, on) => {
    const w = folder()
    await start($, on, w)
    const ui = await mount($)
    const t = await texts(ui)
    for (const s of ['needs you · 1', 'api', 'api-special-case-rules', 'done on the brew branches · 1', 'backoffice-feedback', 'api-order-title',
      'at work · 1', 'web-order-title', 'code', 'session “web: brew” · unattended', 'waited on api/api-order-title, done',
      'can start now', 'web-orders-customer-filter', 'api half done', 'next · 1', 'web-flat-rate-orders', 'waits for web-order-title',
      'feature/brew-2026-10-28', 'feature/brew-2026-10-29', 'brewing', 'platform', 'nothing open', 'odd', 'base unknown']) {
      expect(t).toContain(s)
    }
    expect(t).not.toContain('feature/parent')
    expect(t).not.toContain('notes')
    await holdsTheLook(ui, 'folder')
  })

  test('a session that went quiet: stopped after its phase, the age an SVG clock that counts on', async ($, on) => {
    const w = folder()
    const rec = JSON.parse(w.files['web/.ristretto/at-work.json'])
    w.files['web/.ristretto/at-work.json'] = JSON.stringify({ ...rec, beat: NOW - 20 * 60000 })
    await start($, on, w)
    const ui = await mount($)
    const t = await texts(ui)
    expect(t).toContain('stopped after plan')
    expect(t).toContain('ago')
    expect((await svgs(ui)).some((s: string) => /steps\(10\) infinite/.test(s))).toBe(true)
  })

  test('the same id in two repos: two tagged rows, each opening its own plan', async ($, on) => {
    await start($, on, folder())
    const ui = await mount($)
    const t = await texts(ui)
    expect(t.split('\n').filter(l => l === 'dup').length).toBe(2)
    await press(ui, 'pr-free-web-dup')
    expect(await texts(ui)).toContain('The same id in web')
  })

  test('after the merge: every repo on main, no done rows, nothing brewing', async ($, on) => {
    const w = folder()
    for (const f of ['api', 'web']) w.git[`${f}|rev-parse --abbrev-ref HEAD`] = { exitCode: 0, stdout: 'main\n' }
    delete w.files['web/.ristretto/at-work.json']
    delete w.files['web/.ristretto/pulling']
    await start($, on, w)
    const t = await texts(await mount($))
    expect(t).not.toContain('done on')
    expect(t).toContain('api, platform, web on their base branch')
    expect(t).toContain('nothing brewing')
    expect(t).toContain('web-order-title')
  })

  test('the band names the brewing feature with its repo', async ($, on) => {
    await start($, on, folder())
    const t = await texts(await band($))
    expect(t).toContain('web')
    expect(t).toContain('web-order-title')
    expect(t).toContain('code')
    expect(t).toContain('1 need you')
  })
})

describe('the band', () => {
  test('idle: what is next, how many can start, who is needed; the board toggle', async ($, on) => {
    const w = world()
    w.git['rev-parse --abbrev-ref HEAD'] = { exitCode: 0, stdout: 'main\n' }
    await start($, on, w)
    const ui = await band($)
    const t = await texts(ui)
    expect(t).toContain('next')
    expect(t).toContain('p1')
    expect(t).toContain('2 can start')
    expect(t).toContain('3 need you')
    expect((await ui.findAll({ type: 'Button' })).length).toBe(1)
  })

  test('a brew branch with nothing running: what it holds', async ($, on) => {
    await start($, on)
    expect(await texts(await band($))).toContain('1 done on this branch')
  })

  test('running: the cup, a 96px chip, the ID and its step', async ($, on) => {
    const clock = await start($, on)
    await pull($, clock, 'p1')
    const ui = await band($)
    const t = await texts(ui)
    expect(t).toContain('p1')
    expect(t).toContain('plan')
    expect((await svgs(ui)).some((s: string) => /width="96" height="14"/.test(s))).toBe(true)
    expect(await texts(await band($, 'terminal'))).toMatch(/[▓▒░·█▪]/)
  })

  test('the terminal draws no emoji', async ($, on) => {
    await start($, on)
    expect(await texts(await band($, 'terminal'))).not.toContain('☕')
  })
})
