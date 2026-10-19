import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { RowLink, Table, TableFrame, Td, THead, Th, Tr } from '@/components/ui/table';
import { formatAgo } from '@/lib/admin/format';
import type { RawSearchParams } from '@/lib/admin/search-params';
import type { ClientListItem } from '@/services/client.service';
import { countryName } from './countries';

export function ClientsTable({ items, params, sort, dir }: { items: ClientListItem[]; params: RawSearchParams; sort: string; dir: 'asc' | 'desc' }) {
  const s = (key: string) => ({ key, path: '/admin/clients', params, active: sort, dir });
  return (
    <TableFrame>
      <Table caption="Clients">
        <THead>
          <tr>
            <Th sort={s('name')}>Client</Th>
            <Th sort={s('status')}>Status</Th>
            <Th>Country</Th>
            <Th>Main contact</Th>
            <Th>Owner</Th>
            <Th numeric>Projects</Th>
            <Th sort={s('updatedAt')}>Updated</Th>
          </tr>
        </THead>
        <tbody>
          {items.map((c) => (
            <Tr key={c.id}>
              <Td>
                <RowLink href={`/admin/clients/${c.id}`}>{c.name}</RowLink>
                <span className="ml-2 font-pd-mono text-[12px] text-pd-ink-3">{c.ref}</span>
                {c.isInternal ? <Badge className="ml-2" tone="violet">Internal</Badge> : null}
                {c.archived ? <Badge className="ml-2">Archived</Badge> : null}
              </Td>
              <Td><StatusBadge status={c.status} /></Td>
              <Td muted>{countryName(c.country) || '-'}</Td>
              <Td>
                {c.primaryContact ? (
                  <>
                    <span className="block">{c.primaryContact.name}</span>
                    {c.primaryContact.email ? <span className="block text-[12px] text-pd-ink-3">{c.primaryContact.email}</span> : null}
                  </>
                ) : <span className="text-pd-ink-3">-</span>}
              </Td>
              <Td muted>{c.accountOwner ?? '-'}</Td>
              <Td numeric>{c.projectCount}</Td>
              <Td muted>{formatAgo(c.updatedAt)}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableFrame>
  );
}
