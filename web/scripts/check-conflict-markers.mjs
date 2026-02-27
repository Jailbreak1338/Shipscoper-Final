import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['src'];
const exts = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const bad = [];

const CONFLICT_RE = /^(<{7}|={7}|>{7})(?:\s|$)/m;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      walk(p);
      continue;
    }
    const dot = p.lastIndexOf('.');
    const ext = dot >= 0 ? p.slice(dot) : '';
    if (!exts.has(ext)) continue;
    const txt = readFileSync(p, 'utf8');
    if (CONFLICT_RE.test(txt)) {
      bad.push(p);
    }
  }
}

for (const root of roots) walk(root);

if (bad.length > 0) {
  console.error('Merge conflict markers found in source files:');
  for (const f of bad) console.error(`- ${f}`);
  process.exit(1);
}

console.log('No merge conflict markers detected.');
