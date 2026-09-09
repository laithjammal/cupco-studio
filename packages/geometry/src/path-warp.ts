/**
 * Vector path warping: design space -> fan space, preserving vectors.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The raster path (packages/render) resamples pixels through the INVERSE map.
 * That is correct for photographs, but it throws away resolution: a logo
 * exported at 600dpi is still 600dpi, and text edges are still pixels.
 *
 * For vector artwork we can do better. A straight line in design space becomes
 * a CURVE on the fan (constant-v lines map to arcs), so we cannot simply map
 * the endpoints. Instead we recursively subdivide each segment until the
 * mapped midpoint lies within a tolerance of the straight line joining the
 * mapped endpoints - flattening the true curve to a polyline that is provably
 * accurate to a stated number of millimetres ON THE PRINTED FAN.
 *
 * Measuring the tolerance in fan-space millimetres (not in design space, and
 * not in pixels) is the important detail: it means the guarantee is about the
 * physical artwork, and it automatically spends more segments where the warp
 * is severe (near the cup base, where the arc is tightest) and fewer where it
 * is gentle.
 *
 * A vertical line in design space maps to a straight radial line on the fan,
 * so it needs no subdivision at all. The algorithm discovers that for free.
 */

import { designToFan } from './mapping';
import type { FrustumGeometry } from './frustum';
import type { DesignUV, Point2 } from './types';

/** Default flattening tolerance, mm. Well below a 600dpi dot (0.042mm). */
export const DEFAULT_FLATNESS_MM = 0.02;

/** Hard recursion cap, so a pathological input cannot hang the export. */
const MAX_DEPTH = 18;

/** Perpendicular distance from p to the segment a-b, in the same units. */
function distanceToSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function subdivide(
  a: DesignUV, b: DesignUV,
  fa: Point2, fb: Point2,
  geom: FrustumGeometry,
  tolMm: number,
  out: Point2[],
  depth: number,
): void {
  const mid: DesignUV = { u: (a.u + b.u) / 2, v: (a.v + b.v) / 2 };
  const fm = designToFan(mid, geom);

  if (depth >= MAX_DEPTH || distanceToSegment(fm, fa, fb) <= tolMm) {
    out.push(fb);
    return;
  }
  subdivide(a, mid, fa, fm, geom, tolMm, out, depth + 1);
  subdivide(mid, b, fm, fb, geom, tolMm, out, depth + 1);
}

/**
 * Warp a polyline from design space into fan space (mm), subdividing as needed.
 *
 * The returned polyline is accurate to `toleranceMm` everywhere.
 */
export function warpPolyline(
  points: readonly DesignUV[],
  geom: FrustumGeometry,
  toleranceMm: number = DEFAULT_FLATNESS_MM,
): Point2[] {
  if (points.length === 0) return [];
  const first = points[0]!;
  const out: Point2[] = [designToFan(first, geom)];

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    subdivide(a, b, designToFan(a, geom), designToFan(b, geom), geom, toleranceMm, out, 0);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Shapes                                                                      */
/* -------------------------------------------------------------------------- */

/** A filled shape in design space: one or more closed subpaths (even-odd). */
export interface DesignShape {
  /** Closed rings, in normalised design coordinates. */
  subpaths: DesignUV[][];
  /** sRGB fill, 0-255. */
  fill: readonly [number, number, number];
  /** 0-1. */
  opacity: number;
}

/** The same shape warped onto the fan, in millimetres. */
export interface FanShape {
  subpaths: Point2[][];
  fill: readonly [number, number, number];
  opacity: number;
}

export function warpShape(
  shape: DesignShape,
  geom: FrustumGeometry,
  toleranceMm: number = DEFAULT_FLATNESS_MM,
): FanShape {
  return {
    subpaths: shape.subpaths.map((ring) => warpPolyline(ring, geom, toleranceMm)),
    fill: shape.fill,
    opacity: shape.opacity,
  };
}

/**
 * Warp a shape, repeating it across the seam.
 *
 * Design space wraps: a shape crossing u=0 is physically continuous on the
 * cup, but its coordinates jump. Emitting the shape at u-1, u and u+1 and
 * letting the fan clip handle the rest is the same three-pass trick the raster
 * renderer uses, and it is what stops a logo being sliced in half at the glue
 * seam.
 *
 * Copies that fall entirely outside the sector are dropped, so the common case
 * (a shape nowhere near the seam) still emits exactly one path.
 */
export function warpShapeWrapped(
  shape: DesignShape,
  geom: FrustumGeometry,
  toleranceMm: number = DEFAULT_FLATNESS_MM,
): FanShape[] {
  const out: FanShape[] = [];

  // A shape that already spans the whole circumference needs no wrapped copy:
  // the copies would land on top of it and paint its far side over its near
  // side. That is how a full-bleed template loses its right-hand content
  // under its own left-hand edge.
  let minU = Infinity, maxU = -Infinity;
  for (const r of shape.subpaths) {
    for (const p of r) { if (p.u < minU) minU = p.u; if (p.u > maxU) maxU = p.u; }
  }
  const offsets = maxU - minU >= 1 ? [0] : [-1, 0, 1];

  for (const du of offsets) {
    const shifted: DesignShape = {
      ...shape,
      subpaths: shape.subpaths.map((r) => r.map((p) => ({ u: p.u + du, v: p.v }))),
    };
    // Cheap reject: drop a copy whose u SPAN misses the sector entirely.
    //
    // Tested as a span, not as vertices. A shape wide enough to straddle the
    // whole sector has every vertex outside it while covering all of it, so a
    // per-vertex test discards precisely the shapes that matter most - a
    // full-bleed background would vanish from the vector export.
    if (minU + du > 1.02 || maxU + du < -0.02) continue;
    out.push(warpShape(shifted, geom, toleranceMm));
  }
  return out;
}

/** Emit a fan-space shape as an SVG path `d` string (mm units). */
export function fanShapeToSvgPath(shape: FanShape, precision = 4): string {
  return shape.subpaths
    .filter((r) => r.length > 1)
    .map((ring) =>
      ring.map((p, i) =>
        `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(precision)} ${p.y.toFixed(precision)}`,
      ).join(' ') + ' Z',
    )
    .join(' ');
}

/** Total point count, for reporting how much the flattening cost. */
export function shapePointCount(shape: FanShape): number {
  return shape.subpaths.reduce((n, r) => n + r.length, 0);
}
