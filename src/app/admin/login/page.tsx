import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/page-guard';
import { safeNextPath } from '@/lib/auth/safe-next-path';
import { first, type RawSearchParams } from '@/lib/admin/search-params';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  const next = safeNextPath(first(sp, 'next'));
  // Only a session the DATABASE still accepts skips the form; a stale cookie just shows it.
  const { admin } = await getCurrentAdmin();
  if (admin) redirect(admin.mustChangePassword ? '/admin/account/password' : next);

  return (
    <main className="grid min-h-svh place-items-center px-4 py-10">
      <div className="w-full max-w-[26rem]">
        <p className="mb-6 text-center leading-none">
          <span className="font-pd-serif text-[34px] font-semibold tracking-[-0.02em]">ProDevly</span>
          <span className="pd-eyebrow ml-2 align-middle">Admin</span>
        </p>
        <div className="rounded-pd-md bg-pd-leaf p-6 shadow-[0_0_0_1px_var(--color-pd-rule)] sm:p-8">
          <h1 className="font-pd-serif text-[24px] leading-8 font-semibold tracking-[-0.01em]">Sign in</h1>
          <p className="mt-1 mb-6 text-[14px] text-pd-ink-3">Use the email and password your team set up for you.</p>
          <LoginForm next={next} />
        </div>
        <p className="mt-5 text-center text-[13px] text-pd-ink-3">Accounts are created by a superadmin. Ask one of them if you need access.</p>
      </div>
    </main>
  );
}
