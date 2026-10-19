import { cookies } from 'next/headers';
import { myVisitCookie } from './visit';

/** When this person last opened My work in this browser, or null on a first visit (nothing is flagged new then). */
export async function readMyVisit(adminId: string): Promise<Date | null> {
  const raw = Number((await cookies()).get(myVisitCookie(adminId))?.value);
  return Number.isFinite(raw) && raw > 0 ? new Date(raw) : null;
}
