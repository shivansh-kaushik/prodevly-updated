'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { EntityPicker, type PickerValue } from '@/components/admin/entity-picker';
import { cx } from '@/lib/cx';

export interface AssigneeItem {
  kind: 'admin' | 'thirdParty';
  id: string;
  name: string;
}

/**
 * Who is on a task: chips for the people already on it, and two pickers to add a team member or a
 * third party. Only the kind and the id are ever sent: the server reads the name from the record.
 */
export function AssigneePicker({ value, onChange, disabled }: { value: AssigneeItem[]; onChange: (next: AssigneeItem[]) => void; disabled?: boolean }) {
  // Bumping a picker's key empties it after a choice, ready for the next person.
  const [keys, setKeys] = useState({ admin: 0, thirdParty: 0 });

  function add(kind: AssigneeItem['kind'], picked: PickerValue | null) {
    if (!picked) return;
    if (!value.some((v) => v.kind === kind && v.id === picked.id)) onChange([...value, { kind, id: picked.id, name: picked.label }]);
    setKeys((k) => ({ ...k, [kind]: k[kind] + 1 }));
  }

  return (
    <div className="flex flex-col gap-3">
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Assigned people">
          {value.map((a) => (
            <li key={`${a.kind}:${a.id}`} className={cx('inline-flex h-8 items-center gap-1.5 rounded-pd-sm bg-pd-well pr-1 pl-2.5 text-[13px] text-pd-ink pointer-coarse:h-11', disabled && 'opacity-60')}>
              <span className="max-w-48 truncate">{a.name}</span>
              {a.kind === 'thirdParty' ? <span className="text-[11px] text-pd-ink-3">third party</span> : null}
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${a.name}`}
                onClick={() => onChange(value.filter((v) => !(v.kind === a.kind && v.id === a.id)))}
                className="grid size-6 place-items-center rounded-pd-sm text-pd-ink-3 hover:bg-pd-rule-soft hover:text-pd-ink pointer-coarse:size-11"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-pd-ink-3">Nobody is assigned yet.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <EntityPicker key={`a${keys.admin}`} kind="admins" value={null} onChange={(p) => add('admin', p)} placeholder="Add a team member" disabled={disabled} />
        <EntityPicker key={`t${keys.thirdParty}`} kind="third-parties" value={null} onChange={(p) => add('thirdParty', p)} placeholder="Add a third party" disabled={disabled} />
      </div>
    </div>
  );
}
