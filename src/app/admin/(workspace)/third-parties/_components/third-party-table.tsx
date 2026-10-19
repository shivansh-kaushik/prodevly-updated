import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { RowLink, Table, TableFrame, Td, THead, Th, Tr } from '@/components/ui/table';
import { formatAgo, formatCount, formatInr, humanize } from '@/lib/admin/format';
import type { RawSearchParams } from '@/lib/admin/search-params';
import type { ThirdPartyListItemDTO } from '@/services/third-party.service';
import { PATHS } from './labels';

/** The directory. Server-rendered: sorting is a link. The money columns appear only when the rows carry `money` (payout:view). */
export function ThirdPartyTable({ items, params, sort, dir }: { items: ThirdPartyListItemDTO[]; params: RawSearchParams; sort: string; dir: 'asc' | 'desc' }) {
  const sortable = (key: string) => ({ key, path: PATHS.directory, params, active: sort, dir });
  const showMoney = items.some((i) => i.money !== null);
  return (
    <TableFrame>
      <Table caption="Third parties" className={showMoney ? 'min-w-[52rem]' : 'min-w-[40rem]'}>
        <THead>
          <tr>
            <Th sort={sortable('name')}>Name</Th>
            <Th sort={sortable('type')}>Type</Th>
            <Th>Status</Th>
            <Th>Contact</Th>
            {showMoney ? <Th numeric>Paid</Th> : null}
            {showMoney ? <Th numeric>Due</Th> : null}
            {showMoney ? <Th numeric>Open orders</Th> : null}
            <Th sort={sortable('updatedAt')}>Updated</Th>
          </tr>
        </THead>
        <tbody>
          {items.map((t) => (
            <Tr key={t.id}>
              <Td className="max-w-64">
                <RowLink href={`${PATHS.directory}/${t.id}`}>{t.name}</RowLink>
                {t.archived ? <Badge className="ml-2">Archived</Badge> : null}
                <span className="block truncate text-[12px] text-pd-ink-3"><span className="font-pd-mono">{t.ref}</span>{t.skills.length ? ` · ${t.skills.slice(0, 3).join(', ')}` : ''}</span>
              </Td>
              <Td muted>{humanize(t.type)}</Td>
              <Td><StatusBadge status={t.status} /></Td>
              <Td muted className="max-w-56">
                <span className="block truncate">{t.contactName ?? t.email ?? 'No contact'}</span>
                {t.contactName && t.email ? <span className="block truncate text-[12px]">{t.email}</span> : null}
              </Td>
              {showMoney ? <Td numeric>{t.money && t.money.paidCount > 0 ? formatInr(t.money.paidInr) : <span className="text-pd-ink-3">-</span>}</Td> : null}
              {showMoney ? <Td numeric>{t.money && t.money.dueCount > 0 ? formatInr(t.money.dueInr) : <span className="text-pd-ink-3">-</span>}</Td> : null}
              {showMoney ? <Td numeric>{t.money && t.money.openWorkOrders > 0 ? formatCount(t.money.openWorkOrders) : <span className="text-pd-ink-3">-</span>}</Td> : null}
              <Td muted className="whitespace-nowrap">{formatAgo(t.updatedAt)}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableFrame>
  );
}
