import { Readable } from 'node:stream';
import { Types } from 'mongoose';
import { connectToDatabase, mongoose } from './mongoose';

/**
 * File storage behind a small adapter. Today the bytes live in MongoDB GridFS (bucket `media`);
 * the Media document only knows `storage: 'gridfs'` and a `fileId`, so moving to S3, R2 or
 * Vercel Blob later means writing another object with this same shape and switching which one
 * the media service uses. No schema change, no change to the serving route.
 *
 * GridFS writes cannot join a Mongo transaction, so callers store the bytes FIRST, then record
 * the Media document in a transaction, and remove the bytes again if that transaction fails.
 */
export interface StoredFileInfo {
  filename: string;
  contentType: string;
}

export interface MediaStorage {
  put(data: Buffer, info: StoredFileInfo): Promise<Types.ObjectId>;
  /** A byte stream, or null when the file is gone (an orphaned record). */
  open(fileId: Types.ObjectId | string): Promise<ReadableStream<Uint8Array> | null>;
  /** Whether the bytes still exist (a Media record can outlive its file if a delete was interrupted). */
  has(fileId: Types.ObjectId | string): Promise<boolean>;
  /** Idempotent: removing a file that is already gone is not an error. */
  remove(fileId: Types.ObjectId | string): Promise<void>;
}

export const GRIDFS_BUCKET = 'media';

async function bucket() {
  await connectToDatabase();
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database connection');
  return new mongoose.mongo.GridFSBucket(db, { bucketName: GRIDFS_BUCKET });
}

const toId = (id: Types.ObjectId | string) => new mongoose.mongo.ObjectId(String(id));

export const gridfsStorage: MediaStorage = {
  async put(data, info) {
    const b = await bucket();
    // The driver no longer has a contentType option; the type lives on the Media document and here for anyone reading the bucket.
    const upload = b.openUploadStream(info.filename, { metadata: { contentType: info.contentType } });
    await new Promise<void>((resolve, reject) => {
      upload.once('error', reject);
      upload.once('finish', () => resolve());
      upload.end(data);
    });
    return new Types.ObjectId(String(upload.id));
  },

  async open(fileId) {
    const b = await bucket();
    const found = await b.find({ _id: toId(fileId) }, { limit: 1 }).toArray();
    if (found.length === 0) return null;
    return Readable.toWeb(b.openDownloadStream(toId(fileId))) as ReadableStream<Uint8Array>;
  },

  async has(fileId) {
    const b = await bucket();
    return (await b.find({ _id: toId(fileId) }, { limit: 1 }).toArray()).length > 0;
  },

  async remove(fileId) {
    const b = await bucket();
    try {
      await b.delete(toId(fileId));
    } catch (error) {
      // The driver reports a missing file only through its message ("File not found for id ...").
      if (/file\s?not\s?found/i.test(String((error as Error)?.message))) return;
      throw error;
    }
  },
};

/** Test helper and last-resort reader: the whole file as a Buffer, or null when it is gone. */
export async function readStoredFile(fileId: Types.ObjectId | string): Promise<Buffer | null> {
  const stream = await gridfsStorage.open(fileId);
  if (!stream) return null;
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** How many files the bucket holds. For tests and ops checks. */
export async function countStoredFiles(): Promise<number> {
  await connectToDatabase();
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database connection');
  return db.collection(`${GRIDFS_BUCKET}.files`).countDocuments();
}
