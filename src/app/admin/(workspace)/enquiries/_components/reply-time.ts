import { formatDuration } from '@/lib/admin/format';

/** A first-reply time in minutes, short enough for a phone-width tile: "< 1 min", "45m", "3h 20m", "5 days". Null means no data. */
export function formatReplyTime(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return 'No data';
  if (minutes < 1) return '< 1 min';
  if (minutes < 48 * 60) return formatDuration(minutes);
  const days = Math.round(minutes / 1440);
  return `${days} days`;
}
