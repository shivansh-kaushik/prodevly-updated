'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { humanize } from '@/lib/admin/format';
import { cleanText, toCode } from '@/lib/validation/settings-text';

/**
 * One editable list: add, remove and reorder. `kind="code"` lists hold codes (what is typed becomes
 * `bank_transfer`, shown as "Bank transfer"); `kind="text"` lists hold display text as written.
 * The cleaning here is the same code the server uses, so what the list shows is what gets saved.
 * Order is the order forms offer the options in.
 */
export interface ListEditorProps {
  /** The setting's name. Server errors arrive as `name` (the list) and `name.3` (the fourth row). */
  name: string;
  title: string;
  hint: string;
  values: string[];
  onChange: (next: string[]) => void;
  kind: 'code' | 'text';
  /** Fewest rows the list may keep. The remove buttons stop there. */
  min: number;
  max: number;
  /** Longest a single row may be. */
  itemMax: number;
  /** "payment mode": used in labels and messages. */
  noun: string;
  placeholder: string;
  errors: Record<string, string>;
  disabled?: boolean;
}

const same = (a: string, b: string) => a.toLocaleLowerCase('en') === b.toLocaleLowerCase('en');

export function ListEditor({ name, title, hint, values, onChange, kind, min, max, itemMax, noun, placeholder, errors, disabled }: ListEditorProps) {
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<string>();
  const [status, setStatus] = useState('');
  const label = (v: string) => (kind === 'code' ? humanize(v) : v);

  function add() {
    if (!draft.trim()) return;
    const value = kind === 'code' ? toCode(draft) : cleanText(draft);
    if (!value) return setNote('Use letters or numbers.');
    if (value.length > itemMax) return setNote(`At most ${itemMax} characters.`);
    if (values.some((v) => same(v, value))) return setNote(`${label(value)} is already in the list.`);
    if (values.length >= max) return setNote(`At most ${max} ${noun}s.`);
    onChange([...values, value]);
    setDraft('');
    setNote(undefined);
    setStatus(`Added ${label(value)}.`);
  }

  function move(index: number, by: -1 | 1) {
    const next = [...values];
    const [item] = next.splice(index, 1);
    if (item === undefined) return;
    next.splice(index + by, 0, item);
    onChange(next);
    setStatus(`${label(item)} moved to position ${index + by + 1} of ${next.length}.`);
  }

  function remove(index: number) {
    const item = values[index];
    if (item === undefined) return;
    onChange(values.filter((_, i) => i !== index));
    setStatus(`Removed ${label(item)}.`);
  }

  const listError = errors[name];
  return (
    <Panel>
      <PanelHeader title={title} hint={hint} />
      {values.length === 0 ? (
        <p className="rounded-pd-md bg-pd-well px-3 py-3 text-[13px] text-pd-ink-3">No {noun}s yet.</p>
      ) : (
        <ul aria-label={title} className="divide-y divide-pd-rule-soft rounded-pd-md bg-pd-sheet shadow-[0_0_0_1px_var(--color-pd-rule)]">
          {values.map((value, i) => (
            <li key={`${i}-${value}`} className="px-3 py-1">
              <div className="flex min-h-10 items-center gap-2">
                <div className="min-w-0 flex-1">
                  <span className="text-[14px] break-words text-pd-ink">{label(value)}</span>
                  {kind === 'code' ? <span className="ml-2 font-pd-mono text-[12px] break-all text-pd-ink-3">{value}</span> : null}
                </div>
                <IconButton label={`Move ${label(value)} up`} disabled={disabled || i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" aria-hidden /></IconButton>
                <IconButton label={`Move ${label(value)} down`} disabled={disabled || i === values.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" aria-hidden /></IconButton>
                <IconButton label={values.length <= min ? `${label(value)} cannot be removed: keep at least ${min}` : `Remove ${label(value)}`} disabled={disabled || values.length <= min} onClick={() => remove(i)}><X className="size-4" aria-hidden /></IconButton>
              </div>
              {errors[`${name}.${i}`] ? <p role="alert" className="pb-1.5 text-[12px] font-medium text-pd-rubric">{errors[`${name}.${i}`]}</p> : null}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex items-end gap-2">
        <Field label={`Add a ${noun}`} className="flex-1">
          {(c) => (
            <Input
              {...c}
              autoComplete="off"
              placeholder={placeholder}
              value={draft}
              disabled={disabled}
              onChange={(e) => { setDraft(e.target.value); setNote(undefined); }}
              onKeyDown={(e) => {
                // Enter adds the row; it must not submit the page's Save form.
                if (e.key === 'Enter') { e.preventDefault(); add(); }
              }}
            />
          )}
        </Field>
        <Button variant="secondary" onClick={add} disabled={disabled || !draft.trim()}>Add</Button>
      </div>
      {note ? <p role="alert" className="mt-1.5 text-[12px] font-medium text-pd-rubric">{note}</p> : null}
      {listError ? <p role="alert" className="mt-1.5 text-[12px] font-medium text-pd-rubric">{listError}</p> : null}
      <p role="status" className="sr-only">{status}</p>
    </Panel>
  );
}
