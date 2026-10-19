'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminApi } from '@/components/admin/api-provider';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Checkbox, Field, Fieldset, Input, Select } from '@/components/ui/field';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { useToast } from '@/components/ui/toast';
import { BASE_CURRENCY, CURRENCY_CODES } from '@/config/currencies';
import { useForm } from '@/lib/admin/use-form';

export interface GeneralSettings {
  orgName: string;
  timezone: string;
  fyStartMonth: number;
  workLogEditWindowDays: number;
  fxStaleDays: number;
  enabledCurrencies: string[];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type Values = {
  orgName: string;
  timezone: string;
  fyStartMonth: string;
  workLogEditWindowDays: string;
  fxStaleDays: string;
  enabledCurrencies: string[];
};

const toValues = (s: GeneralSettings): Values => ({
  orgName: s.orgName,
  timezone: s.timezone,
  fyStartMonth: String(s.fyStartMonth),
  workLogEditWindowDays: String(s.workLogEditWindowDays),
  fxStaleDays: String(s.fxStaleDays),
  enabledCurrencies: s.enabledCurrencies,
});

const wholeNumber = (text: string) => (/^\d{1,4}$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);

/** Only what changed goes to the server, so the audit entry names exactly what was edited. */
function diff(v: Values, initial: GeneralSettings) {
  const body: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  if (v.orgName !== initial.orgName) body.orgName = v.orgName;
  if (v.timezone.trim() !== initial.timezone) body.timezone = v.timezone.trim();
  const fy = Number(v.fyStartMonth);
  if (fy !== initial.fyStartMonth) body.fyStartMonth = fy;
  for (const key of ['workLogEditWindowDays', 'fxStaleDays'] as const) {
    const n = wholeNumber(v[key]);
    if (Number.isNaN(n)) errors[key] = 'Enter a whole number';
    else if (n !== initial[key]) body[key] = n;
  }
  const chosen = CURRENCY_CODES.filter((c) => c === BASE_CURRENCY || v.enabledCurrencies.includes(c));
  // As sets: the server keeps its own canonical order, so a different order alone is not an edit.
  if ([...chosen].sort().join() !== [...initial.enabledCurrencies].sort().join()) body.enabledCurrencies = chosen;
  return { body, errors };
}

/** Changes that reach every dashboard or every form. Worth a pause before saving. */
function consequences(v: Values, initial: GeneralSettings): string[] {
  const lines: string[] = [];
  if (v.timezone.trim() !== initial.timezone) lines.push('The time zone decides which day a record or a sign-in falls on in periods and day-by-day charts.');
  if (Number(v.fyStartMonth) !== initial.fyStartMonth) lines.push('The financial year, and every period that follows it, will start in ' + (MONTHS[Number(v.fyStartMonth) - 1] ?? '') + '. Saved entries are not changed.');
  const off = initial.enabledCurrencies.filter((c) => c !== BASE_CURRENCY && !v.enabledCurrencies.includes(c));
  if (off.length > 0) lines.push(`${off.join(', ')} will no longer be offered on new entries. Saved entries keep their currency.`);
  return lines;
}

/** Organisation, financial year, work logs and currencies. One Save for the page; the server audits what changed. */
export function GeneralForm({ initial, zones }: { initial: GeneralSettings; zones: string[] }) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const zoneList = useId();
  const form = useForm<Values>(toValues(initial));
  const [confirming, setConfirming] = useState<string[] | null>(null);
  const { body } = diff(form.values, initial);
  const dirty = Object.keys(body).length > 0;
  const startMonth = Number(form.values.fyStartMonth);
  const endMonth = MONTHS[(startMonth + 10) % 12];
  const currencyError = Object.entries(form.errors).find(([key]) => key.startsWith('enabledCurrencies'))?.[1];

  const save = form.submit(async (v) => {
    const { body: patch, errors } = diff(v, initial);
    if (Object.keys(errors).length > 0) {
      form.setErrors(errors);
      return;
    }
    if (Object.keys(patch).length === 0) return;
    await call('/api/admin/settings', { method: 'PATCH', body: patch });
    toast.show('Settings saved.');
    router.refresh();
  });

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const lines = consequences(form.values, initial);
    if (lines.length > 0) setConfirming(lines);
    else void save();
  }

  return (
    <>
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <Panel>
        <PanelHeader title="Organisation" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Organisation name" error={form.errors.orgName} required>
            {(c) => <Input {...c} autoComplete="organization" maxLength={80} value={form.values.orgName} onChange={(e) => form.set('orgName', e.target.value)} />}
          </Field>
          <Field label="Time zone" error={form.errors.timezone} hint="A name such as Asia/Kolkata. Periods and day-by-day charts follow it." required>
            {(c) => (
              <>
                <Input {...c} list={zoneList} autoComplete="off" spellCheck={false} value={form.values.timezone} onChange={(e) => form.set('timezone', e.target.value)} />
                <datalist id={zoneList}>{zones.map((z) => <option key={z} value={z} />)}</datalist>
              </>
            )}
          </Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Financial year and work logs" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Financial year starts in" error={form.errors.fyStartMonth} hint={`${MONTHS[startMonth - 1] ?? ''} to ${endMonth ?? ''}. Dashboards and period filters follow it.`}>
            {(c) => (
              <Select {...c} value={form.values.fyStartMonth} onChange={(e) => form.set('fyStartMonth', e.target.value)}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Work-log edit window (days)" error={form.errors.workLogEditWindowDays} hint="How many days an admin may still edit or delete their own work log.">
            {(c) => <Input {...c} inputMode="numeric" autoComplete="off" className="pd-figure" value={form.values.workLogEditWindowDays} onChange={(e) => form.set('workLogEditWindowDays', e.target.value)} />}
          </Field>
          <Field label="Exchange rate may be this old (days)" error={form.errors.fxStaleDays} hint="An older table rate must be re-entered before a foreign-currency entry can use it.">
            {(c) => <Input {...c} inputMode="numeric" autoComplete="off" className="pd-figure" value={form.values.fxStaleDays} onChange={(e) => form.set('fxStaleDays', e.target.value)} />}
          </Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Currencies" hint="The currencies money entries can be made in." />
        <Fieldset legend="Turned on" hint="INR is the base currency: every entry is also stored in INR, so it stays on.">
          <div className="grid grid-cols-2 gap-x-6 sm:grid-cols-4 lg:grid-cols-7">
            {CURRENCY_CODES.map((code) => (
              <Checkbox
                key={code}
                label={code}
                checked={code === BASE_CURRENCY || form.values.enabledCurrencies.includes(code)}
                disabled={code === BASE_CURRENCY}
                onChange={(e) =>
                  form.set('enabledCurrencies', e.target.checked ? [...form.values.enabledCurrencies, code] : form.values.enabledCurrencies.filter((c) => c !== code))
                }
              />
            ))}
          </div>
        </Fieldset>
        <p className="mt-2 text-[12px] text-pd-ink-3">Turning a currency off stops new entries in it. Saved entries keep theirs. Rates for each currency are on the FX rates tab.</p>
        {currencyError ? <p role="alert" className="mt-2 text-[12px] font-medium text-pd-rubric">{currencyError}</p> : null}
      </Panel>

      {form.formError ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{form.formError}</p> : null}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" disabled={!dirty} loading={form.submitting}>Save settings</Button>
        {dirty ? <Button variant="ghost" onClick={() => form.reset(toValues(initial))} disabled={form.submitting}>Discard changes</Button> : null}
      </div>

    </form>
      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title="Save these changes?"
        description={
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            {(confirming ?? []).map((line) => <li key={line}>{line}</li>)}
          </ul>
        }
        confirmLabel="Save changes"
        tone="primary"
        onConfirm={async () => {
          await save();
        }}
      />
    </>
  );
}
