// What a plan says, for the board to show without anyone opening it: its acceptance criteria,
// what it depends on, its blockers, and once archived, the proof of each criterion, the
// closer's review line, the gate line and the open findings. Pure: no $, no Node.

const NONE = /^[—–-]?$/;

// A `- Name: value` field: its inline value and the indented `- ` items under it.
function field(lines, name) {
  const head = new RegExp(`^-\\s+${name}:\\s*`);
  const at = lines.findIndex((line) => head.test(line));
  if (at < 0) return null;
  const inline = lines[at].replace(head, '').trim();
  const items = [];
  for (let i = at + 1; i < lines.length && /^\s+\S/.test(lines[i]); i++) {
    if (/^\s+-\s+/.test(lines[i])) items.push(lines[i].replace(/^\s+-\s+/, '').trim());
  }
  return { inline: NONE.test(inline) ? '' : inline, items };
}

// The lines of a `## Title` section, up to the next `## `.
function section(lines, title) {
  const at = lines.findIndex((line) => line.trim() === `## ${title}`);
  if (at < 0) return [];
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  return end < 0 ? rest : rest.slice(0, end);
}

// `3, 4`, `1 to 4 and 6`, `2-5` → the criterion numbers.
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

export function parsePlan(text) {
  const lines = text.split(/\r?\n/);
  const acc = field(lines, 'Acceptance');
  const acceptance = (acc ? acc.items : []).map((item) => {
    const tag = /^\[(auto|human)\]\s*/.exec(item);
    return { auto: !tag || tag[1] === 'auto', text: tag ? item.slice(tag[0].length) : item };
  });
  const dep = field(lines, 'Depends');
  const depends = dep
    ? [dep.inline, ...dep.items].join(',').split(',').map((s) => s.trim()).filter((s) => s && !NONE.test(s))
    : [];
  const blk = field(lines, 'Blockers');
  const blockers = blk ? [blk.inline, ...blk.items].filter(Boolean) : [];

  const proofLines = section(lines, 'Evidence');
  const evidence = [];
  for (const line of proofLines) {
    // `Criterion 1 (…): proof`, `Criteria 3, 4 (…)`, `Criteria 1 to 4 and 6 (…)`, `Criterion 8 and live proof:`.
    const hit = /^-\s+Criteri(?:on|a)\s+(\d+(?:\s*(?:,|and|&|to|[-–])\s*\d+)*)[^:(]*(?:\([^)]*\))?[^:]*:\s*(.+)$/.exec(line);
    if (hit) evidence.push({ criteria: numbers(hit[1]), proof: hit[2].trim() });
  }
  const review = lines.map((line) => line.trim()).find((line) => /^review:\s/.test(line)) || null;
  const gateLine = proofLines.find((line) => /^-\s+Gate:/.test(line));
  // Open findings: each line of a fenced block, or each `- ` item; prose and trailers are not findings.
  const findings = [];
  let fenced = false;
  for (const line of section(lines, 'Open findings').map((l) => l.trim())) {
    if (line.startsWith('```')) fenced = !fenced;
    else if (fenced ? line : /^-\s+/.test(line)) findings.push(line.replace(/^-\s+/, ''));
  }

  return {
    acceptance,
    depends,
    blockers,
    evidence,
    review,
    gate: gateLine ? gateLine.replace(/^-\s+Gate:\s*/, '').trim() : null,
    findings,
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
