/**
 * Fan outline construction - the production dieline.
 *
 * Produces the annular-sector boundary for a profile at a chosen offset:
 * trim, the cut line (outset) or the safe area (inset). These are the lines
 * the internal Production Studio draws, and the shapes the export clips
 * against.
 *
 * Offsets are applied in the natural directions of the sector:
 *   - radially at the top and bottom arcs (rho +/- offset)
 *   - angularly at the seam edges, converted from a LINEAR mm offset at each
 *     radius, because a constant linear inset subtends a varying angle.
 *
 * Every offset is PER EDGE. A fan blank is not a uniform outset of the cup:
 * the bottom runs past the base by the material the base seam consumes, and
 * the two seam edges differ because one laps over the other.
 */

import type { FrustumGeometry } from './frustum';
import type { CupProfile, Point2 } from './types';
import { designToFan } from './mapping';

export type FanBoundary = 'trim' | 'cut' | 'safe';

export interface FanOutline {
  boundary: FanBoundary;
  /** Closed polygon in fan space (apex at origin), mm. */
  points: Point2[];
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
      return { top: 0, bottom: 0, left: 0, right: 0 };
    case 'cut': {
      // Asymmetric on purpose. See CutMargins.
      const c = profile.margins.cut;
      return { top: c.topMm, bottom: c.bottomMm, left: c.leftMm, right: c.rightMm };
    }
    case 'safe':
      // Safe insets are ABSOLUTE distances from the trim edge, NOT additive
      // with the rim curl or base allowance.
      //
      // Cupco 2026-08-26: rim curl is ~7mm but printing runs "up to 3mm of the
      // top edge" - i.e. print deliberately extends ~4mm INTO the curl zone,
      // because the curl rolls outward and its outer face stays visible on the
      // finished cup. Adding the two would wrongly pull the safe line down to
      // 10mm and crop artwork the customer expects to see.
      //
      // rimCurlAllowanceMm and baseAllowanceMm remain recorded on the profile
      // as physical facts, but they do not drive the safe area.
      return {
        top: -profile.margins.safeTopMm,
        bottom: -profile.margins.safeBottomMm,
        left: -profile.margins.safeSeamMm,
        right: -profile.margins.safeSeamMm,
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
  const psiInnerStart = -halfTheta - off.left / rhoInner;
  const psiInnerEnd = halfTheta + off.right / rhoInner;
  const psiOuterStart = -halfTheta - off.left / rhoOuter;
  const psiOuterEnd = halfTheta + off.right / rhoOuter;

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

  return { boundary, points };
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
