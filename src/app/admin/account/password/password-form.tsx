'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin/api-client';
import { useForm } from '@/lib/admin/use-form';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';

export function PasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter();
  const form = useForm({ currentPassword: '', newPassword: '', confirm: '' });

  const onSubmit = form.submit(async (v) => {
    if (v.newPassword !== v.confirm) {
      form.setErrors({ confirm: 'The two passwords do not match.' });
      return;
    }
    await adminFetch('/api/admin/auth/password', { body: { currentPassword: v.currentPassword, newPassword: v.newPassword } });
    router.replace('/admin');
    router.refresh();
    await new Promise(() => {}); // keep the button busy until the page changes
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field label={forced ? 'Temporary password' : 'Current password'} error={form.errors.currentPassword}>
        {(c) => <Input {...c} type="password" autoComplete="current-password" autoFocus value={form.values.currentPassword} onChange={(e) => form.set('currentPassword', e.target.value)} />}
      </Field>
      <Field
        label="New password"
        hint="At least 12 characters. Not your name or email, and not a common password. A few random words works well."
        error={form.errors.newPassword}
      >
        {(c) => <Input {...c} type="password" autoComplete="new-password" value={form.values.newPassword} onChange={(e) => form.set('newPassword', e.target.value)} />}
      </Field>
      <Field label="Repeat the new password" error={form.errors.confirm}>
        {(c) => <Input {...c} type="password" autoComplete="new-password" value={form.values.confirm} onChange={(e) => form.set('confirm', e.target.value)} />}
      </Field>
      {form.formError ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{form.formError}</p> : null}
      <div className="mt-1 flex items-center gap-2">
        <Button type="submit" variant="primary" loading={form.submitting}>Save password</Button>
        {forced ? null : <Link href="/admin/account" className="px-2 text-[14px] text-pd-ink-3 hover:text-pd-ink">Cancel</Link>}
      </div>
    </form>
  );
}
