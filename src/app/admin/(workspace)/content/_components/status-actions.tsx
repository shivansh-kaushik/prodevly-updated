'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Archive, CheckCircle2, CircleAlert, Eye, EyeOff, RotateCcw } from 'lucide-react';
import { useAdminApi } from '@/components/admin/api-provider';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import type { ContentStatus } from '@/config/statuses';
import type { ContentType } from '@/lib/content/types';

type Verb = 'publish' | 'unpublish' | 'archive' | 'restore';

const COPY: Record<Verb, { title: (name: string) => string; description: (status: ContentStatus) => string; confirm: string; done: string; tone: 'primary' | 'danger' }> = {
  publish: {
    title: (name) => `Publish "${name}"?`,
    description: () => 'It appears on the public site shortly. The section it belongs to appears with it if this is the first one.',
    confirm: 'Publish',
    done: 'Published.',
    tone: 'primary',
  },
  unpublish: {
    title: (name) => `Unpublish "${name}"?`,
    description: () => 'It is taken off the public site at once and goes back to a draft. If it is the last published one, its section disappears from the site.',
    confirm: 'Unpublish',
    done: 'Unpublished. It is a draft again.',
    tone: 'primary',
  },
  archive: {
    title: (name) => `Archive "${name}"?`,
    description: (status) => (status === 'published' ? 'It is taken off the public site at once. It stays here, read-only, and can be restored later.' : 'It stays here, read-only, and can be restored later.'),
    confirm: 'Archive',
    done: 'Archived.',
    tone: 'danger',
  },
  restore: {
    title: (name) => `Restore "${name}"?`,
    description: () => 'It comes back as a draft. It is not public until someone publishes it.',
    confirm: 'Restore',
    done: 'Restored as a draft.',
    tone: 'primary',
  },
};

/**
 * Publish, unpublish, archive and restore for one record, with what stands in the way of publishing
 * spelled out. All four need publish authority: people without it see the state and the checklist
 * but no buttons (the service refuses them too). Each asks first, because each one changes what the
 * public sees or hides a record from the team.
 *
 * ONE confirm dialog serves all four. ConfirmDialog's submit button points at its form by id, so two
 * of them on a page would have the second one's button submit the FIRST one's form (archive would
 * publish). One instance, with its wording swapped, cannot collide.
 */
export function StatusActions({ type, id, title, status, blockers, canPublish, noun }: {
  type: ContentType;
  id: string;
  title: string;
  status: ContentStatus;
  blockers: string[];
  canPublish: boolean;
  noun: string;
}) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  // Kept after closing, so the wording does not flip to something else during the dialog's exit.
  const [verb, setVerb] = useState<Verb>('publish');
  const ask = (v: Verb) => {
    setVerb(v);
    setOpen(true);
  };
  const copy = COPY[verb];

  const ready = blockers.length === 0;
  return (
    <div className="flex flex-col gap-4">
      {status === 'draft' ? (
        ready ? (
          <p className="flex items-start gap-2 text-[13px] text-pd-credit"><CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> Ready to publish.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <p className="flex items-start gap-2 text-[13px] font-medium text-pd-amber"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> Before this can be published</p>
            <ul className="list-disc pl-9 text-[13px] text-pd-ink-2">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          </div>
        )
      ) : null}
      {status === 'published' ? <p className="text-[13px] text-pd-ink-2">This {noun} is live on the site. Changes to it go live as soon as you save.</p> : null}
      {status === 'archived' ? <p className="text-[13px] text-pd-ink-2">Archived: hidden from the site and read-only. Restore it to a draft to change it.</p> : null}

      {canPublish ? (
        <>
          <div className="flex flex-wrap gap-2">
            {status === 'draft' ? <Button variant="primary" disabled={!ready} onClick={() => ask('publish')}><Eye className="size-4" aria-hidden /> Publish</Button> : null}
            {status === 'published' ? <Button variant="secondary" onClick={() => ask('unpublish')}><EyeOff className="size-4" aria-hidden /> Unpublish</Button> : null}
            {status !== 'archived' ? <Button variant="danger" onClick={() => ask('archive')}><Archive className="size-4" aria-hidden /> Archive</Button> : null}
            {status === 'archived' ? <Button variant="secondary" onClick={() => ask('restore')}><RotateCcw className="size-4" aria-hidden /> Restore to draft</Button> : null}
          </div>
          <ConfirmDialog
            open={open}
            onClose={() => setOpen(false)}
            tone={copy.tone}
            title={copy.title(title)}
            description={copy.description(status)}
            confirmLabel={copy.confirm}
            onConfirm={async () => {
              await call(`/api/admin/content/${type}/${id}/${verb}`, { method: 'POST' });
              toast.show(copy.done);
              router.refresh();
            }}
          />
        </>
      ) : (
        <p className="rounded-pd-sm bg-pd-well px-3 py-2 text-[13px] text-pd-ink-2">Publishing, unpublishing and archiving need publish permission. A superadmin can grant it.</p>
      )}
    </div>
  );
}
