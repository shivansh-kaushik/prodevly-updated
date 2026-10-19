import { Types } from 'mongoose';
import {
  ClientPayment,
  Expense,
  FxRate,
  Settings,
  SETTINGS_ID,
  TeamPayout,
  ThirdPartyPayout,
  type ClientPaymentDoc,
  type ExpenseDoc,
  type MoneyDoc,
  type ThirdPartyPayoutDoc,
} from '@/models';
import type { FetchLike } from '@/services/fx.service';
import type { SettingsDTO } from '@/services/settings.service';
import { makeAdmin } from './factories';
import { makeClient, makeProject, makeThirdParty } from './domain-factories';

/** Fixtures for the Settings and FX module. They write straight to the database, past the services. */
const TESTER = { id: null, name: 'Test' };
let n = 0;
const next = () => ++n;

export const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Creates or updates the settings document with only the fields given (the rest take the model defaults). */
export async function setSettings(patch: Partial<SettingsDTO> = {}): Promise<void> {
  await Settings.findOneAndUpdate({ _id: SETTINGS_ID }, { $set: patch }, { upsert: true, setDefaultsOnInsert: true });
}

export async function makeFxRate(o: { currency: string; on: string; rate: number; source?: 'manual' | 'ecb' }) {
  const doc = await FxRate.create({
    currency: o.currency,
    rateOn: day(o.on),
    rate: o.rate,
    source: o.source ?? 'manual',
    enteredBy: o.source === 'ecb' ? { id: null, name: 'ECB rates feed' } : TESTER,
  });
  return doc.toObject();
}

/** A coherent Money subdocument. USD 1,000.00 at 83.42 is INR 83,420.00. */
export function moneyOf(fxSource: 'identity' | 'table' | 'manual' | 'bank', o: Partial<MoneyDoc> = {}): MoneyDoc {
  if (fxSource === 'identity') {
    const amountMinor = o.amountMinor ?? 50_000;
    return { amountMinor, currency: 'INR', fxRate: 1, fxDate: day('2026-10-01'), fxSource, inrMinor: amountMinor, ...o };
  }
  return { amountMinor: 100_000, currency: 'USD', fxRate: 83.42, fxDate: day('2026-10-01'), fxSource, inrMinor: 8_342_000, ...o };
}

export type LedgerKind = 'clientPayment' | 'thirdPartyPayout' | 'expense' | 'teamPayout';

export interface LedgerOptions {
  amount: MoneyDoc;
  status?: string;
  /** receivedOn / spentOn for payments and expenses; paidOn for payouts. */
  on?: string;
  dueOn?: string;
}

/** One entry in one of the four money ledgers, with the least a valid document needs. */
export async function makeLedgerEntry(kind: LedgerKind, o: LedgerOptions): Promise<void> {
  const i = next();
  const ref = `T-${kind}-${i}`;
  const void_ = o.status === 'void' ? { voidReason: 'Entered in error' } : {};
  switch (kind) {
    case 'clientPayment': {
      const client = await makeClient();
      const project = await makeProject(client);
      await ClientPayment.create({
        ref, type: 'receipt', clientId: client._id, projectId: project._id, amount: o.amount,
        contractEquivalentMinor: o.amount.amountMinor, receivedOn: day(o.on ?? '2026-10-05'), mode: 'bank_transfer',
        status: (o.status ?? 'received') as ClientPaymentDoc['status'], recordedBy: TESTER, ...void_,
      });
      return;
    }
    case 'expense':
      await Expense.create({
        ref, scope: 'company', category: 'other', description: 'Test expense', amount: o.amount, spentOn: day(o.on ?? '2026-10-05'),
        paidFrom: 'company', status: (o.status ?? 'approved') as ExpenseDoc['status'], recordedBy: TESTER,
        ...(o.status === 'rejected' ? { rejectReason: 'Not allowed' } : {}), ...void_,
      });
      return;
    case 'thirdPartyPayout': {
      const client = await makeClient();
      const project = await makeProject(client);
      const vendor = await makeThirdParty();
      await ThirdPartyPayout.create({
        ref, thirdPartyId: vendor._id, thirdPartyName: vendor.name, clientId: client._id, projectId: project._id, amount: o.amount,
        status: (o.status ?? 'paid') as ThirdPartyPayoutDoc['status'], paidOn: o.on ? day(o.on) : undefined, dueOn: o.dueOn ? day(o.dueOn) : undefined,
        recordedBy: TESTER, ...void_,
      });
      return;
    }
    case 'teamPayout': {
      const person = await makeAdmin();
      await TeamPayout.create({
        ref, adminId: person._id, adminName: person.name, basis: 'salary', periodFrom: day('2026-09-01'), periodTo: day('2026-09-30'),
        amount: o.amount, status: (o.status ?? 'paid') as ThirdPartyPayoutDoc['status'], paidOn: o.on ? day(o.on) : undefined, dueOn: o.dueOn ? day(o.dueOn) : undefined,
        recordedBy: TESTER, ...void_,
      });
    }
  }
}

/** What Frankfurter answers for `latest?base=<currency>&symbols=INR`. */
export const feedBody = (base: string, date: string, inr: number) => ({ amount: 1, base, date, rates: { INR: inr } });

export type FeedAnswer = unknown | { status: number; body?: unknown } | Error;

/**
 * A fake rate feed: `answers` maps a base currency to what the feed says (a body object, a
 * `{ status }` for an HTTP error, or an Error to throw). Records every URL asked, so a test can
 * check which base and symbols were requested. No network is ever touched.
 */
export function fakeFeed(answers: Record<string, FeedAnswer>): { fetchImpl: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    urls.push(url);
    const base = new URL(url).searchParams.get('base') ?? '';
    const answer = answers[base];
    if (answer instanceof Error) throw answer;
    if (answer === undefined) return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
    if (typeof answer === 'object' && answer !== null && 'status' in answer && typeof (answer as { status: unknown }).status === 'number') {
      const { status, body } = answer as { status: number; body?: unknown };
      return new Response(JSON.stringify(body ?? { message: 'error' }), { status });
    }
    return new Response(typeof answer === 'string' ? answer : JSON.stringify(answer), { status: 200 });
  };
  return { fetchImpl, urls };
}

export const newObjectId = () => new Types.ObjectId();
