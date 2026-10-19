import { afterAll, beforeAll, beforeEach } from 'vitest';
import { connectToDatabase, disconnectFromDatabase, mongoose } from '@/lib/db/mongoose';
import { syncAllIndexes } from '@/lib/db/indexes';

/**
 * Gives a test file its own database on the shared in-memory replica set, with
 * every index built, and a clean slate before each test.
 *
 *   setupTestDb();   // at the top of a *.int.test.ts file
 */
export function setupTestDb() {
  const dbName = `t_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    const base = process.env.TEST_MONGO_URI;
    if (!base) throw new Error('TEST_MONGO_URI is not set: global setup did not run');
    process.env.MONGODB_URI = base.replace('/?', `/${dbName}?`);
    await connectToDatabase();
    await syncAllIndexes();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('No database connection');
    // Raw collection access: the AuditLog model deliberately refuses deletes.
    for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({});
  });

  afterAll(async () => {
    await mongoose.connection.db?.dropDatabase();
    await disconnectFromDatabase();
  });
}
