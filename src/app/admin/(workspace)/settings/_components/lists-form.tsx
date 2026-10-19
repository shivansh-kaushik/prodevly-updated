'use client';

import { useRouter } from 'next/navigation';
import { useAdminApi } from '@/components/admin/api-provider';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useForm } from '@/lib/admin/use-form';
import { SETTINGS_LIMITS } from '@/lib/validation/settings-text';
import { ListEditor, type ListEditorProps } from './list-editor';

export type Lists = {
  paymentModes: string[];
  expenseCategories: string[];
  thirdPartyTypes: string[];
  budgetRanges: string[];
};

type Spec = Pick<ListEditorProps, 'title' | 'hint' | 'kind' | 'min' | 'max' | 'itemMax' | 'noun' | 'placeholder'>;

const SPECS: Record<keyof Lists, Spec> = {
  paymentModes: {
    title: 'Payment modes',
    hint: 'How money moved: offered on payments, payouts and expenses. Removing one does not change records already saved.',
    kind: 'code',
    min: 1,
    max: SETTINGS_LIMITS.paymentModes.items,
    itemMax: SETTINGS_LIMITS.paymentModes.length,
    noun: 'payment mode',
    placeholder: 'For example Razorpay',
  },
  expenseCategories: {
    title: 'Expense categories',
    hint: 'Offered on every expense. Removing one does not change expenses already saved.',
    kind: 'code',
    min: 1,
    max: SETTINGS_LIMITS.expenseCategories.items,
    itemMax: SETTINGS_LIMITS.expenseCategories.length,
    noun: 'expense category',
    placeholder: 'For example Training',
  },
  thirdPartyTypes: {
    title: 'Third-party types',
    hint: 'The kinds of freelancer, agency or vendor you pay, offered on third-party records.',
    kind: 'code',
    min: 1,
    max: SETTINGS_LIMITS.thirdPartyTypes.items,
    itemMax: SETTINGS_LIMITS.thirdPartyTypes.length,
    noun: 'third-party type',
    placeholder: 'For example Consultant',
  },
  budgetRanges: {
    title: 'Enquiry budget ranges',
    hint: 'Offered as the budget choices on the contact form. Shown exactly as written, in this order.',
    kind: 'text',
    min: 0,
    max: SETTINGS_LIMITS.budgetRanges.items,
    itemMax: SETTINGS_LIMITS.budgetRanges.length,
    noun: 'budget range',
    placeholder: 'For example Under 1 lakh',
  },
};

const KEYS = Object.keys(SPECS) as Array<keyof Lists>;

/** The four editable lists. Only the lists that changed are sent; the server cleans, checks and audits them. */
export function ListsForm({ initial }: { initial: Lists }) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const form = useForm<Lists>(initial);
  const changed = KEYS.filter((k) => JSON.stringify(form.values[k]) !== JSON.stringify(initial[k]));

  const onSubmit = form.submit(async (v) => {
    const body = Object.fromEntries(changed.map((k) => [k, v[k]]));
    if (changed.length === 0) return;
    await call('/api/admin/settings', { method: 'PATCH', body });
    toast.show('Lists saved.');
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {KEYS.map((key) => (
          <ListEditor
            key={key}
            name={key}
            {...SPECS[key]}
            values={form.values[key]}
            onChange={(next) => {
              form.set(key, next);
              // Row errors are by position, and the positions just moved: drop this list's old messages.
              form.setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== key && !k.startsWith(`${key}.`))));
            }}
            errors={form.errors}
          />
        ))}
      </div>
      {form.formError ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{form.formError}</p> : null}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" disabled={changed.length === 0} loading={form.submitting}>Save lists</Button>
        {changed.length > 0 ? <Button variant="ghost" onClick={() => form.reset(initial)} disabled={form.submitting}>Discard changes</Button> : null}
      </div>
    </form>
  );
}
