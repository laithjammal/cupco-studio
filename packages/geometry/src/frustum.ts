/**
 * Frustum derivation: physical cup dimensions -> developed (flat) fan geometry.
 *
 * ---------------------------------------------------------------------------
 * THE MATHEMATICS
 * ---------------------------------------------------------------------------
 * A single-wall cup body is a truncated cone (frustum). A cone is a DEVELOPABLE
 * surface: it unrolls onto a plane with zero distortion. The fan is therefore
 * not an approximation, an artistic warp, or a mesh deformation - it is an
 * exact closed-form result.
 *
 * Given top diameter Dt, bottom diameter Db, vertical height h:
 *
 *     dr    = (Dt - Db) / 2                  radial difference
 *     L     = sqrt(h^2 + dr^2)               SLANT height (not vertical)
 *     R_bot = L * Db / (Dt - Db)             apex -> bottom rim, along slant
 *     R_top = L * Dt / (Dt - Db) = R_bot + L apex -> top rim
 *     theta = pi * (Dt - Db) / L             fan sector sweep angle (radians)
 *
 * The unrolled body is an ANNULAR SECTOR bounded by arcs of radius R_bot and
 * R_top sweeping angle theta, centred on the virtual cone apex.
 *
 * R_bot and R_top follow from similar triangles: distance from the apex along
 * the slant is proportional to the local radius, and the two rims differ by
 * exactly one slant length.
 *
 * theta follows from requiring the developed arc to equal the circumference:
 *
 *     R_top * theta = [L*Dt/(Dt-Db)] * [pi*(Dt-Db)/L] = pi * Dt   (exact)
 *
 * That identity is the correctness invariant for this whole module, and is
 * asserted in the test suite at both rims.
 *
 * ---------------------------------------------------------------------------
 * WHY PROFILES CANNOT SHARE A SCALED FAN
 * ---------------------------------------------------------------------------
 * theta depends on (Dt - Db) / L. Two cups with the same top diameter but
 * different heights produce different sector angles AND different apex radii,
 * in no consistent ratio. There is no scale factor mapping one fan onto
 * another, so every profile derives its own geometry from its own
 * measurements. Never scale a sibling profile's fan.
 */

import type { CupDimensions } from './types';

/** Fully derived flat-fan and cup geometry, all lengths in mm. */
export interface FrustumGeometry {
  /** Top radius of the cup body. */
  topRadiusMm: number;
  /** Bottom radius of the cup body. */
  bottomRadiusMm: number;
  /** Vertical height of the cup body. */
  heightMm: number;
  /** (Dt - Db) / 2 */
  deltaRadiusMm: number;
  /** Slant height - the radial extent of the fan. */
  slantMm: number;
  /** Fan sector sweep angle, radians. */
  sectorAngleRad: number;
  /** Fan sector sweep angle, degrees (convenience/reporting). */
  sectorAngleDeg: number;
  /** Apex -> bottom rim distance, i.e. fan inner radius. */
  rBottomMm: number;
  /** Apex -> top rim distance, i.e. fan outer radius. */
  rTopMm: number;
  /** Developed arc length at the top rim (= pi * Dt). */
  topArcMm: number;
  /** Developed arc length at the bottom rim (= pi * Db). */
  bottomArcMm: number;
  /** Half-angle of the cone's taper, radians. */
  taperHalfAngleRad: number;
}

export class GeometryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeometryError';
  }
}

/**
 * Derive complete fan geometry from cup dimensions.
 *
 * Throws rather than returning nonsense: a silently wrong cup profile would
 * propagate into production files.
 */
export function deriveFrustum(d: CupDimensions): FrustumGeometry {
  const { topDiameterMm: Dt, bottomDiameterMm: Db } = d;

  if (!Number.isFinite(Dt) || Dt <= 0) {
    throw new GeometryError(`topDiameterMm must be a positive number, got ${Dt}`);
  }
  if (!Number.isFinite(Db) || Db <= 0) {
    throw new GeometryError(`bottomDiameterMm must be a positive number, got ${Db}`);
  }
  if (!Number.isFinite(d.heightMm) || d.heightMm <= 0) {
    throw new GeometryError(`heightMm must be a positive number, got ${d.heightMm}`);
  }
  if (Dt <= Db) {
    // A cylinder (Dt === Db) has no apex: theta -> 0 and R -> infinity. A cup
    // narrower at the top is not a drinking cup. Both are rejected explicitly
    // so the failure is a clear message rather than an Infinity downstream.
    throw new GeometryError(
      `topDiameterMm (${Dt}) must be strictly greater than bottomDiameterMm (${Db}). ` +
        `A cylindrical or inverted body has no cone apex and cannot be developed by this method.`,
    );
  }

  const deltaRadiusMm = (Dt - Db) / 2;

  // Resolve the vertical-vs-slant ambiguity explicitly.
  let slantMm: number;
  let heightMm: number;
  if (d.heightIsSlant) {
    slantMm = d.heightMm;
    const inner = slantMm * slantMm - deltaRadiusMm * deltaRadiusMm;
    if (inner <= 0) {
      throw new GeometryError(
        `slant height (${slantMm}mm) must exceed the radial difference (${deltaRadiusMm}mm)`,
      );
    }
    heightMm = Math.sqrt(inner);
  } else {
    heightMm = d.heightMm;
    slantMm = Math.hypot(heightMm, deltaRadiusMm);
  }

  const sectorAngleRad = (Math.PI * (Dt - Db)) / slantMm;
  const rBottomMm = (slantMm * Db) / (Dt - Db);
  const rTopMm = rBottomMm + slantMm;

  return {
    topRadiusMm: Dt / 2,
    bottomRadiusMm: Db / 2,
    heightMm,
    deltaRadiusMm,
    slantMm,
    sectorAngleRad,
    sectorAngleDeg: (sectorAngleRad * 180) / Math.PI,
    rBottomMm,
    rTopMm,
    topArcMm: rTopMm * sectorAngleRad,
    bottomArcMm: rBottomMm * sectorAngleRad,
    taperHalfAngleRad: Math.atan(deltaRadiusMm / heightMm),
  };
}
