'use client';

import { EntityPicker, type PickerValue } from '@/components/admin/entity-picker';
import { MediaListPicker, MediaPicker } from '@/components/admin/media-picker';
import { Checkbox, Field, Fieldset, Input, Textarea } from '@/components/ui/field';
import { useForm } from '@/lib/admin/use-form';
import type { MediaRefDTO, ShowcaseDTO } from '@/lib/content/types';
import { EditorShell, useContentSave } from './editor-shell';
import { PermissionTick, TagsField } from './fields';
import { orNull } from './lists';

interface Values extends Record<string, unknown> {
  title: string;
  clientDisplayName: string;
  summary: string;
  brief: string;
  built: string;
  result: string;
  serviceIds: string[];
  stack: string[];
  cover: MediaRefDTO | null;
  gallery: MediaRefDTO[];
  liveUrl: string;
  completedOn: string;
  project: PickerValue | null;
  clientApproved: boolean;
}

export function ShowcaseForm({ item, serviceOptions, canLinkProject, readOnlyReason }: {
  item?: ShowcaseDTO;
  serviceOptions: Array<{ id: string; title: string }>;
  canLinkProject: boolean;
  readOnlyReason?: string;
}) {
  const save = useContentSave('showcase', item?.id);
  const form = useForm<Values>({
    title: item?.title ?? '',
    clientDisplayName: item?.clientDisplayName ?? '',
    summary: item?.summary ?? '',
    brief: item?.body.brief ?? '',
    built: item?.body.built ?? '',
    result: item?.body.result ?? '',
    serviceIds: item?.serviceIds ?? [],
    stack: item?.stack ?? [],
    cover: item?.coverMedia ?? null,
    gallery: item?.galleryMedia ?? [],
    liveUrl: item?.liveUrl ?? '',
    completedOn: item?.completedOn ?? '',
    project: item?.projectId ? { id: item.projectId, label: item.projectLabel ?? 'Linked project' } : null,
    clientApproved: item?.clientApproved ?? false,
  });
  const v = form.values;
  const e = form.errors;

  const onSubmit = form.submit(async (values) => {
    await save({
      title: values.title,
      clientDisplayName: orNull(values.clientDisplayName),
      summary: values.summary,
      body: { brief: orNull(values.brief), built: orNull(values.built), result: orNull(values.result) },
      serviceIds: values.serviceIds,
      stack: values.stack,
      coverMediaId: values.cover?.id ?? null,
      galleryMediaIds: values.gallery.map((m) => m.id),
      liveUrl: orNull(values.liveUrl),
      completedOn: orNull(values.completedOn),
      // Left out entirely when this person cannot see projects, so saving never changes or probes the link.
      ...(canLinkProject ? { projectId: values.project?.id ?? null } : {}),
      clientApproved: values.clientApproved,
    });
  });

  return (
    <EditorShell onSubmit={onSubmit} submitting={form.submitting} formError={form.formError} readOnlyReason={readOnlyReason} cancelHref="/admin/content/showcase" submitLabel={item ? 'Save changes' : 'Save draft'}>
      <Field label="Project title" error={e.title} required>
        {(c) => <Input {...c} maxLength={140} value={v.title} onChange={(ev) => form.set('title', ev.target.value)} />}
      </Field>
      <Field label="Client name shown on the site" hint="Leave empty to show the project without naming the client." error={e.clientDisplayName}>
        {(c) => <Input {...c} maxLength={120} value={v.clientDisplayName} onChange={(ev) => form.set('clientDisplayName', ev.target.value)} />}
      </Field>
      <Field label="Summary" hint="One or two sentences. Up to 400 characters." error={e.summary} required>
        {(c) => <Textarea {...c} rows={3} maxLength={400} value={v.summary} onChange={(ev) => form.set('summary', ev.target.value)} />}
      </Field>

      <div className="grid gap-4">
        <Field label="The brief" hint="What the client asked for." error={e['body.brief']}>
          {(c) => <Textarea {...c} rows={4} maxLength={4000} value={v.brief} onChange={(ev) => form.set('brief', ev.target.value)} />}
        </Field>
        <Field label="What we built" error={e['body.built']}>
          {(c) => <Textarea {...c} rows={4} maxLength={4000} value={v.built} onChange={(ev) => form.set('built', ev.target.value)} />}
        </Field>
        <Field label="The result" hint="Only what you can state from the project itself." error={e['body.result']}>
          {(c) => <Textarea {...c} rows={4} maxLength={4000} value={v.result} onChange={(ev) => form.set('result', ev.target.value)} />}
        </Field>
      </div>

      {serviceOptions.length > 0 ? (
        <Fieldset legend="Services" hint="Shown as tags once the service itself is published.">
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {serviceOptions.map((s) => (
              <Checkbox
                key={s.id}
                label={s.title}
                checked={v.serviceIds.includes(s.id)}
                onChange={(ev) => form.set('serviceIds', ev.target.checked ? [...v.serviceIds, s.id] : v.serviceIds.filter((x) => x !== s.id))}
              />
            ))}
          </div>
          {e.serviceIds ? <p role="alert" className="mt-1 text-[12px] font-medium text-pd-rubric">{e.serviceIds}</p> : null}
        </Fieldset>
      ) : null}

      <TagsField label="Stack" hint="Technologies used, separated by commas." value={v.stack} onChange={(list) => form.set('stack', list)} error={e.stack} />
      <MediaPicker label="Cover image" hint="The picture on the project card." value={v.cover} onChange={(m) => form.set('cover', m)} error={e.coverMediaId} />
      <MediaListPicker label="Gallery" hint="More pictures on the project page." value={v.gallery} onChange={(list) => form.set('gallery', list)} error={e.galleryMediaIds} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Live link" hint="Only if the project is public." error={e.liveUrl}>
          {(c) => <Input {...c} type="url" inputMode="url" placeholder="https://" maxLength={300} value={v.liveUrl} onChange={(ev) => form.set('liveUrl', ev.target.value)} />}
        </Field>
        <Field label="Completed on" hint="Shown only when you fill it in." error={e.completedOn}>
          {(c) => <Input {...c} type="date" value={v.completedOn} onChange={(ev) => form.set('completedOn', ev.target.value)} />}
        </Field>
      </div>

      {canLinkProject ? (
        <Field label="Internal project" hint="Links this to the project record. For your team only: it is never shown on the site." error={e.projectId}>
          {(c) => <EntityPicker kind="projects" id={c.id} value={v.project} onChange={(p) => form.set('project', p)} placeholder="Search projects" describedBy={c['aria-describedby']} invalid={Boolean(e.projectId)} />}
        </Field>
      ) : null}

      <PermissionTick
        label="The client has approved showing this project"
        explanation="Required before this can be published. Only tick it once the client has agreed to appear on the site."
        checked={v.clientApproved}
        onChange={(checked) => form.set('clientApproved', checked)}
        error={e.clientApproved}
      />
    </EditorShell>
  );
}
