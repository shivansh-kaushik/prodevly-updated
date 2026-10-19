'use client';

import { KeyLink, type KeyTone } from '@/components/home/key';
import { setPrefillPlan } from '@/lib/contact-prefill';

/** The plan card's action: scroll to the form with this plan chosen. */
export function PlanButton({ planKey, tone, children }: { planKey: string; tone: KeyTone; children: React.ReactNode }) {
  return (
    <KeyLink href="#contact" tone={tone} enter className="w-full text-sm" onClick={() => setPrefillPlan(planKey)}>
      {children}
    </KeyLink>
  );
}
