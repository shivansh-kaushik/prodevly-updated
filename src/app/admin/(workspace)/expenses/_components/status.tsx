import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';

/**
 * An expense's status in words a person would use. An out-of-pocket expense that is approved is money WE OWE, so it
 * is not shown in the green of settled things; once it is paid back it reads "Reimbursed". The text always says it:
 * colour is never the only signal.
 */
export function ExpenseStatusBadge({ status, paidFrom }: { status: string; paidFrom: string }) {
  if (status === 'submitted') return <StatusBadge status="submitted" label="Awaiting approval" />;
  if (status === 'approved' && paidFrom === 'admin') return <Badge tone="amber">Approved, to be paid</Badge>;
  if (status === 'paid' && paidFrom === 'admin') return <StatusBadge status="paid" label="Reimbursed" />;
  return <StatusBadge status={status} />;
}
