/**
 * What a file REALLY is, decided from its first bytes ("magic numbers"). The name a browser or
 * a person gave it, and the Content-Type header of the upload, are never consulted: a renamed
 * .exe or an HTML page called photo.png is exactly what an attacker sends. Anything not on the
 * list below is unknown. SVG is deliberately NOT on it: SVG is XML that can carry script, and
 * accepting it safely needs a vetted sanitiser this project does not have.
 */
export type DetectedType =
  | { mime: 'image/png'; ext: 'png'; kind: 'image' }
  | { mime: 'image/jpeg'; ext: 'jpg'; kind: 'image' }
  | { mime: 'image/webp'; ext: 'webp'; kind: 'image' }
  | { mime: 'image/avif'; ext: 'avif'; kind: 'image' }
  | { mime: 'application/pdf'; ext: 'pdf'; kind: 'document' };

export type DetectedMime = DetectedType['mime'];

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const ascii = (bytes: Uint8Array, start: number, end: number): string => {
  let out = '';
  for (let i = start; i < end && i < bytes.length; i++) out += String.fromCharCode(bytes[i] ?? 0);
  return out;
};

const startsWith = (bytes: Uint8Array, signature: readonly number[]) => signature.every((b, i) => bytes[i] === b);

/** AVIF is an ISO-BMFF file: a `ftyp` box whose major or compatible brands include avif/avis. */
function isAvif(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || ascii(bytes, 4, 8) !== 'ftyp') return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxSize = Math.min(view.getUint32(0), bytes.length, 256);
  if (boxSize < 16) return false;
  const brands = [ascii(bytes, 8, 12)];
  for (let i = 16; i + 4 <= boxSize; i += 4) brands.push(ascii(bytes, i, i + 4));
  return brands.some((b) => b === 'avif' || b === 'avis');
}

export function detectFileType(bytes: Uint8Array): DetectedType | null {
  if (startsWith(bytes, PNG)) return { mime: 'image/png', ext: 'png', kind: 'image' };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg', kind: 'image' };
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp', kind: 'image' };
  if (isAvif(bytes)) return { mime: 'image/avif', ext: 'avif', kind: 'image' };
  // The header must be the very first thing in the file: a PDF that "hides" behind leading bytes is not accepted.
  if (ascii(bytes, 0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf', kind: 'document' };
  return null;
}
