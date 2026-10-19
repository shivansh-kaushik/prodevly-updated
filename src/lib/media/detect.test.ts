import { describe, expect, it } from 'vitest';
import { avifBytes, jpegBytes, pdfBytes, pngBytes, webpBytes } from '@/test/content-factories';
import { detectFileType } from './detect';

const bytes = (s: string) => new Uint8Array(Buffer.from(s, 'latin1'));

describe('detectFileType: the type comes from the bytes', () => {
  it.each([
    ['PNG', pngBytes(), 'image/png', 'png'],
    ['JPEG', jpegBytes(), 'image/jpeg', 'jpg'],
    ['WebP (lossy)', webpBytes(8, 8, 'lossy'), 'image/webp', 'webp'],
    ['WebP (lossless)', webpBytes(8, 8, 'lossless'), 'image/webp', 'webp'],
    ['AVIF', avifBytes(), 'image/avif', 'avif'],
    ['PDF', pdfBytes(), 'application/pdf', 'pdf'],
  ])('recognises %s', (_name, data, mime, ext) => {
    expect(detectFileType(data)).toMatchObject({ mime, ext });
  });

  it('marks images as images and a PDF as a document', () => {
    expect(detectFileType(pngBytes())?.kind).toBe('image');
    expect(detectFileType(pdfBytes())?.kind).toBe('document');
  });

  it.each([
    ['a Windows executable', 'MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00'],
    ['an HTML page', '<!doctype html><html><script>alert(1)</script></html>'],
    ['an SVG image', '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><script>alert(1)</script></svg>'],
    ['a shell script', '#!/bin/sh\nrm -rf /\n'],
    ['a ZIP archive', 'PK\x03\x04\x14\x00\x00\x00\x08\x00'],
    ['plain text', 'hello world'],
    ['an empty file', ''],
    ['a GIF (not on the list)', 'GIF89a\x01\x00\x01\x00'],
  ])('rejects %s, whatever it is called', (_name, content) => {
    expect(detectFileType(bytes(content))).toBeNull();
  });

  it('does not accept a PDF whose header is not the first thing in the file', () => {
    expect(detectFileType(bytes('\n%PDF-1.4\n'))).toBeNull();
    expect(detectFileType(bytes('GARBAGE%PDF-1.4'))).toBeNull();
  });

  it('does not take HEIC (an ISO-BMFF file with a different brand) for AVIF', () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic', 'ascii'), Buffer.alloc(4), Buffer.from('mif1heic', 'ascii')]);
    expect(detectFileType(heic)).toBeNull();
  });

  it('accepts AVIF whose major brand is something else but lists avif as compatible', () => {
    const file = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmif1', 'ascii'), Buffer.alloc(4), Buffer.from('mif1avif', 'ascii')]);
    expect(detectFileType(file)?.mime).toBe('image/avif');
  });

  it('survives a truncated file (a RIFF header with nothing after it, a one-byte file)', () => {
    expect(detectFileType(bytes('RIFF'))).toBeNull();
    expect(detectFileType(bytes('\xff'))).toBeNull();
    expect(detectFileType(bytes('\x00\x00\x00\x08ftyp'))).toBeNull();
  });
});
