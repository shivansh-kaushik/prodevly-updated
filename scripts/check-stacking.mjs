#!/usr/bin/env node
/**
 * `npm run check:stacking` - fails when a public `<main>` or `<section>` would create a
 * stacking context, which would trap the fixed 3D canvas behind or in front of the
 * wrong layer. Rules in scripts/lib/stacking.mjs; layers in DESIGN.md.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findStackingContexts } from './lib/stacking.mjs';

const root = process.cwd();
const DIRS = ['src/components/home', 'src/app/(site)'];

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
    else if (/\.tsx$/.test(name) && !/\.test\./.test(name)) yield path;
  }
}

let scanned = 0;
const failures = [];
for (const dir of DIRS) {
  for (const file of walk(join(root, dir))) {
    scanned++;
    for (const f of findStackingContexts(readFileSync(file, 'utf8'), file)) failures.push(`${relative(root, file)}:${f.line}  <${f.element}> has ${f.what}`);
  }
}

if (failures.length > 0) {
  console.error('A section or main creates a stacking context:\n');
  for (const f of failures) console.error('  ' + f);
  console.error('\nPut transforms, opacity and z-index on children, never on <main> or <section>.');
  process.exit(1);
}
console.log(`check:stacking ok (${scanned} files scanned)`);
