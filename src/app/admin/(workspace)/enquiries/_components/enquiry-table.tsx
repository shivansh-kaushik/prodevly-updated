import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { RowLink, Table, TableFrame, Td, THead, Th, Tr } from '@/components/ui/table';
import { formatAgo, formatDate, formatDateTime } from '@/lib/admin/format';
import type { RawSearchParams } from '@/lib/admin/search-params';
import { isOpenLeadStatus } from '@/lib/validation/lead';
import type { LeadListItem } from '@/services/lead.service';

/** "Web apps", "Web apps, Mobile apps", "Web apps +2 more". */
function servicesText(services: string[]): string {
  if (services.length === 0) return '';
  return services.length <= 2 ? services.join(', ') : `${services.slice(0, 2).join(', ')} +${services.length - 2} more`;
}

/**
 * The enquiries list. Everything a visitor wrote is rendered as TEXT (React escapes it); the name
 * links to the record. A follow-up that is due on an open enquiry takes the red margin line, and
 * says "Overdue" or "Today" in words as well.
 */
export function EnquiryTable({
  items,
  today,
  sp,
  sort,
  dir,
}: {
  items: LeadListItem[];
  /** Today's calendar date in the organisation's zone, YYYY-MM-DD. */
  today: string;
  sp: RawSearchParams;
  sort: string;
  dir: 'asc' | 'desc';
}) {
  const now = new Date();
  return (
    <TableFrame>
      <Table caption="Enquiries">
        <THead>
          <tr>
            <Th sort={{ key: 'name', path: '/admin/enquiries', params: sp, active: sort, dir }}>Enquiry</Th>
            <Th>Services</Th>
            <Th>Status</Th>
            <Th>Assigned to</Th>
            <Th>Follow-up</Th>
            <Th sort={{ key: 'createdAt', path: '/admin/enquiries', params: sp, active: sort, dir }}>Received</Th>
          </tr>
        </THead>
        <tbody>
          {items.map((e) => {
            const due = e.followUpOn !== null && isOpenLeadStatus(e.status) && e.followUpOn <= today;
            return (
              <Tr key={e.id} flag={due}>
                <Td className="max-w-[22rem]">
                  <RowLink href={`/admin/enquiries/${e.id}`}>{e.name}</RowLink>
                  <span className="ml-2 font-pd-mono text-[12px] text-pd-ink-3">{e.ref}</span>
                  <span className="block truncate text-[12px] text-pd-ink-3">{e.company ? `${e.company}, ${e.email}` : e.email}</span>
                  <span className="block truncate text-[12px] text-pd-ink-3">{e.excerpt}</span>
                </Td>
                <Td muted className="max-w-[14rem]"><span className="block truncate">{servicesText(e.services) || 'None chosen'}</span></Td>
                <Td><StatusBadge status={e.status} /></Td>
                <Td muted={!e.assignedTo}>{e.assignedTo?.name ?? 'Unassigned'}</Td>
                <Td>
                  {e.followUpOn ? (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="pd-figure">{formatDate(e.followUpOn)}</span>
                      {due ? <Badge tone={e.followUpOn < today ? 'rubric' : 'amber'}>{e.followUpOn < today ? 'Overdue' : 'Today'}</Badge> : null}
                    </span>
                  ) : (
                    <span className="text-pd-ink-3">None</span>
                  )}
                </Td>
                <Td muted>
                  <time dateTime={e.createdAt} title={formatDateTime(e.createdAt)}>{formatAgo(e.createdAt, now)}</time>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </TableFrame>
  );
}
