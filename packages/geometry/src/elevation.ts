/**
 * The cup seen head-on: the projection the 2D mockups are drawn from.
 *
 * WHY THIS LIVES IN THE ENGINE
 * ----------------------------
 * A mockup is not decoration - it is what a customer looks at before saying
 * yes. If it showed artwork at a different size or position from the fan that
 * goes to press, the studio would be manufacturing disappointment. So the
 * elevation is derived from the same FrustumGeometry as the 3D preview and the
 * production fan, and lives beside them rather than in the drawing code.
 *
 * THE PROJECTION
 * --------------
 * The body is a cone frustum viewed from slightly above. Two things follow,
 * and both are visible on a real cup:
 *
 *   1. The silhouette is a TRAPEZIUM, not a rectangle. Its half-width at
 *      height v is exactly the cup's radius there, so an 8oz reads as an 8oz.
 *
 *   2. Artwork COMPRESSES towards the edges. A band of design that is uniform
 *      in u is not uniform on screen: screen x = r(v)*sin(phi), so equal steps
 *      in angle cover less and less width as the surface turns away. Ignoring
 *      this - stretching the artwork flat across the silhouette - is the single
 *      most common way a cup mockup looks wrong without anyone being able to
 *      say why.
 *
 * The tilt is what lets the rim read as an ellipse rather than a straight line.
 * It is a viewing angle only; it never changes where artwork sits on the cup.
 */

import type { FrustumGeometry } from './frustum';

const TAU = Math.PI * 2;

export interface ElevationOptions {
  /**
   * Downward viewing angle in radians. 0 is dead level, where the rim collapses
   * to a line. Around 0.18 reads like a cup on a table seen while standing.
   */
  tiltRad?: number;
  /** Design u at the centre of the visible face. */
  centreU?: number;
}

export const DEFAULT_TILT_RAD = 0.18;

export interface ElevationGeometry {
  /** Radius of the cup at design height v, mm. */
  radiusAt: (v: number) => number;
  /** Vertical screen offset of height v, mm, measured DOWN from the rim centre. */
  yAt: (v: number) => number;
  /** Semi-minor axis of the rim/base ellipses, mm. */
  ellipseDepth: (v: number) => number;
  /** Overall drawn size in mm, including the rim and base ellipses. */
  widthMm: number;
  heightMm: number;
  tiltRad: number;
  centreU: number;
}

export function cupElevation(
  geom: FrustumGeometry,
  options: ElevationOptions = {},
): ElevationGeometry {
  const tiltRad = options.tiltRad ?? DEFAULT_TILT_RAD;
  const centreU = options.centreU ?? 0.5;
  const rTop = geom.topRadiusMm;
  const rBottom = geom.bottomRadiusMm;

  const radiusAt = (v: number) => rBottom + (rTop - rBottom) * v;
  const ellipseDepth = (v: number) => radiusAt(v) * Math.sin(tiltRad);
  // Foreshortened height: looking down flattens the body slightly.
  const bodyHeight = geom.heightMm * Math.cos(tiltRad);
  const yAt = (v: number) => (1 - v) * bodyHeight;

  return {
    radiusAt,
    yAt,
    ellipseDepth,
    // The rim is the widest part, and its ellipse adds depth top and bottom.
    widthMm: rTop * 2,
    heightMm: bodyHeight + ellipseDepth(1) + ellipseDepth(0),
    tiltRad,
    centreU,
  };
}

/**
 * Design u visible at a horizontal position across the cup.
 *
 * `across` is -1 at the left silhouette edge, 0 at the centre of the face, +1
 * at the right edge. The arcsine IS the foreshortening: near the middle a step
 * across the screen is a small step in angle, and at the edges the same step
 * sweeps most of a quarter turn.
 *
 * Returns u wrapped into [0,1).
 */
export function uAtAcross(across: number, centreU: number): number {
  const clamped = across < -1 ? -1 : across > 1 ? 1 : across;
  const phi = Math.asin(clamped);
  const u = centreU + phi / TAU;
  return u - Math.floor(u);
}

/**
 * How much the surface faces the viewer at `across`, from 0 at the edges to 1
 * at the centre. This is cos(phi), which is both the Lambert shading term and
 * the reason a cup looks round rather than flat.
 */
export function facingAt(across: number): number {
  const clamped = across < -1 ? -1 : across > 1 ? 1 : across;
  return Math.sqrt(1 - clamped * clamped);
}

/**
 * The u-span visible from one viewpoint: exactly half the circumference.
 *
 * Worth stating because it bounds what a single mockup can ever show. Artwork
 * on the far side is not hidden by a rendering shortcut - it is behind the cup.
 */
export const VISIBLE_U_SPAN = 0.5;

/** The closed silhouette of the body, in mm, origin at the rim centre. */
export function silhouettePath(
  elev: ElevationGeometry,
  segments = 48,
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const rTop = elev.radiusAt(1);
  const rBottom = elev.radiusAt(0);
  const topDepth = elev.ellipseDepth(1);
  const bottomDepth = elev.ellipseDepth(0);

  // The OUTLINE follows the rim's far edge over the top and the base's near
  // edge under the bottom - those are the extremes on screen. Taking the near
  // edge of the rim instead lops the back of the opening off the drawing.
  for (let i = 0; i <= segments; i++) {
    const a = Math.PI - (Math.PI * i) / segments; // left -> right, over the top
    pts.push({ x: rTop * Math.cos(a), y: -topDepth * Math.sin(a) });
  }
  // Down the right wall.
  pts.push({ x: rBottom, y: elev.yAt(0) });
  // Base, right -> left, under the bottom.
  for (let i = 0; i <= segments; i++) {
    const a = (Math.PI * i) / segments;
    pts.push({
      x: rBottom * Math.cos(a),
      y: elev.yAt(0) + bottomDepth * Math.sin(a),
    });
  }
  // Up the left wall closes it.
  pts.push({ x: -rTop, y: 0 });
  return pts;
}
