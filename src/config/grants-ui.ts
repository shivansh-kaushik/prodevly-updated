import { GRANTABLE, type Capability } from './capabilities';

/**
 * How the grantable capabilities are presented on an admin's access page. Money modules get a
 * None / View / View and record choice (recording always includes viewing); everything else is
 * a plain switch. A test asserts every GRANTABLE capability appears exactly once here, so adding
 * one to capabilities.ts cannot silently go missing from the form.
 */
export interface GrantModule {
  key: string;
  label: string;
  hint: string;
  view: Capability;
  record: Capability;
  recordLabel: string;
}

export const GRANT_MODULES: readonly GrantModule[] = [
  { key: 'payments', label: 'Client payments', hint: 'Money received from clients.', view: 'payment:view', record: 'payment:record', recordLabel: 'View and record payments' },
  { key: 'payouts', label: 'Third-party payouts', hint: 'Work orders and what we pay freelancers and vendors.', view: 'payout:view', record: 'payout:record', recordLabel: 'View and record payouts' },
  { key: 'expenses', label: 'Expenses', hint: 'Company spending, beyond submitting their own.', view: 'expense:view', record: 'expense:record', recordLabel: 'View and record expenses' },
];

export interface GrantSwitch {
  capability: Capability;
  label: string;
  hint: string;
}

export const GRANT_SWITCHES: readonly GrantSwitch[] = [
  { capability: 'client:archive', label: 'Archive clients', hint: 'Hide a client from lists without deleting anything.' },
  { capability: 'project:archive', label: 'Archive projects', hint: 'Hide a project from lists without deleting anything.' },
  { capability: 'worklog:viewAll', label: 'See everyone\'s work logs', hint: 'Otherwise they see only their own.' },
  { capability: 'thirdParty:edit', label: 'Edit third parties', hint: 'Add and change freelancers, agencies and vendors.' },
  { capability: 'content:publish', label: 'Publish website content', hint: 'Make drafts live on the public site, and take them down.' },
  { capability: 'fx:edit', label: 'Edit exchange rates', hint: 'Enter or correct the INR rate for a currency and date.' },
  { capability: 'export:data', label: 'Export data to CSV', hint: 'Download the current list. Needs a password confirmation each time.' },
];

/** Which level a module is at for a set of granted capabilities. */
export function moduleLevel(m: GrantModule, grants: readonly string[]): 'none' | 'view' | 'record' {
  if (grants.includes(m.record)) return 'record';
  if (grants.includes(m.view)) return 'view';
  return 'none';
}

/** Rebuilds the grant list from the form's choices. The server expands dependencies and orders it. */
export function grantsFromChoices(levels: Record<string, 'none' | 'view' | 'record'>, switches: readonly string[]): string[] {
  const out: string[] = [];
  for (const m of GRANT_MODULES) {
    const level = levels[m.key] ?? 'none';
    if (level === 'record') out.push(m.record);
    else if (level === 'view') out.push(m.view);
  }
  for (const s of GRANT_SWITCHES) if (switches.includes(s.capability)) out.push(s.capability);
  return out;
}

export const ALL_PRESENTED: readonly Capability[] = [...GRANT_MODULES.flatMap((m) => [m.view, m.record]), ...GRANT_SWITCHES.map((s) => s.capability)];
export { GRANTABLE };
