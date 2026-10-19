import { Types, type ClientSession } from 'mongoose';
import { mongoose, connectToDatabase } from '@/lib/db/mongoose';
import { assertCapability } from '@/lib/auth/guard';
import { notFound, validationFailed } from '@/lib/api/errors';
import { formatDate } from '@/lib/admin/format';
import { addDays, formatDateOnly, parseDateOnly } from '@/lib/dates/date-only';
import { startOfDayInstant } from '@/lib/dates/ranges';
import { apportion } from '@/lib/money/apportion';
import { fieldErrors, parseObjectId } from '@/lib/validation/common';
import {
  MAX_PERIOD_DAYS,
  payoutBasisFor,
  suggestionQuerySchema,
  type SuggestionQuery,
  type TeamPayoutBasis,
} from '@/lib/validation/team-payout';
import { Admin, PayProfile, Task, TeamPayout, WorkLog } from '@/models';
import type { SessionUser } from '@/types/session';
import { payTermsOn, type PayTerms } from './pay-profile.service';
import { getSettings } from './settings.service';
import { projectBriefs, type TaskProjectDTO } from './task.service';

/**
 * What a person's pay profile proposes for a period (plan section 6), and the facts it is made of. Split out of
 * `team-payout.service.ts` so the money rules and the proposal can each be read on their own; the payout service
 * re-exports the public pieces and takes the same facts when it records a payout (so the stored proposal is the one shown).
 *
 *   monthly: the rate.  hourly: minutes logged in the period / 60 x rate.  per task: tasks completed in the period x rate.
 *   none: nothing. The pay terms used are the ones in force on the LAST day of the period (a March payout uses March's rate
 *   even after an April raise); a change inside the period is reported as a warning.
 */

const DAY = 86_400_000;
const iso = (d: Date) => formatDateOnly(d);
const oid = (id: string) => new Types.ObjectId(id);

export interface StoredSuggestion {
  minutes: number;
  taskCount: number;
  rateMinor: number;
  currency: string;
  computedMinor: number;
}

export const UNKNOWN_PROJECT = (id: Types.ObjectId): TaskProjectDTO => ({ id: String(id), ref: '', name: 'Unknown project', clientId: '', clientName: '', archived: false });

export interface Facts {
  minutes: number;
  /** Minutes per project, biggest first. */
  byProject: Array<{ projectId: Types.ObjectId; clientId: Types.ObjectId; minutes: number }>;
  /** Tasks the person is on that were completed (moved to done) inside the period. */
  taskCount: number;
  /** Their logs inside the period that a paid payout already covers. */
  lockedLogs: number;
}

/**
 * What the person did in the period. Sequential on purpose: inside a transaction one session cannot run
 * operations in parallel. Aggregation stages are not sanitised, so every value here is a parsed Date or ObjectId.
 */
export async function loadFacts(adminId: Types.ObjectId, from: Date, to: Date, timeZone: string, session?: ClientSession): Promise<Facts> {
  const rows = await WorkLog.aggregate<{ _id: Types.ObjectId; clientId: Types.ObjectId; minutes: number }>([
    { $match: { adminId, workedOn: { $gte: from, $lte: to } } },
    { $group: { _id: '$projectId', clientId: { $first: '$clientId' }, minutes: { $sum: '$minutes' } } },
    { $sort: { minutes: -1, _id: 1 } },
  ]).session(session ?? null);

  // `completedAt` is an instant; the period is calendar dates in the organisation's zone, end inclusive.
  const taskCount = await Task.countDocuments({
    status: 'done',
    completedAt: mongoose.trusted({ $gte: startOfDayInstant(from, timeZone), $lt: startOfDayInstant(addDays(to, 1), timeZone) }),
    assignees: mongoose.trusted({ $elemMatch: { kind: 'admin', id: adminId } }),
  }).session(session ?? null);

  const lockedLogs = await WorkLog.countDocuments({
    adminId,
    workedOn: mongoose.trusted({ $gte: from, $lte: to }),
    lockedByPayoutId: mongoose.trusted({ $exists: true }),
  }).session(session ?? null);

  return {
    minutes: rows.reduce((s, r) => s + r.minutes, 0),
    byProject: rows.map((r) => ({ projectId: r._id, clientId: r.clientId, minutes: r.minutes })),
    taskCount,
    lockedLogs,
  };
}

/** The amount a basis proposes, in the profile's currency. Integer maths: hours are minutes / 60, rounded half up to the minor unit. */
export function computeSuggestedMinor(terms: PayTerms, minutes: number, taskCount: number): number | null {
  if (terms.basis === 'none' || terms.rateMinor <= 0) return null;
  let value: number;
  if (terms.basis === 'monthly') value = terms.rateMinor;
  else if (terms.basis === 'hourly') {
    const numerator = BigInt(minutes) * BigInt(terms.rateMinor);
    value = Number((numerator * BigInt(2) + BigInt(60)) / BigInt(120));
  } else value = taskCount * terms.rateMinor;
  return Number.isSafeInteger(value) ? value : null;
}

export interface PayoutSuggestionDTO {
  adminId: string;
  adminName: string;
  periodFrom: string;
  periodTo: string;
  /** The pay terms the proposal used (in force on the last day of the period), or null when the person had none. */
  terms: PayTerms | null;
  /** What `terms.basis` means as a payout basis ("monthly" is "salary"), or null. */
  payoutBasis: TeamPayoutBasis | null;
  minutes: number;
  taskCount: number;
  /** The proposed amount in `terms.currency`, or null when there is nothing to propose. */
  computedMinor: number | null;
  /** What would be stored with the payout, or null. */
  suggestion: StoredSuggestion | null;
  /** Where the person's time went, biggest first: the basis of the proposed split. */
  projects: Array<{ projectId: string; projectRef: string; projectName: string; clientId: string; clientName: string; minutes: number; archived: boolean }>;
  /** The whole proposed amount shared across `projects` in proportion to the minutes (in `terms.currency`). Empty without a proposal. */
  proposedAllocations: Array<{ projectId: string; amountMinor: number }>;
  warnings: string[];
}

export interface SuggestionCore {
  terms: PayTerms | null;
  startTerms: PayTerms | null;
  payoutBasis: TeamPayoutBasis | null;
  computedMinor: number | null;
  suggestion: StoredSuggestion | null;
  facts: Facts;
  noProfile: boolean;
}

export async function computeSuggestion(adminId: Types.ObjectId, from: Date, to: Date, timeZone: string, session?: ClientSession): Promise<SuggestionCore> {
  const profile = await PayProfile.findOne({ adminId }).session(session ?? null).lean();
  const facts = await loadFacts(adminId, from, to, timeZone, session);
  const like = {
    exists: Boolean(profile),
    basis: profile?.basis ?? ('none' as const),
    rateMinor: profile?.rateMinor ?? 0,
    currency: profile?.currency ?? 'INR',
    effectiveFrom: profile ? iso(profile.effectiveFrom) : null,
    history: (profile?.history ?? []).map((h) => ({
      basis: h.basis,
      rateMinor: h.rateMinor,
      currency: h.currency,
      effectiveFrom: iso(h.effectiveFrom),
      effectiveTo: iso(h.effectiveTo),
      changedBy: h.changedBy.name,
    })),
  };
  const end = payTermsOn(like, iso(to));
  const startTerms = payTermsOn(like, iso(from));
  const usable = end && end.basis !== 'none' ? end : null;
  const computedMinor = usable ? computeSuggestedMinor(usable, facts.minutes, facts.taskCount) : null;
  return {
    terms: usable,
    startTerms,
    payoutBasis: usable ? payoutBasisFor(usable.basis) : null,
    computedMinor,
    suggestion:
      usable && computedMinor !== null
        ? { minutes: facts.minutes, taskCount: facts.taskCount, rateMinor: usable.rateMinor, currency: usable.currency, computedMinor }
        : null,
    facts,
    noProfile: !profile,
  };
}

/** The suggestion belongs on a payout only when the payout is the kind the profile proposes (a bonus is not a salary suggestion). */
export const storableSuggestion = (core: SuggestionCore, basis: TeamPayoutBasis): StoredSuggestion | undefined =>
  core.suggestion && core.payoutBasis === basis ? core.suggestion : undefined;

export function parsePeriod(from: string, to: string): { from: Date; to: Date } {
  const f = parseDateOnly(from);
  const t = parseDateOnly(to);
  if (!f) throw validationFailed({ periodFrom: 'Enter a valid date' });
  if (!t) throw validationFailed({ periodTo: 'Enter a valid date' });
  assertPeriod(f, t);
  return { from: f, to: t };
}

export function assertPeriod(from: Date, to: Date): void {
  if (to < from) throw validationFailed({ periodTo: 'The period cannot end before it starts' });
  if ((to.getTime() - from.getTime()) / DAY + 1 > MAX_PERIOD_DAYS) {
    throw validationFailed({ periodTo: `A payout covers at most ${MAX_PERIOD_DAYS} days. Split a longer period into several payouts.` });
  }
}

/**
 * The proposal for a person and period (the form calls this before it has an amount). Needs `teamPayout:record` and `team:payView`:
 * it reads pay terms, which only a superadmin may see. A person with no pay basis gets facts and a split, never an amount.
 */
export async function getPayoutSuggestion(viewer: SessionUser, query: SuggestionQuery): Promise<PayoutSuggestionDTO> {
  assertCapability(viewer, 'teamPayout:record');
  assertCapability(viewer, 'team:payView');
  const parsed = suggestionQuerySchema.safeParse(query);
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  const adminId = oid(parseObjectId(parsed.data.adminId));
  const { from, to } = parsePeriod(parsed.data.from, parsed.data.to);
  await connectToDatabase();
  const settings = await getSettings();

  const person = await Admin.findById(adminId).select('name').lean();
  if (!person) throw notFound('We could not find that person');
  const core = await computeSuggestion(adminId, from, to, settings.timezone);
  const projects = await projectBriefs(core.facts.byProject.map((p) => p.projectId));

  const warnings: string[] = [];
  if (core.noProfile) warnings.push(`${person.name} has no pay profile yet, so no amount is proposed. Enter the amount yourself.`);
  else if (!core.terms) warnings.push(`${person.name} had no pay basis during this period, so no amount is proposed. Enter the amount yourself.`);
  else if (core.startTerms && (core.startTerms.basis !== core.terms.basis || core.startTerms.rateMinor !== core.terms.rateMinor || core.startTerms.currency !== core.terms.currency)) {
    warnings.push(`The pay terms changed during this period. The proposal uses the terms in force on ${formatDate(to)}.`);
  }
  if (core.facts.lockedLogs > 0) {
    warnings.push(`${core.facts.lockedLogs} time ${core.facts.lockedLogs === 1 ? 'entry' : 'entries'} in this period ${core.facts.lockedLogs === 1 ? 'is' : 'are'} already covered by a paid payout and would be counted again.`);
  }
  const clashes = await TeamPayout.find({
    adminId,
    status: mongoose.trusted({ $ne: 'void' }),
    periodFrom: mongoose.trusted({ $lte: to }),
    periodTo: mongoose.trusted({ $gte: from }),
  })
    .select('ref periodFrom periodTo status')
    .sort({ periodFrom: 1 })
    .limit(5)
    .lean();
  for (const c of clashes) warnings.push(`${c.ref} already covers ${formatDate(c.periodFrom)} to ${formatDate(c.periodTo)} (${c.status}).`);

  const proposed = core.computedMinor && core.computedMinor > 0 ? apportion(core.computedMinor, core.facts.byProject.map((p) => p.minutes)) : [];
  return {
    adminId: String(adminId),
    adminName: person.name,
    periodFrom: iso(from),
    periodTo: iso(to),
    terms: core.terms,
    payoutBasis: core.payoutBasis,
    minutes: core.facts.minutes,
    taskCount: core.facts.taskCount,
    computedMinor: core.computedMinor,
    suggestion: core.suggestion,
    projects: core.facts.byProject.map((p) => {
      const b = projects.get(String(p.projectId)) ?? UNKNOWN_PROJECT(p.projectId);
      return { projectId: String(p.projectId), projectRef: b.ref, projectName: b.name, clientId: String(p.clientId), clientName: b.clientName, minutes: p.minutes, archived: b.archived };
    }),
    proposedAllocations: proposed.map((amountMinor, i) => ({ projectId: String(core.facts.byProject[i]?.projectId), amountMinor })),
    warnings,
  };
}
