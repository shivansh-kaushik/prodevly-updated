export interface RateLimitRule {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /**
   * When the limiter's own database is unreachable: deny (true) or allow (false).
   * Authentication, admin writes and anything touching money fail CLOSED.
   * The public contact form fails OPEN, because it also has honeypot, timing and
   * duplicate checks and a hard failure would block genuine visitors.
   */
  failClosed: boolean;
  /** Tighter limit for requests whose client IP could not be determined. */
  unknownLimit?: number;
}

export const RATE_LIMITS = {
  adminLoginIp: { limit: 10, windowSeconds: 15 * 60, failClosed: true, unknownLimit: 3 },
  adminLoginEmail: { limit: 5, windowSeconds: 15 * 60, failClosed: true },
  passwordChange: { limit: 5, windowSeconds: 15 * 60, failClosed: true },
  stepUp: { limit: 5, windowSeconds: 15 * 60, failClosed: true },
  adminMutation: { limit: 120, windowSeconds: 60, failClosed: true },
  leadCreate: { limit: 5, windowSeconds: 10 * 60, failClosed: false, unknownLimit: 2 },
} as const satisfies Record<string, RateLimitRule>;
