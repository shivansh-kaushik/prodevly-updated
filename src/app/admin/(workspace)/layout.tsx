import { AdminShell } from '@/components/admin/admin-shell';
import { requireAdminPage } from '@/lib/auth/page-guard';

/**
 * The guard and frame for every signed-in screen. Layouts do NOT re-run on client navigation,
 * so every page ALSO calls requireAdminPage with its own capability. This layout is the
 * first line, not the only one.
 */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminPage();
  return <AdminShell admin={admin}>{children}</AdminShell>;
}
