import { describe, expect, it } from 'vitest';
import { Lead } from '@/models';
import { markLeadSpam } from '@/services/lead.service';
import { convertLead } from '@/services/lead-conversion.service';
import { makeConvertibleLead } from '@/test/lead-conversion-factories';
import { makeSuperadmin, sessionFor } from '@/test/factories';
import { setupTestDb } from '@/test/db';

setupTestDb();

describe('a converted enquiry', () => {
  it('cannot be marked as spam: that would leave junk linked to a real client', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const lead = await makeConvertibleLead();
    await convertLead(sa, String(lead._id), { mode: 'new', client: { name: 'Acme Logistics' }, project: null }, {});
    await expect(markLeadSpam(sa, String(lead._id), undefined)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await Lead.findById(lead._id).lean())?.status).toBe('won');
  });
});
