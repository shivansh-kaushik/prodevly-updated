import { COMMON_PASSWORD_FRAGMENTS } from './common-passwords';

export const PASSWORD_MIN_LENGTH = 12;
/** bcrypt only reads the first 72 BYTES; longer passwords would be silently truncated. */
export const PASSWORD_MAX_BYTES = 72;

export interface PasswordContext {
  email?: string;
  name?: string;
}

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Undoes the usual character swaps (P@ssw0rd, l3tm31n, $ecret) before comparing. */
const LEET: Record<string, string> = { '@': 'a', '4': 'a', '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', $: 's', '5': 's', '7': 't' };
const deLeet = (s: string) => squash(s.toLowerCase().replace(/[@4013!|$57]/g, (c) => LEET[c] ?? c));

/**
 * Returns a human-readable reason the password is not acceptable, or null.
 *
 * Rules: 12 characters to 72 bytes; not a run of one character; not containing
 * the person's email name or any part of their name; not containing a common
 * password fragment. No character-class ritual: length does more for real-world
 * resistance than forcing a symbol.
 */
export function checkPasswordPolicy(password: string, ctx: PasswordContext = {}): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters`;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return `Use at most ${PASSWORD_MAX_BYTES} bytes (about 72 plain characters)`;
  }
  if (new Set(password).size < 4) return 'That password is too repetitive';

  const flat = squash(password);
  const flatLeet = deLeet(password);
  const local = ctx.email ? squash(ctx.email.split('@')[0] ?? '') : '';
  if (local.length >= 3 && flat.includes(local)) return 'The password cannot contain your email name';

  for (const part of (ctx.name ?? '').split(/\s+/)) {
    const token = squash(part);
    if (token.length >= 3 && flat.includes(token)) return 'The password cannot contain your name';
  }

  for (const fragment of COMMON_PASSWORD_FRAGMENTS) {
    if (flat.includes(fragment) || flatLeet.includes(deLeet(fragment))) {
      return 'That password is too common. Pick something less predictable';
    }
  }
  return null;
}
