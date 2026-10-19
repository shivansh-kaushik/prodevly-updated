/**
 * A compact denylist for admin passwords. Length does most of the work (the
 * policy requires 12+ characters), so this only catches the passwords that long,
 * predictable strings are actually made of. Compared after lower-casing and
 * stripping everything that is not a letter or digit.
 */
export const COMMON_PASSWORD_FRAGMENTS = [
  'password',
  'passw0rd',
  'qwerty',
  'asdfgh',
  'zxcvbn',
  'letmein',
  'welcome',
  'changeme',
  'iloveyou',
  'administrator',
  'admin123',
  'prodevly',
  'abcdef',
  '123456',
  '654321',
  '111111',
  '000000',
  'trustno1',
  'starwars',
] as const;
