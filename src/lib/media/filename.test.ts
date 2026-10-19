import { describe, expect, it } from 'vitest';
import { MEDIA_PRIVATE_PURPOSES } from '@/models/media.model';
import { sanitiseFilename } from './filename';
import { MEDIA_PURPOSES, UPLOAD_CAPABILITIES, VIEW_CAPABILITIES, DELETE_CAPABILITIES, PRIVATE_TYPES, PUBLIC_TYPES, formatBytes, uploadProblem } from './rules';
import { mediaPath } from './url';

describe('sanitiseFilename', () => {
  it('makes a readable lowercase name and takes the extension from the detected type', () => {
    expect(sanitiseFilename('My Holiday Photo (final).JPEG', 'jpg')).toBe('my-holiday-photo-final.jpg');
  });

  it('ignores the original extension: an .exe or .html name holding image bytes is stored as an image', () => {
    expect(sanitiseFilename('invoice.html', 'png')).toBe('invoice.png');
    expect(sanitiseFilename('payload.exe', 'png')).toBe('payload.png');
    expect(sanitiseFilename('a.php.png', 'png')).toBe('a-php.png');
  });

  it('removes path parts, traversal and control characters', () => {
    expect(sanitiseFilename('../../etc/passwd', 'png')).toBe('passwd.png');
    expect(sanitiseFilename('C:\\Users\\me\\scan.pdf', 'pdf')).toBe('scan.pdf');
    expect(sanitiseFilename('bad\u0000name\r\n.png', 'png')).toBe('bad-name.png');
  });

  it('strips accents and drops characters it cannot keep, falling back to "file"', () => {
    expect(sanitiseFilename('Café Menü.png', 'png')).toBe('cafe-menu.png');
    expect(sanitiseFilename('名前.png', 'png')).toBe('file.png');
    expect(sanitiseFilename('', 'png')).toBe('file.png');
    expect(sanitiseFilename('...', 'png')).toBe('file.png');
    expect(sanitiseFilename('.htaccess', 'png')).toBe('file.png');
  });

  it('caps the length', () => {
    expect(sanitiseFilename(`${'a'.repeat(300)}.png`, 'png').length).toBeLessThanOrEqual(84);
  });
});

describe('mediaPath', () => {
  it('builds the canonical URL from the id and the stored name', () => {
    expect(mediaPath('65f1c2a4b6d3e8a9c0b1d2e3', 'logo.png')).toBe('/media/65f1c2a4b6d3e8a9c0b1d2e3/logo.png');
  });
});

describe('upload rules', () => {
  it('accepts exactly the types the plan lists, and never SVG', () => {
    expect(PUBLIC_TYPES).toEqual(['image/png', 'image/jpeg', 'image/webp', 'image/avif']);
    expect(PRIVATE_TYPES).toEqual(['application/pdf', 'image/png', 'image/jpeg']);
    expect([...PUBLIC_TYPES, ...PRIVATE_TYPES].some((t) => t.includes('svg'))).toBe(false);
  });

  it('applies the size limits: 5 MB public, 10 MB private', () => {
    expect(uploadProblem('public', 'image/png', 5 * 1024 * 1024)).toBeNull();
    expect(uploadProblem('public', 'image/png', 5 * 1024 * 1024 + 1)).toMatch(/5 MB/);
    expect(uploadProblem('private', 'application/pdf', 10 * 1024 * 1024)).toBeNull();
    expect(uploadProblem('private', 'application/pdf', 10 * 1024 * 1024 + 1)).toMatch(/10 MB/);
  });

  it('refuses a PDF as a website image and WebP/AVIF as a receipt', () => {
    expect(uploadProblem('public', 'application/pdf', 100)).toMatch(/PNG, JPEG, WebP or AVIF/);
    expect(uploadProblem('private', 'image/webp', 100)).toMatch(/PDF, PNG or JPEG/);
    expect(uploadProblem('private', 'image/avif', 100)).toMatch(/PDF, PNG or JPEG/);
  });

  it('formats sizes for people', () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
    expect(formatBytes(1536 * 1024)).toBe('1.5 MB');
    expect(formatBytes(2048)).toBe('2 KB');
  });

  it('has a capability rule for every purpose, and the purposes match the model', () => {
    for (const purpose of MEDIA_PURPOSES) expect(UPLOAD_CAPABILITIES[purpose].length).toBeGreaterThan(0);
    expect(MEDIA_PURPOSES).toEqual(['content', ...MEDIA_PRIVATE_PURPOSES]);
    expect(Object.keys(VIEW_CAPABILITIES).sort()).toEqual([...MEDIA_PRIVATE_PURPOSES].sort());
    expect(Object.keys(DELETE_CAPABILITIES).sort()).toEqual([...MEDIA_PRIVATE_PURPOSES].sort());
  });
});
