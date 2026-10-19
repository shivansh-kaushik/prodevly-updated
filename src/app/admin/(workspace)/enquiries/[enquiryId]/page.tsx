import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditFeed } from '@/components/admin/audit-feed';
import { PageHeader } from '@/components/admin/page-header';
import { StatusHistory } from '@/components/admin/status-history';
import { Badge } from '@/components/ui/badge';
import { DescriptionList, Panel, PanelHeader } from '@/components/ui/panel';
import { StatusBadge } from '@/components/ui/status-badge';
import { AppError } from '@/lib/api/errors';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { formatDateTime } from '@/lib/admin/format';
import { parseObjectId } from '@/lib/validation/common';
import { getActivity } from '@/services/activity.service';
import { getClientFormOptions } from '@/services/client.service';
import { getLead } from '@/services/lead.service';
import { mailtoHref, telHref } from '../_components/contact-links';
import { ConvertButton } from '../_components/convert-dialog';
import { HandlingPanel } from '../_components/handling-panel';
import { NoteForm } from '../_components/note-form';
import { PlainText } from '../_components/plain-text';
import { RecordActions } from '../_components/record-actions';

export const metadata: Metadata = { title: 'Enquiry' };

const link = 'underline underline-offset-2 hover:text-pd-blue';

export default async function EnquiryPage({ params }: { params: Promise<{ enquiryId: string }> }) {
  const viewer = await requireAdminPage('/admin/enquiries', { capability: 'lead:view' });
  let id: string;
  try {
    id = parseObjectId((await params).enquiryId);
  } catch {
    notFound();
  }
  const lead = await getLead(viewer, id).catch((error: unknown) => {
    if (error instanceof AppError && error.code === 'NOT_FOUND') return null;
    throw error;
  });
  if (!lead) notFound();
  const activity = await getActivity({ entityType: 'lead', entityId: id }, { limit: 15 });

  const canEdit = viewer.capabilities.has('lead:edit');
  const canMarkSpam = canEdit && lead.status !== 'spam';
  const canDelete = viewer.capabilities.has('lead:delete');
  // Converting makes a client, so it needs client:edit as well. Spam is restored first; a converted enquiry is done.
  const canConvert = canEdit && viewer.capabilities.has('client:edit') && lead.status !== 'spam' && lead.converted === null;
  const currencies = canConvert ? (await getClientFormOptions()).currencies : [];
  const mail = mailtoHref(lead.email);
  const tel = telHref(lead.phone);
  const hasUtm = Boolean(lead.utm.source || lead.utm.medium || lead.utm.campaign);

  // On a phone the order is what you need first: the message, what you can do, who to reach, then the rest.
  // On a wide screen the two wrappers become the two columns.
  return (
    <>
      <PageHeader
        title={lead.name}
        description={lead.company ?? undefined}
        crumbs={[{ label: 'Enquiries', href: '/admin/enquiries' }, { label: lead.name }]}
        actions={
          canConvert ? (
            <ConvertButton
              lead={{ id: lead.id, ref: lead.ref, name: lead.name, company: lead.company, email: lead.email, phone: lead.phone, country: lead.country }}
              currencies={currencies}
              canStartProject={viewer.capabilities.has('project:edit')}
            />
          ) : undefined
        }
        meta={
          <span className="flex items-center gap-2">
            <span className="font-pd-mono text-[13px] text-pd-ink-3">{lead.ref}</span>
            <StatusBadge status={lead.status} />
          </span>
        }
      />

      {lead.status === 'spam' ? (
        <p className="mb-6 rounded-pd-md bg-pd-rubric-wash px-4 py-3 text-[14px] text-pd-ink">
          <span className="font-medium">Marked as spam.</span> It is hidden from the everyday list and the dashboard figures. Change its status to bring it back.
        </p>
      ) : null}

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-6">
          <Panel className="order-1 lg:order-none">
            <PanelHeader title="Message" hint={`Received ${formatDateTime(lead.createdAt)}`} />
            <PlainText text={lead.message} />
          </Panel>

          <Panel className="order-4 lg:order-none">
            <PanelHeader title="Notes" hint="Internal. The visitor never sees these." />
            {lead.notes.length === 0 ? (
              <p className="mb-5 text-[13px] text-pd-ink-3">No notes yet.</p>
            ) : (
              <ol className="mb-5 flex flex-col">
                {[...lead.notes].reverse().map((n, i) => (
                  <li key={`${n.at}-${i}`} className="border-b border-pd-rule-soft py-3 first:pt-0 last:border-b-0">
                    <PlainText text={n.text} className="leading-5" />
                    <p className="mt-1 text-[12px] text-pd-ink-3">{n.by}, <time dateTime={n.at}>{formatDateTime(n.at)}</time></p>
                  </li>
                ))}
              </ol>
            )}
            {canEdit ? <NoteForm id={lead.id} /> : null}
          </Panel>

          <Panel className="order-6 lg:order-none">
            <PanelHeader title="Status history" />
            <StatusHistory items={lead.statusHistory} />
          </Panel>

          <Panel className="order-7 lg:order-none">
            <PanelHeader title="Activity" />
            <AuditFeed entries={activity} emptyTitle="No activity on this enquiry yet" />
          </Panel>
        </div>

        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-6">
          <Panel className="order-2 lg:order-none">
            <PanelHeader title="Handling" />
            <HandlingPanel
              id={lead.id}
              status={lead.status}
              assignedTo={lead.assignedTo}
              followUpOn={lead.followUpOn}
              viewer={{ id: viewer.id, name: viewer.name }}
              canEdit={canEdit}
            />
          </Panel>

          <Panel className="order-3 lg:order-none">
            <PanelHeader title="Contact" />
            <DescriptionList
              columns={1}
              items={[
                { label: 'Email', value: mail ? <a href={mail} className={link}>{lead.email}</a> : lead.email },
                ...(lead.phone ? [{ label: 'Phone', value: tel ? <a href={tel} className={link}>{lead.phone}</a> : lead.phone }] : []),
                ...(lead.company ? [{ label: 'Company', value: lead.company }] : []),
                ...(lead.country ? [{ label: 'Country', value: lead.country }] : []),
              ]}
            />
          </Panel>

          <Panel className="order-5 lg:order-none">
            <PanelHeader title="Details" />
            <DescriptionList
              columns={1}
              items={[
                { label: 'Services of interest', value: lead.services.length ? lead.services.map((s) => s.title).join(', ') : '' },
                { label: 'Budget range', value: lead.budgetRange ?? '' },
                { label: 'Sent from page', value: lead.sourcePath ? <span className="font-pd-mono text-[13px]">{lead.sourcePath}</span> : '' },
                ...(hasUtm
                  ? [
                      ...(lead.utm.source ? [{ label: 'UTM source', value: lead.utm.source }] : []),
                      ...(lead.utm.medium ? [{ label: 'UTM medium', value: lead.utm.medium }] : []),
                      ...(lead.utm.campaign ? [{ label: 'UTM campaign', value: lead.utm.campaign }] : []),
                    ]
                  : []),
                { label: 'First reply', value: lead.firstResponseAt ? formatDateTime(lead.firstResponseAt) : 'Not yet' },
              ]}
            />
            {lead.converted ? (
              <p className="mt-4 flex flex-wrap items-center gap-2 border-t border-pd-rule pt-3 text-[13px]">
                <Badge tone="credit">Converted</Badge>
                {viewer.capabilities.has('client:view') ? <Link href={`/admin/clients/${lead.converted.clientId}`} className={link}>Open the client</Link> : null}
                {lead.converted.projectId && viewer.capabilities.has('project:view') ? <Link href={`/admin/projects/${lead.converted.projectId}`} className={link}>Open the project</Link> : null}
              </p>
            ) : null}
          </Panel>

          {canMarkSpam || canDelete ? (
            <Panel className="order-8 lg:order-none">
              <PanelHeader title="Actions" />
              <RecordActions id={lead.id} name={lead.name} canMarkSpam={canMarkSpam} canDelete={canDelete} converted={lead.converted !== null} />
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
