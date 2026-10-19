'use client';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

// Next 16 gives error boundaries `retry` (re-render this segment), not the older `reset`.
export default function WorkspaceError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <EmptyState
      title="This page could not load"
      body={error.digest ? `Something went wrong on our side. Reference ${error.digest}.` : 'Something went wrong on our side.'}
      action={<Button variant="primary" onClick={() => retry()}>Try again</Button>}
      className="py-24"
    />
  );
}
