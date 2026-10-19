'use client';

import { Checkbox, Fieldset } from '@/components/ui/field';
import { GRANT_MODULES, GRANT_SWITCHES, grantsFromChoices, moduleLevel } from '@/config/grants-ui';
import { cx } from '@/lib/cx';

/**
 * Extra access for one admin, beyond what every admin can do. Money modules take a level
 * (none, view, or view and record); the rest are switches. Superadmin-only powers (managing
 * admins, approving and voiding money, pay, settings, audit) are not on this list because they
 * cannot be granted at all.
 */
export function GrantsEditor({ value, onChange, disabled }: { value: string[]; onChange: (grants: string[]) => void; disabled?: boolean }) {
  const levels = Object.fromEntries(GRANT_MODULES.map((m) => [m.key, moduleLevel(m, value)])) as Record<string, 'none' | 'view' | 'record'>;
  const switches = GRANT_SWITCHES.filter((s) => value.includes(s.capability)).map((s) => s.capability as string);

  const setLevel = (key: string, level: 'none' | 'view' | 'record') => onChange(grantsFromChoices({ ...levels, [key]: level }, switches));
  const setSwitch = (cap: string, on: boolean) => onChange(grantsFromChoices(levels, on ? [...switches, cap] : switches.filter((c) => c !== cap)));

  return (
    <div className="flex flex-col gap-6">
      <Fieldset legend="Money" hint="Off by default. Only a superadmin can approve or void anything.">
        <div className="flex flex-col divide-y divide-pd-rule-soft rounded-pd-md shadow-[0_0_0_1px_var(--color-pd-rule)]">
          {GRANT_MODULES.map((m) => (
            <div key={m.key} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-pd-ink">{m.label}</p>
                <p className="text-[12px] text-pd-ink-3">{m.hint}</p>
              </div>
              <div role="radiogroup" aria-label={m.label} className="inline-flex rounded-pd-sm bg-pd-well p-0.5 text-[13px] font-medium">
                {(['none', 'view', 'record'] as const).map((lv) => (
                  <label
                    key={lv}
                    className={cx(
                      'cursor-pointer rounded-[3px] px-2.5 py-1 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-pd-blue',
                      levels[m.key] === lv ? 'bg-pd-sheet text-pd-ink shadow-[0_0_0_1px_var(--color-pd-rule)]' : 'text-pd-ink-3 hover:text-pd-ink',
                      disabled && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    <input type="radio" className="sr-only" name={`grant-${m.key}`} checked={levels[m.key] === lv} disabled={disabled} onChange={() => setLevel(m.key, lv)} />
                    {lv === 'none' ? 'None' : lv === 'view' ? 'View' : 'View and record'}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Fieldset>
      <Fieldset legend="Other permissions">
        <div className="grid gap-x-8 sm:grid-cols-2">
          {GRANT_SWITCHES.map((s) => (
            <div key={s.capability} className="py-1.5">
              <Checkbox label={s.label} checked={value.includes(s.capability)} disabled={disabled} onChange={(e) => setSwitch(s.capability, e.target.checked)} />
              <p className="-mt-1 pl-[26px] text-[12px] text-pd-ink-3">{s.hint}</p>
            </div>
          ))}
        </div>
      </Fieldset>
    </div>
  );
}
