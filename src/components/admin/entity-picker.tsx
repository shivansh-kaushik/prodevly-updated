'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, X } from 'lucide-react';
import { cx } from '@/lib/cx';
import { qs } from '@/lib/admin/api-client';
import { useAdminApi } from './api-provider';

/**
 * A typeahead for one record: a client, project, task, admin or third party. This is the ARIA 1.2
 * combobox pattern (an input that owns a listbox): arrow keys move, Enter picks, Escape closes
 * without closing a dialog around it, and the list is announced to screen readers. Results come
 * from /api/admin/lookup/<kind>; pass `clientId` / `projectId` to cascade (pick the client, then
 * only that client's projects).
 */
export interface PickerValue {
  id: string;
  label: string;
  ref?: string;
}

interface Item extends PickerValue {
  sublabel?: string;
}

export interface EntityPickerProps {
  kind: 'clients' | 'projects' | 'tasks' | 'admins' | 'third-parties';
  value: PickerValue | null;
  onChange: (value: PickerValue | null) => void;
  clientId?: string;
  projectId?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
  /** Hide the clear button: the field must keep a value once chosen. */
  required?: boolean;
}

export function EntityPicker({ kind, value, onChange, clientId, projectId, placeholder = 'Search', disabled, id, invalid, describedBy, required }: EntityPickerProps) {
  const { call } = useAdminApi();
  const uid = useId();
  const listId = `${uid}-list`;
  const [text, setText] = useState(value?.label ?? '');
  const valueKey = value ? `${value.id}:${value.label}` : '';
  const [seenKey, setSeenKey] = useState(valueKey);
  if (valueKey !== seenKey) {
    // The chosen record changed from outside (cleared by a parent, a cascade reset): show it.
    setSeenKey(valueKey);
    setText(value?.label ?? '');
  }
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const abort = useRef<AbortController>(undefined);

  useEffect(() => () => { clearTimeout(timer.current); abort.current?.abort(); }, []);

  const search = useCallback(
    (q: string) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        abort.current?.abort();
        const controller = new AbortController();
        abort.current = controller;
        setLoading(true);
        setFailed(false);
        try {
          const data = await call<{ items: Item[] }>(`/api/admin/lookup/${kind}${qs({ q, clientId, projectId })}`, { signal: controller.signal });
          setItems(data.items);
          setActive(0);
        } catch (e) {
          if (!(e instanceof DOMException && e.name === 'AbortError')) setFailed(true);
        } finally {
          if (abort.current === controller) setLoading(false);
        }
      }, q ? 200 : 0);
    },
    [call, kind, clientId, projectId],
  );

  function choose(item: Item | undefined) {
    if (!item) return;
    onChange({ id: item.id, label: item.label, ref: item.ref });
    setText(item.label);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); search(''); return; }
      setActive((i) => (items.length === 0 ? 0 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length));
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      choose(items[active]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault(); // close the list, not the dialog around it
      setOpen(false);
    } else if (e.key === 'Tab') setOpen(false);
  }

  return (
    <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) { setOpen(false); setText(value?.label ?? ''); } }}>
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && items[active] ? `${uid}-opt-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        value={text}
        onFocus={() => { if (!disabled) { setOpen(true); search(''); } }}
        onChange={(e) => { setText(e.target.value); setOpen(true); search(e.target.value); }}
        onKeyDown={onKeyDown}
        className="h-9 w-full rounded-pd-sm bg-pd-well pr-16 pl-3 text-[14px] text-pd-ink shadow-[inset_0_0_0_1px_var(--color-pd-rule)] placeholder:text-pd-ink-3 hover:shadow-[inset_0_0_0_1px_var(--color-pd-rule-strong)] focus:bg-pd-sheet focus:shadow-[inset_0_0_0_1px_var(--color-pd-blue),0_0_0_3px_var(--color-pd-blue-wash)] focus:outline-none disabled:opacity-60 aria-invalid:shadow-[inset_0_0_0_1px_var(--color-pd-rubric)] pointer-coarse:h-11"
      />
      <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1 text-pd-ink-3">
        {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
        {value && !required && !disabled ? (
          <button type="button" aria-label="Clear selection" onClick={() => { onChange(null); setText(''); }} className="grid size-6 place-items-center rounded-pd-sm hover:bg-pd-rule-soft hover:text-pd-ink">
            <X className="size-3.5" aria-hidden />
          </button>
        ) : null}
        <ChevronDown className="size-4" aria-hidden />
      </div>
      {open ? (
        <ul id={listId} role="listbox" className="absolute z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-pd-md bg-pd-sheet py-1 shadow-pd-float">
          {items.length === 0 ? (
            <li role="presentation" className="px-3 py-2 text-[13px] text-pd-ink-3">{failed ? 'Could not load results.' : loading ? 'Searching...' : 'No matches.'}</li>
          ) : (
            items.map((item, i) => (
              <li
                key={item.id}
                id={`${uid}-opt-${i}`}
                role="option"
                aria-selected={value?.id === item.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(item)}
                onMouseMove={() => setActive(i)}
                className={cx('flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-[14px]', i === active && 'bg-pd-well')}
              >
                <span className="min-w-0">
                  <span className="block truncate text-pd-ink">{item.label}</span>
                  {item.sublabel ? <span className="block truncate text-[12px] text-pd-ink-3">{item.sublabel}</span> : null}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {item.ref ? <span className="font-pd-mono text-[11px] text-pd-ink-3">{item.ref}</span> : null}
                  {value?.id === item.id ? <Check className="size-4 text-pd-credit" aria-hidden /> : null}
                </span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
