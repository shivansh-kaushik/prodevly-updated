import { Types } from 'mongoose';
import type { PAY_BASES } from '@/config/statuses';
import { connectToDatabase, withTransaction } from '@/lib/db/mongoose';
import { assertCapability, assertStepUp } from '@/lib/auth/guard';
import { forbidden, notFound, selfAction, validationFailed } from '@/lib/api/errors';
import { addDays, formatDateOnly, parseDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { fieldErrors, parseObjectId } from '@/lib/validation/common';
import { payProfileSchema, type PayProfileInput } from '@/lib/validation/team';
import { Admin, PayProfile, type PayProfileDoc } from '@/models';
import type { PayHistoryEntry } from '@/models/pay-profile.model';
import type { ActorDoc } from '@/models/shared.schema';
import type { SessionUser } from '@/types/session';
import type { ServiceMeta } from './admin.service';
import { audit, diffFields, type AuditActor } from './audit.service';
import { getSettings } from './settings.service';

/**
 * Pay profiles: how each person is paid. Kept in their own collection so pay never rides along
 * with a directory or session read; nothing in `team.service.ts` imports this file.
 *
 * - Reading: a person reads their OWN basis and rate. `team:payView` (superadmins only: it is not
 *   grantable) reads anyone's, with the history and the payout note. Nobody else reads anything.
 * - Writing: `team:payView` AND a recent step-up, and never on your own profile (SELF_ACTION),
 *   which holds for superadmins too.
 * - Every change runs in one transaction with its audit entry.
 */

type PayBasis = (typeof PAY_BASES)[number];

export interface PayTerms {
  basis: PayBasis;
  rateMinor: number;
  currency: string;
}

export interface PayHistoryDTO extends PayTerms {
  effectiveFrom: string;
  /** The last day these terms applied. */
  effectiveTo: string;
  changedBy: string;
}

export interface PayProfileDTO extends PayTerms {
  adminId: string;
  adminName: string;
  /** False until somebody records a profile: the terms then read "no pay basis". */
  exists: boolean;
  effectiveFrom: string | null;
  updatedAt: string | null;
  /** Only for a viewer with `team:payView`. */
  history?: PayHistoryDTO[];
  /** Only for a viewer with `team:payView`. */
  payoutNote?: string | null;
}

const actorOf = (admin: SessionUser): AuditActor => ({ id: admin.id, name: admin.name, role: admin.role });
const isSelf = (viewer: SessionUser, id: string) => viewer.id.toLowerCase() === id;
const iso = (d: Date) => formatDateOnly(d);

/** The mutable core of a profile, as plain values the change planner can reason about. */
export interface PayState extends PayTerms {
  effectiveFrom: Date;
  history: PayHistoryEntry[];
}

export type PayChangeKind = 'start' | 'new_period' | 'correct' | 'redate' | 'none';

const sameTerms = (a: PayTerms, b: PayTerms) => a.basis === b.basis && a.rateMinor === b.rateMinor && a.currency === b.currency;

/**
 * Works out what a PUT means for the history. Pure (no clock, no database) so the rules are tested directly.
 *
 * History holds terms that were in force and have been replaced, contiguous and non-overlapping:
 * each entry ends the day before the next one starts, and the last ends the day before the current terms.
 * `today` is the organisation's calendar date; a start date after it is refused, so the current terms
 * are always the ones in force and there is nothing "scheduled" to get stuck.
 *
 *  - no profile yet                       -> `start`
 *  - terms unchanged, same start date     -> `none` (only the note may have changed)
 *  - terms unchanged, new start date      -> `redate`: a correction; the previous period stretches to meet it
 *  - terms changed, same start date       -> `correct`: replaced in place, no zero-length period in history
 *  - terms changed, later start date      -> `new_period`: the old terms go to history, ending the day before
 *  - terms changed, EARLIER start date    -> refused: terms already in force cannot be replaced retroactively
 */
export function applyPayChange(
  current: PayState | null,
  next: PayTerms & { effectiveFrom: Date },
  changedBy: ActorDoc,
  today: Date,
): { kind: PayChangeKind; state: PayState } {
  if (next.effectiveFrom.getTime() > today.getTime()) {
    throw validationFailed({ effectiveFrom: 'The start date cannot be in the future' });
  }
  const terms: PayTerms = { basis: next.basis, rateMinor: next.rateMinor, currency: next.currency };
  if (!current) return { kind: 'start', state: { ...terms, effectiveFrom: next.effectiveFrom, history: [] } };

  const from = current.effectiveFrom.getTime();
  const to = next.effectiveFrom.getTime();
  const history = current.history.map((h) => ({ ...h }));

  if (sameTerms(current, terms)) {
    if (to === from) return { kind: 'none', state: { ...current, history } };
    const last = history.at(-1);
    if (last) {
      if (to <= last.effectiveFrom.getTime()) {
        throw validationFailed({ effectiveFrom: `Must be after ${iso(last.effectiveFrom)}, when the earlier terms began` });
      }
      last.effectiveTo = addDays(next.effectiveFrom, -1);
    }
    return { kind: 'redate', state: { ...terms, effectiveFrom: next.effectiveFrom, history } };
  }

  if (to === from) return { kind: 'correct', state: { ...terms, effectiveFrom: next.effectiveFrom, history } };
  if (to < from) {
    throw validationFailed({
      effectiveFrom: `These terms have applied since ${iso(current.effectiveFrom)}. Use that date to correct them, or a later date for a change.`,
    });
  }
  history.push({
    basis: current.basis,
    rateMinor: current.rateMinor,
    currency: current.currency,
    effectiveFrom: current.effectiveFrom,
    effectiveTo: addDays(next.effectiveFrom, -1),
    changedBy,
  });
  return { kind: 'new_period', state: { ...terms, effectiveFrom: next.effectiveFrom, history } };
}

/**
 * The terms that applied on a calendar date ("YYYY-MM-DD"), or null when the date is before the
 * first record. This is what a payout suggestion should read, not the current terms: a payout for
 * March must use March's rate even after a raise in April.
 */
export function payTermsOn(
  profile: Pick<PayProfileDTO, 'exists' | 'effectiveFrom' | 'history'> & PayTerms,
  date: string,
): PayTerms | null {
  if (!profile.exists || !profile.effectiveFrom) return null;
  if (date >= profile.effectiveFrom) return { basis: profile.basis, rateMinor: profile.rateMinor, currency: profile.currency };
  const hit = profile.history?.find((h) => h.effectiveFrom <= date && date <= h.effectiveTo);
  return hit ? { basis: hit.basis, rateMinor: hit.rateMinor, currency: hit.currency } : null;
}

type ProfileLike = Pick<PayProfileDoc, 'basis' | 'rateMinor' | 'currency' | 'effectiveFrom' | 'history' | 'payoutNote' | 'updatedAt'>;

function toDTO(person: { id: string; name: string }, doc: ProfileLike | null, full: boolean): PayProfileDTO {
  const dto: PayProfileDTO = doc
    ? {
        adminId: person.id,
        adminName: person.name,
        exists: true,
        basis: doc.basis,
        rateMinor: doc.rateMinor,
        currency: doc.currency,
        effectiveFrom: iso(doc.effectiveFrom),
        updatedAt: doc.updatedAt.toISOString(),
      }
    : { adminId: person.id, adminName: person.name, exists: false, basis: 'none', rateMinor: 0, currency: 'INR', effectiveFrom: null, updatedAt: null };
  if (full) {
    dto.history = (doc?.history ?? []).map((h) => ({
      basis: h.basis,
      rateMinor: h.rateMinor,
      currency: h.currency,
      effectiveFrom: iso(h.effectiveFrom),
      effectiveTo: iso(h.effectiveTo),
      changedBy: h.changedBy.name,
    }));
    dto.payoutNote = doc?.payoutNote ?? null;
  }
  return dto;
}

/**
 * A person reads their own basis and rate; `team:payView` reads anyone's in full (history and the
 * payout note). Anyone else is refused.
 */
export async function getPayProfile(viewer: SessionUser, adminId: string): Promise<PayProfileDTO> {
  const id = parseObjectId(adminId);
  const full = viewer.capabilities.has('team:payView');
  if (!full && !isSelf(viewer, id)) throw forbidden('Your access does not allow this action');

  await connectToDatabase();
  const person = await Admin.findById(id).select('name').lean();
  if (!person) throw notFound('We could not find that person');
  const query = PayProfile.findOne({ adminId: id });
  if (full) query.select('+payoutNote');
  const doc = await query.lean();
  return toDTO({ id, name: person.name }, doc, full);
}

const SUMMARY: Record<Exclude<PayChangeKind, 'none'> | 'note', (from: string) => string> = {
  start: () => 'Recorded the first pay profile',
  new_period: (from) => `New pay terms from ${from}`,
  correct: () => 'Corrected the current pay terms',
  redate: (from) => `Moved the start date to ${from}`,
  note: () => 'Updated the payout note',
};

/**
 * Sets how a person is paid from a date. Needs `team:payView` and a recent step-up and is refused on
 * your own profile. A change of terms from a later date moves the old terms into history; see `applyPayChange`.
 */
export async function putPayProfile(
  viewer: SessionUser,
  adminId: string,
  input: PayProfileInput,
  meta: ServiceMeta = {},
  now = new Date(),
): Promise<PayProfileDTO> {
  assertCapability(viewer, 'team:payView');
  const id = parseObjectId(adminId);
  if (isSelf(viewer, id)) throw selfAction('You cannot change your own pay profile');
  assertStepUp(viewer);

  // The route validated already; a direct caller must not be able to skip the rules.
  const parsed = payProfileSchema.safeParse(input);
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  const body = parsed.data;
  const effectiveFrom = parseDateOnly(body.effectiveFrom);
  if (!effectiveFrom) throw validationFailed({ effectiveFrom: 'That is not a real date' });

  const settings = await getSettings();
  if (body.currency !== 'INR' && !settings.enabledCurrencies.includes(body.currency)) {
    throw validationFailed({ currency: 'That currency is not enabled in Settings' });
  }
  const today = todayDateOnly(now, settings.timezone);

  return withTransaction(async (session) => {
    const person = await Admin.findById(id).select('name').session(session).lean();
    if (!person) throw notFound('We could not find that person');
    const doc = await PayProfile.findOne({ adminId: id }).select('+payoutNote').session(session);

    const by: ActorDoc = { id: new Types.ObjectId(viewer.id), name: viewer.name };
    const next = { basis: body.basis, rateMinor: body.rateMinor, currency: body.currency, effectiveFrom };
    // Plain values, not subdocuments: the planner copies and compares them.
    const plain = doc?.toObject();
    const current: PayState | null = plain
      ? { basis: plain.basis, rateMinor: plain.rateMinor, currency: plain.currency, effectiveFrom: plain.effectiveFrom, history: plain.history }
      : null;
    const plan = applyPayChange(current, next, by, today);

    const noteBefore = doc?.payoutNote ?? undefined;
    const noteAfter = body.payoutNote === undefined ? noteBefore : body.payoutNote || undefined;
    const noteChanged = (noteAfter ?? '') !== (noteBefore ?? '');
    const who = { id, name: person.name };
    if (plain && plan.kind === 'none' && !noteChanged) return toDTO(who, plain, true); // nothing to save, nothing to audit

    const before = doc ? { basis: doc.basis, rateMinor: doc.rateMinor, currency: doc.currency, effectiveFrom: iso(doc.effectiveFrom), payoutNote: noteBefore } : {};
    let saved: PayProfileDoc;
    if (!doc) {
      const [created] = await PayProfile.create(
        [{ adminId: id, ...plan.state, payoutNote: noteAfter, createdBy: by, updatedBy: by }],
        { session },
      );
      if (!created) throw new Error('Pay profile was not created');
      saved = created.toObject();
    } else {
      doc.basis = plan.state.basis;
      doc.rateMinor = plan.state.rateMinor;
      doc.currency = plan.state.currency;
      doc.effectiveFrom = plan.state.effectiveFrom;
      if (plan.kind === 'new_period' || plan.kind === 'redate') doc.history = plan.state.history;
      doc.payoutNote = noteAfter;
      doc.updatedBy = by;
      await doc.save({ session });
      saved = doc.toObject();
    }

    const after = { basis: saved.basis, rateMinor: saved.rateMinor, currency: saved.currency, effectiveFrom: iso(saved.effectiveFrom), payoutNote: saved.payoutNote };
    await audit(
      {
        actor: actorOf(viewer),
        action: doc ? 'payProfile.update' : 'payProfile.create',
        entity: { type: 'payProfile', id: String(saved._id), label: person.name },
        summary: SUMMARY[plan.kind === 'none' ? 'note' : plan.kind](iso(saved.effectiveFrom)),
        // The note is redacted by the audit helper; the terms are not, because the audit log is superadmin-only.
        changes: diffFields(before, after, ['basis', 'rateMinor', 'currency', 'effectiveFrom', 'payoutNote']),
        meta,
      },
      session,
    );
    return toDTO(who, saved, true);
  });
}
