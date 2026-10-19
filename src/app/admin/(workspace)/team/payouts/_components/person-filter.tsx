'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { EntityPicker, type PickerValue } from '@/components/admin/entity-picker';

/** The "person" filter of the payouts list: a typeahead that writes `?adminId=` into the URL, like the toolbar's other filters. */
export function PersonFilter({ current }: { current: PickerValue | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  return (
    <div className="w-56" aria-busy={pending || undefined}>
      <EntityPicker
        kind="admins"
        value={current}
        placeholder="Any person"
        onChange={(picked) => {
          const params = new URLSearchParams(sp.toString());
          if (picked) params.set('adminId', picked.id);
          else params.delete('adminId');
          params.delete('page');
          startTransition(() => router.replace(params.toString() ? `${pathname}?${params}` : pathname));
        }}
      />
    </div>
  );
}
