/**
 * Fan outline construction - the production dieline.
 *
 * Produces the annular-sector boundary for a profile at a chosen offset:
 * trim, bleed (outset) or safe area (inset). These are the lines the internal
 * Production Studio draws, and the shapes the export clips against.
 *
 * Offsets are applied in the natural directions of the sector:
 *   - radially at the top and bottom arcs (rho +/- offset)
 *   - angularly at the seam edges, converted from a LINEAR mm offset at each
 *     radius, because a constant linear inset subtends a varying angle.
 */

import type { FrustumGeometry } from './frustum';
import type { CupProfile, Point2 } from './types';
import { designToFan } from './mapping';

export type FanBoundary = 'trim' | 'bleed' | 'safe';

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
 * Radial and angular offsets for a boundary, in mm.
 * Positive = outward from the trim line.
 */
function offsetsFor(boundary: FanBoundary, profile: CupProfile) {
  switch (boundary) {
    case 'trim':
      return { top: 0, bottom: 0, seam: 0 };
    case 'bleed': {
      const b = profile.margins.bleedMm;
      return { top: b, bottom: b, seam: b };
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
        seam: -profile.margins.safeSeamMm,
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
  // per-radius rather than applying one angular constant.
  const halfTheta = geom.sectorAngleRad / 2;
  const dPsiInner = off.seam / rhoInner;
  const dPsiOuter = off.seam / rhoOuter;

  const psiInnerStart = -halfTheta - dPsiInner;
  const psiInnerEnd = halfTheta + dPsiInner;
  const psiOuterStart = -halfTheta - dPsiOuter;
  const psiOuterEnd = halfTheta + dPsiOuter;

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

/**
 * The seam overlap strip, as a polygon in fan space.
 *
 * Artwork must CONTINUE into this strip so no white sliver shows at the glued
 * seam. On the finished cup it is lapped over and hidden.
 */
export function buildOverlapStrip(
  profile: CupProfile,
  geom: FrustumGeometry,
  arcSegments = 32,
): Point2[] {
  const halfTheta = geom.sectorAngleRad / 2;
  const w = profile.seam.overlapMm;
  const points: Point2[] = [];
  const at = (rho: number, psi: number): Point2 => ({
    x: rho * Math.sin(psi),
    y: -rho * Math.cos(psi),
  });

  for (let i = 0; i <= arcSegments; i++) {
    const rho = geom.rBottomMm + (geom.slantMm * i) / arcSegments;
    points.push(at(rho, halfTheta));
  }
  for (let i = arcSegments; i >= 0; i--) {
    const rho = geom.rBottomMm + (geom.slantMm * i) / arcSegments;
    points.push(at(rho, halfTheta + w / rho));
  }
  return points;
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
