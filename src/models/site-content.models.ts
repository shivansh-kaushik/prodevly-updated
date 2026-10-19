import { Schema, model, models, type Model, type Types } from 'mongoose';
import { CURRENCY_CODES } from '@/config/currencies';
import { PARTNER_KINDS, PRICE_MODELS } from '@/config/statuses';
import { contentBaseFields, type ContentBase } from './content.shared';
import { text } from './shared.schema';

/**
 * The public website's content collections. Each is draft -> published -> archived, and a home
 * section renders only when it has at least one PUBLISHED record. A record can be published only
 * when its permission tick is true (client approval, partner permission, developer consent):
 * the content service enforces that, and the schema keeps the ticks as plain booleans.
 */

export interface ShowcaseItemDoc extends ContentBase {
  _id: Types.ObjectId;
  title: string;
  slug: string;
  clientDisplayName?: string;
  /** Internal link to the project; never rendered publicly. */
  projectId?: Types.ObjectId;
  summary: string;
  body: { brief?: string; built?: string; result?: string };
  serviceIds: Types.ObjectId[];
  stack: string[];
  coverMediaId?: Types.ObjectId;
  galleryMediaIds: Types.ObjectId[];
  liveUrl?: string;
  /** Rendered only when set. */
  completedOn?: Date;
  /** Must be true before the item can be published. */
  clientApproved: boolean;
}

const showcaseSchema = new Schema<ShowcaseItemDoc>(
  {
    ...contentBaseFields,
    title: { ...text(140, true) },
    slug: { ...text(160, true), lowercase: true },
    clientDisplayName: text(120),
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    summary: { ...text(400, true) },
    body: { brief: text(4000), built: text(4000), result: text(4000) },
    serviceIds: { type: [Schema.Types.ObjectId], default: [] },
    stack: { type: [text(40)], default: [] },
    coverMediaId: { type: Schema.Types.ObjectId, ref: 'Media' },
    galleryMediaIds: { type: [Schema.Types.ObjectId], default: [] },
    liveUrl: text(300),
    completedOn: { type: Date },
    clientApproved: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);
showcaseSchema.index({ slug: 1 }, { unique: true });
showcaseSchema.index({ status: 1, order: 1 });

export interface PartnerDoc extends ContentBase {
  _id: Types.ObjectId;
  name: string;
  kind: (typeof PARTNER_KINDS)[number];
  logoMediaId?: Types.ObjectId;
  url?: string;
  /** Must be true before the partner can be published. */
  permissionConfirmed: boolean;
}

const partnerSchema = new Schema<PartnerDoc>(
  {
    ...contentBaseFields,
    name: { ...text(120, true) },
    kind: { type: String, enum: PARTNER_KINDS, required: true, default: 'technology' },
    logoMediaId: { type: Schema.Types.ObjectId, ref: 'Media' },
    url: text(300),
    permissionConfirmed: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);
partnerSchema.index({ status: 1, order: 1 });

export interface ServiceDoc extends ContentBase {
  _id: Types.ObjectId;
  title: string;
  slug: string;
  summary: string;
  deliverables: string[];
  stack: string[];
  /** Names the 3D totem that represents this service on the home page (the set is defined with the stage engine). */
  totemKey?: string;
}

const serviceSchema = new Schema<ServiceDoc>(
  {
    ...contentBaseFields,
    title: { ...text(100, true) },
    slug: { ...text(120, true), lowercase: true },
    summary: { ...text(400, true) },
    deliverables: { type: [text(160)], default: [] },
    stack: { type: [text(40)], default: [] },
    totemKey: text(40),
  },
  { timestamps: true },
);
serviceSchema.index({ slug: 1 }, { unique: true });
serviceSchema.index({ status: 1, order: 1 });

export interface PricingPlanDoc extends ContentBase {
  _id: Types.ObjectId;
  name: string;
  summary?: string;
  priceModel: (typeof PRICE_MODELS)[number];
  /** Required unless the model is `quote`. A quote plan renders with no number at all. */
  amountMinor?: number;
  currency?: string;
  priceNote?: string;
  features: string[];
  /** At most one published plan may be highlighted (the service enforces it). */
  highlighted: boolean;
  ctaLabel?: string;
}

const pricingSchema = new Schema<PricingPlanDoc>(
  {
    ...contentBaseFields,
    name: { ...text(80, true) },
    summary: text(300),
    priceModel: { type: String, enum: PRICE_MODELS, required: true, default: 'quote' },
    amountMinor: { type: Number, min: 1, validate: { validator: Number.isSafeInteger, message: '{PATH} must be a whole number' } },
    currency: { type: String, enum: CURRENCY_CODES },
    priceNote: text(200),
    features: { type: [text(160)], default: [] },
    highlighted: { type: Boolean, required: true, default: false },
    ctaLabel: text(40),
  },
  { timestamps: true },
);
// A DRAFT may be saved without a price; a PUBLISHED non-quote plan may not (the service's publish gate checks first).
pricingSchema.pre('validate', async function () {
  if (this.status === 'published' && this.priceModel !== 'quote') {
    if (!this.amountMinor) this.invalidate('amountMinor', 'Enter a price, or choose "Quote" to show no number');
    if (!this.currency) this.invalidate('currency', 'Choose a currency');
  }
});
pricingSchema.index({ status: 1, order: 1 });
// At most one PUBLISHED plan is highlighted. The service checks first (for a readable message); this is the
// backstop that holds even when two editors publish at the same moment.
pricingSchema.index({ highlighted: 1 }, { unique: true, partialFilterExpression: { highlighted: true, status: 'published' } });

export interface DeveloperProfileDoc extends ContentBase {
  _id: Types.ObjectId;
  /** Optional link to a team member's account; unique when set. */
  adminId?: Types.ObjectId;
  displayName: string;
  title?: string;
  photoMediaId?: Types.ObjectId;
  bio?: string;
  skills: string[];
  links: { github?: string; linkedin?: string; website?: string };
  /** Must be true before the profile can be published: the person agreed to be shown. */
  consentConfirmed: boolean;
}

const developerSchema = new Schema<DeveloperProfileDoc>(
  {
    ...contentBaseFields,
    adminId: { type: Schema.Types.ObjectId, ref: 'Admin' },
    displayName: { ...text(80, true) },
    title: text(80),
    photoMediaId: { type: Schema.Types.ObjectId, ref: 'Media' },
    bio: text(280),
    skills: { type: [text(40)], default: [] },
    links: { github: text(200), linkedin: text(200), website: text(200) },
    consentConfirmed: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);
developerSchema.index({ adminId: 1 }, { unique: true, partialFilterExpression: { adminId: { $exists: true } } });
developerSchema.index({ status: 1, order: 1 });

export const SITE_INFO_ID = 'site';

/** Company details for the footer and contact fallback. Empty fields are not rendered. */
export interface SiteInfoDoc {
  _id: string;
  legalName?: string;
  displayName: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  address?: string;
  social: { linkedin?: string; github?: string; x?: string; instagram?: string; dribbble?: string; behance?: string };
  footerNote?: string;
  updatedAt: Date;
}

const siteInfoSchema = new Schema<SiteInfoDoc>(
  {
    _id: { type: String, required: true, default: SITE_INFO_ID },
    legalName: text(160),
    displayName: { ...text(80, true), default: 'ProDevly' },
    email: { ...text(160), lowercase: true },
    phone: text(40),
    whatsapp: text(40),
    address: text(400),
    social: { linkedin: text(200), github: text(200), x: text(200), instagram: text(200), dribbble: text(200), behance: text(200) },
    footerNote: text(300),
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

declare module 'mongoose' {
  interface Models {
    ShowcaseItem: Model<ShowcaseItemDoc>;
    Partner: Model<PartnerDoc>;
    Service: Model<ServiceDoc>;
    PricingPlan: Model<PricingPlanDoc>;
    DeveloperProfile: Model<DeveloperProfileDoc>;
    SiteInfo: Model<SiteInfoDoc>;
  }
}

export const ShowcaseItem: Model<ShowcaseItemDoc> = models.ShowcaseItem ?? model<ShowcaseItemDoc>('ShowcaseItem', showcaseSchema);
export const Partner: Model<PartnerDoc> = models.Partner ?? model<PartnerDoc>('Partner', partnerSchema);
export const Service: Model<ServiceDoc> = models.Service ?? model<ServiceDoc>('Service', serviceSchema);
export const PricingPlan: Model<PricingPlanDoc> = models.PricingPlan ?? model<PricingPlanDoc>('PricingPlan', pricingSchema);
export const DeveloperProfile: Model<DeveloperProfileDoc> = models.DeveloperProfile ?? model<DeveloperProfileDoc>('DeveloperProfile', developerSchema);
export const SiteInfo: Model<SiteInfoDoc> = models.SiteInfo ?? model<SiteInfoDoc>('SiteInfo', siteInfoSchema);
export type { ContentStatus } from '@/config/statuses';
