'use client';

import { useRouter } from 'next/navigation';
import { useAdminApi } from '@/components/admin/api-provider';
import { Button, LinkButton } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { useForm } from '@/lib/admin/use-form';
import type { AdminRole } from '@/config/capabilities';
import { GrantsEditor } from './grants-editor';
import { RolePicker } from './role-picker';
import { TempPasswordField } from './temp-password-field';
import { generateTempPassword } from './temp-password';
import { useState } from 'react';

export function CreateAdminForm() {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const [initialPassword] = useState(generateTempPassword);
  const form = useForm<{ name: string; email: string; role: AdminRole; grants: string[]; password: string }>({
    name: '', email: '', role: 'admin', grants: [], password: initialPassword,
  });

  const onSubmit = form.submit(async (v) => {
    const data = await call<{ admin: { id: string } }>('/api/admin/admins', {
      body: { name: v.name, email: v.email, role: v.role, grants: v.role === 'admin' ? v.grants : [], password: v.password },
    });
    toast.show('Account created. Pass the temporary password to them.');
    router.push(`/admin/admins/${data.admin.id}`);
    await new Promise(() => {});
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-3xl flex-col gap-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" error={form.errors.name} required>
          {(c) => <Input {...c} autoComplete="off" value={form.values.name} onChange={(e) => form.set('name', e.target.value)} />}
        </Field>
        <Field label="Work email" error={form.errors.email} required>
          {(c) => <Input {...c} type="email" autoComplete="off" inputMode="email" value={form.values.email} onChange={(e) => form.set('email', e.target.value)} />}
        </Field>
      </div>
      <RolePicker value={form.values.role} onChange={(r) => form.set('role', r)} />
      {form.values.role === 'admin' ? <GrantsEditor value={form.values.grants} onChange={(g) => form.set('grants', g)} /> : null}
      <TempPasswordField value={form.values.password} onChange={(p) => form.set('password', p)} error={form.errors.password} />
      {form.errors.grants ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{form.errors.grants}</p> : null}
      {form.formError ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{form.formError}</p> : null}
      <div className="flex items-center gap-2 border-t border-pd-rule pt-5">
        <Button type="submit" variant="primary" loading={form.submitting}>Create account</Button>
        <LinkButton href="/admin/admins" variant="ghost">Cancel</LinkButton>
      </div>
    </form>
  );
}
