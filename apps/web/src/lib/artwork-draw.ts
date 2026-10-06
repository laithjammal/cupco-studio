/**
 * Painting artwork - shapes and embedded pictures - onto a 2D canvas.
 *
 * One routine for every place artwork is drawn: the editor preview, concept
 * thumbnails, and the import check that lays our reading of a file over the
 * browser's. If the import check drew differently from the preview, it could
 * pass a logo the preview then shows wrong.
 */

import { rgbToCmyk, simulateCmykPrint, type Affine, type RGB } from '@cupco/vector';
import { decodedRaster, proofedRaster } from './raster-cache';

type Ring = readonly { x: number; y: number }[];

/** The parts of artwork drawing needs. PlacedArtwork satisfies it. */
export interface DrawableArtwork {
  shapes: readonly {
    subpaths: readonly Ring[];
    fill: RGB;
    opacity: number;
    fillRule?: 'nonzero' | 'evenodd';
  }[];
  rasters?: readonly {
    href: string;
    matrix: Affine;
    naturalWidth: number;
    naturalHeight: number;
    opacity: number;
    clip?: readonly Ring[] | null;
    before: number;
  }[];
}

export interface DrawArtworkOptions {
  /** Opacity the element itself adds, multiplied into every part. */
  opacity?: number;
  /** Show colours as they will print in CMYK ink. */
  proofCmyk?: boolean;
}

const mul = (m: Affine, n: Affine): Affine => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

function tracePath(ctx: CanvasRenderingContext2D, rings: readonly Ring[], m: Affine): void {
  ctx.beginPath();
  for (const ring of rings) {
    ring.forEach((p, i) => {
      const x = m[0] * p.x + m[2] * p.y + m[4];
      const y = m[1] * p.x + m[3] * p.y + m[5];
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
}

/**
 * Paint artwork through `toCanvas`, which maps the artwork's own units into
 * the context's current coordinates.
 *
 * Pictures are painted in the file's own order - each before the shape it
 * preceded - so a photo framed by a ring sits under the ring, not over it.
 * A picture still decoding is skipped; the raster cache announces it when it
 * is ready and the caller redraws.
 */
export function drawArtwork(
  ctx: CanvasRenderingContext2D,
  art: DrawableArtwork,
  toCanvas: Affine,
  options: DrawArtworkOptions = {},
): void {
  const base = options.opacity ?? 1;
  const rasters = art.rasters ?? [];

  const drawRaster = (r: NonNullable<DrawableArtwork['rasters']>[number]) => {
    const pic = options.proofCmyk ? proofedRaster(r.href) : decodedRaster(r.href);
    if (!pic || r.naturalWidth <= 0 || r.naturalHeight <= 0) return;
    ctx.save();
    ctx.globalAlpha = base * r.opacity;
    if (r.clip && r.clip.length) {
      tracePath(ctx, r.clip, toCanvas);
      ctx.clip('nonzero');
    }
    // Image pixels -> the image's unit square -> artwork -> canvas.
    const m = mul(toCanvas, mul(r.matrix, [1 / r.naturalWidth, 0, 0, 1 / r.naturalHeight, 0, 0]));
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(pic, 0, 0, r.naturalWidth, r.naturalHeight);
    ctx.restore();
  };

  art.shapes.forEach((shape, i) => {
    for (const r of rasters) if (r.before === i) drawRaster(r);
    ctx.globalAlpha = base * shape.opacity;
    const c = options.proofCmyk ? simulateCmykPrint(rgbToCmyk(shape.fill)) : shape.fill;
    ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    tracePath(ctx, shape.subpaths, toCanvas);
    // The shape's OWN rule. Imported artwork states it; generated artwork
    // leaves it unset and means even-odd. Assuming one rule for both punched
    // holes through logos that had none.
    ctx.fill(shape.fillRule ?? 'evenodd');
  });
  for (const r of rasters) if (r.before >= art.shapes.length) drawRaster(r);
  ctx.globalAlpha = base;
}
