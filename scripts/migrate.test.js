#!/usr/bin/env node
// Self-check for scripts/migrate.js — run with: node scripts/migrate.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const m = require('./migrate.js');

const FIX = path.join(__dirname, 'migrate.fixtures');
const SCRIPT = path.join(__dirname, 'migrate.js');

// git may check fixtures out with either line ending; every test picks the one it needs.
const lf = (s) => s.replace(/\r\n/g, '\n');
const read = (...p) => lf(fs.readFileSync(path.join(FIX, ...p), 'utf8'));

function copyFixture(name, eol = '\n') {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), `migrate-${name}-`));
  (function walk(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(from, e.name), path.join(to, e.name));
      else fs.writeFileSync(path.join(to, e.name), lf(fs.readFileSync(path.join(from, e.name), 'utf8')).replace(/\n/g, eol));
    }
  })(path.join(FIX, name), dest);
  return dest;
}

function snapshot(dir) {
  const out = {};
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else out[path.relative(dir, p).replace(/\\/g, '/')] = fs.readFileSync(p, 'utf8');
    }
  })(dir);
  return out;
}

function run(dir, mode) {
  const r = spawnSync(process.execPath, [SCRIPT, mode], { cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

const table = (rows) => [
  '# Ristretto Roadmap',
  '<!-- ristretto-format: 0.20 -->',
  '',
  '| Flight | Feature | Title | Tier | Status | Plan | Updated | Files touched | Commit |',
  '|---|---|---|---|---|---|---|---|---|',
  ...rows.map(([id, title, status]) => `| f | ${id} | ${title} | normal | ${status} | [plan](plans/${id}.md) | 2026-10-01 | a.js | abc1234 |`),
  '',
].join('\n');

const vsChecks = m.parseChecks(read('vs', 'docs', 'ristretto', 'manual-checks.md'));
const apiChecks = m.parseChecks(read('api', 'docs', 'ristretto', 'manual-checks.md'));
const vsPlan = (id) => read('vs', 'docs', 'ristretto', 'plans', 'archived', `${id}.md`);
const apiPlan = (...p) => read('api', 'docs', 'ristretto', 'plans', ...p);

// roadmapDropsColumns
{
  const out = m.migrateRoadmap(read('vs', 'docs', 'ristretto', 'roadmap.md'));
  const t = m.readTable(out);
  assert.deepStrictEqual(t.header, ['Flight', 'Feature', 'Title', 'Tier', 'Status']);
  assert.ok(out.includes('<!-- ristretto-format: 0.22 -->'), 'stamped 0.22');
  assert.ok(out.includes('\n|--------|---------|-------|------|--------|\n'), 'separator sized to the header');
  assert.deepStrictEqual(t.rows.map((r) => r.Feature), ['pw-frontend-templates', 'wp-content-migration', 'test-suite-runtime']);
  assert.strictEqual(m.FORMAT, '0.22');
  // Text around the table stays.
  const api = m.migrateRoadmap(read('api', 'docs', 'ristretto', 'roadmap.md'));
  assert.ok(api.endsWith('## Blockiert\n\n- **nodes-invoice-draft** — waiting on Anatol: Notes write API for draft invoices.\n'));
}

// statusesMap
{
  const pairs = [['needs-human', 'done'], ['needs-review', 'done'], ['awaits-release', 'done'], ['split-pending', 'blocked'],
    ['planned', 'planned'], ['in-progress', 'in-progress'], ['blocked', 'blocked'], ['done', 'done']];
  const out = m.readTable(m.migrateRoadmap(table(pairs.map(([s], i) => [`f${i}`, 'T', s]))));
  assert.deepStrictEqual(out.rows.map((r) => r.Status), pairs.map(([, s]) => s));
  assert.throws(() => m.migrateRoadmap(table([['odd-one', 'T', 'shipped']])), /odd-one.*shipped|shipped.*odd-one/);
}

// titleStripsCheckCount
{
  const out = m.readTable(m.migrateRoadmap(table([
    ['a', 'Design ported to ProcessWire templates (+1 manual check)', 'done'],
    ['b', 'Two of them (+2 manual checks)', 'done'],
    ['c', 'Fields (and roles)', 'done'],
  ])));
  assert.deepStrictEqual(out.rows.map((r) => r.Title), ['Design ported to ProcessWire templates', 'Two of them', 'Fields (and roles)']);
}

// humanCriterionBecomesCheckbox
{
  const out = m.migratePlan(vsPlan('pw-frontend-templates'), vsChecks.get('pw-frontend-templates'));
  assert.ok(out.includes([
    '  - [ ] [human] Rendered pages are a faithful visual match to the Claude Design artboards at 375px and 1280px — spacing rhythm, type scale and weight, and card proportion read as the same design rather than an approximation.',
    '    how: Open `http://localhost:8080/` and step through `/`, `/unsere-schule/` and `/termine/` at a 375px and a 1280px viewport, side by side with the design. Note any spacing or type-scale drift.',
    '- Provides:',
  ].join('\n')), out);
  const ticked = m.parseChecks(read('vs', 'docs', 'ristretto', 'manual-checks.md').replace('- [ ] Open', '- [x] Open'));
  assert.ok(m.migratePlan(vsPlan('pw-frontend-templates'), ticked.get('pw-frontend-templates')).includes('  - [x] [human] Rendered pages'));
  // The **proves** · … · … · how shape; quotes and a trailing "(Manual-Checks)." do not stop the match.
  const intake = m.migratePlan(apiPlan('api-intake-creates-lnw.md'), apiChecks.get('api-intake-creates-lnw'));
  assert.ok(intake.includes('„offene Probleme“ (Manual-Checks).\n    how: deploy (`docker compose up -d --build api` in ../platform), then compare the counts\n'), intake);
  assert.ok(intake.includes('  - [ ] [human] After deploying'));
  // One human criterion, one check, worded differently: they are the same check.
  const eval_ = m.migratePlan(apiPlan('archived', 'mail-classify-eval.md'), apiChecks.get('mail-classify-eval'));
  assert.ok(eval_.includes('**0 LNW missed**.\n    how: run `uv run python -m scripts.mail_classify_eval` in this repo and record the result\n'), eval_);
  assert.ok(eval_.includes('  - [x] [human] On the real set'));
  // A human criterion nobody wrote a check for is still a box, open.
  assert.ok(m.migratePlan('## Contract\n- Acceptance:\n  - [human] Looks right\n').includes('  - [ ] [human] Looks right\n'));
}

// planManualChecksAreKept: before a feature is built, its plan's Manual-Checks items are the only
// steps there are. They become the box's how; manual-checks.md, written at close, supersedes them.
{
  const plan = [
    '## Contract',
    '- Acceptance:',
    '  - [human] After deploying, no waiting item is left',
    '- Manual-Checks:',
    '  - After the deploy: count the waiting items, then compare.',
    '- Blockers: —',
    '',
  ].join('\n');
  assert.strictEqual(m.migratePlan(plan), [
    '## Contract',
    '- Acceptance:',
    '  - [ ] [human] After deploying, no waiting item is left',
    '    how: After the deploy: count the waiting items, then compare.',
    '- Blockers: —',
    '',
  ].join('\n'));
  const two = plan.replace('- Blockers', '  - proves · something else entirely · because · look at it\n- Blockers');
  // Two items, one criterion: no guess. The box stays without steps and both items are kept.
  assert.ok(m.migratePlan(two).endsWith([
    '  - [ ] [human] After deploying, no waiting item is left',
    '- Blockers: —',
    '',
    '## Manual checks (migrated)',
    '',
    '  - After the deploy: count the waiting items, then compare.',
    '',
    '  - proves · something else entirely · because · look at it',
    '',
  ].join('\n')), m.migratePlan(two));
  // The pw plan's own item is the prep-time copy of the check manual-checks.md already carries.
  assert.ok(!m.migratePlan(vsPlan('pw-frontend-templates'), vsChecks.get('pw-frontend-templates')).includes('proves · rendered'));
}

// unmatchedCheckIsKept
{
  const out = m.migratePlan(vsPlan('wp-content-migration'), vsChecks.get('wp-content-migration'));
  assert.ok(out.endsWith([
    '## Manual checks (migrated)',
    '',
    '- [x] **proves** · [auto] The importer loads `2607199db1.sql` into a separate `wp_`-prefixed schema in the dev MySQL, runs against a migrated content model, and exits 0 · settled everything except `exit 0` itself · put the real `wp-content/uploads/` tree on disk and repeat the run. **SETTLED 2026-09-04**: the run exited 0.',
    '',
  ].join('\n')), out);
  assert.ok(out.includes('  - [auto] The importer loads'), 'the [auto] criterion is untouched');
}

// decisionTakenBecomesBox
{
  const pw = m.migratePlan(vsPlan('pw-frontend-templates'), vsChecks.get('pw-frontend-templates'));
  assert.ok(pw.includes([
    '  - Termine defaults to upcoming.',
    "  - [ ] how to stop double-encoding titles -> $page->getUnformatted('title') inside $sanitizer->entities() at all 23 sites",
    '- Blockers: —',
  ].join('\n')), pw);
  assert.ok(!pw.includes('decision taken:'));
  const fav = m.migratePlan(apiPlan('archived', 'api-favicon.md'));
  assert.ok(fav.includes([
    '  - Cache for a day.',
    '  - [ ] which bare client proves "no session, no bearer"? → the existing `unauth_client` fixture (`tests/conftest.py:782`).',
    '  - [ ] `dependencies = ["resvg-py"]` unpinned? → pinned `resvg-py==0.5.0`. The criterion "same SVG → same bytes" must hold.',
    '',
  ].join('\n')), fav);
  assert.ok(!/decision taken:|would-escalate:/.test(fav));
  assert.ok(fav.includes('- Planner decisions (build plan, 2026-10-16), unchanged:\n- Review history'), 'the lines around them stay');
  const eval_ = m.migratePlan(apiPlan('archived', 'mail-classify-eval.md'), apiChecks.get('mail-classify-eval'));
  assert.ok(eval_.includes('- Blockers: —\n- Decisions:\n  - [ ] a correction key whose value is no object is no change\n\n## Evidence'), eval_);
}

// planLosesDuplicates
{
  const src = read('vs', 'docs', 'ristretto', 'plans', 'test-suite-runtime.md');
  assert.strictEqual(m.migratePlan(src), [
    '# test-suite-runtime',
    '',
    '## Spec',
    '- Source: idea',
    '- Goal: The suite runs in half the time.',
    '',
    '## Contract',
    '- Acceptance:',
    '  - [auto] The whole suite runs in at most half its old wall clock.',
    '- Blockers: —',
    '',
    '## Approach',
    '- Depends: —',
    '',
  ].join('\n'));
  const pw = m.migratePlan(vsPlan('pw-frontend-templates'), vsChecks.get('pw-frontend-templates'));
  assert.ok(!/Manual-Checks:|^- Flight:|proves · rendered/m.test(pw));
  assert.ok(pw.includes('status: not-a-status-line-inside-a-fence'), 'fenced text is never touched');
  assert.ok(!/^status: needs-review/m.test(pw));
  assert.ok(pw.endsWith('```\n'), pw.slice(-40));
}

// duplicatePlanRefuses
{
  const dir = copyFixture('vs');
  const base = path.join(dir, 'docs', 'ristretto', 'plans');
  fs.copyFileSync(path.join(base, 'test-suite-runtime.md'), path.join(base, 'archived', 'test-suite-runtime.md'));
  const before = snapshot(dir);
  const r = run(dir, 'apply');
  assert.strictEqual(r.code, 1, r.out);
  assert.ok(r.out.includes('plans/test-suite-runtime.md') && r.out.includes('plans/archived/test-suite-runtime.md'), r.out);
  assert.deepStrictEqual(snapshot(dir), before, 'nothing written');
}

// orphanChecksStay (and a full apply on both fixtures)
{
  const dir = copyFixture('vs');
  assert.strictEqual(run(dir, 'check').code, 1);
  const r = run(dir, 'apply');
  assert.strictEqual(r.code, 0, r.out);
  assert.ok(/gone-feature/.test(r.out), r.out);
  const s = snapshot(dir);
  assert.ok(s['docs/ristretto/manual-checks.md'].includes('## gone-feature\n\n- [ ] Check the thing by hand.'));
  assert.ok(!/## (pw-frontend-templates|wp-content-migration)/.test(s['docs/ristretto/manual-checks.md']));
  assert.ok(!fs.existsSync(path.join(dir, 'docs', 'ristretto', 'plans', 'archived')), 'archived/ is gone');
  assert.ok(s['docs/ristretto/plans/pw-frontend-templates.md'].startsWith('# pw-frontend-templates\n'));
  assert.ok(s['docs/ristretto/plans/pw-frontend-templates.md'].includes('  - [ ] [human] Rendered pages'));

  const api = copyFixture('api');
  assert.strictEqual(run(api, 'apply').code, 0);
  assert.ok(!fs.existsSync(path.join(api, 'docs', 'ristretto', 'manual-checks.md')), 'every check found its plan');
  assert.ok(snapshot(api)['docs/ristretto/plans/mail-classify-eval.md'].includes('  - [x] [human] On the real set'));
}

// escapedPipeCell
{
  const src = table([['k', 'Klassen \\| Unsere Schule', 'done']]);
  assert.strictEqual(m.readTable(src).rows[0].Title, 'Klassen \\| Unsere Schule');
  assert.ok(m.migrateRoadmap(src).includes('| f | k | Klassen \\| Unsere Schule | normal | done |'));
}

// crlfSurvives
{
  const dir = copyFixture('vs', '\r\n');
  assert.strictEqual(run(dir, 'apply').code, 0);
  for (const [file, text] of Object.entries(snapshot(dir))) {
    assert.ok(!/(^|[^\r])\n/.test(text), `${file} has a bare LF`);
  }
  assert.ok(snapshot(dir)['docs/ristretto/plans/pw-frontend-templates.md'].includes('  - [ ] [human] Rendered pages'));
}

// applyIsIdempotent
{
  const dir = copyFixture('vs');
  run(dir, 'apply');
  const once = snapshot(dir);
  const r = run(dir, 'apply');
  assert.strictEqual(r.code, 0, r.out);
  assert.deepStrictEqual(snapshot(dir), once);
  assert.strictEqual(run(dir, 'check').code, 0);
  // The functions alone are idempotent too.
  for (const [file, text] of Object.entries(once)) {
    if (file.includes('/plans/')) assert.strictEqual(m.migratePlan(text), text, file);
    if (file.endsWith('roadmap.md')) assert.strictEqual(m.migrateRoadmap(text), text);
  }
}

// check's other answers: no roadmap, unstamped, newer than the plugin
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-empty-'));
  assert.strictEqual(run(dir, 'check').code, 0);
  fs.mkdirSync(path.join(dir, 'docs', 'ristretto'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'ristretto', 'roadmap.md'), '# Ristretto Roadmap\n\n| Feature | Status |\n|---|---|\n');
  assert.strictEqual(run(dir, 'check').code, 2);
  assert.strictEqual(run(dir, 'apply').code, 2, 'apply refuses what check cannot tell');
  fs.writeFileSync(path.join(dir, 'docs', 'ristretto', 'roadmap.md'), '# Ristretto Roadmap\n<!-- ristretto-format: 0.99 -->\n');
  assert.strictEqual(run(dir, 'check').code, 3);
}

console.log('migrate: all checks passed');
