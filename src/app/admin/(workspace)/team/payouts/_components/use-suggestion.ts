'use client';

import { useEffect, useState } from 'react';
import { useAdminApi } from '@/components/admin/api-provider';
import { ApiError, qs } from '@/lib/admin/api-client';
import type { PayoutSuggestionDTO } from '@/services/team-payout.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Answer = { key: string; data: PayoutSuggestionDTO | null; error?: string };

/**
 * What the pay profile proposes for a person and period (GET /api/admin/team-payouts/suggestion). Waits for a pause in
 * typing, ignores an answer that belongs to an earlier person or period, and never throws: a failure is a message.
 */
export function useSuggestion(adminId: string | null, from: string, to: string) {
  const { call } = useAdminApi();
  const [answer, setAnswer] = useState<Answer | null>(null);
  const key = adminId && DATE.test(from) && DATE.test(to) && from <= to ? `${adminId}|${from}|${to}` : null;

  useEffect(() => {
    if (!key || !adminId) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await call<{ suggestion: PayoutSuggestionDTO }>(`/api/admin/team-payouts/suggestion${qs({ adminId, from, to })}`, { signal: controller.signal });
        setAnswer({ key, data: res.suggestion });
      } catch (e) {
        if (controller.signal.aborted) return;
        setAnswer({ key, data: null, error: e instanceof ApiError ? e.message : 'We could not load the proposal.' });
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, adminId, from, to, call]);

  const current = answer && answer.key === key ? answer : null;
  return { data: current?.data ?? null, error: current?.error, loading: key !== null && current === null, enabled: key !== null };
}
