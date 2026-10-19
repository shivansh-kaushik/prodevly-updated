import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MONGO_BINARY_VERSION } from './scripts/lib/mongo';

/**
 * One in-memory MongoDB replica set for the whole run (transactions need a
 * replica set). Each test file gets its own database name on top of it.
 * Workers inherit the environment, so the URI reaches them through process.env.
 */
let replSet: MongoMemoryReplSet | undefined;

export async function setup() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    binary: { version: MONGO_BINARY_VERSION },
  });
  process.env.TEST_MONGO_URI = replSet.getUri();
}

export async function teardown() {
  await replSet?.stop();
}
