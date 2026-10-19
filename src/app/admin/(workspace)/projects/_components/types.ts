/** Plain shapes the pages pass to client components. They match the service DTOs structurally, so nothing server-only is imported. */
export type PricingModelKey = 'fixed' | 'milestone' | 'hourly' | 'retainer';

export interface PersonOption {
  id: string;
  label: string;
}

export interface MilestoneRow {
  id: string;
  title: string;
  amountMinor: number;
  dueOn: string | null;
  status: 'pending' | 'invoiced' | 'paid';
  invoiceRef: string | null;
}

export interface ContractShape {
  pricingModel: PricingModelKey;
  amountMinor: number;
  currency: string;
  hourlyRateMinor: number | null;
  retainerMonthlyMinor: number | null;
}

/** What the edit page hands the form. Dates are YYYY-MM-DD. */
export interface ProjectFormInitial {
  id: string;
  clientId: string;
  clientName: string;
  name: string;
  type: string;
  priority: string;
  health: string;
  lead: PersonOption | null;
  members: PersonOption[];
  startOn: string | null;
  deadlineOn: string | null;
  scopeSummary: string | null;
  links: { repo: string | null; staging: string | null; live: string | null; design: string | null };
  tags: string[];
  /** Null when the viewer may not see money. */
  contract: ContractShape | null;
  costBudgetInrMinor: number | null;
  /** Milestones exist, so the contract currency can no longer change. */
  currencyLocked: boolean;
}
