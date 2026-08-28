'use client';

/**
 * Draw the cup, seen head-on, with the design mapped onto it.
 *
 * This is a GATHER, exactly like the production fan rasteriser: it walks the
 * output pixels and asks each one which piece of the design it shows. Painting
 * the design forward onto the shape - stretching strips of artwork across the
 * silhouette - is the obvious approach and it is wrong twice over: it leaves
 * seams between strips, and it spreads artwork evenly across a surface that is
 * curving away, so the logo comes out too wide at the edges.
 *
 * The result must agree with the fan that goes to press. Everything geometric
 * comes from @cupco/geometry; nothing here invents a proportion.
 */

import { cupElevation, uAtAcross, facingAt } from '@cupco/geometry';
import type { ElevationGeometry, FrustumGeometry } from '@cupco/geometry';

export interface CupRenderOptions {
  /** Which part of the design faces the viewer. 0.5 puts the seam behind. */
  centreU?: number;
  tiltRad?: number;
  /** Overall lightness of the scene's light on the cup, 1 = neutral. */
  exposure?: number;
  /** Direction the key light comes from, -1 (left) to 1 (right). */
  lightFrom?: number;
}

/** Unprinted cup board. Not pure white: paper never is. */
const PAPER: [number, number, number] = [246, 244, 240];

/**
 * Solve screen position back to a point on the cup surface.
 *
 * `sy` is measured down from the rim centre. The two equations couple v and
 * the angle, because looking down means a point's height on screen depends on
 * how far round the cup it sits. Four fixed-point passes settle it well below
 * a pixel; the taper is gentle, so the iteration converges quickly.
 */
function solveSurface(
  sx: number,
  sy: number,
  elev: ElevationGeometry,
  bodyHeight: number,
  sinTilt: number,
): { v: number; across: number } | null {
  let v = 1 - sy / bodyHeight;
  let across = 0;

  for (let i = 0; i < 4; i++) {
    const r = elev.radiusAt(v);
    if (r <= 0) return null;
    across = sx / r;
    if (across < -1 || across > 1) return null;
    const cosPhi = Math.sqrt(Math.max(0, 1 - across * across));
    v = 1 - (sy - r * cosPhi * sinTilt) / bodyHeight;
  }
  if (v < 0 || v > 1) return null;
  return { v, across };
}

export interface CupImage {
  canvas: HTMLCanvasElement;
  /** Where the cup's base centre sits inside the canvas, for shadow placement. */
  baseCentre: { x: number; y: number };
  /** Centre of the rim opening, so a scene can seat a lid on it accurately. */
  rimCentre: { x: number; y: number };
  /** Rim ellipse in canvas pixels. */
  rimRadiusPx: number;
  rimDepthPx: number;
  widthPx: number;
  heightPx: number;
}

/**
 * Render the cup to its own transparent canvas.
 *
 * Kept separate from the scenes so a scene can place, scale and shadow it
 * without knowing anything about how it was drawn.
 */
export function renderCup(
  design: HTMLCanvasElement,
  geom: FrustumGeometry,
  heightPx: number,
  options: CupRenderOptions = {},
): CupImage {
  const elev = cupElevation(geom, {
    ...(options.tiltRad !== undefined ? { tiltRad: options.tiltRad } : {}),
    ...(options.centreU !== undefined ? { centreU: options.centreU } : {}),
  });
  const exposure = options.exposure ?? 1;
  const lightFrom = options.lightFrom ?? -0.45;

  const scale = heightPx / elev.heightMm;
  const widthPx = Math.ceil(elev.widthMm * scale);
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');

  const dctx = design.getContext('2d', { willReadFrequently: true });
  if (!dctx) throw new Error('design context unavailable');
  const src = dctx.getImageData(0, 0, design.width, design.height);
  const sd = src.data;

  const out = ctx.createImageData(widthPx, heightPx);
  const od = out.data;

  const bodyHeight = geom.heightMm * Math.cos(elev.tiltRad);
  const sinTilt = Math.sin(elev.tiltRad);
  const topDepth = elev.ellipseDepth(1);
  // Screen origin: rim centre sits topDepth below the top of the canvas.
  const originX = widthPx / 2;
  const originY = topDepth * scale;

  for (let py = 0; py < heightPx; py++) {
    const syMm = (py + 0.5 - originY) / scale;
    for (let px = 0; px < widthPx; px++) {
      const sxMm = (px + 0.5 - originX) / scale;
      const hit = solveSurface(sxMm, syMm, elev, bodyHeight, sinTilt);
      if (!hit) continue;

      const u = uAtAcross(hit.across, elev.centreU);
      const sxi = Math.min(design.width - 1, Math.max(0, Math.floor(u * design.width)));
      // Design row 0 is the TOP of the cup, matching every other renderer.
      const syi = Math.min(design.height - 1, Math.max(0, Math.floor((1 - hit.v) * design.height)));
      const so = (syi * design.width + sxi) * 4;

      // Lambert against a key light that is off to one side, lifted by a fill
      // so the far edge never goes to black. This is what makes it read round.
      const facing = facingAt(hit.across);
      const toLight = Math.max(0, facing * 0.75 + (1 - Math.abs(hit.across - lightFrom)) * 0.45);
      let shade = (0.34 + 0.66 * Math.min(1, toLight)) * exposure;
      // The rim catches the light; the base sits in its own shadow.
      shade *= 0.9 + 0.14 * hit.v;

      const o = (py * widthPx + px) * 4;
      const a = sd[so + 3]! / 255;
      // Anything the design leaves transparent is bare cup board.
      od[o] = Math.min(255, (sd[so]! * a + PAPER[0] * (1 - a)) * shade);
      od[o + 1] = Math.min(255, (sd[so + 1]! * a + PAPER[1] * (1 - a)) * shade);
      od[o + 2] = Math.min(255, (sd[so + 2]! * a + PAPER[2] * (1 - a)) * shade);
      od[o + 3] = 255;
    }
  }

  ctx.putImageData(out, 0, 0);
  drawRim(ctx, elev, scale, originX, originY, exposure);

  return {
    canvas,
    baseCentre: { x: originX, y: originY + bodyHeight * scale },
    rimCentre: { x: originX, y: originY },
    rimRadiusPx: elev.radiusAt(1) * scale,
    rimDepthPx: topDepth * scale,
    widthPx,
    heightPx,
  };
}

/**
 * The rim: the rolled lip and the sliver of unprinted inside wall below it.
 *
 * Without this the cup reads as a printed tube. The curl is also physically
 * true - artwork stops short of the lip, which is exactly what the safe-area
 * margin in the profile is protecting.
 */
function drawRim(
  ctx: CanvasRenderingContext2D,
  elev: ElevationGeometry,
  scale: number,
  originX: number,
  originY: number,
  exposure: number,
): void {
  const rTop = elev.radiusAt(1) * scale;
  const depth = elev.ellipseDepth(1) * scale;

  ctx.save();
  // Inside of the cup, seen through the opening.
  ctx.beginPath();
  ctx.ellipse(originX, originY, rTop, depth, 0, 0, Math.PI * 2);
  const inner = ctx.createLinearGradient(0, originY - depth, 0, originY + depth);
  inner.addColorStop(0, `rgb(${[150, 146, 140].map((c) => Math.min(255, c * exposure)).join(',')})`);
  inner.addColorStop(1, `rgb(${[214, 210, 203].map((c) => Math.min(255, c * exposure)).join(',')})`);
  ctx.fillStyle = inner;
  ctx.fill();

  // The rolled lip itself, brightest where it turns towards the light.
  ctx.beginPath();
  ctx.ellipse(originX, originY, rTop, depth, 0, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1.5, rTop * 0.055);
  const lip = ctx.createLinearGradient(originX - rTop, 0, originX + rTop, 0);
  lip.addColorStop(0, `rgb(${[214, 210, 203].map((c) => Math.min(255, c * exposure)).join(',')})`);
  lip.addColorStop(0.35, `rgb(${[252, 251, 248].map((c) => Math.min(255, c * exposure)).join(',')})`);
  lip.addColorStop(1, `rgb(${[205, 201, 194].map((c) => Math.min(255, c * exposure)).join(',')})`);
  ctx.strokeStyle = lip;
  ctx.stroke();
  ctx.restore();
}
