/**
 * Design canvas -> production fan raster.
 *
 * This is the ONE place in the system where artwork is warped. The 3D preview
 * applies no warp at all (the cup's UV parameterisation matches design space
 * exactly), so there is no second pipeline that could drift out of step with
 * this one.
 *
 * ---------------------------------------------------------------------------
 * WHY THE INVERSE MAP
 * ---------------------------------------------------------------------------
 * We iterate over OUTPUT pixels and gather from the design canvas, rather than
 * pushing design pixels forward into the fan. Forward mapping scatters samples
 * non-uniformly - the fan's outer arc is longer than its inner arc, so a
 * forward scatter leaves unfilled gaps near the rim. Gathering cannot: every
 * output pixel is written exactly once.
 */

import {
  fanToDesign,
  buildFanOutline,
  fanBounds,
  type CupProfile,
  type FrustumGeometry,
  type FanBoundary,
  type Point2,
} from '@cupco/geometry';
import { createImage, sampleBilinear, type RasterImage, type RGBA } from './image';

export interface FanRasterOptions {
  /** Output resolution. Defaults to the profile's exportDpi. */
  dpi?: number;
  /** Which boundary the output canvas should cover. Defaults to 'bleed', the outermost. */
  boundary?: FanBoundary;
  /** Fill for pixels outside the sector. Defaults to transparent. */
  background?: RGBA;
  /**
   * Whether artwork wraps across the seam. Default true - see sampleBilinear.
   */
  wrapU?: boolean;
  /**
   * Supersampling factor per axis (1 = off, 2 = 4 samples/pixel).
   * The fan's inner arc compresses artwork, so 2 meaningfully reduces aliasing
   * near the cup base. Costs 4x time.
   */
  supersample?: number;
  /**
   * The design-space v values the artwork image's BOTTOM and TOP rows carry.
   * Default 0 and 1, i.e. the image covers exactly the trim band.
   *
   * Give it a wider range and artwork placed past the cup's wall - out towards
   * the cut and the bleed - actually renders, instead of the trim edge being
   * smeared outward. Sampling clamps at the image edge either way; the
   * question is only how much design the image was given in the first place.
   */
  designVBottom?: number;
  designVTop?: number;
  /**
   * Blank margin around the fan bounds, mm. Default 3.
   *
   * Without this the sector is tangent to all four canvas edges, so the
   * antialiased boundary and the centred dieline strokes are half-clipped -
   * which reads as the fan's corners being cut off. Padding also leaves room
   * for selection handles in the editor.
   */
  paddingMm?: number;
}

/**
 * Maps between output pixels and fan-space millimetres.
 *
 * Emitted alongside the raster so a vector dieline can be overlaid on the PNG
 * in exact register - without this the two would only line up by luck.
 */
export interface FanRasterTransform {
  /** Fan-space mm at output pixel (0,0). */
  originXMm: number;
  originYMm: number;
  mmPerPixel: number;
  dpi: number;
  widthPx: number;
  heightPx: number;
  widthMm: number;
  heightMm: number;
}

export interface FanRasterResult {
  image: RasterImage;
  transform: FanRasterTransform;
}

const MM_PER_INCH = 25.4;

/**
 * Rasterise a design canvas into its production fan.
 *
 * `design` is the logical artwork: u across the width, v up the height, with
 * raster row 0 being the TOP of the cup.
 */
export function rasteriseFan(
  design: RasterImage,
  profile: CupProfile,
  geom: FrustumGeometry,
  options: FanRasterOptions = {},
): FanRasterResult {
  const dpi = options.dpi ?? profile.exportDpi;
  const boundary = options.boundary ?? 'bleed';
  const wrapU = options.wrapU ?? true;
  const ss = Math.max(1, Math.floor(options.supersample ?? 1));
  const bg = options.background ?? ([0, 0, 0, 0] as const);

  // How much design space the supplied artwork image spans vertically.
  const designVBottom = options.designVBottom ?? 0;
  const designVTop = options.designVTop ?? 1;
  const designVSpan = designVTop - designVBottom;
  if (!(designVSpan > 0)) throw new Error(`bad design v range ${designVBottom}..${designVTop}`);

  if (!Number.isFinite(dpi) || dpi <= 0) throw new Error(`bad dpi ${dpi}`);

  const pad = options.paddingMm ?? 3;
  const outline = buildFanOutline(profile, geom, boundary, 512);
  const raw = fanBounds(outline.points);
  const b = {
    minX: raw.minX - pad,
    minY: raw.minY - pad,
    maxX: raw.maxX + pad,
    maxY: raw.maxY + pad,
    widthMm: raw.widthMm + pad * 2,
    heightMm: raw.heightMm + pad * 2,
  };

  const mmPerPixel = MM_PER_INCH / dpi;
  const widthPx = Math.max(1, Math.ceil(b.widthMm / mmPerPixel));
  const heightPx = Math.max(1, Math.ceil(b.heightMm / mmPerPixel));

  const image = createImage(widthPx, heightPx);
  const out = image.data;

  // Sector test: two radii and two straight edges. Cheaper and more stable
  // than a point-in-polygon test against the tessellated outline.
  const rhoMin = outline.rhoInnerMm;
  const rhoMax = outline.rhoOuterMm;

  // The seam edges are STRAIGHT lines - that is what a die cuts - so each is a
  // half-plane test, built from the very corners the outline polygon is drawn
  // from. Re-deriving the edges here is what would let the raster and the
  // dieline drift apart.
  //
  // The reference point for "inside" is the sector's own mid-point. The apex
  // will not do: the seam edges pass close to it, so which side it falls on is
  // decided by rounding rather than by geometry.
  const inX = 0;
  const inY = -(rhoMin + rhoMax) / 2;
  const halfPlane = (a: Point2, b: Point2) => {
    const nx = -(b.y - a.y);
    const ny = b.x - a.x;
    const c = nx * a.x + ny * a.y;
    const sign = nx * inX + ny * inY - c <= 0 ? 1 : -1;
    return (x: number, y: number) => sign * (nx * x + ny * y - c) <= 0;
  };
  const insideLeft = halfPlane(outline.corners.outerLeft, outline.corners.innerLeft);
  const insideRight = halfPlane(outline.corners.outerRight, outline.corners.innerRight);

  const sample: number[] = [0, 0, 0, 0];
  const acc: number[] = [0, 0, 0, 0];
  const inv = 1 / (ss * ss);

  for (let py = 0; py < heightPx; py++) {
    for (let pxi = 0; pxi < widthPx; pxi++) {
      acc[0] = acc[1] = acc[2] = acc[3] = 0;
      let hits = 0;

      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const offX = (sx + 0.5) / ss;
          const offY = (sy + 0.5) / ss;
          const mmX = b.minX + (pxi + offX) * mmPerPixel;
          const mmY = b.minY + (py + offY) * mmPerPixel;

          const rho = Math.hypot(mmX, mmY);
          if (rho < rhoMin || rho > rhoMax) continue;
          if (!insideLeft(mmX, mmY) || !insideRight(mmX, mmY)) continue;

          const uv = fanToDesign({ x: mmX, y: mmY }, geom);
          // Design v -> image v. Identity when the image covers 0..1.
          const iv = (uv.v - designVBottom) / designVSpan;
          sampleBilinear(design, uv.u, iv, wrapU, sample);
          acc[0]! += sample[0]!;
          acc[1]! += sample[1]!;
          acc[2]! += sample[2]!;
          acc[3]! += sample[3]!;
          hits++;
        }
      }

      const o = (py * widthPx + pxi) * 4;
      if (hits === 0) {
        out[o] = bg[0]; out[o + 1] = bg[1]; out[o + 2] = bg[2]; out[o + 3] = bg[3];
      } else if (hits === ss * ss) {
        out[o] = acc[0]! * inv;
        out[o + 1] = acc[1]! * inv;
        out[o + 2] = acc[2]! * inv;
        out[o + 3] = acc[3]! * inv;
      } else {
        // Partial coverage at the sector edge: blend against the background so
        // the boundary is antialiased rather than a hard staircase.
        const cov = hits / (ss * ss);
        const k = 1 / hits;
        out[o] = acc[0]! * k * cov + bg[0] * (1 - cov);
        out[o + 1] = acc[1]! * k * cov + bg[1] * (1 - cov);
        out[o + 2] = acc[2]! * k * cov + bg[2] * (1 - cov);
        out[o + 3] = acc[3]! * k * cov + bg[3] * (1 - cov);
      }
    }
  }

  return {
    image,
    transform: {
      originXMm: b.minX,
      originYMm: b.minY,
      mmPerPixel,
      dpi,
      widthPx,
      heightPx,
      widthMm: b.widthMm,
      heightMm: b.heightMm,
    },
  };
}

/** Convert a fan-space mm point to output pixel coordinates. */
export function fanMmToPixel(
  xMm: number,
  yMm: number,
  t: FanRasterTransform,
): { x: number; y: number } {
  return {
    x: (xMm - t.originXMm) / t.mmPerPixel,
    y: (yMm - t.originYMm) / t.mmPerPixel,
  };
}
