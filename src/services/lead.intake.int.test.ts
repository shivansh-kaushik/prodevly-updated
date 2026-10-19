import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as formTokenRoute } from '@/app/api/form-token/route';
import { POST as leadsRoute } from '@/app/api/leads/route';
import { checkFormToken, signFormToken } from '@/lib/api/form-token';
import { hashIp } from '@/lib/api/client-ip';
import { AuditLog, Counter, Lead, RateLimit, Settings } from '@/models';
import { createLeadFromPublic, messageHashOf } from '@/services/lead.service';
import { call, makeAdmin } from '@/test/factories';
import { intakeBody, makeService } from '@/test/lead-factories';
import { setupTestDb } from '@/test/db';
import { Types } from 'mongoose';

setupTestDb();
afterEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllEnvs());

const NOW = new Date('2026-10-12T10:00:00.000Z');
const META = { ipHash: 'hash-of-an-ip', userAgent: 'TestAgent/1.0', requestId: 'req-1' };
const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; fields?: Record<string, string>; message: string };
  }
  throw new Error('expected the call to be rejected');
};
const leadCount = () => Lead.countDocuments({});

describe('public intake: a valid enquiry', () => {
  it('is stored with a reference, a lowercased email, a history entry and an audit entry in the same commit', async () => {
    const outcome = await createLeadFromPublic(intakeBody(NOW), META, NOW);
    expect(outcome).toBe('created');

    const lead = await Lead.findOne({}).lean();
    expect(lead).toMatchObject({
      ref: 'ENQ-0001',
      name: 'Neha Verma',
      email: 'neha@example.com',
      status: 'new',
      ipHash: 'hash-of-an-ip',
      userAgent: 'TestAgent/1.0',
    });
    expect(lead?.statusHistory).toHaveLength(1);
    expect(lead?.statusHistory[0]).toMatchObject({ from: null, to: 'new', by: { name: 'Website visitor' } });
    expect(lead?.messageHash).toBe(messageHashOf('neha@example.com', lead!.message));
    expect(lead?.firstResponseAt).toBeUndefined();

    const entries = await AuditLog.find({ action: 'lead.create' }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actor: { name: 'Website visitor' }, entity: { type: 'lead', ref: 'ENQ-0001', label: 'Neha Verma' }, ipHash: 'hash-of-an-ip' });
  });

  it('numbers enquiries in sequence', async () => {
    await createLeadFromPublic(intakeBody(NOW, { fields: { message: 'First enquiry about a mobile app for our team.' } }), META, NOW);
    await createLeadFromPublic(intakeBody(NOW, { fields: { message: 'Second enquiry about a different thing entirely.' } }), META, NOW);
    expect((await Lead.find({}).sort({ ref: 1 }).lean()).map((l) => l.ref)).toEqual(['ENQ-0001', 'ENQ-0002']);
  });

  it('stores the optional details, cleaned: path without its query string, lowercased UTM', async () => {
    await createLeadFromPublic(
      intakeBody(NOW, {
        fields: { phone: '+91 98765 43210', company: 'Verma Logistics', country: 'India', sourcePath: '/contact?token=abc#x', utm: { source: 'Google', medium: 'cpc' } },
      }),
      META,
      NOW,
    );
    const lead = await Lead.findOne({}).lean();
    expect(lead).toMatchObject({ phone: '+91 98765 43210', company: 'Verma Logistics', country: 'India', sourcePath: '/contact', utm: { source: 'google', medium: 'cpc' } });
  });

  it('never stores the raw IP: only the hash it was given, nowhere else in the document', async () => {
    await createLeadFromPublic(intakeBody(NOW), { ...META, ipHash: hashIp('203.0.113.77') }, NOW);
    const raw = JSON.stringify(await Lead.findOne({}).lean()) + JSON.stringify(await AuditLog.find({}).lean());
    expect(raw).not.toContain('203.0.113.77');
  });

  it('strips invisible characters from the visitor text before it is stored', async () => {
    const rlo = String.fromCharCode(0x202e);
    await createLeadFromPublic(intakeBody(NOW, { fields: { name: `Neha${rlo} Verma`, message: `Hello${rlo} there, we need a website built for us.` } }), META, NOW);
    const lead = await Lead.findOne({}).lean();
    expect(lead?.name).toBe('Neha Verma');
    expect(lead?.message).not.toContain(rlo);
  });
});

describe('public intake: services and budget range', () => {
  it('keeps published services and ignores unknown, unpublished and malformed ids', async () => {
    const published = await makeService({ status: 'published' });
    const draft = await makeService({ status: 'draft' });
    const archived = await makeService({ status: 'archived' });
    const unknown = new Types.ObjectId();
    await createLeadFromPublic(
      intakeBody(NOW, { fields: { serviceIds: [String(published._id), String(draft._id), String(archived._id), String(unknown), 'garbage'] } }),
      META,
      NOW,
    );
    const lead = await Lead.findOne({}).lean();
    expect(lead?.serviceIds.map(String)).toEqual([String(published._id)]);
  });

  it('keeps a budget range only when the team configured it (matched case-insensitively, stored as configured)', async () => {
    await Settings.create({ budgetRanges: ['Under 5 lakh', '5 to 15 lakh'] });
    await createLeadFromPublic(intakeBody(NOW, { fields: { budgetRange: '5 TO 15 LAKH', message: 'Budget enquiry number one for a portal.' } }), META, NOW);
    await createLeadFromPublic(intakeBody(NOW, { fields: { budgetRange: 'a million dollars', message: 'Budget enquiry number two for a portal.' } }), META, NOW);
    const leads = await Lead.find({}).sort({ ref: 1 }).lean();
    expect(leads.map((l) => l.budgetRange)).toEqual(['5 to 15 lakh', undefined]);
  });

  it('assigns a new enquiry to the configured default assignee while they are active, and never a spam one', async () => {
    const admin = await makeAdmin({ name: 'Priya Shah' });
    await Settings.create({ leadDefaultAssignee: { id: admin._id, name: admin.name } });
    await createLeadFromPublic(intakeBody(NOW, { fields: { message: 'Enquiry that should be assigned to Priya.' } }), META, NOW);
    await createLeadFromPublic(intakeBody(NOW, { fields: { message: 'Buy VIAGRA now from our cheap online pharmacy.' } }), META, NOW);
    const [first, second] = await Lead.find({}).sort({ ref: 1 }).lean();
    expect(first?.assignedTo).toMatchObject({ name: 'Priya Shah' });
    expect(second?.status).toBe('spam');
    expect(second?.assignedTo).toBeUndefined();
  });

  it('does not assign to a default assignee who has been removed', async () => {
    const gone = await makeAdmin({ status: 'deactivated' });
    await Settings.create({ leadDefaultAssignee: { id: gone._id, name: gone.name } });
    await createLeadFromPublic(intakeBody(NOW), META, NOW);
    expect((await Lead.findOne({}).lean())?.assignedTo).toBeUndefined();
  });
});

describe('public intake: the honeypot', () => {
  it('answers like a success and stores NOTHING: no enquiry, no audit entry, no reference used', async () => {
    for (const filled of ['https://spam.example', 'x', 12345, true, { a: 1 }]) {
      expect(await createLeadFromPublic(intakeBody(NOW, { fields: { companyWebsite: filled } }), META, NOW)).toBe('honeypot');
    }
    expect(await leadCount()).toBe(0);
    expect(await AuditLog.countDocuments({})).toBe(0);
    expect(await Counter.countDocuments({})).toBe(0);
    expect(await RateLimit.countDocuments({})).toBe(0);
  });

  it('wins even over an invalid token or invalid fields, so a bot never sees a different answer', async () => {
    expect(await createLeadFromPublic({ formToken: 'junk', companyWebsite: 'x' }, META, NOW)).toBe('honeypot');
    expect(await createLeadFromPublic({ companyWebsite: 'x', name: '', email: 'nope' }, META, NOW)).toBe('honeypot');
  });

  it('an empty or blank honeypot (what a real browser sends) is not a hit', async () => {
    expect(await createLeadFromPublic(intakeBody(NOW, { fields: { companyWebsite: '' } }), META, NOW)).toBe('created');
    expect(await createLeadFromPublic(intakeBody(NOW, { fields: { companyWebsite: '   ', message: 'A different message, with a blank honeypot.' } }), META, NOW)).toBe('created');
    expect(await leadCount()).toBe(2);
  });
});

describe('public intake: the form token', () => {
  it('under 3 seconds is a silent discard: success to the sender, nothing stored', async () => {
    expect(await createLeadFromPublic(intakeBody(NOW, { ageMs: 2_999 }), META, NOW)).toBe('too_fast');
    expect(await createLeadFromPublic(intakeBody(NOW, { ageMs: 0 }), META, NOW)).toBe('too_fast');
    expect(await leadCount()).toBe(0);
    expect(await AuditLog.countDocuments({})).toBe(0);
  });

  it('exactly 3 seconds and exactly 2 hours are accepted', async () => {
    expect(await createLeadFromPublic(intakeBody(NOW, { ageMs: 3_000, fields: { message: 'Submitted three seconds after loading.' } }), META, NOW)).toBe('created');
    expect(await createLeadFromPublic(intakeBody(NOW, { ageMs: 2 * 3_600_000, fields: { message: 'Submitted after exactly two hours open.' } }), META, NOW)).toBe('created');
  });

  it('over 2 hours asks the visitor to refresh (400) and stores nothing', async () => {
    const err = await rejects(createLeadFromPublic(intakeBody(NOW, { ageMs: 2 * 3_600_000 + 1 }), META, NOW));
    expect(err.code).toBe('BAD_REQUEST');
    expect(err.message).toMatch(/refresh the page/);
    expect(await leadCount()).toBe(0);
  });

  it('a missing, malformed, tampered or foreign token is rejected (400)', async () => {
    const good = intakeBody(NOW);
    const token = good.formToken as string;
    const [v, issued, sig] = token.split('.') as [string, string, string];
    const variants: unknown[] = [undefined, null, '', 'nonsense', 42, `${v}.${Number(issued) - 7_200_000}.${sig}`, `${v}.${issued}.${sig.slice(0, -2)}xx`];
    for (const formToken of variants) {
      const err = await rejects(createLeadFromPublic({ ...good, formToken }, META, NOW));
      expect(err.code, String(formToken)).toBe('BAD_REQUEST');
    }
    vi.stubEnv('FORM_TOKEN_SECRET', 'a-different-secret-entirely-0000');
    expect((await rejects(createLeadFromPublic(good, META, NOW))).code).toBe('BAD_REQUEST');
    expect(await leadCount()).toBe(0);
  });

  it('a non-object body is a 400', async () => {
    for (const body of [null, 'text', 5, [1, 2]]) expect((await rejects(createLeadFromPublic(body, META, NOW))).code).toBe('BAD_REQUEST');
  });
});

describe('public intake: validation', () => {
  it('answers 422 with a message per field, and stores nothing', async () => {
    const err = await rejects(createLeadFromPublic(intakeBody(NOW, { fields: { name: '', email: 'not-an-email', message: 'hi' } }), META, NOW));
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(err.fields ?? {}).sort()).toEqual(['email', 'message', 'name']);
    expect(await leadCount()).toBe(0);
  });
});

describe('public intake: spam', () => {
  it('is held as spam, not rejected: stored with status spam, the reasons in the history and the audit entry', async () => {
    const outcome = await createLeadFromPublic(
      intakeBody(NOW, { fields: { message: 'Cheap links for you https://a.example.com https://b.example.com https://c.example.com' } }),
      META,
      NOW,
    );
    expect(outcome).toBe('held_as_spam');
    const lead = await Lead.findOne({}).lean();
    expect(lead?.status).toBe('spam');
    expect(lead?.statusHistory[0]).toMatchObject({ from: null, to: 'spam' });
    expect(lead?.statusHistory[0]?.note).toMatch(/3 links in the message/);
    const entry = await AuditLog.findOne({ action: 'lead.create' }).lean();
    expect(entry?.summary).toMatch(/^Held as spam: 3 links/);
  });

  it('a clean message is not held', async () => {
    expect(await createLeadFromPublic(intakeBody(NOW), META, NOW)).toBe('created');
    expect((await Lead.findOne({}).lean())?.status).toBe('new');
  });
});

describe('public intake: the 10-minute duplicate window', () => {
  it('the same email and message again inside 10 minutes stores no second row and no second audit entry', async () => {
    expect(await createLeadFromPublic(intakeBody(NOW), META, NOW)).toBe('created');
    const later = new Date(NOW.getTime() + 9 * 60_000);
    expect(await createLeadFromPublic(intakeBody(later), META, later)).toBe('duplicate');
    expect(await leadCount()).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'lead.create' })).toBe(1);
  });

  it('counts a different case or spacing as the same message', async () => {
    await createLeadFromPublic(intakeBody(NOW, { fields: { message: 'We need a customer portal.   Please call.' } }), META, NOW);
    const out = await createLeadFromPublic(intakeBody(NOW, { fields: { email: 'NEHA@example.COM', message: 'we need a CUSTOMER portal. please call.' } }), META, NOW);
    expect(out).toBe('duplicate');
    expect(await leadCount()).toBe(1);
  });

  it('after the window, or from another email, or with another message, a new enquiry is stored', async () => {
    await createLeadFromPublic(intakeBody(NOW), META, NOW);
    const later = new Date(NOW.getTime() + 10 * 60_000 + 1_000);
    expect(await createLeadFromPublic(intakeBody(later), META, later)).toBe('created');
    expect(await createLeadFromPublic(intakeBody(later, { fields: { email: 'other@example.com' } }), META, later)).toBe('created');
    expect(await createLeadFromPublic(intakeBody(later, { fields: { message: 'A completely different message about something else.' } }), META, later)).toBe('created');
    expect(await leadCount()).toBe(4);
  });

  it('a duplicate of a spam-held enquiry is still a duplicate', async () => {
    const body = intakeBody(NOW, { fields: { message: 'Buy cheap viagra online at our pharmacy today.' } });
    expect(await createLeadFromPublic(body, META, NOW)).toBe('held_as_spam');
    expect(await createLeadFromPublic(body, META, NOW)).toBe('duplicate');
    expect(await leadCount()).toBe(1);
  });

  it('identical submissions at the same instant store exactly one row', async () => {
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => createLeadFromPublic(intakeBody(NOW), META, NOW)));
    expect(outcomes.filter((o) => o === 'created')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'duplicate')).toHaveLength(4);
    expect(await leadCount()).toBe(1);
  });
});

describe('POST /api/leads', () => {
  const live = (fields: Record<string, unknown> = {}, ageMs = 10_000) => intakeBody(new Date(), { ageMs, fields });
  const post = (body: unknown, options: Parameters<typeof call>[2] = {}) => call(leadsRoute, '/api/leads', { method: 'POST', body, ...options });
  const SUCCESS = { ok: true, data: { received: true } };

  it('stores a valid enquiry and answers 201 with a body that carries no reference', async () => {
    const res = await post(live());
    expect(res.status).toBe(201);
    expect(res.body).toEqual(SUCCESS);
    expect(await leadCount()).toBe(1);
    expect(JSON.stringify(res.body)).not.toMatch(/ENQ-/);
    // the stored hash is of the client IP, never the IP itself
    const lead = await Lead.findOne({}).lean();
    expect(lead?.ipHash).toMatch(/^[a-f0-9]{32}$/);
  });

  it('is indistinguishable from outside whether it stored, held, deduplicated or discarded', async () => {
    const stored = await post(live());
    const duplicate = await post(live());
    const honeypot = await post(live({ companyWebsite: 'http://bot.example' }));
    const tooFast = await post(live({ message: 'Another perfectly fine message, sent far too quickly.' }, 500));
    const spam = await post(live({ message: 'Buy viagra online, cheap pharmacy for everyone.' }));
    for (const res of [stored, duplicate, honeypot, tooFast, spam]) {
      expect(res.status).toBe(201);
      expect(res.body).toEqual(SUCCESS);
    }
    // stored: 1 real + 1 spam-held; duplicate, honeypot and too-fast stored nothing
    expect(await leadCount()).toBe(2);
  });

  it('a bad token is 400, an expired one asks for a refresh, and nothing is stored', async () => {
    const bad = await post({ ...live(), formToken: 'nonsense' });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
    const expired = await post(live({}, 2 * 3_600_000 + 5_000));
    expect(expired.status).toBe(400);
    expect(expired.body.error.message).toMatch(/refresh/);
    expect(await leadCount()).toBe(0);
  });

  it('validation errors are 422 with field messages', async () => {
    const res = await post(live({ email: 'nope', message: 'short' }));
    expect(res.status).toBe(422);
    expect(res.body.error.fields).toMatchObject({ email: expect.any(String), message: expect.any(String) });
  });

  it('rejects an oversize body: by declared Content-Length, and by real bytes when the header lies', async () => {
    const big = JSON.stringify({ ...live(), message: 'x'.repeat(33 * 1024) });
    const declared = await post(undefined, { method: 'POST', rawBody: big, headers: { 'content-type': 'application/json', 'content-length': String(big.length) } });
    expect(declared.status).toBe(413);
    const lying = await post(undefined, { method: 'POST', rawBody: big, headers: { 'content-type': 'application/json', 'content-length': '10' } });
    expect(lying.status).toBe(413);
    expect(await leadCount()).toBe(0);
  });

  it('a body just under the cap is read (and judged on its content, not its size)', async () => {
    const res = await post(live({ message: 'y'.repeat(4900) }));
    expect(res.status).toBe(201);
  });

  it('rejects cross-site posts and non-JSON bodies', async () => {
    const cross = await post(live(), { headers: { 'sec-fetch-site': 'cross-site' } });
    expect(cross.status).toBe(403);
    const foreign = await post(live(), { headers: { 'sec-fetch-site': '', origin: 'https://evil.example' } });
    expect(foreign.status).toBe(403);
    const text = await post(undefined, { method: 'POST', rawBody: 'hello', headers: { 'content-type': 'text/plain' } });
    expect(text.status).toBe(400);
    expect(await leadCount()).toBe(0);
  });

  describe('rate limit', () => {
    it('allows 5 per 10 minutes per IP and answers 429 with Retry-After for the 6th', async () => {
      const ip = '198.51.100.200';
      for (let i = 0; i < 5; i++) {
        const res = await post(live({ message: `Distinct enquiry number ${i} for the rate limit test.` }), { ip });
        expect(res.status, `request ${i + 1}`).toBe(201);
      }
      const sixth = await post(live({ message: 'Distinct enquiry number six for the rate limit test.' }), { ip });
      expect(sixth.status).toBe(429);
      expect(sixth.body.error.code).toBe('RATE_LIMITED');
      expect(Number(sixth.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(await leadCount()).toBe(5);
      // another visitor is not affected
      expect((await post(live({ message: 'A different visitor on a different connection.' }), { ip: '198.51.100.201' })).status).toBe(201);
    });

    it('counts rejected requests too (a bot that keeps failing the token still burns its own quota)', async () => {
      const ip = '198.51.100.210';
      for (let i = 0; i < 5; i++) expect((await post({ ...live(), formToken: 'x' }, { ip })).status).toBe(400);
      expect((await post(live(), { ip })).status).toBe(429);
    });

    it('gives a request with no determinable IP the tighter "unknown" bucket (2 per window)', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('FORM_TOKEN_SECRET', 'a-long-enough-production-secret');
      const noIp = { headers: { 'x-forwarded-for': '' } };
      const body = (i: number) => ({ ...intakeBody(new Date(), { fields: { message: `Unknown connection enquiry number ${i}, please reply.` } }) });
      expect((await post(body(1), noIp)).status).toBe(201);
      expect((await post(body(2), noIp)).status).toBe(201);
      expect((await post(body(3), noIp)).status).toBe(429);
    });

    it('fails OPEN when the limiter store is down: the enquiry is still accepted', async () => {
      vi.spyOn(RateLimit, 'findOneAndUpdate').mockImplementation((() => {
        throw new Error('rate limit store is down');
      }) as never);
      const res = await post(live());
      expect(res.status).toBe(201);
      expect(await leadCount()).toBe(1);
    });
  });
});

describe('GET /api/form-token', () => {
  it('hands out a token that the intake accepts after 3 seconds, and is never cached', async () => {
    const res = await call(formTokenRoute, '/api/form-token');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.expiresInSeconds).toBe(7200);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    const token = res.body.data.token as string;
    expect(checkFormToken(token, Date.now())).toBe('too_fast');
    expect(checkFormToken(token, Date.now() + 5_000)).toBe('ok');
    expect(token).not.toBe(signFormToken(0));
  });
});
