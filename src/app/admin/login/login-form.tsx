'use client';

import { adminFetch } from '@/lib/admin/api-client';
import { useForm } from '@/lib/admin/use-form';
import { safeNextPath } from '@/lib/auth/safe-next-path';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';

export function LoginForm({ next }: { next: string }) {
  const form = useForm({ email: '', password: '' });

  const onSubmit = form.submit(async (v) => {
    const data = await adminFetch<{ mustChangePassword: boolean }>('/api/admin/auth/login', { body: v });
    // A full navigation, so the server renders the next screen with the new cookie.
    window.location.assign(data.mustChangePassword ? '/admin/account/password' : safeNextPath(next));
    await new Promise(() => {}); // keep the button busy until the page unloads
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field label="Email" error={form.errors.email}>
        {(c) => <Input {...c} type="email" name="email" autoComplete="username" inputMode="email" autoFocus value={form.values.email} onChange={(e) => form.set('email', e.target.value)} />}
      </Field>
      <Field label="Password" error={form.errors.password}>
        {(c) => <Input {...c} type="password" name="password" autoComplete="current-password" value={form.values.password} onChange={(e) => form.set('password', e.target.value)} />}
      </Field>
      {form.formError ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{form.formError}</p> : null}
      <Button type="submit" variant="primary" loading={form.submitting} className="mt-1 w-full">Sign in</Button>
    </form>
  );
}
