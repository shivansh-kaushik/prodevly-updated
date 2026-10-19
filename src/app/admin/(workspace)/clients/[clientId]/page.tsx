import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pencil, Plus } from 'lucide-react';
import { AuditFeed } from '@/components/admin/audit-feed';
import { PageHeader } from '@/components/admin/page-header';
import { Badge } from '@/components/ui/badge';
import { buttonClass } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { DescriptionList, Panel, PanelHeader } from '@/components/ui/panel';
import { StatusBadge } from '@/components/ui/status-badge';
import { TabLinks } from '@/components/ui/tabs';
import { RowLink, Table, TableFrame, Td, THead, Th, Tr } from '@/components/ui/table';
import { formatDate, humanize } from '@/lib/admin/format';
import { first, type RawSearchParams } from '@/lib/admin/search-params';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { parseObjectId } from '@/lib/validation/common';
import { getClientById } from '@/services/client.service';
import { getClientMoney } from '@/services/dashboards/clients';
import { getRecordActivity } from '@/services/activity.service';
import { listProjects } from '@/services/project.service';
import { Money } from '@/components/admin/money';
import { ClientActions } from '../_components/client-actions';
import { countryName } from '../_components/countries';
import { MoneyTab } from '../_components/money-tab';

export const metadata: Metadata = { title: 'Client' };

export default async function ClientPage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<RawSearchParams> }) {
  const viewer = await requireAdminPage('/admin/clients', { capability: 'client:view' });
  const id = parseObjectId((await params).clientId);
  const sp = await searchParams;
  const client = await getClientById(viewer, id).catch(() => null);
  if (!client) notFound();

  const canMoney = viewer.capabilities.has('payment:view');
  const canProjects = viewer.capabilities.has('project:view');
  const tabs = [
    { key: 'overview', label: 'Overview' },
    ...(canProjects ? [{ key: 'projects', label: 'Projects' }] : []),
    ...(canMoney ? [{ key: 'money', label: 'Money' }] : []),
    { key: 'activity', label: 'Activity' },
  ];
  const requested = first(sp, 'tab') ?? 'overview';
  const tab = tabs.some((t) => t.key === requested) ? requested : 'overview';
  const path = `/admin/clients/${client.id}`;
  const archived = Boolean(client.archivedAt);

  return (
    <>
      <PageHeader
        title={client.name}
        description={<span className="font-pd-mono text-[13px]">{client.ref}</span>}
        crumbs={[{ label: 'Clients', href: '/admin/clients' }, { label: client.name }]}
        meta={
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={client.status} />
            <Badge>{humanize(client.kind)}</Badge>
            {client.isInternal ? <Badge tone="violet">Internal</Badge> : null}
            {archived ? <Badge tone="amber">Archived</Badge> : null}
          </span>
        }
        actions={
          <>
            {viewer.capabilities.has('client:edit') ? <Link href={`${path}/edit`} className={buttonClass('secondary')} prefetch={false}><Pencil className="size-4" aria-hidden /> Edit</Link> : null}
            {viewer.capabilities.has('project:edit') && !archived ? <Link href={`/admin/projects/new?client=${client.id}`} className={buttonClass('primary')} prefetch={false}><Plus className="size-4" aria-hidden /> New project</Link> : null}
            {!client.isInternal ? <ClientActions id={client.id} name={client.name} archived={archived} canArchive={viewer.capabilities.has('client:archive')} canDelete={viewer.capabilities.has('client:delete')} /> : null}
          </>
        }
      />
      <div className="mb-6"><TabLinks tabs={tabs} active={tab} path={path} params={sp} /></div>
      {tab === 'overview' ? <Overview client={client} /> : null}
      {tab === 'projects' ? <ProjectsTab clientId={client.id} viewer={viewer} /> : null}
      {tab === 'money' ? <MoneyTab report={await getClientMoney(viewer, client.id)} paymentsHref={canMoney ? `/admin/payments?client=${client.id}` : undefined} /> : null}
      {tab === 'activity' ? <ActivityTab clientId={client.id} viewer={viewer} /> : null}
    </>
  );
}

function Overview({ client }: { client: Awaited<ReturnType<typeof getClientById>> }) {
  const a = client.address;
  const address = [a.line1, a.line2, [a.city, a.state].filter(Boolean).join(', '), [a.postalCode, countryName(a.country)].filter(Boolean).join(' ')].filter(Boolean);
  const safeSite = client.website && /^https?:\/\//i.test(client.website) ? client.website : null;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="flex flex-col gap-6">
        <Panel>
          <PanelHeader title="Details" />
          <DescriptionList
            columns={2}
            items={[
              { label: 'Industry', value: client.industry },
              { label: 'Country', value: countryName(client.country) },
              { label: 'Billing currency', value: client.billingCurrency },
              { label: 'GSTIN', value: client.gstin ? <span className="font-pd-mono">{client.gstin}</span> : null },
              { label: 'Tax ID', value: client.taxId },
              { label: 'Website', value: safeSite ? <a href={safeSite} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">{client.website}</a> : client.website },
              { label: 'Account owner', value: client.accountOwner?.name },
              { label: 'How they found us', value: client.source ? humanize(client.source) : null },
              { label: 'Added', value: formatDate(client.createdAt) },
              { label: 'Tags', value: client.tags.length > 0 ? client.tags.join(', ') : null },
            ]}
          />
        </Panel>
        {client.notes ? <Panel><PanelHeader title="Notes" /><p className="text-[14px] leading-6 whitespace-pre-wrap text-pd-ink-2">{client.notes}</p></Panel> : null}
      </div>
      <div className="flex flex-col gap-6">
        <Panel>
          <PanelHeader title="Contacts" />
          {client.contacts.length === 0 ? <p className="text-[13px] text-pd-ink-3">No contacts yet.</p> : (
            <ul className="flex flex-col divide-y divide-pd-rule-soft">
              {client.contacts.map((c, i) => (
                <li key={`${c.name}-${i}`} className="py-2.5 first:pt-0 last:pb-0">
                  <p className="text-[14px] font-medium">{c.name}{c.isPrimary ? <Badge className="ml-2" tone="blue">Main</Badge> : null}</p>
                  {c.designation ? <p className="text-[13px] text-pd-ink-3">{c.designation}</p> : null}
                  {c.email ? <p className="text-[13px]"><a href={`mailto:${encodeURIComponent(c.email).replace('%40', '@')}`} className="underline underline-offset-2">{c.email}</a></p> : null}
                  {c.phone ? <p className="text-[13px]"><a href={`tel:${c.phone.replace(/[^+\d]/g, '')}`} className="underline underline-offset-2">{c.phone}</a></p> : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {address.length > 0 ? (
          <Panel>
            <PanelHeader title="Address" />
            <address className="text-[14px] leading-6 not-italic text-pd-ink-2">{address.map((l) => <span key={l} className="block">{l}</span>)}</address>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

async function ProjectsTab({ clientId, viewer }: { clientId: string; viewer: Awaited<ReturnType<typeof requireAdminPage>> }) {
  const { items, meta } = await listProjects(viewer, { clientId, pageSize: 50, sort: 'updatedAt', dir: 'desc' });
  if (items.length === 0) {
    return (
      <Panel flush>
        <EmptyState title="No projects yet" body="Projects for this client will be listed here." action={viewer.capabilities.has('project:edit') ? <Link href={`/admin/projects/new?client=${clientId}`} className={buttonClass('primary')}>New project</Link> : undefined} />
      </Panel>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <TableFrame>
        <Table caption="Projects for this client">
          <THead><tr><Th>Project</Th><Th>Status</Th><Th>Health</Th><Th>Deadline</Th><Th numeric>Contract</Th></tr></THead>
          <tbody>
            {items.map((p) => (
              <Tr key={p.id} flag={p.overdue}>
                <Td><RowLink href={`/admin/projects/${p.id}`}>{p.name}</RowLink><span className="ml-2 font-pd-mono text-[12px] text-pd-ink-3">{p.ref}</span></Td>
                <Td><StatusBadge status={p.status} /></Td>
                <Td><StatusBadge status={p.health} /></Td>
                <Td muted>{p.deadlineOn ? formatDate(p.deadlineOn) : '-'}</Td>
                <Td numeric>{p.contract ? <Money amountMinor={p.contract.amountMinor} currency={p.contract.currency} /> : '-'}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableFrame>
      {meta.total > items.length ? <p className="text-[13px] text-pd-ink-3">Showing {items.length} of {meta.total}. <Link href={`/admin/projects?client=${clientId}`} className="underline">See them all</Link></p> : null}
    </div>
  );
}

async function ActivityTab({ clientId, viewer }: { clientId: string; viewer: Awaited<ReturnType<typeof requireAdminPage>> }) {
  const entries = await getRecordActivity(viewer, { clientId }, 30);
  return <Panel><AuditFeed entries={entries} emptyTitle="No activity on this client yet" /></Panel>;
}
