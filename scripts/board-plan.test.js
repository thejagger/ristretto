#!/usr/bin/env node
// Self-check for hooks/board-plan.mjs — run with: node scripts/board-plan.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const p = await import(pathToFileURL(path.join(__dirname, '..', 'hooks', 'board-plan.mjs')).href);

  // Excerpts from tessera's plans: an open one (Depends under Approach, Blockers inline), an
  // archived one (Evidence with a two-criteria line, the closer's review line, a Gate line).
  const open = [
    '## Contract',
    '- Acceptance:',
    '  - [auto] Each check raises its problem exactly when its condition holds',
    '    and not otherwise.',
    '  - [human] The Rückfrage mail arrives in Outlook',
    '- Provides: an e2e seed command',
    '- Manual-Checks: —',
    '- Blockers: (pending roast questions: e2e data isolation)',
    '',
    '## Approach',
    '- Likely touchpoints: backend/app/lnw',
    '- Depends: lnw-core, mail-outbound',
    '- Parallel-with: —',
  ].join('\n');
  const o = p.parsePlan(open);
  assert.deepStrictEqual(o.acceptance, [
    { auto: true, text: 'Each check raises its problem exactly when its condition holds and not otherwise.' },
    { auto: false, text: 'The Rückfrage mail arrives in Outlook' },
  ], 'items, tags read, a wrapped line continues its item');
  assert.deepStrictEqual(o.depends, ['lnw-core', 'mail-outbound'], 'Depends found under Approach');
  assert.deepStrictEqual(o.blockers, ['(pending roast questions: e2e data isolation)'], 'an inline Blockers value');
  assert.deepStrictEqual(p.parsePlan('- Depends: —\n- Blockers: —\n').depends, []);
  assert.deepStrictEqual(p.parsePlan('- Blockers:\n  - API docs → Anatol\n  - write API → Anatol\n').blockers, ['API docs → Anatol', 'write API → Anatol']);

  const archived = [
    '## Contract',
    '- Acceptance:',
    '  - [auto] one',
    '  - [auto] two',
    '  - [auto] three',
    '  - [auto] four',
    '## Evidence',
    '- Criterion 1 (check table): `test_checks.py::test_one`.',
    '- Criteria 3, 4 (customer requirements): `test_checks.py::test_requirements`.',
    '- Gate: `gate.js prove` exit 0.',
    'review: notes-only · rounds: 1 · open: 0 block, 3 note, 4 lean',
    '',
    '## Open findings',
    '',
    '```',
    'bug · bin/install.php:177 · the schema check misses a table',
    '```',
  ].join('\r\n');
  const a = p.parsePlan(archived);
  assert.strictEqual(p.proofFor(a, 1), '`test_checks.py::test_one`.');
  assert.strictEqual(p.proofFor(a, 2), null, 'a criterion without an Evidence line has no proof');
  assert.strictEqual(p.proofFor(a, 4), '`test_checks.py::test_requirements`.', 'one line proving two criteria');
  assert.strictEqual(a.gate, '`gate.js prove` exit 0.');
  assert.strictEqual(a.review, 'review: notes-only · rounds: 1 · open: 0 block, 3 note, 4 lean');
  assert.deepStrictEqual(a.findings, ['bug · bin/install.php:177 · the schema check misses a table']);
  // Shapes tessera's closers wrote: a range with a gap, a parenthesis holding a colon, free
  // words before the colon, and a plan trailer after the findings.
  const loose = p.parsePlan([
    '## Evidence',
    '- Criteria 1 to 4 and 6 (item with `source: "mail"`): `test_intake_mail.py`',
    '- Criterion 8 and live proof: smoke-test passed',
    '',
    '## Open findings',
    '- note · a.ts:1 · weak check',
    '',
    'status: done',
  ].join('\n'));
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 8].map((n) => p.proofFor(loose, n)),
    ['`test_intake_mail.py`', '`test_intake_mail.py`', '`test_intake_mail.py`', '`test_intake_mail.py`', null, '`test_intake_mail.py`', 'smoke-test passed']);
  assert.deepStrictEqual(loose.findings, ['note · a.ts:1 · weak check'], 'a trailer is not a finding');
  // Other repos' closers: bold heads with a dash before the proof and the proof wrapping
  // (vs-ruprechtshofen), `Acceptance 1/2` (ecolaw), `AC3`, a proof table, two criteria named
  // apart on one line, a bold review line and `Gates:`.
  const other = p.parsePlan([
    '## Contract',
    '- Acceptance:',
    '  - [auto] At most 12 cards per page, the page size a single named',
    '    constant',
    '  - [auto] two',
    '  - [auto] three',
    '  - [auto] four',
    '  - [auto] five',
    '  - [auto] six',
    '',
    '## Evidence',
    '- **Criterion 1** (at most 12 cards, page size a single named constant',
    '  `PAGE_SIZE`) — `test_pager.php::test_twelve`, red before.',
    '- **Acceptance 2/3 (EmptyState)** — `empty-states.test.tsx`,',
    '  9 cases.',
    '- **AC4 (org-wide)**: `test_org.py`',
    '- Criterion 5 (due dates) and criterion 6 (exclusions): `test_dues.py`',
    '- Gates: lint 0, test OK',
    '**review: clean - rounds: 1**',
  ].join('\n'));
  assert.strictEqual(other.acceptance[0].text, 'At most 12 cards per page, the page size a single named constant', 'a wrapped item keeps its tail');
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6].map((n) => p.proofFor(other, n)), [
    '`test_pager.php::test_twelve`, red before.', '`empty-states.test.tsx`, 9 cases.', '`empty-states.test.tsx`, 9 cases.',
    '`test_org.py`', '`test_dues.py`', '`test_dues.py`',
  ]);
  assert.deepStrictEqual([other.gate, other.review], ['lint 0, test OK', 'review: clean - rounds: 1']);
  const prose = p.parsePlan('## Evidence\n- Criterion 4 (one `rel=prev` pair) is asserted by `testLinks:218`, which requires\n  `assertCount(1, ...)` — so it fails if the copy emits them.\n');
  assert.deepStrictEqual(prose.evidence.map((e) => e.criteria), [[4]], 'only the numbers the criterion phrase names');
  const table = p.parsePlan(['## Evidence', '| # | Criterion | Proof |', '|---|---|---|', '| 1 | per-org lock | `test_lock.py` |', '| 2 | retries | — |'].join('\n'));
  assert.deepStrictEqual([p.proofFor(table, 1), p.proofFor(table, 2)], ['`test_lock.py`', null], 'a proof table, an empty cell proves nothing');
  // Evidence written as prose: there is proof, just not per criterion.
  assert.deepStrictEqual([other.itemised, p.parsePlan('## Evidence\n\nAll nine criteria have a test in `t.php`.\n').itemised, p.parsePlan('## Contract\n').itemised], [true, false, null]);

  // Depends with a note after the id, as prep writes it: the id alone, commas inside the note ignored.
  assert.deepStrictEqual(p.parsePlan('- Depends: DGS-162 (merged into `development`, rebased onto it), `settle-residue` *(its client half only)*\n').depends, ['DGS-162', 'settle-residue']);

  assert.deepStrictEqual(p.parsePlan(''), { acceptance: [], depends: [], blockers: [], evidence: [], review: null, gate: null, findings: [], itemised: null });

  // manual-checks.md: one section per feature, ticked and unticked items.
  const checks = p.parseChecks([
    '# Manual Checks', '', 'Things ristretto had no way to reach.', '',
    '## core-bootstrap', '',
    '- [x] **proves** · `https://tessera.loc` shows no certificate warning',
    '- [ ] **proves** · mail arrives in Outlook',
    '## other',
    '- [ ] something',
  ].join('\n'));
  assert.deepStrictEqual(checks['core-bootstrap'], [
    { done: true, text: 'proves · `https://tessera.loc` shows no certificate warning' },
    { done: false, text: 'proves · mail arrives in Outlook' },
  ]);
  assert.strictEqual(checks.other.length, 1);

  // Waiting: done, needs-human and needs-review satisfy a dependency, as `pull next` reads it.
  const statusOf = new Map([['lnw-core', 'done'], ['mail-outbound', 'planned'], ['rbac', 'needs-review']]);
  assert.deepStrictEqual(p.waitingOn({ depends: ['lnw-core', 'mail-outbound', 'rbac', 'mail-classify'] }, statusOf),
    [{ id: 'mail-outbound', status: 'planned' }, { id: 'mail-classify', status: 'missing' }]);
  assert.deepStrictEqual(p.waitingOn(undefined, statusOf), []);

  console.log('board-plan.test.js: all checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
