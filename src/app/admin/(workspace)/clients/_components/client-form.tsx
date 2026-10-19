'use client';

import { useRouter } from 'next/navigation';
import { useAdminApi } from '@/components/admin/api-provider';
import { EntityPicker, type PickerValue } from '@/components/admin/entity-picker';
import { Button, LinkButton } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { useToast } from '@/components/ui/toast';
import { CLIENT_KINDS, CLIENT_SOURCES, CLIENT_STATUSES } from '@/config/statuses';
import { humanize } from '@/lib/admin/format';
import { useForm } from '@/lib/admin/use-form';
import { COMMON_COUNTRIES } from './countries';
import { ContactsEditor, emptyContact, type ContactRow } from './contacts-editor';

export type ClientFormValues = {
  name: string;
  kind: string;
  status: string;
  industry: string;
  source: string;
  country: string;
  billingCurrency: string;
  gstin: string;
  taxId: string;
  website: string;
  address: { line1: string; line2: string; city: string; state: string; postalCode: string; country: string };
  contacts: ContactRow[];
  owner: PickerValue | null;
  tags: string;
  notes: string;
};

export const blankClient = (): ClientFormValues => ({
  name: '', kind: 'company', status: 'prospect', industry: '', source: '', country: '', billingCurrency: '', gstin: '', taxId: '', website: '',
  address: { line1: '', line2: '', city: '', state: '', postalCode: '', country: '' },
  contacts: [emptyContact(true)], owner: null, tags: '', notes: '',
});

/** Create and edit share this form. `clientId` switches it to editing; `internal` locks the fields the internal client keeps. */
export function ClientForm({ initial, clientId, currencies, internal }: { initial: ClientFormValues; clientId?: string; currencies: string[]; internal?: boolean }) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const form = useForm<ClientFormValues>(initial);
  const v = form.values;
  const e = form.errors;

  const onSubmit = form.submit(async (values) => {
    const contacts = values.contacts
      .filter((c) => c.name.trim() || c.email.trim() || c.phone.trim())
      .map((c) => ({ name: c.name, email: c.email, phone: c.phone, designation: c.designation, isPrimary: c.isPrimary }));
    const body = {
      ...(internal ? {} : { name: values.name, kind: values.kind, status: values.status }),
      industry: values.industry,
      source: values.source,
      country: values.country,
      billingCurrency: values.billingCurrency,
      gstin: values.gstin,
      taxId: values.taxId,
      website: values.website,
      address: values.address,
      contacts,
      accountOwnerId: values.owner?.id ?? '',
      tags: values.tags.split(',').map((t) => t.trim()).filter(Boolean),
      notes: values.notes,
    };
    const data = clientId
      ? await call<{ client: { id: string } }>(`/api/admin/clients/${clientId}`, { method: 'PATCH', body })
      : await call<{ client: { id: string } }>('/api/admin/clients', { body });
    toast.show(clientId ? 'Client saved.' : 'Client created.');
    router.push(`/admin/clients/${data.client.id}`);
    router.refresh();
    await new Promise(() => {});
  });

  const addr = (key: keyof ClientFormValues['address']) => ({
    value: v.address[key],
    onChange: (ev: React.ChangeEvent<HTMLInputElement>) => form.set('address', { ...v.address, [key]: ev.target.value }),
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-4xl flex-col gap-6">
      <Panel>
        <PanelHeader title="Who they are" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={e.name} required className="sm:col-span-2">
            {(c) => <Input {...c} autoComplete="off" disabled={internal} value={v.name} onChange={(ev) => form.set('name', ev.target.value)} />}
          </Field>
          <Field label="Kind" error={e.kind}>
            {(c) => (
              <Select {...c} disabled={internal} value={v.kind} onChange={(ev) => form.set('kind', ev.target.value)}>
                {CLIENT_KINDS.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Status" error={e.status}>
            {(c) => (
              <Select {...c} disabled={internal} value={v.status} onChange={(ev) => form.set('status', ev.target.value)}>
                {CLIENT_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Industry" error={e.industry}>
            {(c) => <Input {...c} autoComplete="off" value={v.industry} onChange={(ev) => form.set('industry', ev.target.value)} />}
          </Field>
          <Field label="How they found us" error={e.source}>
            {(c) => (
              <Select {...c} value={v.source} onChange={(ev) => form.set('source', ev.target.value)}>
                <option value="">Not recorded</option>
                {CLIENT_SOURCES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Account owner" hint="The team member who looks after this client." error={e.accountOwnerId} className="sm:col-span-2">
            {(c) => <EntityPicker kind="admins" id={c.id} value={v.owner} onChange={(o) => form.set('owner', o)} placeholder="Search the team" describedBy={c['aria-describedby']} />}
          </Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Billing" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Country" hint="Two letters, for example IN or US." error={e.country}>
            {(c) => (
              <>
                <Input {...c} list="client-countries" maxLength={2} autoComplete="off" className="uppercase" value={v.country} onChange={(ev) => form.set('country', ev.target.value)} />
                <datalist id="client-countries">{COMMON_COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</datalist>
              </>
            )}
          </Field>
          <Field label="Billing currency" error={e.billingCurrency}>
            {(c) => (
              <Select {...c} value={v.billingCurrency} onChange={(ev) => form.set('billingCurrency', ev.target.value)}>
                <option value="">Not set</option>
                {currencies.map((cur) => <option key={cur} value={cur}>{cur}</option>)}
              </Select>
            )}
          </Field>
          <Field label="GSTIN" hint="15 characters. Indian clients only." error={e.gstin}>
            {(c) => <Input {...c} maxLength={15} autoComplete="off" className="font-pd-mono uppercase" value={v.gstin} onChange={(ev) => form.set('gstin', ev.target.value)} />}
          </Field>
          <Field label="Tax ID" hint="For clients outside India." error={e.taxId}>
            {(c) => <Input {...c} autoComplete="off" value={v.taxId} onChange={(ev) => form.set('taxId', ev.target.value)} />}
          </Field>
          <Field label="Website" error={e.website} className="sm:col-span-2">
            {(c) => <Input {...c} type="url" inputMode="url" placeholder="https://" autoComplete="off" value={v.website} onChange={(ev) => form.set('website', ev.target.value)} />}
          </Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Address" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Address line 1" className="sm:col-span-2" error={e['address.line1']}>{(c) => <Input {...c} autoComplete="off" {...addr('line1')} />}</Field>
          <Field label="Address line 2" className="sm:col-span-2" error={e['address.line2']}>{(c) => <Input {...c} autoComplete="off" {...addr('line2')} />}</Field>
          <Field label="City" error={e['address.city']}>{(c) => <Input {...c} autoComplete="off" {...addr('city')} />}</Field>
          <Field label="State" error={e['address.state']}>{(c) => <Input {...c} autoComplete="off" {...addr('state')} />}</Field>
          <Field label="Postal code" error={e['address.postalCode']}>{(c) => <Input {...c} autoComplete="off" {...addr('postalCode')} />}</Field>
          <Field label="Country" hint="Two letters." error={e['address.country']}>{(c) => <Input {...c} maxLength={2} autoComplete="off" className="uppercase" {...addr('country')} />}</Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Contacts" />
        <ContactsEditor value={v.contacts} onChange={(rows) => form.set('contacts', rows)} errors={e} />
      </Panel>

      <Panel>
        <PanelHeader title="Notes" />
        <div className="grid gap-4">
          <Field label="Tags" hint="Separate with commas." error={e.tags}>
            {(c) => <Input {...c} autoComplete="off" value={v.tags} onChange={(ev) => form.set('tags', ev.target.value)} />}
          </Field>
          <Field label="Notes" error={e.notes}>
            {(c) => <Textarea {...c} rows={4} value={v.notes} onChange={(ev) => form.set('notes', ev.target.value)} />}
          </Field>
        </div>
      </Panel>

      {form.formError ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{form.formError}</p> : null}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" loading={form.submitting}>{clientId ? 'Save client' : 'Create client'}</Button>
        <LinkButton href={clientId ? `/admin/clients/${clientId}` : '/admin/clients'} variant="ghost">Cancel</LinkButton>
      </div>
    </form>
  );
}
