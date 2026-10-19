import { describe, expect, it } from 'vitest';
import { diffAllIndexes } from '@/lib/db/indexes';
import { mongoose } from '@/lib/db/mongoose';
import { Admin, Client, PayProfile, RateLimit, ThirdParty } from '@/models';
import { setupTestDb } from '@/test/db';

setupTestDb();

type Spec = { key: Record<string, number>; unique?: boolean; expireAfterSeconds?: number; partialFilterExpression?: unknown };
const indexesOf = async (model: string) => (await mongoose.model(model).collection.indexes()) as unknown as Spec[];
const find = (specs: Spec[], key: Record<string, number>) => specs.find((s) => JSON.stringify(s.key) === JSON.stringify(key));

describe('indexes the app relies on', () => {
  it('every declared index exists, and none are left over (what `npm run db:indexes` would do is a no-op)', async () => {
    const report = await diffAllIndexes();
    expect(report.filter((r) => r.toCreate.length > 0 || r.toDrop.length > 0)).toEqual([]);
  });

  it.each([
    ['Admin', { email: 1 }],
    ['Client', { ref: 1 }],
    ['Project', { ref: 1 }],
    ['Task', { ref: 1 }],
    ['ClientPayment', { ref: 1 }],
    ['Expense', { ref: 1 }],
    ['TeamPayout', { ref: 1 }],
    ['ThirdParty', { ref: 1 }],
    ['ThirdPartyPayout', { ref: 1 }],
    ['WorkOrder', { ref: 1 }],
    ['TeamRole', { nameLower: 1 }],
    ['PayProfile', { adminId: 1 }],
    ['FxRate', { currency: 1, rateOn: -1 }],
  ])('%s has a UNIQUE index on %o', async (model, key) => {
    expect(find(await indexesOf(model), key)?.unique).toBe(true);
  });

  it('there is at most one internal client, enforced by a partial unique index', async () => {
    const spec = find(await indexesOf('Client'), { isInternal: 1 });
    expect(spec?.unique).toBe(true);
    expect(spec?.partialFilterExpression).toEqual({ isInternal: true });
  });

  it('rate-limit windows expire on their own', async () => {
    expect(find(await indexesOf('RateLimit'), { expiresAt: 1 })?.expireAfterSeconds).toBe(0);
  });

  it('secrets are excluded from default reads', () => {
    expect(Admin.schema.path('passwordHash').options.select).toBe(false);
    expect(PayProfile.schema.path('payoutNote').options.select).toBe(false);
    expect(ThirdParty.schema.path('paymentNote').options.select).toBe(false);
    expect(Client).toBeTruthy();
    expect(RateLimit).toBeTruthy();
  });
});
