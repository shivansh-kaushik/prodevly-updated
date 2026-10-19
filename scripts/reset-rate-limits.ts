/**
 * `npm run reset:rate-limits`: clears every rate-limit window. Development only:
 * the smoke test and manual testing trip the sign-in limits, and this is how you
 * start fresh without spoofing forwarding headers.
 */
import { connectToDatabase, disconnectFromDatabase } from '../src/lib/db/mongoose';
import { RateLimit } from '../src/models';
import { isLocalMongoUri, loadScriptEnv } from './lib/env';

loadScriptEnv();

async function main() {
  // tsx never sets NODE_ENV, so check where the database actually is: this clears brute-force protection.
  if (process.env.NODE_ENV === 'production' || !isLocalMongoUri(process.env.MONGODB_URI)) {
    throw new Error('Refusing to clear rate limits on a database that is not on this machine');
  }
  await connectToDatabase();
  const { deletedCount } = await RateLimit.deleteMany({});
  console.log(`Cleared ${deletedCount} rate-limit window(s).`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => disconnectFromDatabase());
