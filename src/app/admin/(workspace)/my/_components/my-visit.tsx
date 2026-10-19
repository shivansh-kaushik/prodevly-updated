'use client';

import { useEffect } from 'react';
import { myVisitCookie } from '../_lib/visit';

/** Records this visit, so the next one can flag tasks assigned since. Renders nothing. */
export function MyVisit({ adminId, renderedAt }: { adminId: string; renderedAt: number }) {
  useEffect(() => {
    try {
      const secure = window.location.protocol === 'https:' ? '; secure' : '';
      document.cookie = `${myVisitCookie(adminId)}=${renderedAt}; path=/admin; max-age=31536000; samesite=lax${secure}`;
    } catch {
      /* cookies blocked: nothing is flagged as new, which is the safe default */
    }
  }, [adminId, renderedAt]);
  return null;
}
