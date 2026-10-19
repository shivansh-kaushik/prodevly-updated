import type { ClientSession } from 'mongoose';
import { fiscalYearLabel } from '@/lib/dates/fiscal-year';
import { nextSequence } from '@/models';
import { loadSettings } from './settings.service';

/**
 * Human-readable references from atomic counters. Plain kinds count forever
 * (CL-0007, PRJ-0042); money kinds restart each financial year (PAY-FY27-0001).
 */
const PLAIN = { client: 'CL', project: 'PRJ', thirdParty: 'TP', workOrder: 'WO', lead: 'ENQ' } as const;
const FISCAL = { payment: 'PAY', thirdPartyPayout: 'TPP', expense: 'EXP', teamPayout: 'TMP' } as const;

export type PlainRefKind = keyof typeof PLAIN;
export type FiscalRefKind = keyof typeof FISCAL;

const pad = (n: number, width: number) => String(n).padStart(width, '0');

export function formatRef(prefix: string, seq: number, fiscal?: string): string {
  return fiscal ? `${prefix}-${fiscal}-${pad(seq, 4)}` : `${prefix}-${pad(seq, 4)}`;
}

export async function nextRef(kind: PlainRefKind, session?: ClientSession): Promise<string> {
  return formatRef(PLAIN[kind], await nextSequence(kind, session));
}

export async function nextFiscalRef(kind: FiscalRefKind, date: Date, session?: ClientSession): Promise<string> {
  // The reference restarts with the ORGANISATION's financial year (Settings), not a hard-coded April.
  const { fyStartMonth, timezone } = await loadSettings(session);
  const fy = fiscalYearLabel(date, fyStartMonth, timezone);
  return formatRef(FISCAL[kind], await nextSequence(`${kind}:${fy}`, session), fy);
}

/** PRJ-0042-T007: tasks count per project. */
export async function nextTaskRef(projectRef: string, session?: ClientSession): Promise<string> {
  return `${projectRef}-T${pad(await nextSequence(`task:${projectRef}`, session), 3)}`;
}
