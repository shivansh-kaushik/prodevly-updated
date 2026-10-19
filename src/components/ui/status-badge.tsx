import { humanize } from '@/lib/admin/format';
import { statusTone } from '@/lib/admin/status-tone';
import { Badge } from './badge';

/** A status word as a toned badge. Pass `label` to override the humanised text. */
export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  return (
    <Badge tone={statusTone(status)} className={className}>
      {label ?? humanize(status)}
    </Badge>
  );
}
