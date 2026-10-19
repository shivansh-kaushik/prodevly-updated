'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { IconButton } from '@/components/ui/button';
import type { NavGroup } from '@/config/admin-nav';
import { NavLinks } from './nav-links';

/** On a phone the sidebar is a drawer: the same navigation, opened from a slim top bar. */
export function MobileNav({ groups, footer, badges }: { groups: NavGroup[]; footer: React.ReactNode; badges?: Record<string, number> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton label="Open menu" onClick={() => setOpen(true)} className="-ml-2 lg:hidden">
        <Menu className="size-5" aria-hidden />
      </IconButton>
      <Dialog open={open} onClose={() => setOpen(false)} title="Menu" variant="drawer" size="sm" footer={<div className="w-full text-left">{footer}</div>}>
        <NavLinks groups={groups} badges={badges} onNavigate={() => setOpen(false)} />
      </Dialog>
    </>
  );
}
