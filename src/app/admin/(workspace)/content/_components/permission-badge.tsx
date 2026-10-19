import { Badge } from '@/components/ui/badge';
import type { AnyContentDTO } from '@/lib/content/types';

/**
 * The permission tick of a record, in words. Showcase items need client approval, partners need
 * permission, developers need consent; services and plans have no tick. Pure (no client code), so
 * lists and headers both use it.
 */
export function permissionOf(item: AnyContentDTO): { label: string; given: boolean } | null {
  switch (item.type) {
    case 'showcase': return { label: item.clientApproved ? 'Client approved' : 'Client approval missing', given: item.clientApproved };
    case 'partners': return { label: item.permissionConfirmed ? 'Permission given' : 'Permission missing', given: item.permissionConfirmed };
    case 'developers': return { label: item.consentConfirmed ? 'Consent given' : 'Consent missing', given: item.consentConfirmed };
    default: return null;
  }
}

export function PermissionBadge({ item }: { item: AnyContentDTO }) {
  const p = permissionOf(item);
  if (!p) return null;
  return <Badge tone={p.given ? 'credit' : 'amber'}>{p.label}</Badge>;
}
