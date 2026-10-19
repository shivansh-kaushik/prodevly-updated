import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Who am I, and what may I do. Allowed while a password change is pending so the UI can route there. */
export const GET = adminRoute({ allowPasswordChangePending: true }, async ({ admin }) =>
  ok({
    id: admin.id,
    name: admin.name,
    email: admin.email,
    role: admin.role,
    capabilities: [...admin.capabilities],
    mustChangePassword: admin.mustChangePassword,
    stepUpValid: admin.stepUpValid,
  }),
);
