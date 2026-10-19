'use client';

import { type FormEvent, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { KeyButton } from '@/components/home/key';
import { CONTACT } from '@/content/home';
import { SITE } from '@/content/site';
import { getPrefillPlan, getServerPrefillPlan, subscribePrefill } from '@/lib/contact-prefill';
import { signalSent } from '@/lib/stage-data';

/**
 * The enquiry form. Native constraint validation runs first; the browser then posts
 * to Web3Forms (a domain-restricted key, so it works from the browser only) and, in
 * parallel, to /api/leads, which validates, screens and stores the enquiry for the
 * admin panel. It reports success when either call succeeds. When both fail it shows
 * an error with a retry and the mailto link. A success plays the stage's send gesture.
 */
interface PlanOption {
  key: string;
  name: string;
}

const WEB3FORMS = 'https://api.web3forms.com/submit';
const ACCESS_KEY = process.env.NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY;
const input =
  'w-full rounded-lg bg-[#2a2d34] px-3 py-2 text-base text-chalk shadow-[inset_0_0.2rem_0_#121317] placeholder:text-chalk/55 focus-visible:outline-chalk';

type Status = 'idle' | 'sending' | 'sent' | 'error';

export function ContactForm({ plans, email, types }: { plans: PlanOption[]; email: string | null; types: readonly string[] }) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [token, setToken] = useState('');
  const prefilled = useSyncExternalStore(subscribePrefill, getPrefillPlan, getServerPrefillPlan);
  const [chosen, setChosen] = useState('');
  const [more, setMore] = useState(false);
  const plan = chosen || prefilled;

  useEffect(() => {
    let alive = true;
    fetch('/api/form-token')
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { data?: { token?: string }; token?: string } | null) => alive && setToken(body?.data?.token ?? body?.token ?? ''))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const el = form.current;
    if (!el || !el.reportValidity()) return;
    const data = new FormData(el);
    const text = (name: string) => String(data.get(name) ?? '').trim();
    const planName = plans.find((p) => p.key === text('plan'))?.name;
    const details = [text('type') && `Project type: ${text('type')}`, text('timing') && `Timing: ${text('timing')}`, planName && `Plan: ${planName}`].filter(Boolean);
    const message = details.length > 0 ? `${details.join('\n')}\n\n${text('message')}` : text('message');
    setStatus('sending');
    const lead = fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: text('name'), email: text('email'), company: text('company'), message, formToken: token, companyWebsite: text('companyWebsite'), sourcePath: window.location.pathname }),
    }).then((r) => r.ok);
    const web3 = ACCESS_KEY
      ? fetch(WEB3FORMS, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ access_key: ACCESS_KEY, subject: `New enquiry from the ${SITE.name} website`, from_name: text('name'), name: text('name'), email: text('email'), message, botcheck: '' }),
        }).then((r) => r.ok)
      : Promise.resolve(false);
    const results = await Promise.allSettled([lead, web3]);
    const ok = results.some((r) => r.status === 'fulfilled' && r.value);
    setStatus(ok ? 'sent' : 'error');
    if (ok) {
      signalSent();
      el.reset();
      setChosen('');
    }
  }

  const field = (name: string) => `${id}-${name}`;
  return (
    <form ref={form} onSubmit={onSubmit} noValidate={false} className="grid gap-2.5" aria-describedby={`${id}-status`}>
      <div className="grid gap-3 pd-split:grid-cols-2">
        <label htmlFor={field('name')} className="grid gap-1 text-sm">
          {CONTACT.fields.name}
          <input id={field('name')} name="name" required minLength={2} maxLength={120} autoComplete="name" className={input} />
        </label>
        <label htmlFor={field('email')} className="grid gap-1 text-sm">
          {CONTACT.fields.email}
          <input id={field('email')} name="email" type="email" required maxLength={160} autoComplete="email" className={input} />
        </label>
      </div>
      <button type="button" className="pd-mono justify-self-start text-sm underline underline-offset-4 pd-split:hidden" aria-expanded={more} aria-controls={`${id}-more`} onClick={() => setMore((v) => !v)}>
        {more ? CONTACT.fewer : CONTACT.more}
      </button>
      <div id={`${id}-more`} className={`${more ? 'grid' : 'hidden'} gap-3 pd-split:grid`}>
      <label htmlFor={field('company')} className="grid gap-1 text-sm">
        {CONTACT.fields.company}
        <input id={field('company')} name="company" maxLength={120} autoComplete="organization" className={input} />
      </label>
      <div className="grid gap-3 pd-split:grid-cols-2">
        <label htmlFor={field('type')} className="grid gap-1 text-sm">
          {CONTACT.fields.type}
          <select id={field('type')} name="type" defaultValue="" className={input}>
            <option value="">Not sure yet</option>
            {types.map((t) => (
              <option key={t}>{t}</option>
            ))}
            <option>{CONTACT.typeOther}</option>
          </select>
        </label>
        <label htmlFor={field('timing')} className="grid gap-1 text-sm">
          {CONTACT.fields.timing}
          <select id={field('timing')} name="timing" defaultValue="" className={input}>
            <option value="">Not sure yet</option>
            {CONTACT.timing.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>
      {plans.length > 0 ? (
        <label htmlFor={field('plan')} className="grid gap-1 text-sm">
          {CONTACT.fields.plan}
          <select id={field('plan')} name="plan" value={plan} onChange={(e) => setChosen(e.target.value)} className={input}>
            <option value="">No plan chosen</option>
            {plans.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      </div>
      <label htmlFor={field('message')} className="grid gap-1 text-sm">
        {CONTACT.fields.message}
        <textarea id={field('message')} name="message" required minLength={10} maxLength={5000} rows={3} className={input} />
      </label>
      {/* Honeypot: a person never sees or fills it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Company website
          <input name="companyWebsite" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <KeyButton type="submit" enter disabled={status === 'sending'} className="min-w-52 text-base" aria-describedby={`${id}-status`}>
          {status === 'sending' ? CONTACT.sending : CONTACT.send}
        </KeyButton>
        <p id={`${id}-status`} role="status" aria-live="polite" className="pd-mono min-w-0 flex-1 text-sm">
          {status === 'sent' ? CONTACT.sent : null}
          {status === 'error' ? (
            <>
              {CONTACT.failed}{' '}
              {email ? (
                <a href={`mailto:${email}`} className="underline underline-offset-4">
                  {email}
                </a>
              ) : null}
              . <button type="button" className="underline underline-offset-4" onClick={() => form.current?.requestSubmit()}>{CONTACT.retry}</button>
            </>
          ) : null}
        </p>
      </div>
    </form>
  );
}
