import { Money } from '@/components/admin/money';
import { Badge } from '@/components/ui/badge';
import { RowLink, Table, TableFrame, Td, THead, Th, Tr, TotalRow } from '@/components/ui/table';
import { formatDate, formatInr, humanize } from '@/lib/admin/format';
import type { RawSearchParams } from '@/lib/admin/search-params';
import type { ExpenseListItemDTO } from '@/services/expense.service';
import { ExpenseStatusBadge } from './status';

/**
 * The expense register. Server-rendered: sorting is a link, so it works without client JS. On a phone the table scrolls
 * inside its frame. `flagWaiting` puts the red margin line on expenses waiting for a decision, for the people who decide.
 */
export function ExpenseTable({
  items,
  params,
  sort,
  dir,
  settledInr,
  showPerson,
  flagWaiting,
}: {
  items: ExpenseListItemDTO[];
  params: RawSearchParams;
  sort: string;
  dir: 'asc' | 'desc';
  /** Approved and paid, in INR, over everything that matches the filters. */
  settledInr: number;
  showPerson: boolean;
  flagWaiting: boolean;
}) {
  const sortable = (key: string) => ({ key, path: '/admin/expenses', params, active: sort, dir });
  const columns = showPerson ? 7 : 6;
  return (
    <TableFrame>
      <Table caption="Expenses" className="min-w-[58rem]">
        <THead>
          <tr>
            <Th sort={sortable('spentOn')}>Expense</Th>
            <Th>Charged to</Th>
            <Th>Category</Th>
            {showPerson ? <Th>Paid by</Th> : null}
            <Th numeric sort={sortable('amount')}>Amount</Th>
            <Th sort={sortable('status')}>Status</Th>
            <Th>Receipts</Th>
          </tr>
        </THead>
        <tbody>
          {items.map((e) => (
            <Tr key={e.id} flag={flagWaiting && e.status === 'submitted'}>
              <Td className="max-w-80">
                <RowLink href={`/admin/expenses/${e.id}`}>{e.description}</RowLink>
                <span className="block truncate text-[12px] text-pd-ink-3">
                  <span className="font-pd-mono">{e.ref}</span> · {formatDate(e.spentOn)}
                  {e.payee ? ` · ${e.payee}` : ''}
                </span>
              </Td>
              <Td className="max-w-56">
                {e.project ? (
                  <>
                    <span className="block truncate">{e.project.name}</span>
                    <span className="block truncate text-[12px] text-pd-ink-3"><span className="font-pd-mono">{e.project.ref}</span> · {e.project.clientName}</span>
                  </>
                ) : (
                  <Badge>Company</Badge>
                )}
              </Td>
              <Td muted>{humanize(e.category)}</Td>
              {showPerson ? <Td muted>{e.paidBy ? e.paidBy.name : 'Company'}</Td> : null}
              <Td numeric><Money amountMinor={e.amount.amountMinor} currency={e.amount.currency} inrMinor={e.amount.inrMinor} /></Td>
              <Td><ExpenseStatusBadge status={e.status} paidFrom={e.paidFrom} /></Td>
              <Td muted>{e.receiptCount > 0 ? e.receiptCount : 'None'}</Td>
            </Tr>
          ))}
          <TotalRow>
            <Td colSpan={columns - 3}>Approved and paid, everything that matches</Td>
            <Td numeric>{formatInr(settledInr)}</Td>
            <Td colSpan={2} />
          </TotalRow>
        </tbody>
      </Table>
    </TableFrame>
  );
}
