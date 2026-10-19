/**
 * Slugs are generated from titles, never typed: lowercase ASCII words joined by hyphens.
 * Uniqueness is the service's job (it knows what is taken); this only builds the base.
 */
const MAX_SLUG = 60;

export function slugify(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '') // accents: "Café" -> "Cafe"
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '');
  return slug || 'item';
}

/** `base`, then `base-2`, `base-3`... the first one `taken` does not contain. */
export function pickFreeSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base.slice(0, MAX_SLUG - String(n).length - 1)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, MAX_SLUG - 7)}-${Date.now().toString(36).slice(-6)}`;
}
