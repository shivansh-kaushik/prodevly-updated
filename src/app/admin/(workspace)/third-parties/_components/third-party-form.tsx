'use client';

import { useRouter } from 'next/navigation';
import { useAdminApi } from '@/components/admin/api-provider';
import { Button, LinkButton } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { humanize } from '@/lib/admin/format';
import { useForm } from '@/lib/admin/use-form';
import { PATHS } from './labels';

export interface ThirdPartyFormInitial {
  id: string;
  name: string;
  type: string;
  skills: string[];
  contactName: string;
  email: string;
  phone: string;
  country: string;
  defaultCurrency: string;
  gstin: string;
  notes: string;
  status: 'active' | 'inactive';
  /** Only passed to a viewer who may see it (`thirdParty:payDetails`). */
  paymentNote: string;
}

const EMPTY = { name: '', type: '', skills: '', contactName: '', email: '', phone: '', country: '', defaultCurrency: '', gstin: '', notes: '', status: 'active' as 'active' | 'inactive', paymentNote: '' };

const tidySkills = (raw: string) => [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];

/**
 * Add a third party, or edit one (the edit form lives in a drawer). The payment note field exists only for a viewer
 * who holds `thirdParty:payDetails`; everyone else never sees it, and the server refuses it from them anyway.
 */
export function ThirdPartyForm({
  initial,
  types,
  currencies,
  canPayDetails,
  onDone,
}: {
  initial?: ThirdPartyFormInitial;
  types: readonly string[];
  currencies: readonly string[];
  canPayDetails: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const editing = Boolean(initial);
  const typeOptions = initial && !types.includes(initial.type) ? [initial.type, ...types] : [...types];
  const form = useForm({
    ...EMPTY,
    ...(initial ? { ...initial, skills: initial.skills.join(', ') } : { type: types[0] ?? '' }),
  });

  const onSubmit = form.submit(async (v) => {
    if (!initial) {
      const data = await call<{ thirdParty: { id: string } }>('/api/admin/third-parties', {
        body: {
          name: v.name,
          type: v.type,
          skills: tidySkills(v.skills),
          ...(v.contactName.trim() ? { contactName: v.contactName } : {}),
          ...(v.email.trim() ? { email: v.email } : {}),
          ...(v.phone.trim() ? { phone: v.phone } : {}),
          ...(v.country.trim() ? { country: v.country } : {}),
          ...(v.defaultCurrency ? { defaultCurrency: v.defaultCurrency } : {}),
          ...(v.gstin.trim() ? { gstin: v.gstin } : {}),
          ...(v.notes.trim() ? { notes: v.notes } : {}),
          ...(canPayDetails && v.paymentNote.trim() ? { paymentNote: v.paymentNote } : {}),
        },
      });
      toast.show('Third party added');
      router.push(`${PATHS.directory}/${data.thirdParty.id}`);
      await new Promise(() => {}); // stay "busy" until the navigation lands, so it cannot be submitted twice
      return;
    }

    // Edit: send only what changed. An emptied optional field is sent as null, which clears it.
    const body: Record<string, unknown> = {};
    const text = (key: 'contactName' | 'email' | 'phone' | 'country' | 'defaultCurrency' | 'gstin' | 'notes') => {
      if (v[key].trim() !== initial[key]) body[key] = v[key].trim() === '' ? null : v[key].trim();
    };
    if (v.name !== initial.name) body.name = v.name;
    if (v.type !== initial.type) body.type = v.type;
    if (v.status !== initial.status) body.status = v.status;
    if (JSON.stringify(tidySkills(v.skills)) !== JSON.stringify(initial.skills)) body.skills = tidySkills(v.skills);
    for (const key of ['contactName', 'email', 'phone', 'country', 'defaultCurrency', 'gstin', 'notes'] as const) text(key);
    if (canPayDetails && v.paymentNote.trim() !== initial.paymentNote) body.paymentNote = v.paymentNote.trim() === '' ? null : v.paymentNote.trim();
    if (Object.keys(body).length === 0) {
      onDone?.();
      return;
    }
    await call(`/api/admin/third-parties/${initial.id}`, { method: 'PATCH', body });
    toast.show('Third party updated');
    onDone?.();
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-3xl flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={form.errors.name} required>
          {(c) => <Input {...c} maxLength={120} autoComplete="off" value={form.values.name} onChange={(e) => form.set('name', e.target.value)} />}
        </Field>
        <Field label="Type" error={form.errors.type} hint="The types come from Settings." required>
          {(c) => (
            <Select {...c} value={form.values.type} onChange={(e) => form.set('type', e.target.value)}>
              {typeOptions.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Skills" error={form.errors.skills} hint="Separate with commas.">
        {(c) => <Input {...c} autoComplete="off" value={form.values.skills} onChange={(e) => form.set('skills', e.target.value)} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contact name" error={form.errors.contactName}>
          {(c) => <Input {...c} maxLength={100} autoComplete="off" value={form.values.contactName} onChange={(e) => form.set('contactName', e.target.value)} />}
        </Field>
        <Field label="Email" error={form.errors.email}>
          {(c) => <Input {...c} type="email" inputMode="email" autoComplete="off" value={form.values.email} onChange={(e) => form.set('email', e.target.value)} />}
        </Field>
        <Field label="Phone" error={form.errors.phone}>
          {(c) => <Input {...c} type="tel" inputMode="tel" maxLength={30} autoComplete="off" value={form.values.phone} onChange={(e) => form.set('phone', e.target.value)} />}
        </Field>
        <Field label="Country" error={form.errors.country} hint="Two-letter code, for example IN.">
          {(c) => <Input {...c} maxLength={2} autoComplete="off" className="uppercase" value={form.values.country} onChange={(e) => form.set('country', e.target.value)} />}
        </Field>
        <Field label="Usual currency" error={form.errors.defaultCurrency}>
          {(c) => (
            <Select {...c} value={form.values.defaultCurrency} onChange={(e) => form.set('defaultCurrency', e.target.value)}>
              <option value="">Not set</option>
              {currencies.map((cur) => <option key={cur} value={cur}>{cur}</option>)}
            </Select>
          )}
        </Field>
        <Field label="GSTIN" error={form.errors.gstin} hint="15 characters, if they are GST registered.">
          {(c) => <Input {...c} maxLength={15} autoComplete="off" className="uppercase" value={form.values.gstin} onChange={(e) => form.set('gstin', e.target.value)} />}
        </Field>
      </div>
      {editing ? (
        <Field label="Status" error={form.errors.status} hint="An inactive third party stays on record but cannot be picked for new work.">
          {(c) => (
            <Select {...c} value={form.values.status} onChange={(e) => form.set('status', e.target.value as 'active' | 'inactive')}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          )}
        </Field>
      ) : null}
      <Field label="Notes" error={form.errors.notes} hint="Internal. Anyone who can open the directory sees this.">
        {(c) => <Textarea {...c} rows={3} maxLength={4000} value={form.values.notes} onChange={(e) => form.set('notes', e.target.value)} />}
      </Field>
      {canPayDetails ? (
        <Field label="Payment details" error={form.errors.paymentNote} hint="Bank, UPI, PayPal or Wise details. Only superadmins see or change this. It is never shown in a list or written to the activity log.">
          {(c) => <Textarea {...c} rows={3} maxLength={1000} autoComplete="off" value={form.values.paymentNote} onChange={(e) => form.set('paymentNote', e.target.value)} />}
        </Field>
      ) : null}
      {form.formError ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{form.formError}</p> : null}
      <div className="flex items-center gap-2 border-t border-pd-rule pt-5">
        <Button type="submit" variant="primary" loading={form.submitting}>{editing ? 'Save changes' : 'Add third party'}</Button>
        {editing ? <Button variant="ghost" onClick={onDone} disabled={form.submitting}>Cancel</Button> : <LinkButton href={PATHS.directory} variant="ghost">Cancel</LinkButton>}
      </div>
    </form>
  );
}
