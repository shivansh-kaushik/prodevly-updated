'use client';

import { Input } from '@/components/ui/field';

/** Hours and minutes as two plain number boxes (a person thinks "1 h 30", not "90"). */
export interface DurationValue {
  hours: string;
  minutes: string;
}

export const EMPTY_DURATION: DurationValue = { hours: '', minutes: '' };

/** Total whole minutes, or null when either box is not a whole non-negative number. An empty box counts as 0. */
export function toMinutes(v: DurationValue): number | null {
  const h = v.hours.trim() === '' ? 0 : Number(v.hours);
  const m = v.minutes.trim() === '' ? 0 : Number(v.minutes);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || m < 0) return null;
  const total = h * 60 + m;
  return total > 0 ? total : null;
}

export function fromMinutes(total: number): DurationValue {
  return { hours: String(Math.floor(total / 60)), minutes: String(total % 60) };
}

export function DurationInput({
  value,
  onChange,
  id,
  invalid,
  describedBy,
  autoFocus,
}: {
  value: DurationValue;
  onChange: (next: DurationValue) => void;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
}) {
  const shared = { inputMode: 'numeric' as const, 'aria-invalid': invalid || undefined, 'aria-describedby': describedBy, className: 'w-20 text-right' };
  return (
    <div className="flex items-center gap-2">
      <Input {...shared} id={id} aria-label="Hours" placeholder="0" autoFocus={autoFocus} value={value.hours} onChange={(e) => onChange({ ...value, hours: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
      <span aria-hidden className="text-[13px] text-pd-ink-3">h</span>
      <Input {...shared} aria-label="Minutes" placeholder="0" value={value.minutes} onChange={(e) => onChange({ ...value, minutes: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
      <span aria-hidden className="text-[13px] text-pd-ink-3">min</span>
    </div>
  );
}
