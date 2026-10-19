'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LogOut, UserRound } from 'lucide-react';
import { adminFetch } from '@/lib/admin/api-client';
import { initials } from '@/lib/admin/format';
import { Button } from '@/components/ui/button';

/** Who is signed in, with the two things you do from here: your account, and signing out. */
export function UserMenu({ name, roleLabel }: { name: string; roleLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await adminFetch('/api/admin/auth/logout', { body: {} });
    } finally {
      router.replace('/admin/login');
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Link href="/admin/account" className="flex items-center gap-2.5 rounded-pd-sm p-1.5 hover:bg-pd-well" prefetch={false}>
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-pd-ink text-[12px] font-medium text-white">{initials(name)}</span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] leading-4 font-medium text-pd-ink">{name}</span>
          <span className="block text-[12px] leading-4 text-pd-ink-3">{roleLabel}</span>
        </span>
        <UserRound className="sr-only" aria-hidden />
      </Link>
      <Button variant="ghost" size="sm" onClick={signOut} loading={busy} className="justify-start">
        <LogOut className="size-4" aria-hidden /> Sign out
      </Button>
    </div>
  );
}
