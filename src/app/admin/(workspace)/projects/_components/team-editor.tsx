'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Users } from 'lucide-react';
import { useAdminApi } from '@/components/admin/api-provider';
import type { PickerValue } from '@/components/admin/entity-picker';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/admin/api-client';
import { MembersField } from './members-field';
import type { PersonOption } from './types';

/** Changes who leads the project and who is on the team, without opening the whole edit form. */
export function TeamEditor({ projectId, lead, members }: { projectId: string; lead: PersonOption | null; members: PersonOption[] }) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [leadValue, setLead] = useState<PickerValue | null>(lead);
  const [team, setTeam] = useState<PickerValue[]>(members);
  const [errors, setErrors] = useState<{ lead?: string; members?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  function show() {
    setLead(lead);
    setTeam(members);
    setErrors({});
    setOpen(true);
  }

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      await call(`/api/admin/projects/${projectId}`, { method: 'PATCH', body: { leadId: leadValue?.id ?? null, memberIds: team.map((m) => m.id) } });
      toast.show('Team saved.');
      setOpen(false);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) setErrors({ lead: err.fields.leadId, members: err.fields.memberIds, form: err.fields.leadId || err.fields.memberIds ? undefined : err.message });
      else setErrors({ form: 'Something went wrong. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={show}><Users className="size-4" aria-hidden /> Manage team</Button>
      <Dialog
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Manage team"
        description="The lead is always on the team."
        size="md"
        dismissible={!busy}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={save} loading={busy}>Save team</Button>
          </>
        }
      >
        <MembersField lead={leadValue} members={team} onLeadChange={setLead} onMembersChange={setTeam} errors={errors} />
        {errors.form ? <p role="alert" className="mt-3 text-[13px] font-medium text-pd-rubric">{errors.form}</p> : null}
      </Dialog>
    </>
  );
}
