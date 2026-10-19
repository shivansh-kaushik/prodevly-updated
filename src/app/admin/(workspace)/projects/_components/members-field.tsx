'use client';

import { X } from 'lucide-react';
import { EntityPicker, type PickerValue } from '@/components/admin/entity-picker';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';

/**
 * The project lead and the team. The lead is always a member (the server adds them), so choosing a
 * lead shows them in the list straight away. People are picked from active admins.
 */
export function MembersField({
  lead,
  members,
  onLeadChange,
  onMembersChange,
  errors,
}: {
  lead: PickerValue | null;
  members: PickerValue[];
  onLeadChange: (lead: PickerValue | null) => void;
  onMembersChange: (members: PickerValue[]) => void;
  errors: { lead?: string; members?: string };
}) {
  const all = lead && !members.some((m) => m.id === lead.id) ? [lead, ...members] : members;
  return (
    <div className="flex flex-col gap-4">
      <Field label="Project lead" hint="Who answers for delivery. They are added to the team automatically." error={errors.lead}>
        {(c) => (
          <EntityPicker
            kind="admins"
            id={c.id}
            value={lead}
            onChange={(v) => {
              onLeadChange(v);
              if (v && !members.some((m) => m.id === v.id)) onMembersChange([...members, v]);
            }}
            placeholder="Search people"
            invalid={Boolean(c['aria-invalid'])}
            describedBy={c['aria-describedby']}
          />
        )}
      </Field>

      <Field label="Team members" error={errors.members}>
        {(c) => (
          <div className="flex flex-col gap-2.5">
            {/* key resets the picker after each pick so it is ready for the next person */}
            <EntityPicker
              key={all.length}
              kind="admins"
              id={c.id}
              value={null}
              onChange={(v) => {
                if (v && !all.some((m) => m.id === v.id)) onMembersChange([...all, v]);
              }}
              placeholder="Add a person"
              invalid={Boolean(c['aria-invalid'])}
              describedBy={c['aria-describedby']}
            />
            {all.length === 0 ? (
              <p className="text-[13px] text-pd-ink-3">No one on the team yet.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {all.map((m) => (
                  <li key={m.id}>
                    <span className="inline-flex min-h-8 items-center gap-1.5 rounded-pd-sm bg-pd-well py-0.5 pr-1 pl-2.5 text-[13px] text-pd-ink pointer-coarse:min-h-11">
                      {m.label}
                      {lead?.id === m.id ? <Badge tone="blue">Lead</Badge> : null}
                      <button
                        type="button"
                        aria-label={`Remove ${m.label} from the team`}
                        onClick={() => {
                          onMembersChange(all.filter((x) => x.id !== m.id));
                          if (lead?.id === m.id) onLeadChange(null);
                        }}
                        className="grid size-6 place-items-center rounded-pd-sm text-pd-ink-3 hover:bg-pd-rule-soft hover:text-pd-ink pointer-coarse:size-11"
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Field>
    </div>
  );
}
