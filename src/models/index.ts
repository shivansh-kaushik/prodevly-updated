/**
 * Importing this module registers every schema with Mongoose.
 *
 * Anything that touches the database imports from here, never from individual
 * model files: `populate()` and the index script need every model registered, and
 * a model is only registered when its file is evaluated.
 */
import '@/lib/db/mongoose'; // applies sanitizeFilter / strictQuery before any model is used

export { Admin, type AdminDoc } from './admin.model';
export { AuditLog, type AuditChange, type AuditLogDoc } from './audit-log.model';
export { Client, type ClientDoc } from './client.model';
export { ClientPayment, type ClientPaymentDoc } from './client-payment.model';
export { Counter, nextSequence, type CounterDoc } from './counter.model';
export { Expense, type ExpenseDoc } from './expense.model';
export { FxRate, type FxRateDoc } from './fx-rate.model';
export { Lead, type LeadDoc, type LeadNote } from './lead.model';
export { Media, type MediaDoc } from './media.model';
export { PayProfile, type PayProfileDoc } from './pay-profile.model';
export { Project, type ProjectDoc } from './project.model';
export { RateLimit, type RateLimitDoc } from './rate-limit.model';
export { SETTINGS_ID, Settings, type SettingsDoc } from './settings.model';
export {
  DeveloperProfile,
  Partner,
  PricingPlan,
  Service,
  ShowcaseItem,
  SITE_INFO_ID,
  SiteInfo,
  type DeveloperProfileDoc,
  type PartnerDoc,
  type PricingPlanDoc,
  type ServiceDoc,
  type ShowcaseItemDoc,
  type SiteInfoDoc,
} from './site-content.models';
export { Task, type TaskDoc } from './task.model';
export { TeamPayout, type TeamPayoutDoc } from './team-payout.model';
export { TeamRole, type TeamRoleDoc } from './team-role.model';
export { ThirdParty, type ThirdPartyDoc } from './third-party.model';
export { ThirdPartyPayout, type ThirdPartyPayoutDoc } from './third-party-payout.model';
export { WorkLog, type WorkLogDoc } from './work-log.model';
export { WorkOrder, type WorkOrderDoc } from './work-order.model';
export * from './shared.schema';
