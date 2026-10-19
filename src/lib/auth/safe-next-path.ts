/**
 * Only ever redirect to a path inside the admin area. Blocks open redirects such
 * as `//evil.com`, `/\evil.com`, `https://evil.com` and `javascript:` URLs.
 */
export function safeNextPath(value: string | null | undefined, fallback = '/admin'): string {
  if (!value) return fallback;
  if (!value.startsWith('/admin')) return fallback;
  if (value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f]/.test(value)) return fallback;
  if (value !== '/admin' && !value.startsWith('/admin/') && !value.startsWith('/admin?')) return fallback;
  try {
    const url = new URL(value, 'http://localhost');
    if (url.origin !== 'http://localhost') return fallback;
    // Normalisation resolves "/admin/../x" to "/x": re-check the RESULT stays inside /admin.
    if (url.pathname !== '/admin' && !url.pathname.startsWith('/admin/')) return fallback;
    return url.pathname + url.search;
  } catch {
    return fallback;
  }
}
