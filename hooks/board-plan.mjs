// What a plan says, for the board to show without anyone opening it: its acceptance criteria,
// what it depends on, its blockers, and once archived, the proof of each criterion, the
// closer's review line, the gate line and the open findings. Pure: no $, no Node.
//
// Closers never had one line format, so the Evidence reading is tolerant: tessera's
// `- Criterion 1 (…): proof`, vs-ruprechtshofen's `- **Criterion 1** (…) — proof` wrapping over
// lines, ecolaw's `**Acceptance 1/2 (…)** — proof` and proof tables, and `AC3`.

const NONE = /^[—–-]?$/;

// A `- Name: value` field: its inline value and the indented `- ` items under it, an item's
// wrapped lines joined back onto it.
function field(lines, name) {
  const head = new RegExp(`^-\\s+${name}:\\s*`);
  const at = lines.findIndex((line) => head.test(line));
  if (at < 0) return null;
  const inline = lines[at].replace(head, '').trim();
  const items = [];
  for (let i = at + 1; i < lines.length && /^\s+\S/.test(lines[i]); i++) {
    if (/^\s+-\s+/.test(lines[i])) items.push(lines[i].replace(/^\s+-\s+/, '').trim());
    else if (items.length > 0) items[items.length - 1] += ` ${lines[i].trim()}`;
  }
  return { inline: NONE.test(inline) ? '' : inline, items };
}

// The lines of a `## Title` section, up to the next `## `; null when there is none.
function section(lines, title) {
  const at = lines.findIndex((line) => line.trim() === `## ${title}`);
  if (at < 0) return null;
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  return end < 0 ? rest : rest.slice(0, end);
}

// `3, 4`, `1 to 4 and 6`, `2-5`, `1/2` → the criterion numbers.
function numbers(list) {
  const out = [];
  const re = /(\d+)(?:\s*(?:to|[-–])\s*(\d+))?/g;
  for (let m; (m = re.exec(list));) {
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    for (let n = from; n <= to && n - from < 100; n++) out.push(n);
  }
  return out;
}

// Splits at the separators that sit outside parentheses and code spans: `,` for a list, or
// the first `:` / ` — ` / ` – ` that ends an Evidence head.
function outside(text, isSep) {
  let depth = 0;
  let code = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '`') code = !code;
    else if (!code && c === '(') depth++;
    else if (!code && c === ')') depth = Math.max(0, depth - 1);
    else if (!code && depth === 0) {
      const len = isSep(text, i);
      if (len) return [i, len];
    }
  }
  return null;
}

function splitList(text) {
  const parts = [];
  let rest = text;
  for (let at; (at = outside(rest, (t, i) => (t[i] === ',' ? 1 : 0)));) {
    parts.push(rest.slice(0, at[0]));
    rest = rest.slice(at[0] + 1);
  }
  return [...parts, rest];
}

const HEAD = /^(?:criteri(?:on|a)|acceptance|ac)\s*\d/i;

// One Evidence item, bold dropped: the criteria its head names and the proof after the head.
function evidenceOf(item) {
  const text = item.replace(/\*\*/g, '');
  if (!HEAD.test(text)) return null;
  const sep = outside(text, (t, i) => (t[i] === ':' ? 1 : / [—–] /.test(t.slice(i, i + 3)) ? 3 : 0));
  if (!sep) return null;
  const head = text.slice(0, sep[0]).replace(/\([^()]*\)/g, ' ');
  const proof = text.slice(sep[0] + sep[1]).trim();
  // Only the numbers a criterion phrase names: `Criterion 4 … and criterion 5`, not a line
  // number further along in the head's prose.
  const criteria = [...head.matchAll(/(?:criteri(?:on|a)|acceptance|ac)\s*(\d+(?:\s*(?:,|\/|&|and|to|[-–])\s*\d+)*)/gi)]
    .flatMap((m) => numbers(m[1]));
  return criteria.length > 0 && proof ? { criteria, proof } : null;
}

// A proof table: `| # | Criterion | Proof |`, or rows in criterion order with no number column.
function tableEvidence(lines) {
  const out = [];
  const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i])) continue;
    const head = cells(lines[i]).map((c) => c.toLowerCase());
    const proofAt = head.findIndex((c) => c === 'proof' || c === 'evidence');
    if (proofAt < 0) continue;
    const numbered = head[0] === '#' || head[0] === 'no' || head[0] === 'criterion #';
    let n = 0;
    for (i += 1; i < lines.length && /^\s*\|/.test(lines[i]); i++) {
      const row = cells(lines[i]);
      if (row.every((c) => /^:?-+:?$/.test(c))) continue;
      n += 1;
      const criteria = numbered ? numbers(row[0]) : [n];
      const proof = row[proofAt] || '';
      if (criteria.length > 0 && !NONE.test(proof)) out.push({ criteria, proof });
    }
  }
  return out;
}

// `- ` items of a section with their wrapped lines joined back on.
function items(lines) {
  const out = [];
  for (const line of lines) {
    if (/^\s*[-*]\s+/.test(line)) out.push(line.replace(/^\s*[-*]\s+/, '').trim());
    else if (/^\s+\S/.test(line) && out.length > 0 && !/^\s*\|/.test(line)) out[out.length - 1] += ` ${line.trim()}`;
    else if (!line.trim() || !/^\s/.test(line)) out.push(null); // a blank or flush line ends the item
  }
  return out.filter(Boolean);
}

// The ids a Depends value names: commas inside a note do not split, and a note after an id
// (`DGS-162 (merged …)`, `x *(client half only)*`) is not part of it.
function ids(value) {
  return splitList(value)
    .map((part) => /^[\s`*]*([A-Za-z0-9][\w.-]*)/.exec(part))
    .filter((m) => m && !NONE.test(m[1]))
    .map((m) => m[1]);
}

export function parsePlan(text) {
  const lines = text.split(/\r?\n/);
  const acc = field(lines, 'Acceptance');
  const acceptance = (acc ? acc.items : []).map((item) => {
    const tag = /^\[(auto|human)\]\s*/.exec(item);
    return { auto: !tag || tag[1] === 'auto', text: tag ? item.slice(tag[0].length) : item };
  });
  const dep = field(lines, 'Depends');
  const depends = dep ? [dep.inline, ...dep.items].flatMap(ids) : [];
  const blk = field(lines, 'Blockers');
  const blockers = blk ? [blk.inline, ...blk.items].filter(Boolean) : [];

  const proofLines = section(lines, 'Evidence');
  const listed = items(proofLines ?? []);
  const evidence = [...listed.map(evidenceOf).filter(Boolean), ...tableEvidence(proofLines ?? [])];
  const review = lines.map((line) => line.replace(/\*\*/g, '').trim()).find((line) => /^review:\s/.test(line)) || null;
  const gateItem = listed.find((item) => /^Gates?:/.test(item));
  // Open findings: each line of a fenced block, or each `- ` item; prose and trailers are not findings.
  const findings = [];
  let fenced = false;
  for (const line of (section(lines, 'Open findings') ?? []).map((l) => l.trim())) {
    if (line.startsWith('```')) fenced = !fenced;
    else if (fenced ? line : /^-\s+/.test(line)) findings.push(line.replace(/^-\s+/, ''));
  }

  return {
    acceptance,
    depends,
    blockers,
    evidence,
    review,
    gate: gateItem ? gateItem.replace(/^Gates?:\s*/, '').trim() : null,
    findings,
    // Whether the Evidence proves criterion by criterion: false when it is prose, null when
    // there is no Evidence yet.
    itemised: proofLines === null ? null : evidence.length > 0,
  };
}

// The proof the Evidence gives for criterion n (1-based), or null.
export function proofFor(plan, n) {
  const line = plan.evidence.find((e) => e.criteria.includes(n));
  return line ? line.proof : null;
}

// manual-checks.md: a `## <feature>` section per feature, `- [ ]` / `- [x]` items under it.
export function parseChecks(text) {
  const out = {};
  let id = null;
  for (const line of text.split(/\r?\n/)) {
    const head = /^##\s+(.+?)\s*$/.exec(line);
    if (head) { id = head[1]; continue; }
    const item = /^\s*-\s+\[([ xX])\]\s+(.+)$/.exec(line);
    if (id && item) (out[id] = out[id] || []).push({ done: item[1] !== ' ', text: item[2].replace(/\*\*/g, '').trim() });
  }
  return out;
}

// What a plan still waits on: dependencies that are not built, as `pull next` reads them.
export const SATISFIES = new Set(['done', 'needs-human', 'needs-review']);
export function waitingOn(plan, statusOf) {
  if (!plan) return [];
  return plan.depends
    .filter((id) => !SATISFIES.has(statusOf.get(id)))
    .map((id) => ({ id, status: statusOf.get(id) ?? 'missing' }));
}
