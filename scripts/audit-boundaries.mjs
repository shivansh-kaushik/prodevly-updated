#!/usr/bin/env node
/**
 * `npm run audit:boundaries` - builds the import graph of src/ and fails on forbidden
 * imports, direct or transitive. Rules live in scripts/lib/boundaries.mjs.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checkProject } from './lib/boundaries.mjs';

const root = process.cwd();
const EXT = /\.(ts|tsx|mts|mjs|js)$/;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (EXT.test(name) && !/\.test\./.test(name)) yield path;
  }
}

const files = new Map();
for (const file of walk(join(root, 'src'))) files.set(relative(root, file).replaceAll('\\', '/'), readFileSync(file, 'utf8'));

const failures = checkProject(files);
if (failures.length > 0) {
  console.error('Import boundary violations:\n');
  for (const f of failures) console.error(`  ${f.file}\n    ${f.rule}\n    via ${f.chain.join('  ->  ')}`);
  process.exit(1);
}
console.log(`audit:boundaries ok (${files.size} files in the graph)`);
