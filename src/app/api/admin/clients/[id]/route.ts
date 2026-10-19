import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { deleteClientSchema, updateClientSchema, type UpdateClientInput } from '@/lib/validation/client';
import { deleteClient, getClientById, updateClient } from '@/services/client.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = adminRoute<undefined, Params>({ capability: 'client:view' }, async ({ admin, params }) =>
  ok({ client: await getClientById(admin, params.id) }),
);

export const PATCH = adminRoute<UpdateClientInput, Params>(
  { capability: 'client:edit', schema: updateClientSchema },
  async ({ admin, body, params, meta }) => ok({ client: await updateClient(admin, params.id, body, meta) }),
);

/** Permanent delete: needs client:delete (superadmins), the client's name typed, and no linked records. */
export const DELETE = adminRoute<{ confirmName: string }, Params>(
  { capability: 'client:delete', schema: deleteClientSchema },
  async ({ admin, body, params, meta }) => ok(await deleteClient(admin, params.id, body.confirmName, meta)),
);
