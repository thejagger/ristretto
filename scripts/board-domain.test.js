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

  // 2. Confirm rewrites only the marker field, keeps what it said, keeps every other byte.
  const sig = 'Jakob Auer, 2026-10-12';
  const c = d.confirmIn(mail, 'Automatic reply: headers', sig);
  assert.ok(c.includes('read 2026-10-08 · confirmed — Jakob Auer, 2026-10-12 (proposed by prep lnw-auto, 2026-10-08)'));
  assert.strictEqual(c.split('\n').length, mail.split('\n').length);
  assert.strictEqual(c.replace(/ · confirmed — Jakob Auer, 2026-10-12 \(proposed by prep lnw-auto, 2026-10-08\)/, ' · unconfirmed — proposed by prep lnw-auto, 2026-10-08'), mail);
  assert.strictEqual(d.entriesOf('mail.md', c)[0].state, 'confirmed');
  assert.strictEqual(d.confirmIn(c, 'Automatic reply: headers', sig), null, 'already confirmed: nothing to do');

  // Review focus 1: CRLF stays CRLF.
  const crlf = mail.replace(/\n/g, '\r\n');
  const cc = d.confirmIn(crlf, 'Reply threading', sig);
  assert.ok(!/[^\r]\n/.test(cc), 'every newline is still CRLF');

  // Review focus 2: titles match literally; duplicates and unknown titles refuse.
  assert.ok(d.confirmIn(nodes, 'Nodes keys (V1.1)', sig).includes('uuid.\n  source: docs/erp-sync-schnittstelle.md V1.1 · confirmed'));
  assert.ok(d.confirmIn(nodes, 'Nodes keys', sig).includes('by id.\n  source: docs/erp-sync-schnittstelle.md §Zugriff · confirmed'));
  assert.strictEqual(d.confirmIn(nodes, 'Nodes', sig), null);
  assert.strictEqual(d.confirmIn(nodes + nodes.slice(nodes.indexOf('- **Nodes keys**')), 'Nodes keys', sig), null, 'two entries with one title: refuse');
  assert.strictEqual(d.removeIn(mail, 'No such fact'), null);

  // An entry without any marker gets one appended to its last line.
  const bare = '- **Plain** a fact.\n  source: somewhere\n';
  assert.strictEqual(d.confirmIn(bare, 'Plain', sig), '- **Plain** a fact.\n  source: somewhere · confirmed — Jakob Auer, 2026-10-12\n');

  // 3. Remove drops the entry's lines and nothing else; restore puts it back where it was.
  const r = d.removeIn(nodes, 'Nodes keys');
  assert.deepStrictEqual(d.entriesOf('nodes.md', r).map((e) => e.title), ['Nodes keys (V1.1)', 'Nodes counts']);
  assert.strictEqual(d.restoreIn(r, nodes, 'Nodes keys'), nodes, 'undo of a removal');
  assert.strictEqual(d.restoreIn(c, mail, 'Automatic reply: headers'), mail, 'undo of a confirmation');
  const last = d.removeIn(nodes, 'Nodes counts');
  assert.strictEqual(d.restoreIn(last, nodes, 'Nodes counts'), nodes, 'undo of the last entry');

  // 4. Pending: what the working tree changed against HEAD.
  const head = [...d.entriesOf('mail.md', mail), ...d.entriesOf('nodes.md', nodes)];
  const tree = [...d.entriesOf('mail.md', c), ...d.entriesOf('nodes.md', r)];
  const p = d.pendingOf(head, tree);
  assert.deepStrictEqual(p.map((x) => [x.file, x.title, x.change]), [['mail.md', 'Automatic reply: headers', 'confirmed'], ['nodes.md', 'Nodes keys', 'removed']]);
  assert.deepStrictEqual(d.pendingOf(head, head), [], 'nothing changed');

  // 5. Commit: message and argv; only the changed domain files (review focus 4).
  assert.strictEqual(d.commitMessage(p), 'docs(ristretto): confirm 1, remove 1 domain facts');
  assert.strictEqual(d.commitMessage(p.slice(0, 1)), 'docs(ristretto): confirm 1 domain fact');
  assert.deepStrictEqual(d.commitArgs(p), ['commit', '-m', 'docs(ristretto): confirm 1, remove 1 domain facts', '--', 'docs/ristretto/domain/mail.md', 'docs/ristretto/domain/nodes.md']);
  assert.strictEqual(d.signatureOf('Jakob Auer', new Date(2026, 9, 12, 23, 30).getTime()), 'Jakob Auer, 2026-10-12');

  // Final review I1: research commits nothing, so right after a grind its proposals are not in
  // HEAD. They are pending "added" (the button commits them); a confirmation of one is pending
  // "confirmed" and undo puts its proposal marker back; it is not removable until committed.
  const base = d.entriesOf('mail.md', mail);
  const grown = mail + '- **New** fact.\n  source: x · unconfirmed — proposed by grind y, 2026-10-12\n';
  assert.deepStrictEqual(d.pendingOf(base, d.entriesOf('mail.md', grown)).map((x) => [x.title, x.change]), [['New', 'added']]);
  const signed = d.confirmIn(grown, 'New', sig);
  assert.deepStrictEqual(d.pendingOf(base, d.entriesOf('mail.md', signed)).map((x) => [x.title, x.change]), [['New', 'confirmed']]);
  assert.strictEqual(d.restoreIn(signed, mail, 'New'), grown, 'undo of a confirmation HEAD has never seen');
  assert.strictEqual(d.restoreIn(grown, mail, 'New'), null, 'an unconfirmed new fact has nothing to undo');
  assert.strictEqual(d.committed(base, 'mail.md', 'New'), false);
  assert.strictEqual(d.committed(base, 'mail.md', 'Reply threading'), true);
  assert.strictEqual(d.commitMessage([{ change: 'added' }, { change: 'added' }, { change: 'confirmed' }]), 'docs(ristretto): add 2, confirm 1 domain facts');
  assert.deepStrictEqual(d.addArgs([{ file: 'new.md' }, { file: 'mail.md' }, { file: 'new.md' }]), ['add', '--', 'docs/ristretto/domain/mail.md', 'docs/ristretto/domain/new.md']);

  // Final review I3: a leftover marker does not lock the facts forever; a leftover snapshot says what it is.
  const day = 24 * 60 * 60 * 1000;
  assert.strictEqual(d.lockOf({ markerIdleMs: null, snapshot: false }), null);
  assert.strictEqual(d.lockOf({ markerIdleMs: 5000, snapshot: false }), 'a run is active — after it');
  assert.strictEqual(d.lockOf({ markerIdleMs: day + 1, snapshot: false }), null, 'a marker idle for a day is a leftover');
  assert.strictEqual(d.lockOf({ markerIdleMs: null, snapshot: true }), 'a research run is in flight (or did not finish — the next research run checks it)');

  console.log('board-domain.test.js: all checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
