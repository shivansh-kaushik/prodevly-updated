import Link from 'next/link';
import { LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

export default function AdminNotFound() {
  return (
    <main className="grid min-h-svh place-items-center px-4">
      <EmptyState
        title="Nothing here"
        body="That page does not exist, or you do not have access to it."
        action={<LinkButton href="/admin" variant="primary">Back to the overview</LinkButton>}
      />
      <Link href="/admin" className="sr-only">Overview</Link>
    </main>
  );
}
