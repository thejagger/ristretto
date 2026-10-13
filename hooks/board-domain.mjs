// Domain facts (docs/ristretto/domain/*.md) as the board reads and changes them. Pure: no $, no
// Node. An entry is a top-level `- ` bullet plus its indented continuation lines — the rule
// scripts/research.js uses, so the board and check-domain agree on what one entry is. Its title
// is the bold run that opens it: `- **<title>** <text>`. A person confirms by the board's click;
// the marker then reads `confirmed — <name>, <date> (<what the proposal said>)`.

export const EMPTY_DOMAIN = { tree: [] };

const TITLE = /^- \*\*(.+?)\*\*\s*(.*)$/;
const CONFIRMED = /^confirmed\b/i;
const UNCONFIRMED = /^unconfirmed\b/i;
const CONFLICT = /^conflict\b/i;

// `conflict — <what> (<source>), noticed by <who>, <date>`, as research.js conflict writes it.
function conflictOf(field) {
  const rest = field.replace(/^conflict\s*[—–-]?\s*/i, '');
  const m = /^(.*)\s\(([^()]*)\),\s*noticed by\s+(.+)$/.exec(rest);
  return m ? { what: m[1].trim(), source: m[2].trim(), by: m[3].trim() } : { what: rest.trim(), source: '', by: '' };
}

function split(text) {
  const s = String(text);
  return { eol: s.includes('\r\n') ? '\r\n' : '\n', lines: s.split(/\r?\n/) };
}

// Each top-level bullet as [start, end): the bullet line and the indented lines right under it.
function blocks(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const last = out[out.length - 1];
    if (last && last.end === i && /^\s+\S/.test(lines[i])) last.end = i + 1;
    else if (lines[i].startsWith('- ')) out.push({ start: i, end: i + 1 });
  }
  return out;
}

const fields = (line) => line.split('·').map((f) => f.trim());
const titleOf = (line) => (TITLE.exec(line) || [])[1];

// The one entry with exactly this title, or null when there is none or more than one.
function locate(lines, title) {
  const hits = blocks(lines).filter((b) => titleOf(lines[b.start]) === title);
  return hits.length === 1 ? hits[0] : null;
}

export function entriesOf(file, text) {
  const { lines } = split(text);
  return blocks(lines).flatMap(({ start, end }) => {
    const head = TITLE.exec(lines[start]);
    if (!head) return [];
    const body = lines.slice(start + 1, end).map((l) => l.trim());
    const every = [lines[start], ...body].flatMap(fields);
    const noted = every.find((f) => CONFLICT.test(f));
    const all = every.filter((f) => !CONFLICT.test(f));
    const marker = all.find((f) => CONFIRMED.test(f) || UNCONFIRMED.test(f)) || '';
    const src = body.find((l) => /^source:/i.test(l));
    const source = src
      ? fields(src.replace(/^source:\s*/i, ''))[0].replace(/\s*\(https?:[^)]*\)/g, '').replace(/,\s*read \d{4}-\d{2}-\d{2}\s*$/, '').trim()
      : '';
    return [{
      file,
      title: head[1],
      text: [head[2].split('·')[0].trim(), ...body.filter((l) => !/^source:/i.test(l))].join(' ').trim(),
      source,
      state: all.some((f) => CONFIRMED.test(f)) ? 'confirmed' : 'unconfirmed',
      by: marker.replace(/^(un)?confirmed\s*[—–-]?\s*/i, ''),
      conflict: noted ? conflictOf(noted) : null,
    }];
  });
}

// Research only adds, so a fact re-read from a newer source (`Nodes keys (V1.1)`) leaves the old
// one standing; the old one is marked so the owner can remove it in one click.
export function markOlder(facts) {
  const versioned = new Set(facts.map((f) => {
    const m = /^(.*?)\s*\(V[\d.]+\)\s*$/.exec(f.title);
    return m ? `${f.file}\u0000${m[1]}` : null;
  }).filter(Boolean));
  return facts.map((f) => (versioned.has(`${f.file}\u0000${f.title}`) ? { ...f, older: true } : f));
}

const key = (f) => `${f.file}\u0000${f.title}`;

// What the working tree changed against HEAD: facts added since (research commits nothing, so
// its proposals arrive uncommitted), confirmed since, and removed since.
export function pendingOf(head, tree) {
  const inHead = new Map(head.map((f) => [key(f), f]));
  const inTree = new Set(tree.map(key));
  const out = [];
  for (const f of tree) {
    const h = inHead.get(key(f));
    if (!h) out.push({ file: f.file, title: f.title, change: f.state === 'confirmed' ? 'confirmed' : 'added', entry: f });
    else if (h.state === 'unconfirmed' && f.state === 'confirmed') out.push({ file: f.file, title: f.title, change: 'confirmed', entry: f });
  }
  for (const h of head) if (!inTree.has(key(h))) out.push({ file: h.file, title: h.title, change: 'removed', entry: h });
  return out;
}

export function confirmIn(text, title, signature) {
  const { eol, lines } = split(text);
  const b = locate(lines, title);
  if (!b) return null;
  const own = lines.slice(b.start, b.end);
  if (own.flatMap(fields).some((f) => CONFIRMED.test(f))) return null;
  for (let i = b.start; i < b.end; i++) {
    const parts = lines[i].split('·');
    const at = parts.findIndex((p) => UNCONFIRMED.test(p.trim()));
    if (at < 0) continue;
    const lead = /^\s*/.exec(parts[at])[0];
    const said = parts[at].trim().replace(/^unconfirmed\s*[—–-]?\s*/i, '');
    parts[at] = `${lead}confirmed — ${signature}${said ? ` (${said})` : ''}`;
    lines[i] = parts.join('·');
    return lines.join(eol);
  }
  lines[b.end - 1] = `${lines[b.end - 1].trimEnd()} · confirmed — ${signature}`;
  return lines.join(eol);
}

export function removeIn(text, title) {
  const { eol, lines } = split(text);
  const b = locate(lines, title);
  if (!b) return null;
  lines.splice(b.start, b.end - b.start);
  return lines.join(eol);
}

// Undo: the entry as HEAD has it, in place of the working tree's, or back where it stood.
export function restoreIn(treeText, headText, title) {
  const tree = split(treeText);
  const head = split(headText);
  const hb = locate(head.lines, title);
  if (!hb) return unconfirmIn(tree, title);
  const entry = head.lines.slice(hb.start, hb.end);
  const tb = locate(tree.lines, title);
  if (tb) {
    tree.lines.splice(tb.start, tb.end - tb.start, ...entry);
    return tree.lines.join(tree.eol);
  }
  const following = blocks(head.lines).find((b) => b.start >= hb.end);
  const anchor = following ? locate(tree.lines, titleOf(head.lines[following.start])) : null;
  const all = blocks(tree.lines);
  const at = anchor ? anchor.start : all.length > 0 ? all[all.length - 1].end : tree.lines.length;
  tree.lines.splice(at, 0, ...entry);
  return tree.lines.join(tree.eol);
}

// Undo of a confirmation HEAD never saw: the board kept what the proposal said in brackets.
function unconfirmIn(tree, title) {
  const b = locate(tree.lines, title);
  if (!b) return null;
  for (let i = b.start; i < b.end; i++) {
    const parts = tree.lines[i].split('·');
    const at = parts.findIndex((p) => /^confirmed\b.*\((.+)\)\s*$/i.test(p.trim()));
    if (at < 0) continue;
    const lead = /^\s*/.exec(parts[at])[0];
    parts[at] = `${lead}unconfirmed — ${/\((.+)\)\s*$/.exec(parts[at].trim())[1]}`;
    tree.lines[i] = parts.join('·');
    return tree.lines.join(tree.eol);
  }
  return null;
}

// Whether HEAD has this fact: only a committed fact can be removed, so a removal can be undone.
export function committed(head, file, title) {
  return head.some((f) => f.file === file && f.title === title);
}

export function commitMessage(pending) {
  const count = (change) => pending.filter((p) => p.change === change).length;
  const [added, confirmed, removed] = [count('added'), count('confirmed'), count('removed')];
  const parts = [added > 0 && `add ${added}`, confirmed > 0 && `confirm ${confirmed}`, removed > 0 && `remove ${removed}`].filter(Boolean);
  return `docs(ristretto): ${parts.join(', ')} domain fact${pending.length === 1 ? '' : 's'}`;
}

// Only the changed domain files, whatever else is staged: `git commit -- <paths>` commits those
// paths alone.
export function commitArgs(pending) {
  return ['commit', '-m', commitMessage(pending), '--', ...files(pending)];
}

const files = (pending) => [...new Set(pending.map((p) => `docs/ristretto/domain/${p.file}`))].sort();

// A fact file research created is untracked: `git add` it (and only it) before committing.
export function addArgs(pending) {
  return ['add', '--', ...files(pending)];
}

// Why the facts cannot change now, or null. A pull/brew marker idle for a day is a leftover, as
// the board's own marker reading treats it; a domain snapshot lives only while research runs.
const LEFTOVER_MS = 24 * 60 * 60 * 1000;
export function lockOf({ markerIdleMs, snapshot }) {
  if (markerIdleMs !== null && markerIdleMs <= LEFTOVER_MS) return 'a run is active — after it';
  if (snapshot) return 'a research run is in flight (or did not finish — the next research run checks it)';
  return null;
}

export function signatureOf(name, now) {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  return `${name}, ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
