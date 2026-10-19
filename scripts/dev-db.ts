/**
 * `npm run dev:db`: a zero-install local MongoDB for development.
 *
 * A single-node REPLICA SET (transactions need one) on port 27018, storing its
 * data in `.mongo-data/` so the seed survives a restart. Development only:
 * authentication is off. The mongod binary comes from the local cache, so the
 * first run downloads nothing if you already ran the travel site.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { DEV_DB_NAME, DEV_DB_PORT, MONGO_BINARY_VERSION } from './lib/mongo';

const dbPath = path.resolve(process.env.DEV_DB_PATH ?? path.join(process.cwd(), '.mongo-data'));

async function main() {
  mkdirSync(dbPath, { recursive: true });
  console.log(`Starting MongoDB ${MONGO_BINARY_VERSION} (replica set) on port ${DEV_DB_PORT}...`);

  const server = await MongoMemoryReplSet.create({
    binary: { version: MONGO_BINARY_VERSION },
    replSet: { count: 1, dbName: DEV_DB_NAME, storageEngine: 'wiredTiger' },
    instanceOpts: [{ port: DEV_DB_PORT, dbPath, storageEngine: 'wiredTiger' }],
  });

  console.log('\nMongoDB is up. Put this in .env.local:\n');
  console.log(`  MONGODB_URI=${server.getUri(DEV_DB_NAME)}\n`);
  console.log('Then, in another terminal:\n  npm run db:indexes\n  npm run seed\n  npm run dev\n');
  console.log(`Press Ctrl-C to stop. Data persists in ${dbPath}.`);

  const shutdown = async () => {
    console.log('\nStopping MongoDB...');
    await server.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await new Promise(() => {});
}

main().catch((error) => {
  console.error('Could not start the dev database:', error);
  process.exit(1);
});
