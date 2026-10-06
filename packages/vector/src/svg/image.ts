/**
 * Embedded images: decoding data URLs and reading their pixel size.
 *
 * DOM-free like the rest of the importer, so it can be tested without a
 * browser - which means reading dimensions from the file headers directly
 * rather than decoding pixels. The size is what placement needs:
 * preserveAspectRatio cannot fit an image into its box without it.
 */

export interface DataUrl { mime: string; bytes: Uint8Array }

function base64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/=_-]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function parseDataUrl(href: string): DataUrl | null {
  const m = /^\s*data:([^,]*?)(;base64)?,([\s\S]*)$/i.exec(href);
  if (!m) return null;
  const mime = (m[1]!.split(';')[0] || 'text/plain').trim().toLowerCase();
  try {
    const bytes = m[2] ? base64(m[3]!) : new TextEncoder().encode(decodeURIComponent(m[3]!));
    return { mime, bytes };
  } catch {
    return null;
  }
}

const be16 = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const le16 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const be32 = (b: Uint8Array, i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
const le24 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const le32 = (b: Uint8Array, i: number) => (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24));
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

/** Pixel dimensions of a PNG, JPEG, GIF, WebP or BMP, from its header. */
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  if (b.length < 24) return null;
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return { w: be32(b, 16), h: be32(b, 20) };
  if (ascii(b, 0, 4) === 'GIF8') return { w: le16(b, 6), h: le16(b, 8) };
  if (b[0] === 0x42 && b[1] === 0x4d) return { w: le32(b, 18), h: Math.abs(le32(b, 22)) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      // Start of frame: every SOF marker except DHT, JPG and DAC.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { w: be16(b, i + 7), h: be16(b, i + 5) };
      }
      i += 2 + be16(b, i + 2);
    }
    return null;
  }
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const kind = ascii(b, 12, 4);
    if (kind === 'VP8 ') return { w: le16(b, 26) & 0x3fff, h: le16(b, 28) & 0x3fff };
    if (kind === 'VP8L') {
      return {
        w: 1 + (((b[22]! & 0x3f) << 8) | b[21]!),
        h: 1 + (((b[24]! & 0x0f) << 10) | (b[23]! << 2) | ((b[22]! & 0xc0) >> 6)),
      };
    }
    if (kind === 'VP8X') return { w: 1 + le24(b, 24), h: 1 + le24(b, 27) };
  }
  return null;
}

export function utf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
