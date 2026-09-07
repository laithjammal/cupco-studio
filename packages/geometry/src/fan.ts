/**
 * Fan outline construction - the production dieline.
 *
 * Produces the annular-sector boundary for a profile at a chosen offset.
 * Four lines, innermost outward:
 *
 *   safe   keep logos and text inside this
 *   trim   the finished cup wall - what still shows once the cup is formed
 *   cut    the real blank's own outline, where the die falls
 *   bleed  ink carries this far past the cut, so the die never exposes white
 *
 * These are the lines the internal Production Studio draws, and the shapes
 * the export clips against.
 *
 * Offsets are applied in the natural directions of the sector:
 *   - radially at the top and bottom arcs (rho +/- offset)
 *   - angularly at the seam edges, converted from a LINEAR mm offset at each
 *     radius, because a constant linear inset subtends a varying angle. Each
 *     seam edge carries its own offset at the top and bottom arcs, so the
 *     straight segment between the two corners lands where the die cuts.
 *
 * Every offset is PER EDGE. A fan blank is not a uniform outset of the cup:
 * the bottom runs past the base by the material the base seam consumes, and
 * the two seam edges differ because one laps over the other.
 */

import type { FrustumGeometry } from './frustum';
import type { CupProfile, Point2 } from './types';
import { designToFan } from './mapping';

export type FanBoundary = 'trim' | 'cut' | 'bleed' | 'safe';

/**
 * The boundaries drawn as guide lines on the production fan, outermost first.
 *
 * `trim` is deliberately NOT among them. It remains the load-bearing geometry -
 * design space v=0..1 IS the trim band, every mapping is defined against it,
 * and the 3D preview is its own wrap - but as a drawn line it told a production
 * operator nothing they act on. What they act on is where the die falls (cut),
 * how far ink must run past it (bleed), and where artwork is guaranteed to
 * survive (safe).
 *
 * Anything that needs the trim outline can still ask for it by name.
 */
export const GUIDE_BOUNDARIES = ['bleed', 'cut', 'safe'] as const satisfies readonly FanBoundary[];

export interface FanOutline {
  boundary: FanBoundary;
  /** Closed polygon in fan space (apex at origin), mm. */
  points: Point2[];
  /**
   * The four corners, and the two arc radii.
   *
   * Published so that anything needing to TEST the sector - the rasteriser's
   * inside/outside clip - can work from the same corners the polygon is drawn
   * from, rather than re-deriving the seam edges and drifting from them.
   */
  rhoInnerMm: number;
  rhoOuterMm: number;
  corners: {
    innerLeft: Point2; innerRight: Point2;
    outerLeft: Point2; outerRight: Point2;
  };
}

/** Bounding box in fan space, mm. */
export interface FanBounds {
  minX: number; minY: number; maxX: number; maxY: number;
  widthMm: number; heightMm: number;
}

/**
 * Per-edge offsets for a boundary, in mm.
 * Positive = outward from the trim line.
 */
function offsetsFor(boundary: FanBoundary, profile: CupProfile) {
  switch (boundary) {
    case 'trim':
      return { top: 0, bottom: 0, leftTop: 0, leftBottom: 0, rightTop: 0, rightBottom: 0 };
    case 'cut': {
      // Per edge AND per arc, on purpose. See CutMargins and SeamCut.
      const c = profile.margins.cut;
      return {
        top: c.topMm, bottom: c.bottomMm,
        leftTop: c.left.atTopMm, leftBottom: c.left.atBottomMm,
        rightTop: c.right.atTopMm, rightBottom: c.right.atBottomMm,
      };
    }
    case 'bleed': {
      // OUTSIDE the cut, not outside trim: the blank is cut at the cut line,
      // so that is the edge ink has to carry past.
      const c = profile.margins.cut;
      const b = profile.margins.bleedMm;
      return {
        top: c.topMm + b, bottom: c.bottomMm + b,
        leftTop: c.left.atTopMm + b, leftBottom: c.left.atBottomMm + b,
        rightTop: c.right.atTopMm + b, rightBottom: c.right.atBottomMm + b,
      };
    }
    case 'safe':
      // Safe insets are ABSOLUTE distances from the trim edge, NOT additive
      // with the rim curl or base allowance.
      //
      // Cupco 2026-08-26: printing runs "up to 3mm of the top edge", while
      // the curl takes ~9mm (measured off the manufacturer drawing) - i.e.
      // print deliberately extends ~6mm INTO the curl zone,
      // because the curl rolls outward and its outer face stays visible on the
      // finished cup. Adding the two would wrongly pull the safe line down to
      // 10mm and crop artwork the customer expects to see.
      //
      // rimCurlAllowanceMm and baseAllowanceMm remain recorded on the profile
      // as physical facts, but they do not drive the safe area.
      return {
        top: -profile.margins.safeTopMm,
        bottom: -profile.margins.safeBottomMm,
        leftTop: -profile.margins.safeSeamMm,
        leftBottom: -profile.margins.safeSeamMm,
        rightTop: -profile.margins.safeSeamMm,
        rightBottom: -profile.margins.safeSeamMm,
      };
  }
}

/**
 * Build a closed fan outline polygon.
 *
 * `arcSegments` controls how finely the two arcs are tessellated. The default
 * of 128 keeps the maximum sagitta error well under 0.01mm at 8oz radii; raise
 * it for very large profiles or very high-resolution export.
 */
export function buildFanOutline(
  profile: CupProfile,
  geom: FrustumGeometry,
  boundary: FanBoundary = 'trim',
  arcSegments = 128,
): FanOutline {
  const off = offsetsFor(boundary, profile);

  const rhoInner = geom.rBottomMm - off.bottom;
  const rhoOuter = geom.rTopMm + off.top;

  // A linear seam offset subtends a different angle at each radius, so convert
  // per-radius rather than applying one angular constant - and per EDGE, since
  // the two sides of a fan blank are not the same distance out.
  const halfTheta = geom.sectorAngleRad / 2;
  const psiInnerStart = -halfTheta - off.leftBottom / rhoInner;
  const psiInnerEnd = halfTheta + off.rightBottom / rhoInner;
  const psiOuterStart = -halfTheta - off.leftTop / rhoOuter;
  const psiOuterEnd = halfTheta + off.rightTop / rhoOuter;

  const points: Point2[] = [];
  const at = (rho: number, psi: number): Point2 => ({
    x: rho * Math.sin(psi),
    y: -rho * Math.cos(psi),
  });

  // Inner (bottom rim) arc, left -> right.
  for (let i = 0; i <= arcSegments; i++) {
    const t = i / arcSegments;
    points.push(at(rhoInner, psiInnerStart + (psiInnerEnd - psiInnerStart) * t));
  }
  // Outer (top rim) arc, right -> left, closing the sector.
  for (let i = arcSegments; i >= 0; i--) {
    const t = i / arcSegments;
    points.push(at(rhoOuter, psiOuterStart + (psiOuterEnd - psiOuterStart) * t));
  }

  return {
    boundary,
    points,
    rhoInnerMm: rhoInner,
    rhoOuterMm: rhoOuter,
    corners: {
      innerLeft: at(rhoInner, psiInnerStart),
      innerRight: at(rhoInner, psiInnerEnd),
      outerLeft: at(rhoOuter, psiOuterStart),
      outerRight: at(rhoOuter, psiOuterEnd),
    },
  };
}

/**
 * How much DESIGN SPACE a boundary covers vertically.
 *
 * Design space v runs 0 at the cup's base to 1 at its rim - v=0..1 IS the trim
 * band. Every other boundary lies partly outside it: the cut and bleed run
 * past the cup at both ends, so they need v below 0 and above 1.
 *
 * This is what an artwork raster has to span for elements placed out towards
 * the die to survive. Rendered only over 0..1, they are simply not on the
 * canvas, and the warp has nothing to read but the edge row.
 */
export function boundaryVRange(
  profile: CupProfile,
  geom: FrustumGeometry,
  boundary: FanBoundary,
): { vBottom: number; vTop: number } {
  const o = buildFanOutline(profile, geom, boundary, 8);
  return {
    vBottom: (o.rhoInnerMm - geom.rBottomMm) / geom.slantMm,
    vTop: (o.rhoOuterMm - geom.rBottomMm) / geom.slantMm,
  };
}

/** Axis-aligned bounds of a set of fan-space points. */
export function fanBounds(points: readonly Point2[]): FanBounds {
  if (points.length === 0) throw new Error('fanBounds: no points');
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, widthMm: maxX - minX, heightMm: maxY - minY };
}

/** Render a fan outline as an SVG path `d` string, in mm units. */
export function outlineToSvgPath(outline: FanOutline): string {
  const [first, ...rest] = outline.points;
  if (!first) return '';
  const fmt = (n: number) => n.toFixed(4);
  return (
    `M ${fmt(first.x)} ${fmt(first.y)} ` +
    rest.map((p) => `L ${fmt(p.x)} ${fmt(p.y)}`).join(' ') +
    ' Z'
  );
}

/** Convenience: sample the design-space rectangle border into fan space. */
export function designBorderInFan(geom: FrustumGeometry, perEdge = 64): Point2[] {
  const pts: Point2[] = [];
  for (let i = 0; i <= perEdge; i++) pts.push(designToFan({ u: i / perEdge, v: 0 }, geom));
  for (let i = 0; i <= perEdge; i++) pts.push(designToFan({ u: 1, v: i / perEdge }, geom));
  for (let i = perEdge; i >= 0; i--) pts.push(designToFan({ u: i / perEdge, v: 1 }, geom));
  for (let i = perEdge; i >= 0; i--) pts.push(designToFan({ u: 0, v: i / perEdge }, geom));
  return pts;
}
