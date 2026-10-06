import { describe, it, expect } from 'vitest';
import { deriveFrustum, designToFan, CUP_8OZ } from '@cupco/geometry';
import { warpPictureToFan, createImage, type FanPicture, type RasterImage } from '../src/index';

const g8 = deriveFrustum(CUP_8OZ.dimensions);

/** A picture from rows of RGBA quadruples. */
function picture(rows: number[][][]): RasterImage {
  const img = createImage(rows[0]!.length, rows.length);
  rows.forEach((row, y) => row.forEach((p, x) => img.data.set(p, (y * img.width + x) * 4)));
  return img;
}

/** The warped pixel under a design-space point. */
function at(pieces: FanPicture[], u: number, v: number): number[] {
  const p = designToFan({ u, v }, g8);
  for (const f of pieces) {
    const x = Math.floor((p.x - f.originXMm) / f.mmPerPixel);
    const y = Math.floor((p.y - f.originYMm) / f.mmPerPixel);
    if (x < 0 || y < 0 || x >= f.image.width || y >= f.image.height) continue;
    const i = (y * f.image.width + x) * 4;
    return [...f.image.data.subarray(i, i + 4)];
  }
  return [0, 0, 0, 0];
}

const RED = [255, 0, 0, 255], GREEN = [0, 255, 0, 255], BLUE = [0, 0, 255, 255], WHITE = [255, 255, 255, 255];
const quad = picture([[RED, GREEN], [BLUE, WHITE]]);
// Unit square -> u 0.4..0.5, and down the picture is DOWN the cup: v 0.6..0.4.
const place = [0.1, 0, 0, -0.2, 0.4, 0.6] as const;

describe('warping a picture onto the fan', () => {
  const pieces = warpPictureToFan(quad, place, g8, { dpi: 150, supersample: 1 });

  it('puts each part of the picture where its placement says', () => {
    expect(pieces).toHaveLength(1);
    expect(at(pieces, 0.42, 0.58)).toEqual(RED);     // top left
    expect(at(pieces, 0.48, 0.58)).toEqual(GREEN);   // top right
    expect(at(pieces, 0.42, 0.42)).toEqual(BLUE);    // bottom left
    expect(at(pieces, 0.48, 0.42)).toEqual(WHITE);   // bottom right
  });

  it('is transparent outside the picture', () => {
    expect(at(pieces, 0.38, 0.5)[3]).toBe(0);
    expect(at(pieces, 0.45, 0.65)[3]).toBe(0);
  });

  it('carries the element opacity into the alpha', () => {
    const faint = warpPictureToFan(quad, place, g8, { dpi: 150, supersample: 1, opacity: 0.5 });
    expect(at(faint, 0.42, 0.58)[3]).toBeCloseTo(127.5, -1);
  });

  it('appears at both edges when it straddles the glue seam', () => {
    const seam = warpPictureToFan(quad, [0.1, 0, 0, -0.2, -0.05, 0.6], g8, { dpi: 100, supersample: 1 });
    expect(seam).toHaveLength(2);
    // The left half shows at the right-hand edge of the fan, the right half
    // at the left-hand edge - one picture, continuous across the join.
    expect(at(seam, 0.97, 0.58)).toEqual(RED);
    expect(at(seam, 0.03, 0.58)).toEqual(GREEN);
  });

  it('does not bleed the colour of transparent pixels into the edge', () => {
    // White next to transparent black. Filtering straight alpha would grey
    // the boundary; premultiplied filtering keeps it white.
    const edge = picture([[WHITE, [0, 0, 0, 0]]]);
    const out = warpPictureToFan(edge, place, g8, { dpi: 300, supersample: 2 });
    let worst = 255;
    for (const f of out) {
      for (let i = 0; i < f.image.data.length; i += 4) {
        if (f.image.data[i + 3]! > 8) worst = Math.min(worst, f.image.data[i]!);
      }
    }
    expect(worst).toBeGreaterThan(250);
  });
});
