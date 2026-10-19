'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useAdminApi } from '@/components/admin/api-provider';
import { formatNative } from '@/components/admin/money';
import { IconButton } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { RowLink, Table, TableFrame, Td, THead, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/admin/api-client';
import { formatAgo, humanize } from '@/lib/admin/format';
import type { AnyContentDTO, ContentType } from '@/lib/content/types';
import { PermissionBadge } from './permission-badge';

/** The second line under a record's name: the one fact that tells records of a type apart. */
function detail(item: AnyContentDTO): string {
  switch (item.type) {
    case 'showcase': return item.clientDisplayName ?? 'Client not named';
    case 'partners': return humanize(item.kind);
    case 'services': return item.slug ?? '';
    case 'pricing': return item.amountMinor && item.currency ? `${humanize(item.priceModel)}, ${formatNative(item.amountMinor, item.currency)}` : humanize(item.priceModel);
    case 'developers': return item.jobTitle ?? '';
  }
}

/**
 * A type's records in display order, with up and down buttons to reorder them (keyboard and touch
 * friendly: no dragging). Moving a published record changes the public page, so it needs publish
 * authority; the buttons that would do that are disabled for everyone else (the service refuses it too).
 */
export function ContentList({ type, items, canPublish, reorderable }: { type: ContentType; items: AnyContentDTO[]; canPublish: boolean; reorderable: boolean }) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const serverOrder = items.map((i) => i.id).join(',');
  const [order, setOrder] = useState(() => items.map((i) => i.id));
  const [seen, setSeen] = useState(serverOrder);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  if (seen !== serverOrder) {
    // The server's list changed (a refresh, a filter): follow it.
    setSeen(serverOrder);
    setOrder(items.map((i) => i.id));
  }

  const byId = new Map(items.map((i) => [i.id, i]));
  const shown = order.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });

  const canMove = (index: number, dir: -1 | 1) => {
    const a = shown[index];
    const b = shown[index + dir];
    if (!a || !b || busy) return false;
    return canPublish || (a.status !== 'published' && b.status !== 'published');
  };

  async function move(index: number, dir: -1 | 1) {
    const next = [...order];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(index + dir, 0, moved);
    const previous = order;
    setOrder(next);
    setBusy(true);
    try {
      await call(`/api/admin/content/${type}/reorder`, { body: { ids: next } });
      setAnnouncement(`Moved ${byId.get(moved)?.title ?? 'item'} to position ${index + dir + 1} of ${next.length}.`);
      router.refresh();
    } catch (e) {
      setOrder(previous);
      toast.show(e instanceof ApiError ? e.message : 'Could not change the order. Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <TableFrame>
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
      <Table caption={`${type} in display order`}>
        <THead>
          <tr>
            {reorderable ? <Th width="7rem">Order</Th> : null}
            <Th>Name</Th>
            <Th>Status</Th>
            <Th>Permission and readiness</Th>
            <Th>Updated</Th>
          </tr>
        </THead>
        <tbody>
          {shown.map((item, i) => (
            <Tr key={item.id} flag={item.status === 'draft' && item.blockers.length > 0}>
              {reorderable ? (
                <Td>
                  <span className="flex items-center gap-0.5">
                    <span className="pd-figure w-6 text-[13px] text-pd-ink-3">{i + 1}</span>
                    <IconButton label={`Move ${item.title} up`} disabled={!canMove(i, -1)} onClick={() => void move(i, -1)}><ArrowUp className="size-4" aria-hidden /></IconButton>
                    <IconButton label={`Move ${item.title} down`} disabled={!canMove(i, 1)} onClick={() => void move(i, 1)}><ArrowDown className="size-4" aria-hidden /></IconButton>
                  </span>
                </Td>
              ) : null}
              <Td>
                <RowLink href={`/admin/content/${type}/${item.id}`}>{item.title}</RowLink>
                <span className="block text-[12px] text-pd-ink-3">{detail(item)}</span>
              </Td>
              <Td><StatusBadge status={item.status} /></Td>
              <Td>
                <span className="flex flex-col items-start gap-1">
                  <PermissionBadge item={item} />
                  {item.type === 'pricing' && item.highlighted ? <span className="text-[12px] font-medium text-pd-ink-2">Highlighted plan</span> : null}
                  {item.status !== 'published' && item.blockers.length > 0 ? <span className="text-[12px] text-pd-amber">Needs: {item.blockers.join('; ')}</span> : null}
                  {item.status === 'published' ? <span className="text-[12px] text-pd-ink-3">Live on the site</span> : null}
                </span>
              </Td>
              <Td muted><time dateTime={item.updatedAt} suppressHydrationWarning>{formatAgo(item.updatedAt)}</time></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      {reorderable && shown.length > 1 ? <p className="border-t border-pd-rule-soft px-4 py-2 text-[12px] text-pd-ink-3">The site shows published items in this order. <Link href={`/admin/content/${type}?status=archived`} className="underline">See archived</Link>.</p> : null}
    </TableFrame>
  );
}
