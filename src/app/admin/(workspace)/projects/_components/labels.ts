import type { PricingModelKey } from './types';

/** Words for the codes in the data. Pure, so server and client components share them. */
export const PROJECT_TYPE_LABELS: Record<string, string> = {
  website: 'Website',
  web_app: 'Web app',
  saas: 'SaaS',
  mobile_app: 'Mobile app',
  custom_software: 'Custom software',
  uiux: 'UI/UX design',
  devops: 'DevOps',
  maintenance: 'Maintenance',
};

export const PRICING_LABELS: Record<PricingModelKey, string> = {
  fixed: 'Fixed price',
  milestone: 'By milestone',
  hourly: 'Hourly',
  retainer: 'Monthly retainer',
};

export const PRICING_HINTS: Record<PricingModelKey, string> = {
  fixed: 'One price for the whole project. Milestones, if any, split it into invoices.',
  milestone: 'The contract value is split into milestones that are invoiced as each is reached.',
  hourly: 'Billed by the hour. Add one milestone for each invoice you send.',
  retainer: 'A monthly fee. Add one milestone for each invoice you send.',
};

export const PRIORITY_LABELS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
export const HEALTH_LABELS: Record<string, string> = { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' };

export const typeLabel = (type: string) => PROJECT_TYPE_LABELS[type] ?? type;

/** Segment colours for the projects-by-status bar. The legend carries the words and counts, so colour is never alone. */
export const STATUS_COLORS: Record<string, string> = {
  proposal: '#9aa1b0',
  active: '#2d4b8e',
  in_review: '#6a4a98',
  on_hold: '#a3680b',
  delivered: '#1d6b49',
  maintenance: '#5f9c80',
  closed: '#5d6679',
  cancelled: '#b3301d',
};

/** Only http(s) addresses are rendered as links. The API enforces it too; this is the second lock. */
export function safeHref(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : null;
}
