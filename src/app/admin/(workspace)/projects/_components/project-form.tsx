'use client';

import { useRouter } from 'next/navigation';
import { useAdminApi } from '@/components/admin/api-provider';
import { EntityPicker, type PickerValue } from '@/components/admin/entity-picker';
import { Button, LinkButton } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { useForm } from '@/lib/admin/use-form';
import { PROJECT_TYPES } from '@/config/statuses';
import { ContractFields } from './contract-fields';
import { contractToValue, emptyContract, parseContract, type ContractValue } from './contract-value';
import { HEALTH_LABELS, PRIORITY_LABELS, typeLabel } from './labels';
import { MembersField } from './members-field';
import type { ProjectFormInitial } from './types';

type Values = {
  client: PickerValue | null;
  name: string;
  type: string;
  status: 'proposal' | 'active';
  priority: string;
  health: string;
  lead: PickerValue | null;
  members: PickerValue[];
  startOn: string;
  deadlineOn: string;
  scopeSummary: string;
  repo: string;
  staging: string;
  live: string;
  design: string;
  tags: string;
  contract: ContractValue;
};

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-pd-rule pt-5 first:border-t-0 first:pt-0">
      <div>
        <h2 className="text-[15px] font-semibold text-pd-ink">{title}</h2>
        {hint ? <p className="text-[13px] text-pd-ink-3">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function initialValues(initial: ProjectFormInitial | undefined, defaultClient: PickerValue | null, currencies: readonly string[]): Values {
  const defaultCurrency = currencies.includes('INR') ? 'INR' : (currencies[0] ?? 'INR');
  if (!initial) {
    return {
      client: defaultClient, name: '', type: 'website', status: 'proposal', priority: 'medium', health: 'on_track',
      lead: null, members: [], startOn: '', deadlineOn: '', scopeSummary: '', repo: '', staging: '', live: '', design: '', tags: '',
      contract: emptyContract(defaultCurrency),
    };
  }
  return {
    client: { id: initial.clientId, label: initial.clientName },
    name: initial.name,
    type: initial.type,
    status: 'proposal',
    priority: initial.priority,
    health: initial.health,
    lead: initial.lead,
    members: initial.members,
    startOn: initial.startOn ?? '',
    deadlineOn: initial.deadlineOn ?? '',
    scopeSummary: initial.scopeSummary ?? '',
    repo: initial.links.repo ?? '',
    staging: initial.links.staging ?? '',
    live: initial.links.live ?? '',
    design: initial.links.design ?? '',
    tags: initial.tags.join(', '),
    contract: initial.contract ? contractToValue(initial.contract, initial.costBudgetInrMinor) : emptyContract(defaultCurrency),
  };
}

/**
 * Create and edit share one form. Money (contract, cost budget) is only shown to people who may edit
 * it: the server enforces that too. Dates are plain calendar dates and amounts are typed as text and
 * turned into integer minor units on submit.
 */
export function ProjectForm({
  initial,
  defaultClient = null,
  canEditMoney,
  currencies,
}: {
  /** Present when editing. */
  initial?: ProjectFormInitial;
  defaultClient?: PickerValue | null;
  canEditMoney: boolean;
  currencies: readonly string[];
}) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const editing = Boolean(initial);
  const form = useForm<Values>(initialValues(initial, defaultClient, currencies));
  const { values: v, errors } = form;

  const onSubmit = form.submit(async (values) => {
    if (!values.client) {
      form.setErrors({ clientId: 'Pick a client' });
      return;
    }
    const money = canEditMoney ? parseContract(values.contract) : null;
    if (money && Object.keys(money.errors).length > 0) {
      form.setErrors(money.errors);
      form.setFormError('Please check the highlighted fields.');
      return;
    }
    const clean = (s: string) => s.trim();
    const links = { repo: clean(values.repo), staging: clean(values.staging), live: clean(values.live), design: clean(values.design) };
    const tags = values.tags.split(',').map((t) => t.trim()).filter(Boolean);
    const memberIds = values.members.map((m) => m.id);

    if (!initial) {
      const body: Record<string, unknown> = {
        clientId: values.client.id,
        name: clean(values.name),
        type: values.type,
        status: values.status,
        priority: values.priority,
        memberIds,
        tags,
        links: Object.fromEntries(Object.entries(links).filter(([, x]) => x)),
        ...(values.lead ? { leadId: values.lead.id } : {}),
        ...(values.startOn ? { startOn: values.startOn } : {}),
        ...(values.deadlineOn ? { deadlineOn: values.deadlineOn } : {}),
        ...(clean(values.scopeSummary) ? { scopeSummary: clean(values.scopeSummary) } : {}),
      };
      if (money) {
        body.contract = {
          pricingModel: money.contract.pricingModel,
          amountMinor: money.contract.amountMinor,
          currency: money.contract.currency,
          ...(money.contract.hourlyRateMinor !== null ? { hourlyRateMinor: money.contract.hourlyRateMinor } : {}),
          ...(money.contract.retainerMonthlyMinor !== null ? { retainerMonthlyMinor: money.contract.retainerMonthlyMinor } : {}),
        };
        if (money.costBudgetInrMinor !== null) body.costBudgetInrMinor = money.costBudgetInrMinor;
      }
      const data = await call<{ project: { id: string } }>('/api/admin/projects', { body });
      toast.show('Project created.');
      router.push(`/admin/projects/${data.project.id}`);
      await new Promise(() => {}); // stay "busy" while the page navigates
      return;
    }

    const body: Record<string, unknown> = {
      clientId: values.client.id,
      name: clean(values.name),
      type: values.type,
      priority: values.priority,
      health: values.health,
      leadId: values.lead?.id ?? null,
      memberIds,
      startOn: values.startOn || null,
      deadlineOn: values.deadlineOn || null,
      scopeSummary: clean(values.scopeSummary),
      links,
      tags,
    };
    if (money) {
      body.contract = { ...money.contract };
      body.costBudgetInrMinor = money.costBudgetInrMinor;
    }
    await call(`/api/admin/projects/${initial.id}`, { method: 'PATCH', body });
    toast.show('Project saved.');
    router.push(`/admin/projects/${initial.id}`);
    router.refresh();
    await new Promise(() => {});
  });

  const text = (key: keyof Values) => ({
    value: v[key] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => form.set(key, e.target.value as never),
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-3xl flex-col gap-7">
      <Section title="Project">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client" error={errors.clientId} required className="sm:col-span-2">
            {(c) => (
              <EntityPicker
                kind="clients"
                id={c.id}
                value={v.client}
                onChange={(client) => form.set('client', client)}
                placeholder="Search clients"
                required
                invalid={Boolean(c['aria-invalid'])}
                describedBy={c['aria-describedby']}
              />
            )}
          </Field>
          <Field label="Project name" error={errors.name} required className="sm:col-span-2">
            {(c) => <Input {...c} autoComplete="off" {...text('name')} />}
          </Field>
          <Field label="Type" error={errors.type} required>
            {(c) => (
              <Select {...c} {...text('type')}>
                {PROJECT_TYPES.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Priority" error={errors.priority}>
            {(c) => (
              <Select {...c} {...text('priority')}>
                {Object.entries(PRIORITY_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </Select>
            )}
          </Field>
          {editing ? (
            <Field label="Health" hint="Set this by hand as the project goes." error={errors.health}>
              {(c) => (
                <Select {...c} {...text('health')}>
                  {Object.entries(HEALTH_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </Select>
              )}
            </Field>
          ) : (
            <Field label="Starts as" hint="A proposal is not agreed yet. Choose Active if work has begun: the agreed scope, price and deadline are recorded then." error={errors.status}>
              {(c) => (
                <Select {...c} {...text('status')}>
                  <option value="proposal">Proposal</option>
                  <option value="active">Active</option>
                </Select>
              )}
            </Field>
          )}
        </div>
      </Section>

      <Section title="People">
        <MembersField
          lead={v.lead}
          members={v.members}
          onLeadChange={(lead) => form.set('lead', lead)}
          onMembersChange={(members) => form.set('members', members)}
          errors={{ lead: errors.leadId, members: errors.memberIds }}
        />
      </Section>

      <Section title="Dates">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start date" error={errors.startOn}>
            {(c) => <Input {...c} type="date" {...text('startOn')} />}
          </Field>
          <Field label="Deadline" error={errors.deadlineOn}>
            {(c) => <Input {...c} type="date" {...text('deadlineOn')} />}
          </Field>
        </div>
      </Section>

      <Section title="Scope and links">
        <Field label="Scope summary" hint="What was agreed, in plain words. It is copied into the agreed snapshot when the project first becomes active." error={errors.scopeSummary}>
          {(c) => <Textarea {...c} rows={4} {...text('scopeSummary')} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {([['repo', 'Repository'], ['staging', 'Staging site'], ['live', 'Live site'], ['design', 'Design files']] as const).map(([key, label]) => (
            <Field key={key} label={label} error={errors[`links.${key}`]}>
              {(c) => <Input {...c} type="url" inputMode="url" autoComplete="off" placeholder="https://" {...text(key)} />}
            </Field>
          ))}
        </div>
        <Field label="Tags" hint="Separate with commas." error={errors.tags}>
          {(c) => <Input {...c} autoComplete="off" {...text('tags')} />}
        </Field>
      </Section>

      {canEditMoney ? (
        <Section title="Contract and billing" hint="Visible only to people with payment access.">
          <ContractFields
            value={v.contract}
            onChange={(contract) => form.set('contract', contract)}
            errors={errors}
            currencies={currencies}
            currencyLocked={initial?.currencyLocked}
          />
        </Section>
      ) : (
        <p className="rounded-pd-sm bg-pd-well p-3 text-[13px] text-pd-ink-2">
          Contract value, billing and the cost budget are set by someone with payment access. You can create the project without them.
        </p>
      )}

      {form.formError ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{form.formError}</p> : null}
      <div className="flex items-center gap-2 border-t border-pd-rule pt-5">
        <Button type="submit" variant="primary" loading={form.submitting}>{editing ? 'Save changes' : 'Create project'}</Button>
        <LinkButton href={initial ? `/admin/projects/${initial.id}` : '/admin/projects'} variant="ghost">Cancel</LinkButton>
      </div>
    </form>
  );
}
