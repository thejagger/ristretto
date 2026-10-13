#!/usr/bin/env node
// Self-check for hooks/board-domain.mjs — run with: node scripts/board-domain.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const d = await import(pathToFileURL(path.join(__dirname, '..', 'hooks', 'board-domain.mjs')).href);

  // Shapes copied from tessera's docs/ristretto/domain/ (2026-10-12).
  const mail = [
    '# Mail (protocol rules Tessera\'s mail features rely on)',
    '',
    '- **Automatic reply: headers** The reply SHOULD carry `Auto-Submitted: auto-replied`, and `In-Reply-To` / `References` when the subject message had a Message-ID.',
    '  source: RFC 3834 §3.1.3, §3.1.5–3.1.7, read 2026-10-08 · unconfirmed — proposed by prep lnw-auto, 2026-10-08',
    '- **Reply threading** A reply\'s `In-Reply-To` is the parent\'s Message-ID.',
    '  source: RFC 5322 §3.6.4 (https://www.rfc-editor.org/rfc/rfc5322#section-3.6.4), read 2026-10-08 · unconfirmed — proposed by prep lnw-auto, 2026-10-08',
    '',
  ].join('\n');
  const nodes = [
    '# Nodes API',
    '',
    '- **Nodes keys** Firmen keyed by id.',
    '  source: docs/erp-sync-schnittstelle.md §Zugriff · unconfirmed — proposed by prep nodes-connector, 2026-10-08',
    '- **Nodes keys (V1.1)** Firmen keyed by uuid.',
    '  source: docs/erp-sync-schnittstelle.md V1.1 · unconfirmed — proposed by prep nodes-connector, 2026-10-08',
    '- **Nodes counts** Already settled.',
    '  source: Anatol · confirmed — Jakob, 2026-10-09',
    '',
  ].join('\n');

  // 1. Parsing: title, text, source without URL and read-date, state, proposer.
  const m = d.entriesOf('mail.md', mail);
  assert.deepStrictEqual(m.map((e) => [e.title, e.state]), [['Automatic reply: headers', 'unconfirmed'], ['Reply threading', 'unconfirmed']]);
  assert.strictEqual(m[1].source, 'RFC 5322 §3.6.4');
  assert.strictEqual(m[0].by, 'proposed by prep lnw-auto, 2026-10-08');
  assert.ok(m[0].text.startsWith('The reply SHOULD carry'));
  const n = d.markOlder(d.entriesOf('nodes.md', nodes));
  assert.deepStrictEqual(n.map((e) => [e.title, e.state, Boolean(e.older)]), [
    ['Nodes keys', 'unconfirmed', true], ['Nodes keys (V1.1)', 'unconfirmed', false], ['Nodes counts', 'confirmed', false],
  ]);

  // CRLF files parse the same as LF ones.
  assert.deepStrictEqual(d.entriesOf('mail.md', mail.replace(/\n/g, '\r\n')).map((e) => e.title), m.map((e) => e.title));
  assert.deepStrictEqual(Object.keys(d).sort(), ['EMPTY_DOMAIN', 'entriesOf', 'markOlder'], 'board-domain only reads');

  // A conflict noted by research.js conflict: parsed apart, and the fact keeps its own state.
  const noted = mail.replace('read 2026-10-08 · unconfirmed — proposed by prep lnw-auto, 2026-10-08\n- **Reply',
    'read 2026-10-08 · unconfirmed — proposed by prep lnw-auto, 2026-10-08 · conflict — Exchange drops In-Reply-To on auto-replies (live test, 2026-10-13), noticed by review lnw-auto-reply, 2026-10-13\n- **Reply');
  assert.notStrictEqual(noted, mail, 'the fixture took the conflict');
  const withConflict = d.entriesOf('mail.md', noted);
  assert.deepStrictEqual(withConflict[0].conflict, { what: 'Exchange drops In-Reply-To on auto-replies', source: 'live test, 2026-10-13', by: 'review lnw-auto-reply, 2026-10-13' });
  assert.strictEqual(withConflict[0].state, 'unconfirmed');
  assert.ok(!withConflict[0].by.includes('conflict'), 'the marker stays the marker');
  assert.strictEqual(withConflict[1].conflict, null);
  assert.deepStrictEqual(d.EMPTY_DOMAIN, { tree: [] });
  // Final review #9: a field that only starts with the word is no conflict.
  const law = '- **Recht** Austrian law applies\n  source: § 1 IPRG · conflict of laws: Rome I · unconfirmed — proposed by grind X, 2026-10-07\n';
  assert.strictEqual(d.entriesOf('law.md', law)[0].conflict, null);

  console.log('board-domain.test.js: all checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
