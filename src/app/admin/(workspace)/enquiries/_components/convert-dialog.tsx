'use client';

import { useRouter } from 'next/navigation';
import { useId, useMemo, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { useAdminApi } from '@/components/admin/api-provider';
import { EntityPicker, type PickerValue } from '@/components/admin/entity-picker';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { CLIENT_KINDS, PROJECT_TYPES } from '@/config/statuses';
import { humanize } from '@/lib/admin/format';
import { useForm } from '@/lib/admin/use-form';
import { prefillClient, prefillProject, type ClientSource } from '@/lib/validation/lead-conversion';
import { COMMON_COUNTRIES } from '@/app/admin/(workspace)/clients/_components/countries';
import { ChoiceGroup } from '@/app/admin/(workspace)/expenses/_components/choice-group';
import { typeLabel } from '@/app/admin/(workspace)/projects/_components/labels';
import { convertLabel, summariseConversion } from './convert-summary';

/** What the drawer needs of the enquiry. Plain strings: the message stays on the server, which builds the project scope from it. */
export interface ConvertLead extends ClientSource {
  id: string;
  ref: string;
}

interface Props {
  lead: ConvertLead;
  /** Currencies switched on in Settings, for the new client's billing currency. */
  currencies: string[];
  /** project:edit. Without it the drawer does not offer a draft project. */
  canStartProject: boolean;
}

type Mode = 'new' | 'existing';
type Values = {
  mode: Mode;
  name: string;
  kind: string;
  country: string;
  billingCurrency: string;
  client: PickerValue | null;
  withProject: boolean;
  projectName: string;
  projectType: string;
};

/** Every field the drawer can show an error under. Anything else the server says goes in the message at the bottom. */
const PLACED = new Set(['mode', 'client.name', 'client.kind', 'client.country', 'client.billingCurrency', 'clientId', 'project.name', 'project.type']);

interface Conversion {
  client: { id: string; name: string; created: boolean };
  project: { id: string; name: string } | null;
}

/**
 * Turns an enquiry into a client (new, or one already on the books) and, if asked, a draft project.
 * The new client starts from the enquiry, and the person can change any of it. Nothing is saved until
 * the button is pressed, and the server does the whole thing in one step: if any part fails, none of it happens.
 */
export function ConvertDialog({ open, onClose, lead, currencies, canStartProject }: Props & { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const listId = useId();
  const fill = useMemo(() => prefillClient(lead), [lead]);
  const form = useForm<Values>({
    mode: 'new',
    name: fill.name,
    kind: fill.kind,
    country: fill.country,
    billingCurrency: '',
    client: null,
    withProject: false,
    projectName: prefillProject(lead).name,
    projectType: '',
  });
  const v = form.values;
  const e = form.errors;
  const withProject = canStartProject && v.withProject;
  const formId = `${listId}-convert`;

  const onSubmit = form.submit(async (values) => {
    if (values.mode === 'existing' && !values.client) {
      form.setErrors({ clientId: 'Pick a client' });
      form.setFormError('Please check the highlighted fields.');
      return;
    }
    const project = canStartProject && values.withProject ? { name: values.projectName, type: values.projectType } : null;
    const body =
      values.mode === 'new'
        ? { mode: 'new', client: { name: values.name, kind: values.kind, country: values.country, ...(values.billingCurrency ? { billingCurrency: values.billingCurrency } : {}) }, project }
        : { mode: 'existing', clientId: values.client?.id, project };
    const { conversion } = await call<{ conversion: Conversion }>(`/api/admin/enquiries/${lead.id}/convert`, { body });
    toast.show(
      conversion.client.created
        ? `Converted. ${conversion.client.name} is now a client${conversion.project ? ' with a draft project' : ''}.`
        : `Converted. Linked to ${conversion.client.name}${conversion.project ? ' with a draft project' : ''}.`,
    );
    router.push(`/admin/clients/${conversion.client.id}`);
    router.refresh();
    // Stay "busy" until the page changes under us, so a second press cannot start a second conversion.
    await new Promise(() => {});
  });

  const unplaced = Object.entries(e).filter(([key]) => !PLACED.has(key)).map(([, message]) => message);
  const problem = unplaced.length > 0 ? unplaced.join(' ') : form.formError;
  const steps = summariseConversion({
    mode: v.mode,
    leadRef: lead.ref,
    clientName: v.mode === 'new' ? v.name : (v.client?.label ?? ''),
    kind: v.kind,
    contactName: fill.contact.name,
    projectName: withProject ? v.projectName : null,
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      variant="drawer"
      title="Convert to a client"
      description={`Starts from ${lead.ref}. Nothing is saved until you press the button below.`}
      dismissible={!form.submitting}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={form.submitting}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} loading={form.submitting}>{convertLabel(v.mode, withProject)}</Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <ChoiceGroup<Mode>
          legend="Who is the client?"
          value={v.mode}
          onChange={(m) => {
            form.set('mode', m);
            // The other mode's fields are not on screen: what the server said about them no longer applies.
            form.setErrors({});
            form.setFormError(null);
          }}
          error={e.mode}
          choices={[
            { value: 'new', title: 'A new client', hint: 'Create one from this enquiry.' },
            { value: 'existing', title: 'An existing client', hint: 'We already work with them.' },
          ]}
        />

        {v.mode === 'new' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client name" error={e['client.name']} required className="sm:col-span-2" hint={lead.company ? 'From the company on the enquiry.' : "No company was given, so this is the person's name."}>
              {(c) => <Input {...c} autoComplete="off" maxLength={120} value={v.name} onChange={(ev) => form.set('name', ev.target.value)} />}
            </Field>
            <Field label="Kind" error={e['client.kind']}>
              {(c) => (
                <Select {...c} value={v.kind} onChange={(ev) => form.set('kind', ev.target.value)}>
                  {CLIENT_KINDS.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Country" hint={lead.country && !fill.country ? `They wrote "${lead.country}". Use the 2-letter code, for example IN.` : 'Two letters, for example IN or US.'} error={e['client.country']}>
              {(c) => (
                <>
                  <Input {...c} list={`${listId}-countries`} maxLength={2} autoComplete="off" className="uppercase" value={v.country} onChange={(ev) => form.set('country', ev.target.value)} />
                  <datalist id={`${listId}-countries`}>{COMMON_COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</datalist>
                </>
              )}
            </Field>
            <Field label="Billing currency" error={e['client.billingCurrency']} className="sm:col-span-2">
              {(c) => (
                <Select {...c} value={v.billingCurrency} onChange={(ev) => form.set('billingCurrency', ev.target.value)}>
                  <option value="">Not set</option>
                  {currencies.map((cur) => <option key={cur} value={cur}>{cur}</option>)}
                </Select>
              )}
            </Field>
            <p className="text-[13px] leading-5 text-pd-ink-3 sm:col-span-2">
              The main contact is {fill.contact.name}, <span className="break-all">{fill.contact.email}</span>
              {fill.contact.phone ? `, ${fill.contact.phone}` : ''}. You can add more contacts on the client afterwards.
            </p>
          </div>
        ) : (
          <Field label="Client" required error={e.clientId} hint="This enquiry is linked to them. Archived clients and our own internal client are not offered.">
            {(c) => (
              <EntityPicker kind="clients" id={c.id} value={v.client} onChange={(p) => form.set('client', p)} placeholder="Search clients" invalid={Boolean(c['aria-invalid'])} describedBy={c['aria-describedby']} />
            )}
          </Field>
        )}

        {canStartProject ? (
          <div className="flex flex-col gap-4 border-t border-pd-rule pt-4">
            <Checkbox label="Also start a draft project" checked={v.withProject} onChange={(ev) => form.set('withProject', ev.target.checked)} />
            {v.withProject ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Project name" required error={e['project.name']} className="sm:col-span-2">
                  {(c) => <Input {...c} autoComplete="off" maxLength={140} value={v.projectName} onChange={(ev) => form.set('projectName', ev.target.value)} />}
                </Field>
                <Field label="Type" required error={e['project.type']} hint="It starts as a proposal. Contract and dates are set on the project.">
                  {(c) => (
                    <Select {...c} value={v.projectType} onChange={(ev) => form.set('projectType', ev.target.value)}>
                      <option value="">Choose a type</option>
                      {PROJECT_TYPES.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
                    </Select>
                  )}
                </Field>
              </div>
            ) : null}
          </div>
        ) : null}

        <section aria-labelledby={`${listId}-plan`} className="rounded-pd-md bg-pd-leaf p-3.5 shadow-[inset_0_0_0_1px_var(--color-pd-rule)]">
          <h3 id={`${listId}-plan`} className="pd-eyebrow mb-2">What will happen</h3>
          <ol className="flex list-decimal flex-col gap-1.5 pl-4 text-[13px] leading-5 text-pd-ink-2">
            {steps.map((line) => <li key={line}>{line}</li>)}
          </ol>
          <p className="mt-2 text-[12px] leading-4 text-pd-ink-3">It all happens together. If any part fails, nothing is saved.</p>
        </section>

        {problem ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{problem}</p> : null}
      </form>
    </Dialog>
  );
}

/** The page's button. The drawer is mounted only while open, so it starts again from the enquiry each time. */
export function ConvertButton(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <UserPlus className="size-4" aria-hidden /> Convert to client
      </Button>
      {open ? <ConvertDialog open onClose={() => setOpen(false)} {...props} /> : null}
    </>
  );
}
