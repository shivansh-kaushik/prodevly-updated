'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { adminDownload, adminFetch, ApiError, hardNavigate, type DownloadResult, type FetchOptions } from '@/lib/admin/api-client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { ToastProvider } from '@/components/ui/toast';

/**
 * Wraps every admin screen. `useAdminApi()` gives screens a `call()` that behaves like
 * adminFetch but also handles the three things no screen should have to remember:
 *
 * - step-up: a sensitive action answers STEP_UP_REQUIRED, the person re-enters their password
 *   in a dialog, and the SAME call is retried once;
 * - an expired or revoked session: sent through /admin/auth/clear back to sign-in;
 * - a pending password change: sent to the change-password page.
 */
type Call = <T>(path: string, options?: FetchOptions) => Promise<T>;
/** Like `call`, for a CSV: the same recovery, but the answer is a file rather than JSON. */
type Download = (path: string) => Promise<DownloadResult>;
interface AdminApi {
  call: Call;
  download: Download;
}
const ApiContext = createContext<AdminApi | null>(null);

export function useAdminApi(): AdminApi {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error('useAdminApi must be used inside <AdminProviders>');
  return ctx;
}

function StepUpDialog({ open, onDone }: { open: boolean; onDone: (ok: boolean) => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await adminFetch('/api/admin/auth/step-up', { body: { password } });
      setPassword('');
      onDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields.password ?? err.message) : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        setPassword('');
        setError(undefined);
        onDone(false);
      }}
      title="Confirm it is you"
      description="This action is sensitive. Enter your own password to continue. It stays unlocked for 10 minutes."
      size="sm"
      dismissible={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={() => onDone(false)} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="submit" form="step-up-form" loading={busy}>Confirm</Button>
        </>
      }
    >
      <form id="step-up-form" onSubmit={confirm}>
        <Field label="Your password" error={error} required>
          {(c) => <Input {...c} type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
      </form>
    </Dialog>
  );
}

export function AdminProviders({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const pending = useRef<((ok: boolean) => void) | null>(null);

  const requestStepUp = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        pending.current?.(false);
        pending.current = resolve;
        setStepUpOpen(true);
      }),
    [],
  );
  const finishStepUp = useCallback((ok: boolean) => {
    setStepUpOpen(false);
    pending.current?.(ok);
    pending.current = null;
  }, []);

  // The recovery every request shares, whatever it fetches: `attempt` is retried once after a step-up.
  const recover = useCallback(
    async <T,>(path: string, attempt: () => Promise<T>): Promise<T> => {
      try {
        return await attempt();
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (error.code === 'STEP_UP_REQUIRED' && (await requestStepUp())) return attempt();
        if (error.code === 'UNAUTHORIZED' && !path.startsWith('/api/admin/auth/')) {
          // A route handler that deletes the dead cookie: needs a real navigation, not the client router.
          hardNavigate(`/admin/auth/clear?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
          return new Promise<never>(() => {});
        }
        if (error.code === 'PASSWORD_CHANGE_REQUIRED') {
          router.push('/admin/account/password');
          return new Promise<never>(() => {});
        }
        throw error;
      }
    },
    [requestStepUp, router],
  );

  const call = useCallback<Call>((path, options) => recover(path, () => adminFetch(path, options)), [recover]);
  const download = useCallback<Download>((path) => recover(path, () => adminDownload(path)), [recover]);

  const value = useMemo(() => ({ call, download }), [call, download]);
  return (
    <ToastProvider>
      <ApiContext.Provider value={value}>
        {children}
        <StepUpDialog open={stepUpOpen} onDone={finishStepUp} />
      </ApiContext.Provider>
    </ToastProvider>
  );
}
