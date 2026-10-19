import { MAX_BIO_LENGTH } from './types';

/**
 * The rules a record must meet before it may be PUBLISHED. Pure functions over plain values, so
 * the service (which enforces them), the dashboard (which counts drafts that fail them) and the
 * editors (which explain them) all read the same rule. Each returns problems keyed by the field
 * at fault; an empty object means "ready".
 *
 * Permission ticks exist because the public site must never show a client, partner or person
 * who has not agreed. They are plain booleans, so these gates are what actually protect them.
 */
export type GateProblems = Record<string, string>;

export function showcaseGate(d: { clientApproved?: boolean }): GateProblems {
  return d.clientApproved ? {} : { clientApproved: 'Confirm the client has approved showing this project' };
}

export function partnerGate(d: { permissionConfirmed?: boolean }): GateProblems {
  return d.permissionConfirmed ? {} : { permissionConfirmed: 'Confirm this partner has given permission to be shown' };
}

export function developerGate(d: { consentConfirmed?: boolean; bio?: string | null }): GateProblems {
  const out: GateProblems = {};
  if (!d.consentConfirmed) out.consentConfirmed = 'Confirm this person has agreed to be shown';
  if ((d.bio ?? '').length > MAX_BIO_LENGTH) out.bio = `Keep the bio to ${MAX_BIO_LENGTH} characters`;
  return out;
}

export function pricingGate(d: { priceModel?: string; amountMinor?: number | null; currency?: string | null }): GateProblems {
  if (d.priceModel === 'quote') return {};
  const out: GateProblems = {};
  if (!d.amountMinor || d.amountMinor <= 0) out.amountMinor = 'Enter a price, or choose "Quote" to show no number';
  if (!d.currency) out.currency = 'Choose a currency';
  return out;
}

/** Services have no permission tick: a title and summary are required to save at all. */
export function serviceGate(): GateProblems {
  return {};
}

export const blockersOf = (problems: GateProblems): string[] => Object.values(problems);
