import Link from 'next/link';
import { formatNative } from '@/components/admin/money';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { Table, TableFrame, Td, THead, Th, Tr } from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatCount, formatDate } from '@/lib/admin/format';
import type { PaymentsDashboard } from '@/services/dashboards/payments';

const when = (days: number) => (days === 0 ? 'Due today' : days < 0 ? `${-days} ${days === -1 ? 'day' : 'days'} overdue` : `In ${days} ${days === 1 ? 'day' : 'days'}`);

/** Milestones not yet paid that are overdue or fall due in the next 30 days, soonest first. */
export function UpcomingMilestones({ upcoming, total }: { upcoming: PaymentsDashboard['upcoming']; total: number }) {
  return (
    <Panel flush>
      <div className="px-5 pt-5">
        <PanelHeader title="Upcoming milestones" hint="Overdue first, then the next 30 days. A milestone leaves this list when payments cover it." />
      </div>
      {upcoming.length === 0 ? (
        <EmptyState title="No milestones due" body="Milestones with a due date show here until they are paid. Add them on a project's Money tab." className="py-8" />
      ) : (
        <TableFrame className="rounded-none shadow-none">
          <Table caption="Upcoming milestones" className="min-w-[40rem]">
            <THead>
              <tr>
                <Th>Milestone</Th>
                <Th>Due</Th>
                <Th>Status</Th>
                <Th numeric>Amount</Th>
                <Th numeric>Received</Th>
              </tr>
            </THead>
            <tbody>
              {upcoming.map((u) => (
                <Tr key={u.milestoneId} flag={u.overdue}>
                  <Td className="max-w-60">
                    <span className="font-medium">{u.title}</span>
                    <span className="block truncate text-[12px] text-pd-ink-3">
                      <Link href={`/admin/payments?project=${u.projectId}`} prefetch={false} className="underline-offset-2 hover:underline">{u.projectName}</Link> · {u.clientName}
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {formatDate(u.dueOn)}
                    <span className="block text-[12px] text-pd-ink-3">{when(u.daysFromToday)}</span>
                    {u.overdue ? <Badge tone="rubric" className="mt-0.5">Overdue</Badge> : null}
                  </Td>
                  <Td><StatusBadge status={u.status} /></Td>
                  <Td numeric>{formatNative(u.amountMinor, u.currency)}</Td>
                  <Td numeric>{u.receivedMinor > 0 ? formatNative(u.receivedMinor, u.currency) : <span className="text-pd-ink-3">None</span>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableFrame>
      )}
      {total > upcoming.length ? <p className="px-5 py-3 text-[12px] text-pd-ink-3">Showing the first {formatCount(upcoming.length)} of {formatCount(total)}.</p> : null}
    </Panel>
  );
}
