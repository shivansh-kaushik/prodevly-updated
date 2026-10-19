import bcrypt from 'bcryptjs';

/**
 * bcrypt hashing. Cost 12 is about a quarter of a second per hash: slow enough
 * to make offline cracking expensive, fast enough that sign-in feels instant. The
 * cost lives inside each hash, so raising it later keeps old hashes verifying.
 * Tests use the minimum cost so the suite stays fast.
 */
const COST = process.env.NODE_ENV === 'test' ? 4 : 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;

/**
 * Burns the same time as a real verification. Without it, "no such account"
 * returns in 2 ms and "wrong password" in 250 ms, which hands an attacker a
 * free account-enumeration oracle. Used for unknown, locked and deactivated accounts.
 */
export async function fakeVerify(): Promise<void> {
  dummyHash ??= bcrypt.hash('not-a-real-password', COST);
  await bcrypt.compare('another-not-a-real-password', await dummyHash);
}
