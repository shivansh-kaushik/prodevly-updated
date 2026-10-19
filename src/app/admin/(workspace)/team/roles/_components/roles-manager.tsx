'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useAdminApi } from '@/components/admin/api-provider';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input, Textarea } from '@/components/ui/field';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/admin/api-client';
import { formatCount } from '@/lib/admin/format';
import { useForm } from '@/lib/admin/use-form';
import type { TeamRoleDTO } from '@/services/team-role.service';

const holders = (n: number) => (n === 0 ? 'No one holds it' : `${formatCount(n)} ${n === 1 ? 'person holds' : 'people hold'} it`);

type Pending = { kind: 'archive' | 'delete'; role: TeamRoleDTO } | null;

/**
 * Create, rename, reorder, archive, restore and delete job roles. Reordering is two arrow buttons (keyboard and
 * touch friendly, no drag). A role someone holds can be archived but not deleted: the button is not offered, and
 * the server refuses it too.
 */
export function RolesManager({ roles }: { roles: TeamRoleDTO[] }) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<TeamRoleDTO | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  const live = roles.filter((r) => !r.archived);
  const archived = roles.filter((r) => r.archived);

  /** Runs one change, then reloads the list. A refusal (a stale list, a rule) is shown, never swallowed. */
  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await action();
      if (done) toast.show(done);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.', 'error');
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  const move = (index: number, delta: -1 | 1) => {
    const ids = live.map((r) => r.id);
    const target = index + delta;
    const a = ids[index];
    const b = ids[target];
    if (a === undefined || b === undefined) return;
    ids[index] = b;
    ids[target] = a;
    return run(() => call('/api/admin/team/roles/reorder', { body: { ids } }));
  };

  return (
    <div className="flex flex-col gap-6">
      <AddRoleForm />

      <Panel flush>
        <div className="px-5 pt-5">
          <PanelHeader title="Job roles" hint={live.length > 0 ? 'The order here is the order in menus.' : undefined} />
        </div>
        {live.length === 0 ? (
          <EmptyState title="No job roles yet" body="Add the first one above. Pick names your team already uses." className="py-10" />
        ) : (
          <ol className="border-t border-pd-rule-soft">
            {live.map((r, i) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-pd-rule-soft px-5 py-3 last:border-b-0">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-[14px] font-medium text-pd-ink">{r.name}</p>
                  {r.description ? <p className="text-[13px] text-pd-ink-3">{r.description}</p> : null}
                  <p className="text-[12px] text-pd-ink-3">{holders(r.memberCount)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <IconButton label={`Move ${r.name} up`} disabled={busy || i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp className="size-4" aria-hidden />
                  </IconButton>
                  <IconButton label={`Move ${r.name} down`} disabled={busy || i === live.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown className="size-4" aria-hidden />
                  </IconButton>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(r)}>Edit</Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPending({ kind: 'archive', role: r })}>Archive</Button>
                  {r.memberCount === 0 ? <Button size="sm" variant="danger" disabled={busy} onClick={() => setPending({ kind: 'delete', role: r })}>Delete</Button> : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      {archived.length > 0 ? (
        <Panel flush>
          <div className="px-5 pt-5">
            <PanelHeader title="Archived" hint="Hidden from menus. People who hold one keep it." />
          </div>
          <ul className="border-t border-pd-rule-soft">
            {archived.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-pd-rule-soft px-5 py-3 last:border-b-0">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-[14px] font-medium text-pd-ink-2">{r.name} <Badge className="ml-1.5">Archived</Badge></p>
                  <p className="text-[12px] text-pd-ink-3">{holders(r.memberCount)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => call(`/api/admin/team/roles/${r.id}/restore`, { body: {} }), `${r.name} restored.`)}>Restore</Button>
                  {r.memberCount === 0 ? <Button size="sm" variant="danger" disabled={busy} onClick={() => setPending({ kind: 'delete', role: r })}>Delete</Button> : null}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {editing ? <EditRoleDialog key={editing.id} role={editing} onClose={() => setEditing(null)} /> : null}

      {/* One at a time: ConfirmDialog's form has a fixed id, so two mounted together would cross their submit buttons. */}
      {pending ? (
        <ConfirmDialog
          key={`${pending.kind}-${pending.role.id}`}
          open
          onClose={() => setPending(null)}
          title={pending.kind === 'archive' ? `Archive ${pending.role.name}?` : `Delete ${pending.role.name}?`}
          description={
            pending.kind === 'delete'
              ? 'This removes it for good. Nobody holds it, so no one loses a label. Archive instead if you may want it back.'
              : pending.role.memberCount > 0
                ? `${holders(pending.role.memberCount)}. They keep it, but it no longer appears in menus for anyone else. You can restore it later.`
                : 'It disappears from menus. You can restore it later.'
          }
          confirmLabel={pending.kind === 'archive' ? 'Archive' : 'Delete job role'}
          tone={pending.kind === 'archive' ? 'primary' : 'danger'}
          onConfirm={async () => {
            if (pending.kind === 'archive') await call(`/api/admin/team/roles/${pending.role.id}/archive`, { body: {} });
            else await call(`/api/admin/team/roles/${pending.role.id}`, { method: 'DELETE' });
            toast.show(pending.kind === 'archive' ? `${pending.role.name} archived.` : `${pending.role.name} deleted.`);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function AddRoleForm() {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const form = useForm<{ name: string; description: string }>({ name: '', description: '' });

  const onSubmit = form.submit(async (v) => {
    await call('/api/admin/team/roles', { body: { name: v.name, ...(v.description.trim() ? { description: v.description } : {}) } });
    toast.show(`${v.name.trim()} added.`);
    form.reset({ name: '', description: '' });
    router.refresh();
  });

  return (
    <Panel>
      <PanelHeader title="Add a job role" />
      <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] sm:items-start">
        <Field label="Name" error={form.errors.name} required>
          {(c) => <Input {...c} autoComplete="off" maxLength={60} placeholder="Frontend developer" value={form.values.name} onChange={(e) => form.set('name', e.target.value)} />}
        </Field>
        <Field label="What it covers" hint="Optional." error={form.errors.description}>
          {(c) => <Input {...c} autoComplete="off" maxLength={300} value={form.values.description} onChange={(e) => form.set('description', e.target.value)} />}
        </Field>
        <div className="sm:pt-[1.625rem]">
          <Button type="submit" variant="primary" loading={form.submitting} className="w-full sm:w-auto">Add job role</Button>
        </div>
        {form.formError && !Object.keys(form.errors).length ? <p role="alert" className="text-[13px] font-medium text-pd-rubric sm:col-span-3">{form.formError}</p> : null}
      </form>
    </Panel>
  );
}

function EditRoleDialog({ role, onClose }: { role: TeamRoleDTO; onClose: () => void }) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const form = useForm<{ name: string; description: string }>({ name: role.name, description: role.description ?? '' });
  const dirty = form.values.name.trim() !== role.name || form.values.description.trim() !== (role.description ?? '');

  const onSubmit = form.submit(async (v) => {
    await call(`/api/admin/team/roles/${role.id}`, { method: 'PATCH', body: { name: v.name, description: v.description } });
    toast.show('Job role updated.');
    onClose();
    router.refresh();
  });

  return (
    <Dialog
      open
      onClose={() => { if (!form.submitting) onClose(); }}
      title={`Edit ${role.name}`}
      size="md"
      dismissible={!form.submitting}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={form.submitting}>Cancel</Button>
          <Button variant="primary" type="submit" form="edit-role-form" loading={form.submitting} disabled={!dirty}>Save</Button>
        </>
      }
    >
      <form id="edit-role-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Name" error={form.errors.name} required>
          {(c) => <Input {...c} autoComplete="off" maxLength={60} autoFocus value={form.values.name} onChange={(e) => form.set('name', e.target.value)} />}
        </Field>
        <Field label="What it covers" hint="Leave empty for none." error={form.errors.description}>
          {(c) => <Textarea {...c} rows={3} maxLength={300} value={form.values.description} onChange={(e) => form.set('description', e.target.value)} />}
        </Field>
        {form.formError && !Object.keys(form.errors).length ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{form.formError}</p> : null}
      </form>
    </Dialog>
  );
}
