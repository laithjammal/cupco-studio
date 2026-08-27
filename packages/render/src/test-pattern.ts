/**
 * Deterministic test artwork.
 *
 * Used by the verification step the architecture plan calls for: place a known
 * grid in design space, then confirm it lands where predicted in BOTH the 3D
 * UV map and the exported fan. Because the pattern encodes position into
 * colour, a single sampled pixel proves where it came from.
 */
import { createImage, type RasterImage } from './image';

export interface TestPatternOptions {
  width?: number;
  height?: number;
  /** Grid divisions across u. */
  cols?: number;
  /** Grid divisions up v. */
  rows?: number;
}

/**
 * A grid whose red channel encodes u and green channel encodes v.
 *
 *   red   = round(u * 255)   at the cell centre
 *   green = round(v * 255)
 *
 * So sampling any fan pixel and decoding (r/255, g/255) recovers the design
 * coordinate it came from - which is exactly what the round-trip test asserts.
 *
 * Blue marks structure: the seam column and the two rims are tinted so the
 * pattern is also readable by eye on the 3D cup.
 */
export function createUVTestPattern(opts: TestPatternOptions = {}): RasterImage {
  const width = opts.width ?? 512;
  const height = opts.height ?? 256;
  const cols = opts.cols ?? 16;
  const rows = opts.rows ?? 8;

  const img = createImage(width, height);
  const d = img.data;

  for (let y = 0; y < height; y++) {
    // Raster row 0 is the TOP of the cup, so v runs the other way.
    const v = 1 - (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;

      const cell = (Math.floor(u * cols) + Math.floor(v * rows)) % 2 === 0;
      const nearSeam = u < 1 / width || u > 1 - 1 / width;
      const nearRim = v < 0.02 || v > 0.98;

      const i = (y * width + x) * 4;
      d[i] = Math.round(u * 255);
      d[i + 1] = Math.round(v * 255);
      d[i + 2] = nearSeam ? 255 : nearRim ? 180 : cell ? 90 : 20;
      d[i + 3] = 255;
    }
  }
  return img;
}

/** Decode a pixel produced by createUVTestPattern back to (u,v). */
export function decodeUV(r: number, g: number): { u: number; v: number } {
  return { u: r / 255, v: g / 255 };
}

/** Flat colour fill, for background plates and quick checks. */
export function createSolid(
  width: number,
  height: number,
  rgba: readonly [number, number, number, number],
): RasterImage {
  const img = createImage(width, height);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = rgba[0];
    img.data[i + 1] = rgba[1];
    img.data[i + 2] = rgba[2];
    img.data[i + 3] = rgba[3];
  }
  return img;
}
