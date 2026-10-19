'use client';

import { Field, Input, Textarea } from '@/components/ui/field';
import { useForm } from '@/lib/admin/use-form';
import type { ServiceDTO } from '@/lib/content/types';
import { EditorShell, useContentSave } from './editor-shell';
import { LinesField, TagsField } from './fields';
import { orNull } from './lists';

interface Values extends Record<string, unknown> {
  title: string;
  summary: string;
  deliverables: string[];
  stack: string[];
  totemKey: string;
}

export function ServiceForm({ item, readOnlyReason }: { item?: ServiceDTO; readOnlyReason?: string }) {
  const save = useContentSave('services', item?.id);
  const form = useForm<Values>({
    title: item?.title ?? '',
    summary: item?.summary ?? '',
    deliverables: item?.deliverables ?? [],
    stack: item?.stack ?? [],
    totemKey: item?.totemKey ?? '',
  });
  const v = form.values;
  const e = form.errors;

  const onSubmit = form.submit(async (values) => {
    await save({ title: values.title, summary: values.summary, deliverables: values.deliverables, stack: values.stack, totemKey: orNull(values.totemKey) });
  });

  return (
    <EditorShell onSubmit={onSubmit} submitting={form.submitting} formError={form.formError} readOnlyReason={readOnlyReason} cancelHref="/admin/content/services" submitLabel={item ? 'Save changes' : 'Save draft'}>
      <Field label="Service name" error={e.title} required>
        {(c) => <Input {...c} maxLength={100} value={v.title} onChange={(ev) => form.set('title', ev.target.value)} />}
      </Field>
      <Field label="Summary" hint="One or two sentences. Up to 400 characters." error={e.summary} required>
        {(c) => <Textarea {...c} rows={3} maxLength={400} value={v.summary} onChange={(ev) => form.set('summary', ev.target.value)} />}
      </Field>
      <LinesField label="What you get" hint="One deliverable per line." value={v.deliverables} onChange={(list) => form.set('deliverables', list)} error={e.deliverables} />
      <TagsField label="Stack" hint="Technologies used for this service, separated by commas." value={v.stack} onChange={(list) => form.set('stack', list)} error={e.stack} />
      <Field label="3D object key" hint="Names the object that stands for this service on the home page. Leave empty unless the stage engine lists one for it." error={e.totemKey}>
        {(c) => <Input {...c} maxLength={40} autoCapitalize="none" spellCheck={false} placeholder="web-app" value={v.totemKey} onChange={(ev) => form.set('totemKey', ev.target.value)} />}
      </Field>
    </EditorShell>
  );
}
