import { Money } from '@/components/admin/money';
import { Badge } from '@/components/ui/badge';
import { RowLink, Table, TableFrame, Td, THead, Th, Tr } from '@/components/ui/table';
import { formatDate } from '@/lib/admin/format';
import type { RawSearchParams } from '@/lib/admin/search-params';
import type { PaymentDTO } from '@/services/client-payment.dto';
import { modeLabel } from './labels';

/**
 * The payments ledger. Server-rendered: sorting is a link, so it works without client JS. A void entry stays
 * in the list with a Void badge and its figures struck through: it is in no total. A refund is shown negative.
 */
export function PaymentsTable({ items, params, sort, dir }: { items: PaymentDTO[]; params: RawSearchParams; sort: string; dir: 'asc' | 'desc' }) {
  const sortable = (key: string) => ({ key, path: '/admin/payments', params, active: sort, dir });
  return (
    <TableFrame>
      <Table caption="Client payments" className="min-w-[52rem]">
        <THead>
          <tr>
            <Th sort={sortable('ref')}>Payment</Th>
            <Th sort={sortable('receivedOn')}>Received</Th>
            <Th>Client and project</Th>
            <Th>Mode</Th>
            <Th numeric sort={sortable('amount')}>Amount</Th>
          </tr>
        </THead>
        <tbody>
          {items.map((p) => {
            const void_ = p.status === 'void';
            const sign = p.type === 'refund' ? -1 : 1;
            return (
              <Tr key={p.id} className={void_ ? 'bg-pd-paper/60' : undefined}>
                <Td className="min-w-40">
                  <RowLink href={`/admin/payments/${p.id}`} className="font-pd-mono text-[13px]">{p.ref}</RowLink>
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {void_ ? <Badge tone="rubric">Void</Badge> : null}
                    {p.type === 'refund' ? <Badge tone="amber">Refund</Badge> : null}
                    {p.recordedAsAdvance ? <Badge tone="violet">Advance</Badge> : null}
                  </span>
                </Td>
                <Td className="whitespace-nowrap">{formatDate(p.receivedOn)}</Td>
                <Td className="max-w-64">
                  <span className="block truncate">{p.project.name}</span>
                  <span className="block truncate text-[12px] text-pd-ink-3">
                    {p.client.name}
                    {p.transactionRef ? <> · <span className="font-pd-mono">{p.transactionRef}</span></> : null}
                  </span>
                </Td>
                <Td muted>{modeLabel(p.mode)}</Td>
                <Td numeric className={void_ ? 'text-pd-ink-3 line-through' : undefined}>
                  <Money amountMinor={sign * p.amount.amountMinor} currency={p.amount.currency} inrMinor={sign * p.amount.inrMinor} />
                  {void_ ? <span className="sr-only"> (void, not counted)</span> : null}
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </TableFrame>
  );
}
