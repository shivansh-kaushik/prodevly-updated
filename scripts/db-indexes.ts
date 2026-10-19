/**
 * `npm run db:indexes [-- --dry-run]`: build the indexes every model declares.
 *
 * `autoIndex` is off in production, and the unique indexes (admin email, the single
 * internal client, reference numbers) and the rate-limit TTL index are part of the
 * app's correctness, so run this in the deploy pipeline BEFORE traffic.
 */
import { loadEnvConfig } from '@next/env';
import { diffAllIndexes, syncAllIndexes } from '../src/lib/db/indexes';
import { disconnectFromDatabase } from '../src/lib/db/mongoose';

loadEnvConfig(process.cwd());

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const report = await diffAllIndexes();
  let pending = 0;
  for (const r of report) {
    if (r.toCreate.length === 0 && r.toDrop.length === 0) continue;
    pending += r.toCreate.length + r.toDrop.length;
    console.log(`${r.model}`);
    for (const c of r.toCreate) console.log(`  + ${c}`);
    for (const d of r.toDrop) console.log(`  - ${d}`);
  }
  console.log(pending === 0 ? 'All indexes are up to date.' : `${pending} index change(s) pending.`);
  if (!dryRun && pending > 0) {
    await syncAllIndexes();
    console.log('Indexes synced.');
  }
}

main()
  .catch((error) => {
    console.error('db:indexes failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => disconnectFromDatabase());
