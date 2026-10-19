import type { DetectedMime } from './detect';

/**
 * Image width and height read from the file HEADER, with no image library. Nothing is decoded,
 * so a hostile file cannot make this allocate: it only walks a few headers and returns null the
 * moment anything is out of range (a DataView read past the end throws, and that is caught).
 * Null means "not a well-formed image of that type", which the upload treats as a rejection.
 */
export interface ImageSize {
  width: number;
  height: number;
}

const ascii = (bytes: Uint8Array, start: number, end: number): string => {
  let out = '';
  for (let i = start; i < end && i < bytes.length; i++) out += String.fromCharCode(bytes[i] ?? 0);
  return out;
};

function png(view: DataView, bytes: Uint8Array): ImageSize | null {
  // 8-byte signature, then the first chunk, which must be IHDR: length(4) "IHDR"(4) width(4) height(4).
  if (ascii(bytes, 12, 16) !== 'IHDR') return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function jpeg(view: DataView, bytes: Uint8Array): ImageSize | null {
  let p = 2;
  while (p + 4 <= bytes.length) {
    if (bytes[p] !== 0xff) return null;
    let marker = bytes[p + 1] ?? 0;
    while (marker === 0xff) marker = bytes[++p + 1] ?? 0; // fill bytes
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      p += 2; // markers with no length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image or start of scan, and no frame header seen
    const length = view.getUint16(p + 2);
    // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC), carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: view.getUint16(p + 5), width: view.getUint16(p + 7) };
    }
    if (length < 2) return null;
    p += 2 + length;
  }
  return null;
}

function webp(view: DataView, bytes: Uint8Array): ImageSize | null {
  const chunk = ascii(bytes, 12, 16);
  if (chunk === 'VP8 ') {
    // Lossy: a 3-byte frame tag, the start code 9d 01 2a, then 14-bit width and height.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) return null;
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    const u24 = (at: number) => (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16);
    return { width: u24(24) + 1, height: u24(27) + 1 };
  }
  return null;
}

/** Walks ISO-BMFF boxes in [start, end), calling `visit(type, bodyStart, bodyEnd)`. */
function walkBoxes(view: DataView, bytes: Uint8Array, start: number, end: number, visit: (type: string, from: number, to: number) => void) {
  let p = start;
  while (p + 8 <= end) {
    let size = view.getUint32(p);
    const type = ascii(bytes, p + 4, p + 8);
    let header = 8;
    if (size === 1) {
      // 64-bit size: only sizes that fit comfortably in a number are meaningful here
      const high = view.getUint32(p + 8);
      if (high !== 0) return;
      size = view.getUint32(p + 12);
      header = 16;
    } else if (size === 0) size = end - p;
    if (size < header || p + size > end) return;
    visit(type, p + header, p + size);
    p += size;
  }
}

function avif(view: DataView, bytes: Uint8Array): ImageSize | null {
  let best: ImageSize | null = null;
  const consider = (width: number, height: number) => {
    if (!best || width * height > best.width * best.height) best = { width, height };
  };
  walkBoxes(view, bytes, 0, bytes.length, (type, from, to) => {
    if (type !== 'meta') return;
    // meta is a "full box": 4 bytes of version and flags come first.
    walkBoxes(view, bytes, from + 4, to, (t2, f2, e2) => {
      if (t2 !== 'iprp') return;
      walkBoxes(view, bytes, f2, e2, (t3, f3, e3) => {
        if (t3 !== 'ipco') return;
        walkBoxes(view, bytes, f3, e3, (t4, f4) => {
          // ispe (image spatial extents), a full box: version/flags(4), width(4), height(4)
          if (t4 === 'ispe') consider(view.getUint32(f4 + 4), view.getUint32(f4 + 8));
        });
      });
    });
  });
  return best;
}

export function readImageSize(bytes: Uint8Array, mime: DetectedMime): ImageSize | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    switch (mime) {
      case 'image/png': return png(view, bytes);
      case 'image/jpeg': return jpeg(view, bytes);
      case 'image/webp': return webp(view, bytes);
      case 'image/avif': return avif(view, bytes);
      default: return null;
    }
  } catch {
    return null; // a header that runs off the end of the file
  }
}
