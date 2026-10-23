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

  assert.deepStrictEqual(p.parsePlan(''), { acceptance: [], depends: [], blockers: [], goal: null, evidence: [], review: null, gate: null, findings: [], itemised: null });

  // parsesPlanChecks: a [human] criterion is its own box in the plan, its steps on a how: line.
  const boxed = [
    '## Contract',
    '- Acceptance:',
    '  - [auto] The page renders',
    '  - [ ] [human] Mail arrives in Outlook',
    '    how: send one from the dev stack and open Outlook',
    '  - [x] [human] The design reads the same',
    '    how: open both side by side',
    '- Decisions:',
    '  - Styling -> one stylesheet.',
    '    - nested detail of that ruling',
    '  - [ ] which client? → the bare one',
    '  - [x] pin resvg? → yes',
    '- Blockers: —',
    '',
    '## Evidence',
    '- 1: tests/test_page.py',
    '- 2, 3: by hand',
    '',
  ].join('\n');
  assert.deepStrictEqual(p.parseChecks(boxed), [
    { done: false, text: 'Mail arrives in Outlook', how: 'send one from the dev stack and open Outlook' },
    { done: true, text: 'The design reads the same', how: 'open both side by side' },
  ]);
  assert.deepStrictEqual(p.parsePlan(boxed).acceptance, [
    { auto: true, text: 'The page renders' },
    { auto: false, text: 'Mail arrives in Outlook' },
    { auto: false, text: 'The design reads the same' },
  ], 'a box and its how: line are not part of the criterion');
  assert.strictEqual(p.proofFor(p.parsePlan(boxed), 1), 'tests/test_page.py', 'Evidence by criterion number');
  assert.strictEqual(p.proofFor(p.parsePlan(boxed), 3), 'by hand');
  assert.deepStrictEqual(p.parseChecks('- Acceptance:\n  - [auto] x\n'), []);

  // parsesPlanDecisions: a prep ruling has no box; the agent's has one, ticked once the user confirms.
  assert.deepStrictEqual(p.parseDecisions(boxed), [
    { done: null, text: 'Styling -> one stylesheet. nested detail of that ruling' },
    { done: false, text: 'which client? → the bare one' },
    { done: true, text: 'pin resvg? → yes' },
  ]);
  assert.deepStrictEqual(p.parseDecisions('- Decisions: —\n- Blockers: —\n'), []);

  // parsesCrlfPlan: the same plan with Windows line endings reads the same.
  const crlf = boxed.replace(/\n/g, '\r\n');
  assert.deepStrictEqual(p.parseChecks(crlf), p.parseChecks(boxed));
  assert.deepStrictEqual(p.parseDecisions(crlf), p.parseDecisions(boxed));
  assert.deepStrictEqual(p.parsePlan(crlf), p.parsePlan(boxed));

  // doneSatisfiesDepends: only done satisfies a dependency; there is no other finished status.
  const statusOf = new Map([['lnw-core', 'done'], ['mail-outbound', 'planned'], ['rbac', 'in-progress']]);
  assert.deepStrictEqual(p.waitingOn({ depends: ['lnw-core'] }, statusOf), []);
  assert.deepStrictEqual(p.waitingOn({ depends: ['lnw-core', 'mail-outbound', 'rbac', 'mail-classify'] }, statusOf),
    [{ id: 'mail-outbound', status: 'planned' }, { id: 'rbac', status: 'in-progress' }, { id: 'mail-classify', status: 'missing' }]);
  assert.deepStrictEqual([...p.SATISFIES], ['done']);
  assert.deepStrictEqual(p.waitingOn(undefined, statusOf), []);

  // The plan's one-line goal, for a feature's page.
  assert.strictEqual(p.parsePlan('## Spec\n- Source: idea\n- Goal: measure the classifier on real mails.\n').goal, 'measure the classifier on real mails.');
  assert.strictEqual(p.parsePlan('- Blockers: —\n').goal, null);

  console.log('board-plan.test.js: all checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
