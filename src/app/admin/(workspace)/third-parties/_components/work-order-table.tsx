import Link from 'next/link';
import { formatNative } from '@/components/admin/money';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { RowLink, Table, TableFrame, Td, THead, Th, Tr } from '@/components/ui/table';
import { formatDate } from '@/lib/admin/format';
import type { RawSearchParams } from '@/lib/admin/search-params';
import type { WorkOrderListItemDTO } from '@/services/work-order.service';
import { PATHS } from './labels';

/** The work-order register. Amounts are in each work order's own currency; the balance is agreed less paid less due. */
export function WorkOrderTable({
  items,
  params,
  sort,
  dir,
  path = PATHS.workOrders,
  linkThirdParty = true,
}: {
  items: WorkOrderListItemDTO[];
  params: RawSearchParams;
  sort?: string;
  dir?: 'asc' | 'desc';
  path?: string;
  /** Off on a third party's own page, where every row is theirs. */
  linkThirdParty?: boolean;
}) {
  const sortable = (key: string) => (sort && dir ? { key, path, params, active: sort, dir } : undefined);
  return (
    <TableFrame>
      <Table caption="Work orders" className="min-w-[56rem]">
        <THead>
          <tr>
            <Th sort={sortable('title')}>Work order</Th>
            <Th>Project</Th>
            <Th>Status</Th>
            <Th numeric>Agreed</Th>
            <Th numeric>Paid</Th>
            <Th numeric>Due</Th>
            <Th numeric>Balance</Th>
            <Th sort={sortable('dueOn')}>Due date</Th>
          </tr>
        </THead>
        <tbody>
          {items.map((w) => (
            <Tr key={w.id} flag={w.overdue || w.balanceMinor < 0}>
              <Td className="max-w-64">
                <RowLink href={`${PATHS.workOrders}/${w.id}`}>{w.title}</RowLink>
                <span className="block truncate text-[12px] text-pd-ink-3">
                  <span className="font-pd-mono">{w.ref}</span>
                  {linkThirdParty ? <> · <Link href={`${PATHS.directory}/${w.thirdPartyId}`} prefetch={false} className="hover:underline">{w.thirdPartyName}</Link></> : null}
                </span>
              </Td>
              <Td muted className="max-w-56">
                <span className="block truncate">{w.projectName}</span>
                <span className="block truncate text-[12px]">{w.clientName}</span>
              </Td>
              <Td><StatusBadge status={w.status} /></Td>
              <Td numeric>{formatNative(w.agreed.amountMinor, w.agreed.currency)}</Td>
              <Td numeric>{formatNative(w.paidMinor, w.agreed.currency)}</Td>
              <Td numeric>{formatNative(w.dueMinor, w.agreed.currency)}</Td>
              <Td numeric>
                {formatNative(Math.max(0, w.balanceMinor), w.agreed.currency)}
                {w.balanceMinor < 0 ? <span className="block text-[12px] font-medium text-pd-rubric">Over by {formatNative(-w.balanceMinor, w.agreed.currency)}</span> : null}
              </Td>
              <Td className="whitespace-nowrap">
                {w.dueOn ? formatDate(w.dueOn) : <span className="text-pd-ink-3">No date</span>}
                {w.overdue ? <Badge tone="rubric" className="ml-2">Overdue</Badge> : null}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableFrame>
  );
}
