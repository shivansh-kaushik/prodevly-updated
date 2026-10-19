import { Schema, model, models, type Model } from 'mongoose';
import { BASE_CURRENCY, CURRENCY_CODES, DEFAULT_ENABLED_CURRENCIES } from '@/config/currencies';
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_PAYMENT_MODES,
  DEFAULT_THIRD_PARTY_TYPES,
} from '@/config/statuses';
import { actorSchema, text, type ActorDoc } from './shared.schema';

export const SETTINGS_ID = 'global';

/** One document. Superadmin-editable organisation settings and the lists the forms draw from. */
export interface SettingsDoc {
  _id: string;
  orgName: string;
  timezone: string;
  /** 1-12. April (4) gives the Indian financial year. */
  fyStartMonth: number;
  baseCurrency: string;
  enabledCurrencies: string[];
  paymentModes: string[];
  expenseCategories: string[];
  thirdPartyTypes: string[];
  budgetRanges: string[];
  /** Days an admin may still edit or delete their own work log. */
  workLogEditWindowDays: number;
  /** A currency rate older than this many days must be re-entered before use. */
  fxStaleDays: number;
  leadDefaultAssignee?: ActorDoc;
  updatedAt: Date;
}

const list = (defaults: readonly string[]) => ({ type: [text(60)], default: () => [...defaults] });

const settingsSchema = new Schema<SettingsDoc>(
  {
    _id: { type: String, required: true, default: SETTINGS_ID },
    orgName: { ...text(80, true), default: 'ProDevly' },
    timezone: { ...text(60, true), default: 'Asia/Kolkata' },
    fyStartMonth: { type: Number, required: true, min: 1, max: 12, default: 4 },
    baseCurrency: { type: String, required: true, enum: [BASE_CURRENCY], default: BASE_CURRENCY },
    enabledCurrencies: {
      type: [{ type: String, enum: CURRENCY_CODES }],
      default: () => [...DEFAULT_ENABLED_CURRENCIES],
      validate: {
        validator: (v: string[]) => v.includes(BASE_CURRENCY),
        message: 'INR can never be disabled',
      },
    },
    paymentModes: list(DEFAULT_PAYMENT_MODES),
    expenseCategories: list(DEFAULT_EXPENSE_CATEGORIES),
    thirdPartyTypes: list(DEFAULT_THIRD_PARTY_TYPES),
    budgetRanges: { type: [text(60)], default: [] },
    workLogEditWindowDays: { type: Number, required: true, min: 0, max: 90, default: 7 },
    fxStaleDays: { type: Number, required: true, min: 1, max: 60, default: 7 },
    leadDefaultAssignee: { type: actorSchema },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

declare module 'mongoose' {
  interface Models {
    Settings: Model<SettingsDoc>;
  }
}

export const Settings: Model<SettingsDoc> = models.Settings ?? model<SettingsDoc>('Settings', settingsSchema);
