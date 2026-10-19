'use client';

import { MoneyInput, minorToInput, moneyToMinor, type MoneyValue } from '@/components/admin/money-input';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/field';
import { useForm } from '@/lib/admin/use-form';
import { PRICE_MODELS } from '@/config/statuses';
import type { PricingPlanDTO } from '@/lib/content/types';
import { parseMinor } from '@/lib/money/minor';
import { EditorShell, useContentSave } from './editor-shell';
import { LinesField } from './fields';
import { orNull } from './lists';

type Model = (typeof PRICE_MODELS)[number];
const MODEL_LABEL: Record<Model, string> = {
  fixed_from: 'Fixed price, starting from',
  per_month: 'Per month',
  per_hour: 'Per hour',
  quote: 'Quote: no price is shown',
};

interface Values extends Record<string, unknown> {
  name: string;
  summary: string;
  priceModel: Model;
  amount: MoneyValue;
  priceNote: string;
  features: string[];
  highlighted: boolean;
  ctaLabel: string;
}

export function PricingForm({ item, currencies, readOnlyReason }: { item?: PricingPlanDTO; currencies: readonly string[]; readOnlyReason?: string }) {
  const save = useContentSave('pricing', item?.id);
  const currency = item?.currency && currencies.includes(item.currency) ? item.currency : (currencies.includes('INR') ? 'INR' : (currencies[0] ?? 'INR'));
  const form = useForm<Values>({
    name: item?.title ?? '',
    summary: item?.summary ?? '',
    priceModel: item?.priceModel ?? 'fixed_from',
    amount: { amount: item?.amountMinor && item.currency ? minorToInput(item.amountMinor, item.currency) : '', currency },
    priceNote: item?.priceNote ?? '',
    features: item?.features ?? [],
    highlighted: item?.highlighted ?? false,
    ctaLabel: item?.ctaLabel ?? '',
  });
  const v = form.values;
  const e = form.errors;
  const quote = v.priceModel === 'quote';

  const onSubmit = form.submit(async (values) => {
    let amountMinor: number | null = null;
    if (values.priceModel !== 'quote' && values.amount.amount.trim()) {
      amountMinor = moneyToMinor(values.amount);
      if (amountMinor === null) {
        form.setErrors({ amountMinor: parseMinor(values.amount.amount, values.amount.currency) === 0 ? 'The price must be above zero' : 'Enter a valid amount, such as 24,999 or 24999.50' });
        return;
      }
    }
    await save({
      name: values.name,
      summary: orNull(values.summary),
      priceModel: values.priceModel,
      amountMinor,
      currency: values.priceModel === 'quote' ? null : values.amount.currency,
      priceNote: orNull(values.priceNote),
      features: values.features,
      highlighted: values.highlighted,
      ctaLabel: orNull(values.ctaLabel),
    });
  });

  return (
    <EditorShell onSubmit={onSubmit} submitting={form.submitting} formError={form.formError} readOnlyReason={readOnlyReason} cancelHref="/admin/content/pricing" submitLabel={item ? 'Save changes' : 'Save draft'}>
      <Field label="Plan name" error={e.name} required>
        {(c) => <Input {...c} maxLength={80} value={v.name} onChange={(ev) => form.set('name', ev.target.value)} />}
      </Field>
      <Field label="Summary" hint="Up to 300 characters." error={e.summary}>
        {(c) => <Textarea {...c} rows={2} maxLength={300} value={v.summary} onChange={(ev) => form.set('summary', ev.target.value)} />}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="How it is priced" error={e.priceModel} required>
          {(c) => (
            <Select {...c} value={v.priceModel} onChange={(ev) => form.set('priceModel', ev.target.value as Model)}>
              {PRICE_MODELS.map((m) => <option key={m} value={m}>{MODEL_LABEL[m]}</option>)}
            </Select>
          )}
        </Field>
        {!quote ? (
          <Field label="Price" hint="A price you have decided. Needed before this can be published." error={e.amountMinor ?? e.currency} required>
            {(c) => <MoneyInput id={c.id} value={v.amount} onChange={(next) => { form.set('amount', next); }} currencies={currencies} invalid={Boolean(e.amountMinor || e.currency)} describedBy={c['aria-describedby']} />}
          </Field>
        ) : null}
      </div>

      <Field label="Price note" hint={quote ? 'For example: "Priced after a short call".' : 'For example: "Plus tax".'} error={e.priceNote}>
        {(c) => <Input {...c} maxLength={200} value={v.priceNote} onChange={(ev) => form.set('priceNote', ev.target.value)} />}
      </Field>
      <LinesField label="What is included" hint="One feature per line." value={v.features} onChange={(list) => form.set('features', list)} error={e.features} />
      <Field label="Button label" hint="Text on the plan's button. Leave empty for the default." error={e.ctaLabel}>
        {(c) => <Input {...c} maxLength={40} value={v.ctaLabel} onChange={(ev) => form.set('ctaLabel', ev.target.value)} />}
      </Field>
      <div className="flex flex-col gap-1">
        <Checkbox label="Highlight this plan" checked={v.highlighted} onChange={(ev) => form.set('highlighted', ev.target.checked)} />
        <p className="text-[12px] text-pd-ink-3">Only one published plan can be highlighted at a time.</p>
        {e.highlighted ? <p role="alert" className="text-[12px] font-medium text-pd-rubric">{e.highlighted}</p> : null}
      </div>
    </EditorShell>
  );
}
