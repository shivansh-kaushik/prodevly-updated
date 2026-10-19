import { formatNative } from '@/components/admin/money';
import type { PaymentContextDTO } from '@/services/client-payment.service';

/** What the project is owed and has received, so the amount typed below makes sense. */
export function ContractNote({ context, editing }: { context: PaymentContextDTO; editing: boolean }) {
  const cur = context.contractCurrency;
  const over = context.outstandingMinor < 0;
  return (
    <p className="pd-figure rounded-pd-sm bg-pd-well px-3 py-2 text-[13px] text-pd-ink-2" aria-live="polite">
      {context.project.archived && !editing ? <span className="mb-1 block font-medium text-pd-amber">This project is archived. Restore it before recording money against it.</span> : null}
      {context.billableMinor > 0 ? (
        <>
          Billable {formatNative(context.billableMinor, cur)}, received so far {formatNative(context.receivedMinor, cur)}
          {over ? <>, <span className="font-medium text-pd-amber">{formatNative(-context.outstandingMinor, cur)} received in advance</span>.</> : <>, <span className="font-medium text-pd-ink">{formatNative(context.outstandingMinor, cur)} outstanding</span>.</>}
        </>
      ) : (
        <>Nothing is billable on this project yet: it has no contract amount{context.pricingModel === 'hourly' || context.pricingModel === 'retainer' ? ' or invoiced milestone' : ''}. {context.receivedMinor > 0 ? `Received so far ${formatNative(context.receivedMinor, cur)}.` : ''}</>
      )}
    </p>
  );
}
