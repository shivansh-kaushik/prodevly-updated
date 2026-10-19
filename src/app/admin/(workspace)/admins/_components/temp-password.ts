/** A random temporary password: 4 groups of 4 from an unambiguous alphabet (no 0/O, 1/l/I). */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function generateTempPassword(): string {
  const bytes = new Uint32Array(16);
  crypto.getRandomValues(bytes);
  // Reject-free mapping: 2^32 mod 31 is tiny, and this is a one-time password the person must change at once.
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}
