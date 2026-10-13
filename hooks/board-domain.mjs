// Domain facts (docs/ristretto/domain/*.md) as the board reads them. Pure: no $, no Node. An
// entry is a top-level `- ` bullet plus its indented continuation lines — the rule
// scripts/research.js uses, so the board and check-domain agree on what one entry is. Its title
// is the bold run that opens it: `- **<title>** <text>`. A person makes a fact binding or settles
// a conflict in the chat (prep); the board only reads.

export const EMPTY_DOMAIN = { tree: [] };

const TITLE = /^- \*\*(.+?)\*\*\s*(.*)$/;
const CONFIRMED = /^confirmed\b/i;
const UNCONFIRMED = /^unconfirmed\b/i;
const CONFLICT = /^conflict\s*[—–-]/i;

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

// A fact re-read from a newer source (`Nodes keys (V1.1)`) that left the old one standing — as
// research did before it noted conflicts — marks the old one, so the page says which is older.
export function markOlder(facts) {
  const versioned = new Set(facts.map((f) => {
    const m = /^(.*?)\s*\(V[\d.]+\)\s*$/.exec(f.title);
    return m ? `${f.file}\u0000${m[1]}` : null;
  }).filter(Boolean));
  return facts.map((f) => (versioned.has(`${f.file}\u0000${f.title}`) ? { ...f, older: true } : f));
}
