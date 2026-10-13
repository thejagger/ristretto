// What a feature changed, as a folder tree for the feature page's Files card. Pure: no $, no Node.

// Up to this many files the tree starts fully open; beyond it only the top level shows.
export const OPEN_UP_TO = 12;

// `git show --numstat --format= <commit>`: `<added>\t<removed>\t<path>` per file. A binary file
// reads `-\t-\t<path>`; a rename reads `<a> => <b>` or `<dir>/{<a> => <b>}/<rest>` — the new path counts.
export function parseNumstat(text) {
  return String(text).split(/\r?\n/).flatMap((line) => {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!m) return [];
    const p = m[3].replace(/\{[^{}]*? => ([^{}]*)\}/g, '$1').replace(/^.* => /, '').replace(/\/{2,}/g, '/');
    const bin = m[1] === '-';
    return [{ path: p, add: bin ? 0 : Number(m[1]), del: bin ? 0 : Number(m[2]), bin }];
  });
}

// The roadmap's `Files touched` cell, before there is a commit. A trailing `/` is a folder.
export function plannedOf(touched) {
  return touched.map((p) => p.trim().replace(/^\.?\//, '')).filter(Boolean).map((p) => ({ path: p, add: 0, del: 0, bin: false }));
}

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export function treeOf(files) {
  const root = { name: '', path: '', dirs: new Map(), files: [], add: 0, del: 0 };
  for (const f of files) {
    const folder = f.path.endsWith('/');
    const parts = f.path.replace(/\/$/, '').split('/');
    let node = root;
    node.add += f.add;
    node.del += f.del;
    for (let i = 0; i < (folder ? parts.length : parts.length - 1); i++) {
      if (!node.dirs.has(parts[i])) {
        node.dirs.set(parts[i], { name: parts[i], path: `${parts.slice(0, i + 1).join('/')}/`, dirs: new Map(), files: [], add: 0, del: 0 });
      }
      node = node.dirs.get(parts[i]);
      node.add += f.add;
      node.del += f.del;
    }
    if (!folder) node.files.push({ name: parts[parts.length - 1], path: f.path, add: f.add, del: f.del, bin: f.bin });
  }
  return settle(root);
}

// Maps become sorted arrays; a folder holding one folder and nothing else becomes one row
// (`lib/data/`), so a deep path does not cost a row per level.
function settle(node) {
  const dirs = [...node.dirs.values()].map((d) => {
    let n = d;
    let name = d.name;
    while (n.files.length === 0 && n.dirs.size === 1) {
      n = [...n.dirs.values()][0];
      name = `${name}/${n.name}`;
    }
    return { ...settle(n), name };
  });
  return { name: node.name, path: node.path, dirs: dirs.sort(byName), files: [...node.files].sort(byName), add: node.add, del: node.del };
}

// The rows the card draws: folders first, then files; what a closed folder holds is hidden.
export function rowsOf(tree, isOpen, depth = 0) {
  const out = [];
  for (const d of tree.dirs) {
    const empty = d.dirs.length === 0 && d.files.length === 0;
    const open = !empty && isOpen(d.path);
    out.push({ kind: 'dir', key: d.path, depth, name: `${d.name}/`, path: d.path, add: d.add, del: d.del, open, empty });
    if (open) out.push(...rowsOf(d, isOpen, depth + 1));
  }
  for (const f of tree.files) out.push({ kind: 'file', key: f.path, depth, name: f.name, path: f.path, add: f.add, del: f.del, bin: f.bin });
  return out;
}
