#!/usr/bin/env node
/**
 * `npm run check:contrast` - fails when a field and ink pair on the public home page
 * drops below its WCAG 2.2 contrast minimum. Pairs and rules: scripts/lib/contrast.mjs.
 */
import { readFileSync } from 'node:fs';
import { checkContrast } from './lib/contrast.mjs';

const css = readFileSync('src/app/globals.css', 'utf8');
const results = checkContrast(css);
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.text} on ${r.bg}  ${r.ratio.toFixed(2)} (min ${r.min})  ${r.where}${r.missing ? `  missing ${r.missing.join(', ')}` : ''}`);
if (failed.length > 0) {
  console.error(`\n${failed.length} pair(s) below their minimum`);
  process.exit(1);
}
console.log('\ncheck:contrast ok');
