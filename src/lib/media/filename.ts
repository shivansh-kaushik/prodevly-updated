/**
 * Stored filenames are ASCII words joined by hyphens, with an extension chosen from the
 * DETECTED type (never the original one). That makes the canonical URL safe to print, to put in
 * a header and to cache, and it means "invoice.html" holding PNG bytes is stored as a .png.
 * Path parts, control characters, dots that hide a file and Unicode tricks are all removed.
 */
const MAX_STEM = 80;

export function sanitiseFilename(original: string, ext: string): string {
  const lastSegment = original.split(/[\\/]/).pop() ?? '';
  const noExtension = lastSegment.replace(/\.[^.]*$/, '');
  const stem = noExtension
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_STEM)
    .replace(/-+$/g, '');
  return `${stem || 'file'}.${ext}`;
}
