/**
 * Coordinate mapping between the four spaces of Cupco Studio.
 *
 *   DESIGN SPACE (u,v)  - what the user edits. A plain rectangle.
 *                         u in [0,1) around the circumference, 0 at the seam.
 *                         v in [0,1] bottom -> top.
 *          |
 *     +----+----+
 *     |         |
 *     v         v
 *   3D CUP    FAN SPACE (polar, apex at origin) -> PRINT SPACE (mm @ dpi)
 *   SURFACE
 *
 * Design space is deliberately a rectangle: the customer never sees or edits a
 * curved fan. The curvature is introduced only by the fan transform, which is
 * a pure function of the CupProfile.
 *
 * ---------------------------------------------------------------------------
 * WHY THE 3D VIEW NEEDS NO PRE-WARP
 * ---------------------------------------------------------------------------
 * designToCup() below is exactly the UV parameterisation that Three.js
 * CylinderGeometry(rTop, rBottom, height) already uses: u wraps linearly around
 * the angle, v runs linearly up the height, and the surface radius is linear in
 * height. So the 3D preview can consume the design canvas directly as a
 * texture, with NO warping applied.
 *
 * That is an architectural result, not a coincidence worth ignoring: the warp
 * exists in exactly ONE place (the fan transform), so the 3D preview and the
 * production fan cannot drift out of sync. There is no second approximate
 * mockup pipeline to keep honest.
 */

import type { FrustumGeometry } from './frustum';
import type { CupProfile, DesignUV, Point2, Point3 } from './types';

const TAU = Math.PI * 2;

/* -------------------------------------------------------------------------- */
/* Design space <-> 3D cup surface                                            */
/* -------------------------------------------------------------------------- */

/**
 * Map a design-space coordinate onto the 3D cup surface.
 *
 *   phi  = 2*pi*u + seamPositionRad          angle around the cup
 *   r(v) = r_bot + (r_top - r_bot) * v       radius is LINEAR in height
 *   P    = ( r(v)*sin(phi), h*v, r(v)*cos(phi) )
 *
 * Origin is the centre of the cup base, Y up. Millimetres.
 */
export function designToCup(
  uv: DesignUV,
  geom: FrustumGeometry,
  seamPositionRad = 0,
): Point3 {
  const phi = TAU * uv.u + seamPositionRad;
  const r = geom.bottomRadiusMm + (geom.topRadiusMm - geom.bottomRadiusMm) * uv.v;
  return {
    x: r * Math.sin(phi),
    y: geom.heightMm * uv.v,
    z: r * Math.cos(phi),
  };
}

/* -------------------------------------------------------------------------- */
/* Design space <-> fan space                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Map a design-space coordinate into fan space (apex at origin, mm).
 *
 *   rho(v) = R_bot + L*v      slant distance from apex (linear: r is linear in
 *                             height, and slant distance is proportional to r)
 *   psi(u) = theta * (u - 1/2)  fan centred on the -Y axis
 *   F      = ( rho*sin(psi), -rho*cos(psi) )
 *
 * The fan opens downward from the apex, so the top rim (larger rho) is further
 * from the origin. Y is negative throughout the sector.
 */
export function designToFan(uv: DesignUV, geom: FrustumGeometry): Point2 {
  const rho = geom.rBottomMm + geom.slantMm * uv.v;
  const psi = geom.sectorAngleRad * (uv.u - 0.5);
  return {
    x: rho * Math.sin(psi),
    y: -rho * Math.cos(psi),
  };
}

/**
 * Inverse map: fan space -> design space.
 *
 *   rho = sqrt(Fx^2 + Fy^2)
 *   psi = atan2(Fx, -Fy)
 *   v   = (rho - R_bot) / L
 *   u   = psi/theta + 1/2
 *
 * THIS is the function production export actually runs. Rasterising iterates
 * over OUTPUT pixels and gathers from the design canvas through this inverse.
 * Forward-mapping the source would scatter samples and leave unfilled holes;
 * gather-style resampling cannot.
 *
 * Returned u/v may fall outside [0,1] - that means the fan point lies beyond
 * the artwork (e.g. in the bleed). Callers decide whether to clamp, tile, or
 * treat it as transparent.
 */
export function fanToDesign(p: Point2, geom: FrustumGeometry): DesignUV {
  const rho = Math.hypot(p.x, p.y);
  const psi = Math.atan2(p.x, -p.y);
  return {
    v: (rho - geom.rBottomMm) / geom.slantMm,
    u: psi / geom.sectorAngleRad + 0.5,
  };
}

/* -------------------------------------------------------------------------- */
/* Physical measurement helpers                                               */
/* -------------------------------------------------------------------------- */

/**
 * Circumference of the cup at design-space height v, mm.
 *
 * Used to answer the question the 'angular' design-space mode raises: how wide
 * is this element ACTUALLY, in millimetres, at the height it sits?
 */
export function circumferenceAtV(v: number, geom: FrustumGeometry): number {
  const r = geom.bottomRadiusMm + (geom.topRadiusMm - geom.bottomRadiusMm) * v;
  return TAU * r;
}

/**
 * Physical width in mm of a design-space span of width `du` centred at height
 * `v`.
 *
 * Because design space is angular, the same du is physically NARROWER lower
 * down the tapered cup. This is true of the real cup, not an artefact - but
 * designers think in millimetres, so the editor surfaces this number.
 */
export function designWidthToMm(du: number, v: number, geom: FrustumGeometry): number {
  return du * circumferenceAtV(v, geom);
}

/** Physical height in mm of a design-space span `dv`, measured along the slant. */
export function designHeightToMm(dv: number, geom: FrustumGeometry): number {
  return dv * geom.slantMm;
}

/* -------------------------------------------------------------------------- */
/* Seam                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The design-space u-range hidden beneath the glue overlap on the finished cup.
 *
 * The outer edge of the blank laps over the inner edge, so a strip of artwork
 * roughly `overlapMm` wide is never visible. Critical content must avoid it.
 *
 * The overlap is a constant LINEAR width, but design space is angular, so the
 * hidden u-span is wider at the bottom of the cup than at the top. We report
 * the worst case (widest, i.e. at the bottom rim) so the guidance is
 * conservative in the direction that protects the customer.
 */
export function seamHiddenUSpan(profile: CupProfile, geom: FrustumGeometry): number {
  const narrowestCircumference = circumferenceAtV(0, geom);
  return profile.seam.overlapMm / narrowestCircumference;
}

/**
 * Distance in mm from design-space u to the nearest seam edge, at height v.
 * Used by the editor's "your logo is close to the cup seam" warning and by the
 * corresponding preflight rule.
 */
export function distanceToSeamMm(uv: DesignUV, geom: FrustumGeometry): number {
  // The seam is at u = 0, which is identical to u = 1.
  const u = ((uv.u % 1) + 1) % 1;
  const duToSeam = Math.min(u, 1 - u);
  return designWidthToMm(duToSeam, uv.v, geom);
}
