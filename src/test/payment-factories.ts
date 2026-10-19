import { Types } from 'mongoose';
import type { PRICING_MODELS } from '@/config/statuses';
import type { RecordPaymentInput } from '@/lib/validation/payment';
import { ClientPayment, Media, type ClientDoc, type MediaDoc, type ProjectDoc } from '@/models';
import type { SessionUser } from '@/types/session';
import { makeClient, makeProject } from './domain-factories';
import { makeAdmin, makeSuperadmin, sessionFor } from './factories';
import { D, makeFxRate, makeInternalClient, makePayment, viewerWith, type PaymentFixture } from './project-factories';

/**
 * Fixtures for the Client payments module. Direct-to-database on purpose: a service test needs a project
 * with an exact contract and milestones, and the people to act on it, without going through the services of
 * other modules.
 */
export { D, makeFxRate, makeInternalClient, viewerWith };

/** The organisation's "now" in these tests: 12 October 2026, in India as well as in UTC. */
export const NOW = new Date('2026-10-12T10:00:00Z');

export const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; status?: number; fields?: Record<string, string>; message?: string };
  }
  throw new Error('expected the call to be rejected');
};

export interface PaymentActors {
  /** A superadmin: every capability, including money:void and money:approve. */
  sa: SessionUser;
  /** An admin granted payment:record (which brings payment:view). */
  recorder: SessionUser;
  /** An admin granted payment:view only. */
  viewer: SessionUser;
  /** An admin with no money access at all. */
  plain: SessionUser;
}

export async function paymentActors(): Promise<PaymentActors> {
  return {
    sa: await sessionFor(await makeSuperadmin({ name: 'Sara Super' })),
    recorder: await sessionFor(await makeAdmin({ name: 'Rita Recorder', grants: ['payment:record', 'payment:view'] })),
    viewer: await sessionFor(await makeAdmin({ name: 'Vik Viewer', grants: ['payment:view'] })),
    plain: await sessionFor(await makeAdmin({ name: 'Pat Plain' })),
  };
}

export interface MilestoneFixture {
  title: string;
  amountMinor: number;
  status?: 'pending' | 'invoiced' | 'paid';
  dueOn?: string;
}

export interface BillableProjectOptions {
  client?: Pick<ClientDoc, '_id' | 'name'>;
  currency?: string;
  pricingModel?: (typeof PRICING_MODELS)[number];
  amountMinor?: number;
  milestones?: MilestoneFixture[];
  status?: ProjectDoc['status'];
}

/** A project with a contract (INR 10,00,000.00 fixed by default) and optional milestones. */
export async function makeBillableProject(o: BillableProjectOptions = {}) {
  const client = o.client ?? (await makeClient({ name: 'Acme Robotics' }));
  const project = await makeProject(client, {
    name: 'Checkout redesign',
    status: o.status ?? 'active',
    contract: { pricingModel: o.pricingModel ?? 'fixed', amountMinor: o.amountMinor ?? 100_000_000, currency: o.currency ?? 'INR' },
    milestones: (o.milestones ?? []).map((m) => ({
      title: m.title,
      amountMinor: m.amountMinor,
      status: m.status ?? 'invoiced',
      ...(m.dueOn ? { dueOn: D(m.dueOn) } : {}),
    })) as never,
  });
  return { client, project };
}

/** A valid body to record a payment in INR on the 1st of October 2026. Override what the test is about. */
export function paymentBody(project: Pick<ProjectDoc, '_id'>, o: Partial<RecordPaymentInput> = {}): RecordPaymentInput {
  return {
    projectId: String(project._id),
    amountMinor: 10_000_000,
    currency: 'INR',
    receivedOn: '2026-10-01',
    mode: 'bank_transfer',
    ...o,
  };
}

/** A private payment attachment, as the media service would have stored it. */
export async function makePaymentFile(uploader: Pick<SessionUser, 'id' | 'name'>, o: Partial<Pick<MediaDoc, 'visibility' | 'purpose'>> = {}): Promise<MediaDoc> {
  const doc = await Media.create({
    storage: 'gridfs',
    fileId: new Types.ObjectId(),
    filename: 'remittance.pdf',
    mime: 'application/pdf',
    size: 1234,
    sha256: new Types.ObjectId().toHexString(),
    visibility: o.visibility ?? 'private',
    purpose: o.visibility === 'public' ? undefined : (o.purpose ?? 'payment'),
    uploadedBy: { id: new Types.ObjectId(uploader.id), name: uploader.name },
  });
  return doc.toObject();
}

export const paymentCount = (filter: Record<string, unknown> = {}) => ClientPayment.countDocuments(filter);

export interface LedgerPaymentFixture extends PaymentFixture {
  mode?: string;
  tdsMinor?: number;
  chargesMinor?: number;
}

/**
 * A payment inserted straight into the database, for dashboard tests that need exact settled, void and
 * foreign entries (the service would refuse some of them, or take a rate from the table). The INR value is
 * built the way the services build it.
 */
export async function makeLedgerPayment(project: Pick<ProjectDoc, '_id' | 'clientId'>, o: LedgerPaymentFixture) {
  const doc = await makePayment(project, o);
  const extra: Record<string, unknown> = {};
  if (o.mode) extra.mode = o.mode;
  if (o.tdsMinor !== undefined) extra.tdsMinor = o.tdsMinor;
  if (o.chargesMinor !== undefined) extra.chargesMinor = o.chargesMinor;
  if (Object.keys(extra).length === 0) return doc;
  return (await ClientPayment.findOneAndUpdate({ _id: doc._id }, { $set: extra }, { returnDocument: 'after' }).lean()) ?? doc;
}
