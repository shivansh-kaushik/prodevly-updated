// Runs in every test worker before any test file.
process.env.AUTH_SECRET ??= 'test-secret-test-secret-test-secret-0123456789';
process.env.IP_HASH_SALT ??= 'test-salt';
process.env.NEXT_PUBLIC_SITE_URL ??= 'http://localhost:3050';
