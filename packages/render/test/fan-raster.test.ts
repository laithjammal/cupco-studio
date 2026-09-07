import { describe, it, expect } from 'vitest';
import { deriveFrustum, designToFan, CUP_8OZ } from '@cupco/geometry';
import {
  rasteriseFan, fanMmToPixel, createUVTestPattern, decodeUV, createSolid,
  sampleBilinear, createImage, type RasterImage,
} from '../src/index';

const g8 = deriveFrustum(CUP_8OZ.dimensions);

function pixelAt(
  img: RasterImage, x: number, y: number,
): [number, number, number, number] {
  const i = (Math.round(y) * img.width + Math.round(x)) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!];
}

describe('rasteriseFan — output sizing', () => {
  it('sizes the canvas from the bleed bounds at the requested dpi', () => {
    const { transform: t } = rasteriseFan(createSolid(8, 8, [255, 0, 0, 255]), CUP_8OZ, g8, { dpi: 150 });
    expect(t.dpi).toBe(150);
    expect(t.mmPerPixel).toBeCloseTo(25.4 / 150, 10);
    // The blank plus 5mm of bleed on each edge, plus the rasteriser's own 3mm
    // of padding. The exact figure moves with the profile; these bracket it.
    expect(t.widthMm).toBeGreaterThan(250);
    expect(t.widthMm).toBeLessThan(275);
    expect(t.heightMm).toBeGreaterThan(130);
    expect(t.heightMm).toBeLessThan(155);
    expect(t.widthPx).toBe(Math.ceil(t.widthMm / t.mmPerPixel));
    expect(t.heightPx).toBe(Math.ceil(t.heightMm / t.mmPerPixel));
  });

  it('doubling dpi doubles the pixel dimensions', () => {
    const a = rasteriseFan(createSolid(4, 4, [1, 2, 3, 255]), CUP_8OZ, g8, { dpi: 100 }).transform;
    const b = rasteriseFan(createSolid(4, 4, [1, 2, 3, 255]), CUP_8OZ, g8, { dpi: 200 }).transform;
    expect(b.widthPx / a.widthPx).toBeCloseTo(2, 1);
    expect(b.heightPx / a.heightPx).toBeCloseTo(2, 1);
  });
});

describe('rasteriseFan — artwork lands where the geometry says it should', () => {
  // The core correctness claim of the export path. Uses the UV test pattern:
  // sample a fan pixel, decode the colour, and check it matches the design
  // coordinate the geometry engine predicts for that exact spot.
  const design = createUVTestPattern({ width: 1024, height: 512, cols: 1, rows: 1 });
  const { image, transform } = rasteriseFan(design, CUP_8OZ, g8, { dpi: 150 });

  const probes: { u: number; v: number }[] = [
    { u: 0.5, v: 0.5 },
    { u: 0.25, v: 0.25 },
    { u: 0.75, v: 0.75 },
    { u: 0.1, v: 0.9 },
    { u: 0.9, v: 0.1 },
    { u: 0.5, v: 0.05 },
    { u: 0.5, v: 0.95 },
  ];

  it.each(probes)('design (u=$u, v=$v) round-trips through the fan raster', ({ u, v }) => {
    const mm = designToFan({ u, v }, g8);
    const p = fanMmToPixel(mm.x, mm.y, transform);
    const [r, gch, , a] = pixelAt(image, p.x, p.y);
    expect(a).toBeGreaterThan(0); // must be inside the sector
    const got = decodeUV(r, gch);
    // Tolerance covers 8-bit colour quantisation plus half-pixel rounding.
    expect(got.u).toBeCloseTo(u, 1);
    expect(got.v).toBeCloseTo(v, 1);
  });
});

describe('rasteriseFan — the sector mask', () => {
  const design = createSolid(64, 64, [255, 128, 0, 255]);
  const { image, transform } = rasteriseFan(design, CUP_8OZ, g8, { dpi: 100 });

  it('leaves the corners outside the sector transparent', () => {
    // The fan is a curved sector inside a rectangular canvas, so all four
    // corners must be empty. If they were filled, the mask is not working and
    // ink would be laid outside the blank.
    for (const [x, y] of [[0, 0], [image.width - 1, 0], [0, image.height - 1], [image.width - 1, image.height - 1]]) {
      expect(pixelAt(image, x!, y!)[3]).toBe(0);
    }
  });

  it('fills the centre of the sector', () => {
    const mm = designToFan({ u: 0.5, v: 0.5 }, g8);
    const p = fanMmToPixel(mm.x, mm.y, transform);
    expect(pixelAt(image, p.x, p.y)[3]).toBeGreaterThan(0);
  });

  it('honours a custom background outside the sector', () => {
    const r = rasteriseFan(design, CUP_8OZ, g8, { dpi: 80, background: [10, 20, 30, 255] });
    expect(pixelAt(r.image, 0, 0)).toEqual([10, 20, 30, 255]);
  });

  it('a bleed raster covers more area than a trim raster', () => {
    const bleed = rasteriseFan(design, CUP_8OZ, g8, { dpi: 100, boundary: 'bleed' }).transform;
    const trim = rasteriseFan(design, CUP_8OZ, g8, { dpi: 100, boundary: 'trim' }).transform;
    expect(bleed.widthMm).toBeGreaterThan(trim.widthMm);
    expect(bleed.heightMm).toBeGreaterThan(trim.heightMm);
  });
});

describe('seam continuity', () => {
  // Artwork must be continuous across u=0/u=1, otherwise the finished cup
  // shows a streak down the glue seam.
  it('wrapped sampling is continuous across the seam', () => {
    const img = createUVTestPattern({ width: 256, height: 128, cols: 1, rows: 1 });
    const before: number[] = [0, 0, 0, 0];
    const after: number[] = [0, 0, 0, 0];
    sampleBilinear(img, 0.999, 0.5, true, before);
    sampleBilinear(img, 0.001, 0.5, true, after);
    // Blue channel marks the seam column identically on both sides.
    expect(Math.abs(before[2]! - after[2]!)).toBeLessThan(60);
  });

  it('unwrapped sampling clamps instead of wrapping', () => {
    const img = createImage(4, 4);
    for (let i = 0; i < img.data.length; i += 4) {
      const x = (i / 4) % 4;
      img.data[i] = x === 0 ? 255 : 0;
      img.data[i + 3] = 255;
    }
    const wrapped: number[] = [0, 0, 0, 0];
    const clamped: number[] = [0, 0, 0, 0];
    // u=1.1 wraps to 0.1, which straddles the red column at x=0; clamping
    // instead pins to u=1 and never sees it.
    sampleBilinear(img, 1.1, 0.5, true, wrapped);
    sampleBilinear(img, 1.1, 0.5, false, clamped);
    expect(wrapped[0]!).toBeGreaterThan(200);
    expect(clamped[0]!).toBe(0);
  });
});

describe('supersampling', () => {
  it('produces the same dimensions and a valid image', () => {
    const design = createUVTestPattern({ width: 256, height: 128 });
    const a = rasteriseFan(design, CUP_8OZ, g8, { dpi: 72, supersample: 1 });
    const b = rasteriseFan(design, CUP_8OZ, g8, { dpi: 72, supersample: 2 });
    expect(b.image.width).toBe(a.image.width);
    expect(b.image.height).toBe(a.image.height);
    expect(b.image.data.length).toBe(a.image.data.length);
  });

  it('antialiases the sector edge rather than hard-clipping it', () => {
    // With supersampling, edge pixels should show partial alpha. Without it,
    // every pixel is either fully in or fully out.
    const design = createSolid(32, 32, [255, 255, 255, 255]);
    const ss = rasteriseFan(design, CUP_8OZ, g8, { dpi: 72, supersample: 3 });
    let partial = 0;
    for (let i = 3; i < ss.image.data.length; i += 4) {
      const a = ss.image.data[i]!;
      if (a > 0 && a < 255) partial++;
    }
    expect(partial).toBeGreaterThan(0);
  });
});

describe('input validation', () => {
  it('rejects a non-positive dpi', () => {
    expect(() => rasteriseFan(createSolid(4, 4, [0, 0, 0, 255]), CUP_8OZ, g8, { dpi: 0 })).toThrow();
  });
});
