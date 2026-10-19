import { describe, expect, it } from 'vitest';
import { avifBytes, jpegBytes, pngBytes, webpBytes } from '@/test/content-factories';
import { readImageSize } from './dimensions';

describe('readImageSize: width and height from the header, with no image library', () => {
  it('reads PNG', () => {
    expect(readImageSize(pngBytes(640, 480), 'image/png')).toEqual({ width: 640, height: 480 });
  });

  it('reads JPEG from its frame header, skipping the JFIF segment before it', () => {
    expect(readImageSize(jpegBytes(1920, 1080), 'image/jpeg')).toEqual({ width: 1920, height: 1080 });
  });

  it.each(['lossy', 'lossless', 'extended'] as const)('reads WebP (%s)', (kind) => {
    expect(readImageSize(webpBytes(300, 200, kind), 'image/webp')).toEqual({ width: 300, height: 200 });
  });

  it('reads AVIF from the ispe box', () => {
    expect(readImageSize(avifBytes(1200, 630), 'image/avif')).toEqual({ width: 1200, height: 630 });
  });

  it('reads sizes larger than 16 bits where the format allows (PNG)', () => {
    expect(readImageSize(pngBytes(20_000, 10_000), 'image/png')).toEqual({ width: 20_000, height: 10_000 });
  });

  it('returns null for a header cut short, never throws', () => {
    expect(readImageSize(pngBytes().subarray(0, 20), 'image/png')).toBeNull();
    expect(readImageSize(jpegBytes().subarray(0, 12), 'image/jpeg')).toBeNull();
    expect(readImageSize(webpBytes().subarray(0, 24), 'image/webp')).toBeNull();
    expect(readImageSize(avifBytes().subarray(0, 30), 'image/avif')).toBeNull();
  });

  it('returns null for a JPEG with no frame header before the scan starts', () => {
    expect(readImageSize(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 0, 0, 0, 0, 0, 0]), 'image/jpeg')).toBeNull();
  });

  it('returns null for a PNG whose first chunk is not IHDR', () => {
    const png = Buffer.from(pngBytes());
    png.write('XXXX', 12, 'ascii');
    expect(readImageSize(png, 'image/png')).toBeNull();
  });

  it('returns null for something that is not an image type it knows', () => {
    expect(readImageSize(Buffer.from('%PDF-1.4'), 'application/pdf')).toBeNull();
  });
});
