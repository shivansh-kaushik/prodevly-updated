'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAdminApi } from '@/components/admin/api-provider';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { DescriptionList } from '@/components/ui/panel';
import { useToast } from '@/components/ui/toast';
import { humanize } from '@/lib/admin/format';
import { useForm } from '@/lib/admin/use-form';
import type { OwnProfileDTO } from '@/services/team.service';

interface Values extends Record<string, unknown> {
  phone: string;
  designation: string;
  skills: string;
}

const toValues = (p: OwnProfileDTO): Values => ({ phone: p.phone ?? '', designation: p.designation ?? '', skills: p.skills.join(', ') });
const skillList = (text: string) => text.split(',').map((s) => s.trim()).filter(Boolean);

/**
 * The part of the team profile a person owns: phone, title and skills. Job role, employment type and weekly
 * capacity are set by a superadmin, so they are shown beside it, read-only. Pay is not on this screen.
 */
export function OwnProfileForm({ profile }: { profile: OwnProfileDTO }) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const [saved, setSaved] = useState<Values>(() => toValues(profile));
  const form = useForm<Values>(saved);
  const dirty = form.values.phone.trim() !== saved.phone || form.values.designation.trim() !== saved.designation || JSON.stringify(skillList(form.values.skills)) !== JSON.stringify(skillList(saved.skills));
  // The server reports a bad skill as "skills.3": any key under skills belongs to this one field.
  const skillsError = Object.entries(form.errors).find(([key]) => key === 'skills' || key.startsWith('skills.'))?.[1];

  const onSubmit = form.submit(async (v) => {
    const data = await call<{ profile: OwnProfileDTO }>('/api/admin/team/profile', {
      method: 'PATCH',
      body: { phone: v.phone.trim(), designation: v.designation.trim(), skills: skillList(v.skills) },
    });
    const next = toValues(data.profile);
    setSaved(next);
    form.setValues(next);
    toast.show('Profile saved.');
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone" error={form.errors.phone}>
          {(c) => <Input {...c} type="tel" inputMode="tel" autoComplete="tel" maxLength={30} value={form.values.phone} onChange={(e) => form.set('phone', e.target.value)} />}
        </Field>
        <Field label="Title" hint="What colleagues see next to your name." error={form.errors.designation}>
          {(c) => <Input {...c} autoComplete="organization-title" maxLength={80} value={form.values.designation} onChange={(e) => form.set('designation', e.target.value)} />}
        </Field>
      </div>
      <Field label="Skills" hint="Separate with commas." error={skillsError}>
        {(c) => <Input {...c} autoComplete="off" placeholder="React, Node, Figma" value={form.values.skills} onChange={(e) => form.set('skills', e.target.value)} />}
      </Field>

      <div className="border-t border-pd-rule pt-5">
        <p className="mb-3 text-[12px] text-pd-ink-3">A superadmin sets these. Ask one if they are wrong.</p>
        <DescriptionList
          columns={3}
          items={[
            { label: 'Job role', value: profile.jobRole },
            { label: 'Employment', value: profile.employmentType ? humanize(profile.employmentType) : '' },
            { label: 'Weekly capacity', value: profile.weeklyCapacityHours ? `${profile.weeklyCapacityHours} hours` : '' },
          ]}
        />
      </div>

      {form.formError && Object.keys(form.errors).length === 0 ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{form.formError}</p> : null}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" disabled={!dirty} loading={form.submitting}>Save profile</Button>
        {dirty ? <Button variant="ghost" onClick={() => form.reset(saved)} disabled={form.submitting}>Discard</Button> : null}
      </div>
    </form>
  );
}
