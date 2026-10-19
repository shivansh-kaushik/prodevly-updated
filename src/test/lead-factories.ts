import type { Types } from 'mongoose';
import type { ContentStatus, LeadStatus } from '@/config/statuses';
import { signFormToken } from '@/lib/api/form-token';
import { Lead, Service, type LeadDoc } from '@/models';
import { messageHashOf } from '@/services/lead.service';
import { nextRef } from '@/services/refs';

/**
 * Fixtures for the Enquiries module. Direct-to-database like the shared factories: they bypass the
 * service on purpose, so a test can set up exactly the state it needs (an old createdAt, a status
 * history, a converted enquiry).
 */
const SYSTEM = { id: null, name: 'Test' };
let n = 0;
const next = () => ++n;

export interface LeadOverrides {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  country?: string;
  message?: string;
  status?: LeadStatus;
  createdAt?: Date;
  firstResponseAt?: Date;
  followUpOn?: Date;
  assignedTo?: { id: Types.ObjectId | null; name: string };
  serviceIds?: Types.ObjectId[];
  budgetRange?: string;
  sourcePath?: string;
  utm?: { source?: string; medium?: string; campaign?: string };
  /** Extra history entries after the first "created as new" one, e.g. a contacted step. */
  history?: Array<{ to: LeadStatus; at?: Date }>;
  convertedClientId?: Types.ObjectId;
  convertedProjectId?: Types.ObjectId;
}

export async function makeLead(o: LeadOverrides = {}): Promise<LeadDoc> {
  const i = next();
  const createdAt = o.createdAt ?? new Date();
  const email = o.email ?? `visitor${i}@example.com`;
  const message = o.message ?? `We would like a quote for project number ${i}, please get in touch.`;
  const status = o.status ?? 'new';
  // Walk the history so it is consistent with the status unless the test says otherwise.
  const steps: Array<{ to: LeadStatus; at?: Date }> = o.history ?? (status === 'new' ? [] : [{ to: status }]);
  let from: LeadStatus = 'new';
  const statusHistory = [
    { from: null, to: 'new' as LeadStatus, at: createdAt, by: SYSTEM },
    ...steps.map((s) => {
      const entry = { from, to: s.to, at: s.at ?? createdAt, by: SYSTEM };
      from = s.to;
      return entry;
    }),
  ];
  const doc = await Lead.create({
    ref: await nextRef('lead'),
    name: o.name ?? `Visitor ${i}`,
    email,
    phone: o.phone,
    company: o.company,
    country: o.country,
    message,
    serviceIds: o.serviceIds ?? [],
    budgetRange: o.budgetRange,
    sourcePath: o.sourcePath,
    utm: o.utm,
    status,
    statusHistory,
    assignedTo: o.assignedTo,
    followUpOn: o.followUpOn,
    firstResponseAt: o.firstResponseAt,
    convertedClientId: o.convertedClientId,
    convertedProjectId: o.convertedProjectId,
    messageHash: messageHashOf(email, message),
    createdAt,
  });
  return doc.toObject();
}

export async function makeService(o: { title?: string; status?: ContentStatus } = {}) {
  const i = next();
  const doc = await Service.create({
    title: o.title ?? `Service ${i}`,
    slug: `service-${i}`,
    summary: 'A test service.',
    status: o.status ?? 'published',
    createdBy: SYSTEM,
  });
  return doc.toObject();
}

/** A body the public form would send: a token issued `ageMs` before `now`, and a complete valid enquiry. */
export function intakeBody(now: Date, o: { ageMs?: number; fields?: Record<string, unknown> } = {}): Record<string, unknown> {
  return {
    formToken: signFormToken(now.getTime() - (o.ageMs ?? 10_000)),
    name: 'Neha Verma',
    email: 'Neha@Example.com',
    message: 'We need a customer portal for our logistics business. Can we talk this week?',
    ...o.fields,
  };
}

/** A calendar date (UTC midnight) from "YYYY-MM-DD". */
export const dateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`);
