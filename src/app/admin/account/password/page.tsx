import type { Metadata } from 'next';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { PasswordForm } from './password-form';

export const metadata: Metadata = { title: 'Change password' };

export default async function ChangePasswordPage() {
  // Reachable while a password change is pending: it is the one page that must be.
  const admin = await requireAdminPage('/admin/account/password', { allowPasswordChangePending: true });
  return (
    <main className="grid min-h-svh place-items-center px-4 py-10">
      <div className="w-full max-w-[28rem]">
        <p className="mb-6 text-center leading-none">
          <span className="font-pd-serif text-[34px] font-semibold tracking-[-0.02em]">ProDevly</span>
          <span className="pd-eyebrow ml-2 align-middle">Admin</span>
        </p>
        <div className="rounded-pd-md bg-pd-leaf p-6 shadow-[0_0_0_1px_var(--color-pd-rule)] sm:p-8">
          <h1 className="font-pd-serif text-[24px] leading-8 font-semibold tracking-[-0.01em]">
            {admin.mustChangePassword ? 'Choose a new password' : 'Change password'}
          </h1>
          <p className="mt-1 mb-6 text-[14px] text-pd-ink-3">
            {admin.mustChangePassword
              ? 'The password you were given is temporary. Set your own to continue.'
              : 'Changing it signs you out on every other device.'}
          </p>
          <PasswordForm forced={admin.mustChangePassword} />
        </div>
      </div>
    </main>
  );
}
