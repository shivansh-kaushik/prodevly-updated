'use client';

import { useRouter } from 'next/navigation';
import { useAdminApi } from '@/components/admin/api-provider';
import { Field, Input, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { useForm } from '@/lib/admin/use-form';
import type { SiteInfoDTO } from '@/lib/content/types';
import { EditorShell } from './editor-shell';
import { orNull } from './lists';

const SOCIALS = ['linkedin', 'github', 'x', 'instagram', 'dribbble', 'behance'] as const;
const SOCIAL_LABEL: Record<(typeof SOCIALS)[number], string> = { linkedin: 'LinkedIn', github: 'GitHub', x: 'X', instagram: 'Instagram', dribbble: 'Dribbble', behance: 'Behance' };

interface Values extends Record<string, unknown> {
  displayName: string;
  legalName: string;
  email: string;
  phone: string;
  whatsapp: string;
  address: string;
  footerNote: string;
  social: Record<(typeof SOCIALS)[number], string>;
}

/** Company details for the footer and the contact fallback. Empty fields are simply not shown. */
export function SiteForm({ site, readOnlyReason }: { site: SiteInfoDTO; readOnlyReason?: string }) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const form = useForm<Values>({
    displayName: site.displayName,
    legalName: site.legalName ?? '',
    email: site.email ?? '',
    phone: site.phone ?? '',
    whatsapp: site.whatsapp ?? '',
    address: site.address ?? '',
    footerNote: site.footerNote ?? '',
    social: Object.fromEntries(SOCIALS.map((k) => [k, site.social[k] ?? ''])) as Values['social'],
  });
  const v = form.values;
  const e = form.errors;

  const onSubmit = form.submit(async (values) => {
    await call('/api/admin/content/site', {
      method: 'PUT',
      body: {
        displayName: values.displayName,
        legalName: orNull(values.legalName),
        email: orNull(values.email),
        phone: orNull(values.phone),
        whatsapp: orNull(values.whatsapp),
        address: orNull(values.address),
        footerNote: orNull(values.footerNote),
        social: Object.fromEntries(SOCIALS.map((k) => [k, orNull(values.social[k])])),
      },
    });
    toast.show('Company info saved. It is live on the site.');
    router.refresh();
  });

  return (
    <EditorShell onSubmit={onSubmit} submitting={form.submitting} formError={form.formError} readOnlyReason={readOnlyReason} cancelHref="/admin/content" submitLabel="Save company info">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Display name" hint="How the studio is named on the site." error={e.displayName} required>
          {(c) => <Input {...c} maxLength={80} value={v.displayName} onChange={(ev) => form.set('displayName', ev.target.value)} />}
        </Field>
        <Field label="Legal name" error={e.legalName}>
          {(c) => <Input {...c} maxLength={160} value={v.legalName} onChange={(ev) => form.set('legalName', ev.target.value)} />}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Email" error={e.email}>
          {(c) => <Input {...c} type="email" inputMode="email" autoComplete="off" maxLength={160} value={v.email} onChange={(ev) => form.set('email', ev.target.value)} />}
        </Field>
        <Field label="Phone" error={e.phone}>
          {(c) => <Input {...c} type="tel" inputMode="tel" autoComplete="off" maxLength={40} value={v.phone} onChange={(ev) => form.set('phone', ev.target.value)} />}
        </Field>
        <Field label="WhatsApp" error={e.whatsapp}>
          {(c) => <Input {...c} type="tel" inputMode="tel" autoComplete="off" maxLength={40} value={v.whatsapp} onChange={(ev) => form.set('whatsapp', ev.target.value)} />}
        </Field>
      </div>
      <Field label="Address" error={e.address}>
        {(c) => <Textarea {...c} rows={3} maxLength={400} value={v.address} onChange={(ev) => form.set('address', ev.target.value)} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        {SOCIALS.map((k) => (
          <Field key={k} label={SOCIAL_LABEL[k]} error={e[`social.${k}`]}>
            {(c) => <Input {...c} type="url" inputMode="url" placeholder="https://" maxLength={200} value={v.social[k]} onChange={(ev) => form.set('social', { ...v.social, [k]: ev.target.value })} />}
          </Field>
        ))}
      </div>
      <Field label="Footer note" hint="A short line at the bottom of every page." error={e.footerNote}>
        {(c) => <Input {...c} maxLength={300} value={v.footerNote} onChange={(ev) => form.set('footerNote', ev.target.value)} />}
      </Field>
    </EditorShell>
  );
}
