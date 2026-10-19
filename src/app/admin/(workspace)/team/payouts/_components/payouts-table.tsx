import Link from 'next/link';
import { Money } from '@/components/admin/money';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { RowLink, Table, TableFrame, Td, THead, Th, Tr } from '@/components/ui/table';
import { formatDate } from '@/lib/admin/format';
import type { RawSearchParams } from '@/lib/admin/search-params';
import type { TeamPayoutDTO } from '@/services/team-payout.service';
import { basisLabel, periodText } from './labels';

export const PAYOUTS_PATH = '/admin/team/payouts';

/** Open and past its due date. `today` is the organisation's calendar date ("YYYY-MM-DD"), so this is plain string comparison. */
const overdue = (p: TeamPayoutDTO, today: string) => p.status === 'due' && p.dueOn !== null && p.dueOn < today;

/**
 * A list of payouts, as the viewer may see them: the same columns for a superadmin and for the person reading their own
 * (the data decides what is in them). `sort` makes the headers sortable links when the page offers sorting.
 */
export function PayoutsTable({
  payouts,
  today,
  showPerson = true,
  caption = 'Team payouts',
  sort,
  empty,
}: {
  payouts: TeamPayoutDTO[];
  today: string;
  showPerson?: boolean;
  caption?: string;
  sort?: { params: RawSearchParams; active: string; dir: 'asc' | 'desc' };
  empty: { title: string; body: string; action?: React.ReactNode };
}) {
  const sortOf = (key: string) => (sort ? { key, path: PAYOUTS_PATH, params: sort.params, active: sort.active, dir: sort.dir } : undefined);
  return (
    <TableFrame>
      <Table caption={caption} className="min-w-[46rem]">
        <THead>
          <tr>
            <Th sort={sortOf(showPerson ? 'person' : 'createdAt')}>{showPerson ? 'Person' : 'Payout'}</Th>
            <Th>For</Th>
            <Th numeric sort={sortOf('amount')}>Amount</Th>
            <Th>Status</Th>
            <Th sort={sortOf('dueOn')}>Date</Th>
          </tr>
        </THead>
        <tbody>
          {payouts.map((p) => {
            const late = overdue(p, today);
            return (
              <Tr key={p.id} flag={late}>
                <Td className="min-w-44 py-2">
                  {showPerson ? (
                    <>
                      <RowLink href={`${PAYOUTS_PATH}/${p.id}`}>{p.adminName}</RowLink>
                      <span className="block font-pd-mono text-[12px] text-pd-ink-3">{p.ref}</span>
                    </>
                  ) : (
                    <RowLink href={`${PAYOUTS_PATH}/${p.id}`} className="font-pd-mono text-[13px]">{p.ref}</RowLink>
                  )}
                </Td>
                <Td className="min-w-48 py-2">
                  <span>{basisLabel(p.basis)}</span>
                  <span className="block text-[12px] text-pd-ink-3">{periodText(p.periodFrom, p.periodTo)}</span>
                </Td>
                <Td numeric className="py-2">
                  <Money amountMinor={p.amount.amountMinor} currency={p.amount.currency} inrMinor={p.amount.inrMinor} />
                </Td>
                <Td className="py-2">
                  <span className="flex flex-wrap items-center gap-1">
                    <StatusBadge status={p.status} />
                    {late ? <Badge tone="rubric">Overdue</Badge> : null}
                  </span>
                </Td>
                <Td muted className="py-2 whitespace-nowrap">
                  {p.status === 'paid' && p.paidOn ? `Paid ${formatDate(p.paidOn)}` : p.dueOn ? `Due ${formatDate(p.dueOn)}` : ''}
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
      {payouts.length === 0 ? <EmptyState title={empty.title} body={empty.body} action={empty.action} className="py-10" /> : null}
    </TableFrame>
  );
}

export function ClearFilters() {
  return <Link href={PAYOUTS_PATH} prefetch={false} className="text-[14px] underline">Clear filters</Link>;
}
