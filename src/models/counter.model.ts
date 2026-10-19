import { Schema, model, models, type ClientSession, type Model } from 'mongoose';

/**
 * Atomic sequence generator. Human-readable references (CL-0007, PRJ-0042,
 * PAY-FY27-0001) must be unique, and counting documents would race under
 * concurrent writes, so each key owns one document and one atomic `$inc` hands
 * out the next number. The key `superadmin-guard` is also used as a write lock
 * (see the admin service).
 */
export interface CounterDoc {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<CounterDoc>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { versionKey: false },
);

declare module 'mongoose' {
  interface Models {
    Counter: Model<CounterDoc>;
  }
}

export const Counter: Model<CounterDoc> = models.Counter ?? model<CounterDoc>('Counter', counterSchema);

/** Returns the next value for `key`, creating the counter on first use. Pass the session inside a transaction. */
export async function nextSequence(key: string, session?: ClientSession): Promise<number> {
  const doc = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, session },
  ).lean();
  return doc?.seq ?? 1;
}
