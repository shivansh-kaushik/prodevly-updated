import mongoose, { type ClientSession, type Mongoose } from 'mongoose';

/**
 * Cached MongoDB connection.
 *
 * Next reloads modules on every edit in dev and may start many server instances
 * in production. Without a cache each request would open a new connection pool,
 * so the live connection (and the in-flight promise for it) is parked on
 * `globalThis`.
 */
interface MongooseCache {
  conn: Mongoose | null;
  promise: Promise<Mongoose> | null;
}

declare global {
  var __prodevlyMongoose: MongooseCache | undefined;
}

const cache: MongooseCache = globalThis.__prodevlyMongoose ?? { conn: null, promise: null };
globalThis.__prodevlyMongoose = cache;

/**
 * NoSQL-injection protection, and the one trap in this codebase: READ BEFORE YOU WRITE A QUERY.
 *
 * `sanitizeFilter` makes a filter value that contains `$`-prefixed keys inert by
 * wrapping it in `{ $eq: ... }`. That stops a request body of
 * `{ "email": { "$ne": null } }` from turning `findOne(body)` into "any admin".
 * It is set globally so one forgotten route cannot opt out.
 *
 * The catch: Mongoose cannot tell OUR operators from an attacker's, so
 *
 *     Admin.find({ status: { $ne: 'deactivated' } })                       // WRONG
 *     Admin.find({ status: mongoose.trusted({ $ne: 'deactivated' }) })     // RIGHT
 *
 * Only call `trusted()` on a value you built yourself from zod-parsed input,
 * never on anything off the wire. Aggregation pipelines are NOT sanitised, so
 * build `$match` stages from parsed primitives only. `npm run audit:filters`
 * flags operators that are not wrapped.
 */
mongoose.set('sanitizeFilter', true);
mongoose.set('strictQuery', true);
// Indexes are built by `npm run db:indexes` in production, never implicitly.
mongoose.set('autoIndex', process.env.NODE_ENV !== 'production');

export class DatabaseUnavailableError extends Error {
  constructor(message = 'Database is unavailable') {
    super(message);
    this.name = 'DatabaseUnavailableError';
  }
}

function mongoUri(): string | undefined {
  return process.env.MONGODB_URI?.trim() || undefined;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(mongoUri());
}

export async function connectToDatabase(): Promise<Mongoose> {
  const uri = mongoUri();
  if (!uri) {
    throw new DatabaseUnavailableError(
      'MONGODB_URI is not set. Copy .env.example to .env.local and point it at your MongoDB instance.',
    );
  }

  if (cache.conn && cache.conn.connection.readyState === 1) return cache.conn;

  if (!cache.promise) {
    cache.promise = mongoose
      .connect(uri, {
        // Fail fast instead of hanging a request for 30 s when Mongo is down.
        serverSelectionTimeoutMS: 8_000,
        socketTimeoutMS: 45_000,
        maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE ?? 10),
        minPoolSize: 0,
        bufferCommands: false,
        appName: 'prodevly',
      })
      .catch((error: unknown) => {
        cache.promise = null;
        throw error;
      });
  }

  try {
    cache.conn = await cache.promise;
  } catch (error) {
    cache.promise = null;
    throw new DatabaseUnavailableError(error instanceof Error ? error.message : 'Could not connect to MongoDB');
  }
  return cache.conn;
}

export async function disconnectFromDatabase(): Promise<void> {
  if (cache.conn) {
    await cache.conn.disconnect();
    cache.conn = null;
    cache.promise = null;
  }
}

/**
 * Runs `fn` in a MongoDB transaction and retries on transient errors and write
 * conflicts (Mongoose resets document state between attempts). Everything that
 * writes more than one document, and every audited change, goes through this.
 *
 * Transactions need a replica set. `npm run dev:db` serves one locally and Atlas
 * is one, so a standalone `mongod` will fail here by design.
 */
export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const conn = await connectToDatabase();
  return conn.connection.transaction(fn, {
    readConcern: { level: 'snapshot' },
    writeConcern: { w: 'majority' },
  });
}

export { mongoose };
