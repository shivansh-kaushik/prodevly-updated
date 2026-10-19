import { LinkButton } from '@/components/ui/button';
import type { Capability } from '@/config/capabilities';

/** Which money pages the viewer may jump to from a project. Each one is a page that holds the same capability. */
export interface ProjectMoneyLinks {
  recordPayment: boolean;
  viewPayments: boolean;
  newWorkOrder: boolean;
  viewPayouts: boolean;
  recordExpense: boolean;
}

/**
 * What to offer on a project's Money tab. Anything that would START a new money record is left out for an archived project (the
 * services refuse new links to one), so a button never leads to a form that can only fail; looking at what exists stays.
 */
export function projectMoneyLinks(capabilities: { has(capability: Capability): boolean }, archived: boolean): ProjectMoneyLinks {
  const has = (c: Capability) => capabilities.has(c);
  return {
    recordPayment: has('payment:record') && !archived,
    viewPayments: has('payment:view'),
    newWorkOrder: has('payout:record') && !archived,
    viewPayouts: has('payout:view'),
    recordExpense: (has('expense:record') || has('expense:submit')) && !archived,
  };
}

/**
 * The shortcuts row at the top of a project's Money tab. Every target page takes the project in its address, so it opens with the
 * project already chosen (the payments list and the payouts list use `?project=`, the three forms their own parameter).
 */
export function MoneyLinks({ projectId, links }: { projectId: string; links: ProjectMoneyLinks }) {
  const id = encodeURIComponent(projectId);
  const items: Array<{ show: boolean; href: string; label: string; title?: string; primary?: boolean }> = [
    { show: links.recordPayment, href: `/admin/payments/new?projectId=${id}`, label: 'Record payment', primary: true },
    { show: links.viewPayments, href: `/admin/payments?project=${id}`, label: 'View payments' },
    { show: links.recordExpense, href: `/admin/expenses/new?projectId=${id}`, label: 'Record expense' },
    { show: links.newWorkOrder, href: `/admin/third-parties/work-orders/new?project=${id}`, label: 'New work order' },
    { show: links.viewPayouts, href: `/admin/third-parties/payouts?project=${id}`, label: 'Payouts', title: 'Payouts to third parties on this project' },
  ];
  const shown = items.filter((i) => i.show);
  if (shown.length === 0) return null;
  return (
    <nav aria-label="Money shortcuts for this project" className="flex flex-wrap items-center gap-2">
      {shown.map((i) => (
        <LinkButton key={i.href} href={i.href} variant={i.primary ? 'primary' : 'secondary'} title={i.title} prefetch={false}>
          {i.label}
        </LinkButton>
      ))}
    </nav>
  );
}
