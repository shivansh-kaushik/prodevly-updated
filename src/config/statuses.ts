/** Status enums and the transitions the services allow. Models, services and UI all import from here. */

export const CLIENT_STATUSES = ['prospect', 'active', 'paused', 'past'] as const;
export const CLIENT_KINDS = ['company', 'individual'] as const;
export const CLIENT_SOURCES = ['enquiry', 'referral', 'repeat', 'direct', 'other'] as const;

export const PROJECT_TYPES = [
  'website',
  'web_app',
  'saas',
  'mobile_app',
  'custom_software',
  'uiux',
  'devops',
  'maintenance',
] as const;

export const PROJECT_STATUSES = [
  'proposal',
  'active',
  'in_review',
  'on_hold',
  'delivered',
  'maintenance',
  'closed',
  'cancelled',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_HEALTH = ['on_track', 'at_risk', 'off_track'] as const;
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const PRICING_MODELS = ['fixed', 'milestone', 'hourly', 'retainer'] as const;
export const MILESTONE_STATUSES = ['pending', 'invoiced', 'paid'] as const;

/**
 * Allowed project status moves. Reopening a closed or cancelled project is
 * superadmin-only, and moves to on_hold, cancelled or a reopen need a note.
 */
export const PROJECT_TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  proposal: ['active', 'cancelled'],
  active: ['in_review', 'on_hold', 'cancelled'],
  in_review: ['active', 'delivered'],
  delivered: ['maintenance', 'closed', 'active'],
  maintenance: ['closed'],
  on_hold: ['active', 'cancelled'],
  closed: ['active'],
  cancelled: ['active'],
};

export const TASK_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const ASSIGNEE_KINDS = ['admin', 'thirdParty'] as const;

export const ADMIN_STATUSES = ['active', 'deactivated'] as const;
export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'intern', 'contract'] as const;
export const PAY_BASES = ['monthly', 'hourly', 'per_task', 'none'] as const;

export const PAYMENT_TYPES = ['receipt', 'refund'] as const;
export const PAYMENT_STATUSES = ['received', 'void'] as const;
export const PAYOUT_STATUSES = ['due', 'paid', 'void'] as const;
export const WORK_ORDER_STATUSES = ['open', 'delivered', 'closed', 'cancelled'] as const;
export const EXPENSE_SCOPES = ['company', 'project'] as const;
export const EXPENSE_STATUSES = ['submitted', 'approved', 'paid', 'rejected', 'void'] as const;
export const EXPENSE_PAID_FROM = ['company', 'admin'] as const;
export const TEAM_PAYOUT_BASES = ['salary', 'hours', 'tasks', 'bonus', 'other'] as const;

export const FX_SOURCES = ['identity', 'table', 'bank', 'manual'] as const;
export const FX_RATE_SOURCES = ['manual', 'ecb'] as const;

export const DEFAULT_PAYMENT_MODES = [
  'bank_transfer',
  'upi',
  'cash',
  'cheque',
  'card',
  'paypal',
  'wise',
  'payoneer',
  'other',
] as const;

export const DEFAULT_EXPENSE_CATEGORIES = [
  'software_subscriptions',
  'hosting_domains',
  'hardware',
  'travel',
  'office',
  'marketing',
  'fees_taxes',
  'other',
] as const;

export const DEFAULT_THIRD_PARTY_TYPES = ['freelancer', 'agency', 'vendor', 'contractor'] as const;

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'proposal_sent', 'won', 'lost', 'spam'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Public website content moves draft -> published -> archived (and back to draft). */
export const CONTENT_STATUSES = ['draft', 'published', 'archived'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];
export const PARTNER_KINDS = ['technology', 'agency', 'client'] as const;
export const PRICE_MODELS = ['fixed_from', 'per_month', 'per_hour', 'quote'] as const;
export const MEDIA_VISIBILITIES = ['public', 'private'] as const;
