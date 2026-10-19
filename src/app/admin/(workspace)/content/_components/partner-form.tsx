'use client';

import { MediaPicker } from '@/components/admin/media-picker';
import { Field, Input, Select } from '@/components/ui/field';
import { useForm } from '@/lib/admin/use-form';
import { PARTNER_KINDS } from '@/config/statuses';
import type { MediaRefDTO, PartnerDTO } from '@/lib/content/types';
import { EditorShell, useContentSave } from './editor-shell';
import { PermissionTick } from './fields';
import { orNull } from './lists';

const KIND_LABEL: Record<(typeof PARTNER_KINDS)[number], string> = { technology: 'Technology', agency: 'Agency', client: 'Client' };

interface Values extends Record<string, unknown> {
  name: string;
  kind: (typeof PARTNER_KINDS)[number];
  logo: MediaRefDTO | null;
  url: string;
  permissionConfirmed: boolean;
}

export function PartnerForm({ item, readOnlyReason }: { item?: PartnerDTO; readOnlyReason?: string }) {
  const save = useContentSave('partners', item?.id);
  const form = useForm<Values>({
    name: item?.title ?? '',
    kind: item?.kind ?? 'technology',
    logo: item?.logoMedia ?? null,
    url: item?.url ?? '',
    permissionConfirmed: item?.permissionConfirmed ?? false,
  });
  const v = form.values;
  const e = form.errors;

  const onSubmit = form.submit(async (values) => {
    await save({ name: values.name, kind: values.kind, logoMediaId: values.logo?.id ?? null, url: orNull(values.url), permissionConfirmed: values.permissionConfirmed });
  });

  return (
    <EditorShell onSubmit={onSubmit} submitting={form.submitting} formError={form.formError} readOnlyReason={readOnlyReason} cancelHref="/admin/content/partners" submitLabel={item ? 'Save changes' : 'Save draft'}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={e.name} required>
          {(c) => <Input {...c} maxLength={120} value={v.name} onChange={(ev) => form.set('name', ev.target.value)} />}
        </Field>
        <Field label="Kind" error={e.kind} required>
          {(c) => (
            <Select {...c} value={v.kind} onChange={(ev) => form.set('kind', ev.target.value as Values['kind'])}>
              {PARTNER_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </Select>
          )}
        </Field>
      </div>
      <MediaPicker label="Logo" hint="PNG, JPEG, WebP or AVIF. A logo with a transparent background works best." value={v.logo} onChange={(m) => form.set('logo', m)} error={e.logoMediaId} />
      <Field label="Website" error={e.url}>
        {(c) => <Input {...c} type="url" inputMode="url" placeholder="https://" maxLength={300} value={v.url} onChange={(ev) => form.set('url', ev.target.value)} />}
      </Field>
      <PermissionTick
        label="This partner has given permission to be shown"
        explanation="Required before this can be published. Do not show a company's name or logo without its agreement."
        checked={v.permissionConfirmed}
        onChange={(checked) => form.set('permissionConfirmed', checked)}
        error={e.permissionConfirmed}
      />
    </EditorShell>
  );
}
