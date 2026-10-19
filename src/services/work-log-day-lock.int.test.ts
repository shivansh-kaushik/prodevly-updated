import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { parseDateOnly } from '@/lib/dates/date-only';
import { Counter } from '@/models';
import { markTeamPayoutPaid } from '@/services/team-payout.service';
import { createWorkLog, workLogDayLockKey } from '@/services/work-log.service';
import { makePayoutWorld, NOW, recordPayout, setupTestDb } from '@/test/team-payout-factories';

setupTestDb();

const PAID = { paidOn: '2026-05-10', mode: 'bank_transfer', transactionRef: 'UTR-001' };
const on = (ymd: string) => parseDateOnly(ymd) as Date;

describe('the per-day lock key shared by the work-log and team payout services', () => {
  it('is one format: the person and the calendar day', () => {
    const id = new Types.ObjectId();
    expect(workLogDayLockKey(id, on('2026-04-15'))).toBe(`worklog-day:${String(id)}:2026-04-15`);
    expect(workLogDayLockKey(String(id), on('2026-04-15'))).toBe(workLogDayLockKey(id, on('2026-04-15')));
    expect(workLogDayLockKey(id, on('2026-04-15'))).not.toBe(workLogDayLockKey(id, on('2026-04-16')));
  });

  it('logging time and paying a period write to the very same counter documents', async () => {
    const w = await makePayoutWorld();
    const key = (ymd: string) => workLogDayLockKey(w.person._id, on(ymd));
    const seq = async (ymd: string) => (await Counter.findById(key(ymd)).lean())?.seq;

    await createWorkLog(w.personSession, { taskId: String(w.tasks[0]!._id), workedOn: '2026-04-15', minutes: 45, note: 'before the payout' });
    expect(await seq('2026-04-15')).toBe(1); // the work-log service wrote it

    const payout = await recordPayout(w, { periodFrom: '2026-04-10', periodTo: '2026-04-20' });
    await markTeamPayoutPaid(w.sa, payout.id, PAID, {}, NOW);

    // paying touched the logged day (a second write to the same document, which is what makes a concurrent log conflict) ...
    expect(await seq('2026-04-15')).toBe(2);
    // ... every other day of the period (so a log added on a quiet day conflicts too) ...
    for (const ymd of ['2026-04-10', '2026-04-14', '2026-04-20']) expect(await seq(ymd), ymd).toBe(1);
    // ... and nothing outside it.
    for (const ymd of ['2026-04-09', '2026-04-21']) expect(await seq(ymd), ymd).toBeUndefined();
  });
});
