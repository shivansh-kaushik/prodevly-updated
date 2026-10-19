import type { AdminRole, Capability } from '@/config/capabilities';

/** The signed-in admin as the app sees them. Built from the database on every request. */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  /** Effective capabilities: role defaults plus grants. */
  capabilities: ReadonlySet<Capability>;
  mustChangePassword: boolean;
  /** The account's current token version (used to pin in-transaction authority checks). */
  tokenVersion: number;
  /** True while THIS session's cookie carries an open step-up window. */
  stepUpValid: boolean;
}

/** An actor snapshot stored on records, so history survives an account being removed. */
export interface Actor {
  id: string | null;
  name: string;
}
