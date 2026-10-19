'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { KeyRound, LogOut, UserMinus, UserPlus } from 'lucide-react';
import { useAdminApi } from '@/components/admin/api-provider';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/admin/api-client';
import { TempPasswordField } from './temp-password-field';
import { generateTempPassword } from './temp-password';

export interface OpenTask {
  id: string;
  ref: string;
  title: string;
  status: string;
}

type Which = 'reset' | 'revoke' | 'deactivate' | 'reactivate' | null;

/** The four things a superadmin can do to someone else's account. Each one is audited; deactivating also ends their sessions. */
export function AccountActions({ id, name, active, openTasks }: { id: string; name: string; active: boolean; openTasks: OpenTask[] }) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const [which, setWhich] = useState<Which>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<{ message: string; field?: string }>();
  const [busy, setBusy] = useState(false);

  const close = () => { if (!busy) { setWhich(null); setError(undefined); } };
  const open = (w: Which) => { setPassword(generateTempPassword()); setError(undefined); setWhich(w); };

  async function submitPassword(kind: 'reset' | 'reactivate') {
    setBusy(true);
    setError(undefined);
    try {
      await call(`/api/admin/admins/${id}/${kind === 'reset' ? 'reset-password' : 'reactivate'}`, { body: { newPassword: password } });
      toast.show(kind === 'reset' ? 'Password reset. They must choose a new one at next sign-in.' : 'Account reactivated.');
      setWhich(null);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError) setError({ message: e.fields.newPassword ?? e.message, field: e.fields.newPassword });
      else setError({ message: 'Something went wrong. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-2">
      {active ? (
        <>
          <Button variant="secondary" onClick={() => open('reset')} className="justify-start"><KeyRound className="size-4" aria-hidden /> Reset password</Button>
          <Button variant="secondary" onClick={() => setWhich('revoke')} className="justify-start"><LogOut className="size-4" aria-hidden /> Sign out everywhere</Button>
          <Button variant="danger" onClick={() => setWhich('deactivate')} className="justify-start"><UserMinus className="size-4" aria-hidden /> Remove this account</Button>
        </>
      ) : (
        <Button variant="secondary" onClick={() => open('reactivate')} className="justify-start"><UserPlus className="size-4" aria-hidden /> Reactivate account</Button>
      )}

      {(['reset', 'reactivate'] as const).map((kind) => (
        <Dialog
          key={kind}
          open={which === kind}
          onClose={close}
          title={kind === 'reset' ? `Reset ${name}'s password` : `Reactivate ${name}`}
          description={kind === 'reset' ? 'Sets a temporary password, signs them out everywhere and makes them choose a new one at next sign-in.' : 'Brings the account back with a new temporary password. They must choose their own at first sign-in.'}
          size="md"
          dismissible={!busy}
          footer={
            <>
              <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
              <Button variant="primary" loading={busy} onClick={() => submitPassword(kind)}>{kind === 'reset' ? 'Reset password' : 'Reactivate'}</Button>
            </>
          }
        >
          <TempPasswordField value={password} onChange={setPassword} error={error?.field ? error.message : undefined} label="New temporary password" />
          {error && !error.field ? <p role="alert" className="mt-3 text-[13px] font-medium text-pd-rubric">{error.message}</p> : null}
        </Dialog>
      ))}

      <ConfirmDialog
        open={which === 'revoke'}
        onClose={close}
        title={`Sign ${name} out everywhere?`}
        description="Every browser and device they are signed in on is signed out on its next click. They can sign in again."
        confirmLabel="Sign out everywhere"
        tone="primary"
        onConfirm={async () => {
          await call(`/api/admin/admins/${id}/revoke-sessions`, { body: {} });
          toast.show('Signed out everywhere.');
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={which === 'deactivate'}
        onClose={close}
        title={`Remove ${name}?`}
        description={
          <>
            <p>They are signed out at once and cannot sign in again. Their work logs, payouts and history stay. You can reactivate the account later.</p>
            {openTasks.length > 0 ? (
              <div className="mt-3 rounded-pd-sm bg-pd-well p-3">
                <p className="text-[13px] font-medium text-pd-ink">{openTasks.length} open {openTasks.length === 1 ? 'task is' : 'tasks are'} assigned to them. Reassign {openTasks.length === 1 ? 'it' : 'them'} so the work does not stall.</p>
                <ul className="mt-1.5 flex flex-col gap-1 text-[13px]">
                  {openTasks.slice(0, 6).map((t) => (
                    <li key={t.id}><Link href={`/admin/tasks/${t.id}`} className="underline-offset-2 hover:underline"><span className="font-pd-mono text-[12px] text-pd-ink-3">{t.ref}</span> {t.title}</Link></li>
                  ))}
                  {openTasks.length > 6 ? <li className="text-pd-ink-3">and {openTasks.length - 6} more</li> : null}
                </ul>
              </div>
            ) : null}
          </>
        }
        confirmLabel="Remove account"
        reason={{ label: 'Why are you removing them?', placeholder: 'Left the company, moved to another team...' }}
        onConfirm={async (reason) => {
          await call(`/api/admin/admins/${id}/deactivate`, { body: { reason } });
          toast.show('Account removed.');
          router.refresh();
        }}
      />
    </div>
  );
}
