'use client';

import { EntityPicker, type PickerValue } from '@/components/admin/entity-picker';
import { MediaPicker } from '@/components/admin/media-picker';
import { Field, Input, Textarea } from '@/components/ui/field';
import { useForm } from '@/lib/admin/use-form';
import { MAX_BIO_LENGTH, type DeveloperDTO, type MediaRefDTO } from '@/lib/content/types';
import { EditorShell, useContentSave } from './editor-shell';
import { PermissionTick, TagsField } from './fields';
import { orNull } from './lists';

interface Values extends Record<string, unknown> {
  displayName: string;
  jobTitle: string;
  photo: MediaRefDTO | null;
  bio: string;
  skills: string[];
  github: string;
  linkedin: string;
  website: string;
  account: PickerValue | null;
  consentConfirmed: boolean;
}

export function DeveloperForm({ item, canLinkAccount, readOnlyReason }: { item?: DeveloperDTO; canLinkAccount: boolean; readOnlyReason?: string }) {
  const save = useContentSave('developers', item?.id);
  const form = useForm<Values>({
    displayName: item?.title ?? '',
    jobTitle: item?.jobTitle ?? '',
    photo: item?.photoMedia ?? null,
    bio: item?.bio ?? '',
    skills: item?.skills ?? [],
    github: item?.links.github ?? '',
    linkedin: item?.links.linkedin ?? '',
    website: item?.links.website ?? '',
    account: item?.adminId ? { id: item.adminId, label: item.adminName ?? 'Linked team member' } : null,
    consentConfirmed: item?.consentConfirmed ?? false,
  });
  const v = form.values;
  const e = form.errors;
  const left = MAX_BIO_LENGTH - v.bio.length;

  const onSubmit = form.submit(async (values) => {
    await save({
      displayName: values.displayName,
      title: orNull(values.jobTitle),
      photoMediaId: values.photo?.id ?? null,
      bio: orNull(values.bio),
      skills: values.skills,
      links: { github: orNull(values.github), linkedin: orNull(values.linkedin), website: orNull(values.website) },
      // Left out when this person cannot see the team, so saving never changes or probes the link.
      ...(canLinkAccount ? { adminId: values.account?.id ?? null } : {}),
      consentConfirmed: values.consentConfirmed,
    });
  });

  return (
    <EditorShell onSubmit={onSubmit} submitting={form.submitting} formError={form.formError} readOnlyReason={readOnlyReason} cancelHref="/admin/content/developers" submitLabel={item ? 'Save changes' : 'Save draft'}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name shown on the site" error={e.displayName} required>
          {(c) => <Input {...c} maxLength={80} value={v.displayName} onChange={(ev) => form.set('displayName', ev.target.value)} />}
        </Field>
        <Field label="Job title" error={e.title}>
          {(c) => <Input {...c} maxLength={80} value={v.jobTitle} onChange={(ev) => form.set('jobTitle', ev.target.value)} />}
        </Field>
      </div>
      <MediaPicker label="Photo" value={v.photo} onChange={(m) => form.set('photo', m)} error={e.photoMediaId} />
      <Field label="Short bio" hint={`${left >= 0 ? `${left} characters left` : `${-left} characters over`} of ${MAX_BIO_LENGTH}.`} error={e.bio}>
        {(c) => <Textarea {...c} rows={4} value={v.bio} onChange={(ev) => form.set('bio', ev.target.value)} />}
      </Field>
      <TagsField label="Skills" hint="Separate with commas." value={v.skills} onChange={(list) => form.set('skills', list)} error={e.skills} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="GitHub" error={e['links.github']}>
          {(c) => <Input {...c} type="url" inputMode="url" placeholder="https://" maxLength={200} value={v.github} onChange={(ev) => form.set('github', ev.target.value)} />}
        </Field>
        <Field label="LinkedIn" error={e['links.linkedin']}>
          {(c) => <Input {...c} type="url" inputMode="url" placeholder="https://" maxLength={200} value={v.linkedin} onChange={(ev) => form.set('linkedin', ev.target.value)} />}
        </Field>
        <Field label="Website" error={e['links.website']}>
          {(c) => <Input {...c} type="url" inputMode="url" placeholder="https://" maxLength={200} value={v.website} onChange={(ev) => form.set('website', ev.target.value)} />}
        </Field>
      </div>
      {canLinkAccount ? (
        <Field label="Team account" hint="Optional. Links this profile to the person's account for your team only: no account detail reaches the site." error={e.adminId}>
          {(c) => <EntityPicker kind="admins" id={c.id} value={v.account} onChange={(a) => form.set('account', a)} placeholder="Search the team" describedBy={c['aria-describedby']} invalid={Boolean(e.adminId)} />}
        </Field>
      ) : null}
      <PermissionTick
        label="This person has agreed to be shown"
        explanation="Required before this can be published. Their name, photo and bio will be public."
        checked={v.consentConfirmed}
        onChange={(checked) => form.set('consentConfirmed', checked)}
        error={e.consentConfirmed}
      />
    </EditorShell>
  );
}
