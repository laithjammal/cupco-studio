'use client';

/**
 * Composite artwork onto the cup in a photograph.
 *
 * Three things have to be right for this to look real rather than pasted:
 *
 * 1. SHAPE. The artwork is warped through the plate calibration, so it follows
 *    the cup's real curve and compresses towards the silhouette. That is the
 *    geometry engine's job, not this file's.
 *
 * 2. LIGHT. The artwork is MULTIPLIED into the photograph rather than drawn
 *    over it. Multiply keeps every bit of the original: the fall of light down
 *    the cup, the highlight where it turns, the shadow under the fingers, the
 *    grain of the board. Ink on paper darkens what is underneath, so multiply
 *    is not merely a convenient blend mode - it is what ink does.
 *
 * 3. WHAT IS IN FRONT. In a photograph of a HELD cup, fingers cross the
 *    silhouette. Artwork painted over them would ruin the shot instantly. The
 *    mask below solves that without anyone hand-painting anything.
 */

import { platePoint, plateU, plateFacing } from '@cupco/geometry';
import type { PlateCalibration } from '@cupco/geometry';

export interface MaskOptions {
  /** Below this brightness a pixel is not cup. Excludes a black lid. */
  minBrightness: number;
  /** Above this saturation a pixel is not cup. Excludes skin. */
  maxSaturation: number;
  /** Fade artwork out this far from the silhouette, 0-0.5. */
  edgeFade: number;
  /** Strength of the ink, 0-1. Lets an operator dial a print back. */
  opacity: number;
}

export const DEFAULT_MASK: MaskOptions = {
  minBrightness: 0.45,
  maxSaturation: 0.22,
  edgeFade: 0.06,
  opacity: 1,
};

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-6)));
  return t * t * (3 - 2 * t);
};

/**
 * How much a plate pixel looks like bare cup board.
 *
 * Bright AND neutral. A white cup is both; skin is bright but distinctly warm,
 * and a black lid is neutral but dark. So one cheap test separates the cup
 * from the two things most likely to be in front of it, with no hand-painted
 * mask and nothing for the operator to get wrong.
 *
 * The background is often neutral and bright too - concrete, a white wall -
 * but that does not matter, because this is only ever consulted INSIDE the
 * calibrated area, which is on the cup.
 */
function cupness(r: number, g: number, b: number, o: MaskOptions): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const sat = max <= 0 ? 0 : (max - min) / max;
  const bright = smoothstep(o.minBrightness - 0.12, o.minBrightness + 0.12, max);
  const neutral = 1 - smoothstep(o.maxSaturation - 0.06, o.maxSaturation + 0.06, sat);
  return bright * neutral;
}

/**
 * Map a source triangle of the design onto a destination triangle.
 *
 * Canvas 2D has no texture mapping, so each triangle is clipped and then given
 * the affine transform that carries its source corners onto its destination
 * corners. Subdivided finely enough, the piecewise-affine result is
 * indistinguishable from a true curved warp.
 */
function drawTriangle(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  s: number[], d: number[],
): void {
  const [sx0, sy0, sx1, sy1, sx2, sy2] = s as [number, number, number, number, number, number];
  const [dx0, dy0, dx1, dy1, dx2, dy2] = d as [number, number, number, number, number, number];

  const den = sx0 * (sy2 - sy1) - sx1 * sy2 + sx2 * sy1 + (sx1 - sx2) * sy0;
  if (Math.abs(den) < 1e-12) return;

  const a = -(sy0 * (dx2 - dx1) - sy1 * dx2 + sy2 * dx1 + (sy1 - sy2) * dx0) / den;
  const b = (sy1 * dy2 + sy0 * (dy1 - dy2) - sy2 * dy1 + (sy2 - sy1) * dy0) / den;
  const c = (sx0 * (dx2 - dx1) - sx1 * dx2 + sx2 * dx1 + (sx1 - sx2) * dx0) / den;
  const dd = -(sx1 * dy2 + sx0 * (dy1 - dy2) - sx2 * dy1 + (sx2 - sx1) * dy0) / den;
  const e = (sx0 * (sy2 * dx1 - sy1 * dx2) + sy0 * (sx1 * dx2 - sx2 * dx1)
    + (sx2 * sy1 - sx1 * sy2) * dx0) / den;
  const f = (sx0 * (sy2 * dy1 - sy1 * dy2) + sy0 * (sx1 * dy2 - sx2 * dy1)
    + (sx2 * sy1 - sx1 * sy2) * dy0) / den;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(dx0, dy0);
  ctx.lineTo(dx1, dy1);
  ctx.lineTo(dx2, dy2);
  ctx.closePath();
  // Expand the clip by a hair so neighbouring triangles cannot leave a seam.
  ctx.clip();
  ctx.transform(a, b, c, dd, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/** Columns of the warp mesh. The foreshortening is horizontal, so this is where accuracy is needed. */
const MESH_COLUMNS = 220;

/**
 * Warp the design into the calibrated area on its own transparent canvas.
 *
 * Columns are stepped through the ARCSINE mapping, so each strip of the mesh
 * carries the slice of design that is genuinely visible at that point on the
 * cup - narrow slices in the middle, wide ones towards the edges.
 */
export function warpDesignToPlate(
  design: HTMLCanvasElement,
  cal: PlateCalibration,
  width: number,
  height: number,
  mask: MaskOptions,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');

  const dw = design.width;
  const dh = design.height;

  for (let i = 0; i < MESH_COLUMNS; i++) {
    const s0 = i / MESH_COLUMNS;
    const s1 = (i + 1) / MESH_COLUMNS;

    // Design x for each column edge. u can wrap past 1, so unwrap to keep the
    // strip contiguous in source space.
    let u0 = plateU(s0, cal);
    let u1 = plateU(s1, cal);
    if (u1 < u0) u1 += 1;
    const sx0 = u0 * dw;
    const sx1 = u1 * dw;

    const tl = platePoint(s0, 0, cal);
    const tr = platePoint(s1, 0, cal);
    const bl = platePoint(s0, 1, cal);
    const br = platePoint(s1, 1, cal);

    // Fade towards the silhouette, where the surface turns out of sight.
    const facing = Math.min(plateFacing(s0), plateFacing(s1));
    const alpha = mask.edgeFade <= 0
      ? 1
      : smoothstep(0, mask.edgeFade, Math.min(s0, 1 - s1) + facing * 0.02);
    if (alpha <= 0.002) continue;
    ctx.globalAlpha = alpha;

    // Two triangles per column strip.
    drawTriangle(ctx, design,
      [sx0, 0, sx1, 0, sx0, dh],
      [tl.x, tl.y, tr.x, tr.y, bl.x, bl.y]);
    drawTriangle(ctx, design,
      [sx1, 0, sx1, dh, sx0, dh],
      [tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
  }
  ctx.globalAlpha = 1;
  return canvas;
}

export interface CompositeResult {
  canvas: HTMLCanvasElement;
  /** Fraction of the calibrated area the mask judged to be cup. */
  cupCoverage: number;
}

/**
 * Put the warped artwork onto the plate photograph.
 */
export function compositeOntoPlate(
  plate: HTMLImageElement | HTMLCanvasElement,
  design: HTMLCanvasElement,
  cal: PlateCalibration,
  mask: MaskOptions = DEFAULT_MASK,
): CompositeResult {
  const width = plate instanceof HTMLImageElement ? plate.naturalWidth : plate.width;
  const height = plate instanceof HTMLImageElement ? plate.naturalHeight : plate.height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D context unavailable');
  ctx.drawImage(plate, 0, 0, width, height);

  const warped = warpDesignToPlate(design, cal, width, height, mask);
  const wctx = warped.getContext('2d', { willReadFrequently: true });
  if (!wctx) throw new Error('2D context unavailable');

  const plateData = ctx.getImageData(0, 0, width, height);
  const artData = wctx.getImageData(0, 0, width, height);
  const pd = plateData.data;
  const ad = artData.data;

  let masked = 0;
  let inside = 0;

  // Apply the cup mask to the artwork's alpha, so anything in front of the cup
  // - fingers, a lid, a straw - stays in front of it.
  for (let i = 0; i < ad.length; i += 4) {
    if (ad[i + 3] === 0) continue;
    inside++;
    const k = cupness(pd[i]!, pd[i + 1]!, pd[i + 2]!, mask);
    if (k > 0.5) masked++;
    ad[i + 3] = Math.round(ad[i + 3]! * k * mask.opacity);
  }
  wctx.putImageData(artData, 0, 0);

  // Multiply: ink darkens the board, and every highlight, shadow and texture
  // in the photograph survives underneath it.
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(warped, 0, 0);
  ctx.globalCompositeOperation = 'source-over';

  return { canvas, cupCoverage: inside === 0 ? 0 : masked / inside };
}
