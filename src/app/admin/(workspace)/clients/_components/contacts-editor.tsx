'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { MAX_CONTACTS } from '@/lib/validation/client';

export interface ContactRow {
  name: string;
  email: string;
  phone: string;
  designation: string;
  isPrimary: boolean;
}

export const emptyContact = (isPrimary = false): ContactRow => ({ name: '', email: '', phone: '', designation: '', isPrimary });

/** The people at the client. Exactly one is the main contact; removing it hands the mark to the next. */
export function ContactsEditor({ value, onChange, errors }: { value: ContactRow[]; onChange: (rows: ContactRow[]) => void; errors: Record<string, string> }) {
  const set = (i: number, patch: Partial<ContactRow>) => onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const makePrimary = (i: number) => onChange(value.map((r, j) => ({ ...r, isPrimary: j === i })));
  const remove = (i: number) => {
    const next = value.filter((_, j) => j !== i);
    if (next.length > 0 && !next.some((r) => r.isPrimary)) next[0] = { ...next[0]!, isPrimary: true };
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-4">
      {value.length === 0 ? <p className="text-[13px] text-pd-ink-3">No contacts yet. Add the person you speak to.</p> : null}
      {value.map((row, i) => (
        <fieldset key={i} className="rounded-pd-md bg-pd-paper p-3.5 shadow-[0_0_0_1px_var(--color-pd-rule)]">
          <legend className="sr-only">Contact {i + 1}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" error={errors[`contacts.${i}.name`]} required>
              {(c) => <Input {...c} autoComplete="off" value={row.name} onChange={(e) => set(i, { name: e.target.value })} />}
            </Field>
            <Field label="Email" error={errors[`contacts.${i}.email`]}>
              {(c) => <Input {...c} type="email" inputMode="email" autoComplete="off" value={row.email} onChange={(e) => set(i, { email: e.target.value })} />}
            </Field>
            <Field label="Phone" error={errors[`contacts.${i}.phone`]}>
              {(c) => <Input {...c} type="tel" inputMode="tel" autoComplete="off" value={row.phone} onChange={(e) => set(i, { phone: e.target.value })} />}
            </Field>
            <Field label="Role at the client" error={errors[`contacts.${i}.designation`]}>
              {(c) => <Input {...c} autoComplete="off" value={row.designation} onChange={(e) => set(i, { designation: e.target.value })} />}
            </Field>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-[13px] text-pd-ink">
              <input type="radio" name="primary-contact" className="size-4 accent-[var(--color-pd-ink)]" checked={row.isPrimary} onChange={() => makePrimary(i)} />
              Main contact
            </label>
            <IconButton label={`Remove contact ${i + 1}`} onClick={() => remove(i)}><Trash2 className="size-4" aria-hidden /></IconButton>
          </div>
        </fieldset>
      ))}
      {errors.contacts ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{errors.contacts}</p> : null}
      {value.length < MAX_CONTACTS ? (
        <div><Button variant="secondary" size="sm" onClick={() => onChange([...value, emptyContact(value.length === 0)])}><Plus className="size-4" aria-hidden /> Add a contact</Button></div>
      ) : null}
    </div>
  );
}
