'use client';

import type { AdminRole } from '@/config/capabilities';
import { Fieldset } from '@/components/ui/field';
import { cx } from '@/lib/cx';

const ROLES: ReadonlyArray<{ value: AdminRole; title: string; body: string }> = [
  { value: 'admin', title: 'Admin', body: 'Works on clients, projects, tasks and their own time. Money, settings and the audit log stay off unless granted.' },
  { value: 'superadmin', title: 'Superadmin', body: 'Full access: money, admins, settings and the audit log. Keep this to the people who run the company.' },
];

export function RolePicker({ value, onChange, disabled }: { value: AdminRole; onChange: (role: AdminRole) => void; disabled?: boolean }) {
  return (
    <Fieldset legend="Access level">
      <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
        {ROLES.map((r) => (
          <label
            key={r.value}
            className={cx(
              'flex cursor-pointer flex-col gap-1 rounded-pd-md p-3.5 transition-[box-shadow,background-color] duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-pd-blue',
              value === r.value ? 'bg-pd-sheet shadow-[inset_0_0_0_2px_var(--color-pd-ink)]' : 'bg-pd-leaf shadow-[inset_0_0_0_1px_var(--color-pd-rule-strong)] hover:bg-pd-well',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <input type="radio" name="role" className="sr-only" checked={value === r.value} disabled={disabled} onChange={() => onChange(r.value)} />
            <span className="text-[14px] font-semibold text-pd-ink">{r.title}</span>
            <span className="text-[13px] leading-5 text-pd-ink-3">{r.body}</span>
          </label>
        ))}
      </div>
    </Fieldset>
  );
}
