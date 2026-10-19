import Link from 'next/link';
import { formatNative } from '@/components/admin/money';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { RowLink, Table, TableFrame, Td, THead, Th, Tr } from '@/components/ui/table';
import { formatDate } from '@/lib/admin/format';
import type { ThirdPartiesMoney } from '@/services/dashboards/third-parties';
import { PATHS } from './labels';

/**
 * Open work orders with what was agreed, what is paid, what is due and what is left. The balance is agreed less
 * paid less due, so a payout already recorded as due is never counted twice. Each amount is in the work order's
 * own currency.
 */
export function OpenWorkOrdersTable({ open, canRecord }: { open: ThirdPartiesMoney['openWorkOrders']; canRecord: boolean }) {
  return (
    <Panel flush className="mb-8">
      <div className="px-5 pt-5">
        <PanelHeader title="Open work orders" hint="Balance is agreed less paid and less due. Biggest balance first." />
      </div>
      {open.rows.length === 0 ? (
        <EmptyState
          title="No open work orders"
          body={canRecord ? 'Raise a work order to record what you agreed to pay a third party.' : 'Work orders that are open or delivered show here.'}
          action={canRecord ? <Link href={`${PATHS.workOrders}/new`} className="text-[14px] underline">Raise a work order</Link> : undefined}
          className="py-8"
        />
      ) : (
        <TableFrame className="rounded-none shadow-none">
          <Table caption="Open work orders" className="min-w-[48rem]">
            <THead>
              <tr>
                <Th>Work order</Th>
                <Th>Project</Th>
                <Th numeric>Agreed</Th>
                <Th numeric>Paid</Th>
                <Th numeric>Due</Th>
                <Th numeric>Balance</Th>
              </tr>
            </THead>
            <tbody>
              {open.rows.map((r) => (
                <Tr key={r.id} flag={r.overdue || r.balanceMinor < 0}>
                  <Td className="max-w-64">
                    <RowLink href={`${PATHS.workOrders}/${r.id}`}>{r.title}</RowLink>
                    {r.overdue ? <Badge tone="rubric" className="ml-2">Overdue</Badge> : null}
                    <span className="block truncate text-[12px] text-pd-ink-3"><span className="font-pd-mono">{r.ref}</span> · {r.thirdPartyName}{r.dueOn ? ` · due ${formatDate(r.dueOn)}` : ''}</span>
                  </Td>
                  <Td muted className="max-w-48 truncate">{r.projectName}</Td>
                  <Td numeric>{formatNative(r.agreed.amountMinor, r.agreed.currency)}</Td>
                  <Td numeric>{formatNative(r.paidMinor, r.agreed.currency)}</Td>
                  <Td numeric>{formatNative(r.dueMinor, r.agreed.currency)}</Td>
                  <Td numeric>
                    {formatNative(Math.max(0, r.balanceMinor), r.agreed.currency)}
                    {r.balanceMinor < 0 ? <span className="block text-[12px] font-medium text-pd-rubric">Over by {formatNative(-r.balanceMinor, r.agreed.currency)}</span> : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableFrame>
      )}
      {open.count > open.rows.length ? (
        <p className="px-5 py-3 text-[12px] text-pd-ink-3">Showing the {open.rows.length} biggest of {open.count} open work orders.</p>
      ) : null}
    </Panel>
  );
}
