/**
 * `npm run fx:fetch`: pull the European Central Bank's reference rates (through the Frankfurter API)
 * for every enabled foreign currency into the `fxRates` table, as source "ecb".
 *
 * It never overwrites: a rate that already exists for the same currency and day, entered by hand or
 * fetched earlier, is left exactly as it is, so running it twice is harmless. Currencies the ECB does
 * not publish are reported as skipped and need a manual rate. The same code runs from GET /api/cron/fx
 * (src/services/fx.service.ts); this script is only a thin way to run it by hand.
 *
 * Against a database that is not on this machine it needs `--confirm-production`.
 */
import { disconnectFromDatabase } from '../src/lib/db/mongoose';
import { fetchAndStoreRates } from '../src/services/fx.service';
import { assertConfirmedIfRemote, loadScriptEnv } from './lib/env';

loadScriptEnv();

function maskUri(uri: string): string {
  return uri.replace(/\/\/[^@/]*@/, '//***:***@');
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set. Copy .env.example to .env.local (and run `npm run dev:db` for a local database).');
    process.exit(1);
  }
  assertConfirmedIfRemote(process.argv, uri);

  console.log(`Fetching ECB reference rates into ${maskUri(uri)}\n`);
  const result = await fetchAndStoreRates();

  for (const s of result.stored) console.log(`  stored     ${s.currency}  ${s.rate}  (${s.rateOn})`);
  for (const u of result.unchanged) console.log(`  kept       ${u.currency}  (${u.rateOn}) already has a ${u.keptSource} rate`);
  for (const s of result.skipped) console.log(`  skipped    ${s.currency}  ${s.reason}`);
  for (const f of result.failed) console.log(`  FAILED     ${f.currency}  ${f.reason}`);
  if (result.attempted === 0) console.log('  No foreign currency is enabled in Settings, so there is nothing to fetch.');
  console.log(`\n${result.stored.length} stored, ${result.unchanged.length} kept, ${result.skipped.length} skipped, ${result.failed.length} failed.`);

  // Every currency failing means the feed is unreachable: make a scheduler notice.
  if (result.attempted > 0 && result.failed.length === result.attempted) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('fx:fetch failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => disconnectFromDatabase());
