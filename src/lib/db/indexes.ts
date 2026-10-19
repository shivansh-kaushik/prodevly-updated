import { connectToDatabase, mongoose } from './mongoose';
import '@/models'; // registers every schema

export interface IndexReport {
  model: string;
  toDrop: string[];
  toCreate: string[];
}

/**
 * Compares each model's declared indexes with the database. In production
 * `autoIndex` is off, so this (via `npm run db:indexes`) is the only thing that
 * builds the unique and TTL indexes the app depends on.
 */
export async function diffAllIndexes(): Promise<IndexReport[]> {
  await connectToDatabase();
  const out: IndexReport[] = [];
  for (const name of mongoose.modelNames().sort()) {
    const model = mongoose.model(name);
    const diff = await model.diffIndexes();
    out.push({ model: name, toDrop: diff.toDrop, toCreate: diff.toCreate.map((i) => JSON.stringify(i)) });
  }
  return out;
}

/** Builds missing indexes and drops ones no longer declared. */
export async function syncAllIndexes(): Promise<void> {
  await connectToDatabase();
  for (const name of mongoose.modelNames()) await mongoose.model(name).syncIndexes();
}
