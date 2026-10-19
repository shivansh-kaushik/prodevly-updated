import Link from 'next/link';
import { Paperclip } from 'lucide-react';
import { Money } from '@/components/admin/money';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { RowLink, Table, TableFrame, Td, THead, Th, Tr } from '@/components/ui/table';
import { formatDate } from '@/lib/admin/format';
import type { RawSearchParams } from '@/lib/admin/search-params';
import type { PayoutListItemDTO } from '@/services/third-party-payout.service';
import { PATHS } from './labels';

/**
 * The payout ledger for a third party or a work order. Each amount shows in its own currency with the INR value
 * beneath it. A void payout stays visible with a Void tag and its amount struck through, so it is never mistaken
 * for money that moved.
 */
export function PayoutTable({
  items,
  params,
  sort,
  dir,
  path = PATHS.payouts,
  linkThirdParty = true,
  showWorkOrder = true,
}: {
  items: PayoutListItemDTO[];
  params: RawSearchParams;
  sort?: string;
  dir?: 'asc' | 'desc';
  path?: string;
  linkThirdParty?: boolean;
  showWorkOrder?: boolean;
}) {
  const sortable = (key: string) => (sort && dir ? { key, path, params, active: sort, dir } : undefined);
  return (
    <TableFrame>
      <Table caption="Third-party payouts" className="min-w-[54rem]">
        <THead>
          <tr>
            <Th sort={sortable('ref')}>Payout</Th>
            <Th>{showWorkOrder ? 'Work order and project' : 'Project'}</Th>
            <Th>Status</Th>
            <Th numeric>Amount</Th>
            <Th sort={sortable('dueOn')}>Due</Th>
            <Th sort={sortable('paidOn')}>Paid</Th>
          </tr>
        </THead>
        <tbody>
          {items.map((p) => (
            <Tr key={p.id} flag={p.overdue}>
              <Td className="max-w-56">
                <RowLink href={`${PATHS.payouts}/${p.id}`} className="font-pd-mono text-[13px]">{p.ref}</RowLink>
                {p.attachmentCount > 0 ? <Paperclip className="ml-1.5 inline size-3.5 text-pd-ink-3" aria-label={`${p.attachmentCount} attachment${p.attachmentCount === 1 ? '' : 's'}`} /> : null}
                <span className="block truncate text-[12px] text-pd-ink-3">
                  {linkThirdParty ? <Link href={`${PATHS.directory}/${p.thirdPartyId}`} prefetch={false} className="hover:underline">{p.thirdPartyName}</Link> : p.thirdPartyName}
                </span>
              </Td>
              <Td muted className="max-w-64">
                {showWorkOrder && p.workOrderId ? (
                  <Link href={`${PATHS.workOrders}/${p.workOrderId}`} prefetch={false} className="block truncate hover:underline">
                    <span className="font-pd-mono text-[12px]">{p.workOrderRef}</span> {p.workOrderTitle}
                  </Link>
                ) : showWorkOrder ? (
                  <span className="block truncate text-pd-ink-3">No work order</span>
                ) : null}
                <span className="block truncate text-[12px]">{p.projectName}{p.taskRef ? ` · ${p.taskRef}` : ''}</span>
              </Td>
              <Td><StatusBadge status={p.status} /></Td>
              <Td numeric className={p.status === 'void' ? 'text-pd-ink-3 line-through' : undefined}>
                <Money amountMinor={p.amount.amountMinor} currency={p.amount.currency} inrMinor={p.amount.inrMinor} />
              </Td>
              <Td className="whitespace-nowrap">
                {p.dueOn ? formatDate(p.dueOn) : <span className="text-pd-ink-3">No date</span>}
                {p.overdue ? <Badge tone="rubric" className="ml-2">Overdue</Badge> : null}
              </Td>
              <Td className="whitespace-nowrap" muted={!p.paidOn}>{p.paidOn ? formatDate(p.paidOn) : '-'}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableFrame>
  );
}
