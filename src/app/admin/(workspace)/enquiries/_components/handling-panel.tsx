'use client';

import { useState } from 'react';
import { UserCheck } from 'lucide-react';
import { EntityPicker, type PickerValue } from '@/components/admin/entity-picker';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { humanize } from '@/lib/admin/format';
import { LEAD_STATUSES, type LeadStatus } from '@/config/statuses';
import { useEnquirySave } from './use-enquiry-save';

interface Props {
  id: string;
  status: LeadStatus;
  assignedTo: { id: string; name: string } | null;
  /** YYYY-MM-DD */
  followUpOn: string | null;
  viewer: { id: string; name: string };
  /** False for a viewer who may look but not change (no lead:edit): the values are shown, the controls are not. */
  canEdit: boolean;
}

const formError = (message?: string) => (message ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{message}</p> : null);

/**
 * The three things staff set on an enquiry: its status (with an optional note that goes into the
 * history), who owns it, and when to follow up. Each has its own Save, enabled only when it changed.
 * Marking spam is a separate, confirmed action (see record-actions).
 */
export function HandlingPanel({ id, status, assignedTo, followUpOn, viewer, canEdit }: Props) {
  if (!canEdit) {
    return (
      <div className="flex flex-col gap-3">
        <dl className="flex flex-col gap-3 text-[14px]">
          <div><dt className="pd-eyebrow">Status</dt><dd>{humanize(status)}</dd></div>
          <div><dt className="pd-eyebrow">Assigned to</dt><dd>{assignedTo?.name ?? 'Unassigned'}</dd></div>
          <div><dt className="pd-eyebrow">Follow-up</dt><dd>{followUpOn ?? 'None'}</dd></div>
        </dl>
        <p className="text-[13px] text-pd-ink-3">Your access lets you read enquiries but not change them.</p>
      </div>
    );
  }
  // Each section is keyed by the value the server last sent, so when it changes (a save here, or a
  // teammate editing the same enquiry) the form starts again from it instead of holding a stale pick.
  return (
    <div className="flex flex-col gap-6">
      <StatusSection key={status} id={id} status={status} />
      <AssigneeSection key={assignedTo?.id ?? 'unassigned'} id={id} assignedTo={assignedTo} viewer={viewer} />
      <FollowUpSection key={followUpOn ?? 'none'} id={id} followUpOn={followUpOn} />
    </div>
  );
}

function StatusSection({ id, status }: { id: string; status: LeadStatus }) {
  const { save, busy, error, clearError } = useEnquirySave(id);
  const [value, setValue] = useState<LeadStatus>(status);
  const [note, setNote] = useState('');
  // Spam has its own confirmed action; it only appears here so an enquiry already in spam can be moved back out.
  const options = LEAD_STATUSES.filter((s) => s !== 'spam' || status === 'spam');
  const dirty = value !== status;

  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (!dirty) return;
        if (await save({ status: value, ...(note.trim() ? { statusNote: note.trim() } : {}) }, 'Status updated.')) setNote('');
      }}
    >
      <Field label="Status" error={error?.fields.status}>
        {(c) => (
          <Select {...c} value={value} onChange={(e) => { setValue(e.target.value as LeadStatus); clearError(); }}>
            {options.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </Select>
        )}
      </Field>
      {dirty ? (
        <Field label="Note for the history" hint="Optional. Why it moved, or what was agreed." error={error?.fields.statusNote}>
          {(c) => <Input {...c} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      ) : null}
      {formError(error && Object.keys(error.fields).length === 0 ? error.message : undefined)}
      <div><Button type="submit" variant="primary" size="sm" disabled={!dirty} loading={busy}>Update status</Button></div>
    </form>
  );
}

function AssigneeSection({ id, assignedTo, viewer }: { id: string; assignedTo: { id: string; name: string } | null; viewer: { id: string; name: string } }) {
  const { save, busy, error, clearError } = useEnquirySave(id);
  const saved: PickerValue | null = assignedTo ? { id: assignedTo.id, label: assignedTo.name } : null;
  const [value, setValue] = useState<PickerValue | null>(saved);
  const dirty = (value?.id ?? null) !== (assignedTo?.id ?? null);
  const mine = assignedTo?.id === viewer.id;

  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (dirty) await save({ assignedTo: value?.id ?? null }, value ? `Assigned to ${value.label}.` : 'Unassigned.');
      }}
    >
      <Field label="Assigned to" error={error?.fields.assignedTo}>
        {(c) => (
          <EntityPicker
            kind="admins"
            id={c.id}
            value={value}
            onChange={(v) => { setValue(v); clearError(); }}
            placeholder="Search the team"
            invalid={Boolean(c['aria-invalid'])}
            describedBy={c['aria-describedby']}
          />
        )}
      </Field>
      {formError(error && Object.keys(error.fields).length === 0 ? error.message : undefined)}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={!dirty} loading={busy}>Save assignee</Button>
        {!mine ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={async () => {
              if (await save({ assignedTo: viewer.id }, 'Assigned to you.')) setValue({ id: viewer.id, label: viewer.name });
            }}
          >
            <UserCheck className="size-4" aria-hidden /> Assign to me
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function FollowUpSection({ id, followUpOn }: { id: string; followUpOn: string | null }) {
  const { save, busy, error, clearError } = useEnquirySave(id);
  const [value, setValue] = useState(followUpOn ?? '');
  const dirty = value !== (followUpOn ?? '');

  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (dirty) await save({ followUpOn: value || null }, value ? 'Follow-up date saved.' : 'Follow-up date cleared.');
      }}
    >
      <Field label="Follow up on" hint="Shows on the dashboard from this day until the enquiry is closed." error={error?.fields.followUpOn}>
        {(c) => <Input {...c} type="date" value={value} onChange={(e) => { setValue(e.target.value); clearError(); }} />}
      </Field>
      {formError(error && Object.keys(error.fields).length === 0 ? error.message : undefined)}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={!dirty} loading={busy}>Save date</Button>
        {followUpOn && !dirty ? (
          <Button variant="ghost" size="sm" disabled={busy} onClick={async () => { if (await save({ followUpOn: null }, 'Follow-up date cleared.')) setValue(''); }}>
            Clear date
          </Button>
        ) : null}
      </div>
    </form>
  );
}
