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
    { auto: true, text: 'Each check raises its problem exactly when its condition holds' },
    { auto: false, text: 'The Rückfrage mail arrives in Outlook' },
  ], 'items, tags read, a wrapped line does not become an item');
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
  assert.deepStrictEqual(p.parsePlan(''), { acceptance: [], depends: [], blockers: [], evidence: [], review: null, gate: null, findings: [] });

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
