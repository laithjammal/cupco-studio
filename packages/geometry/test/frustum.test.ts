import { describe, it, expect } from 'vitest';
import {
  deriveFrustum,
  GeometryError,
  CUP_8OZ,
  CUP_12OZ,
  CUP_16OZ,
  BUILT_IN_PROFILES,
  isProductionReady,
  provenanceIssues,
  withMargins,
} from '../src/index';

describe('deriveFrustum — the arc-length identity', () => {
  // This is THE correctness invariant of the whole engine. If the developed
  // arc does not equal the circumference, artwork will not meet at the seam.
  it.each(BUILT_IN_PROFILES.map((p) => [p.displayName, p] as const))(
    '%s: developed arcs equal the circumferences exactly',
    (_name, profile) => {
      const g = deriveFrustum(profile.dimensions);
      const { topDiameterMm: Dt, bottomDiameterMm: Db } = profile.dimensions;

      expect(g.rTopMm * g.sectorAngleRad).toBeCloseTo(Math.PI * Dt, 10);
      expect(g.rBottomMm * g.sectorAngleRad).toBeCloseTo(Math.PI * Db, 10);
      expect(g.topArcMm).toBeCloseTo(Math.PI * Dt, 10);
      expect(g.bottomArcMm).toBeCloseTo(Math.PI * Db, 10);
    },
  );

  it.each(BUILT_IN_PROFILES.map((p) => [p.displayName, p] as const))(
    '%s: R_top is exactly one slant length beyond R_bottom',
    (_name, profile) => {
      const g = deriveFrustum(profile.dimensions);
      expect(g.rTopMm - g.rBottomMm).toBeCloseTo(g.slantMm, 10);
    },
  );
});

describe('deriveFrustum — real 8oz values', () => {
  const g = deriveFrustum(CUP_8OZ.dimensions);

  // Top 73.62mm, bottom 55.01mm, BODY height 85.76mm - the last of these
  // solved from the manufacturer's fan drawing (B55H90), not the 90mm of the
  // designation, which is the finished height. See profiles.ts.
  //
  // These are the numbers the drawing implies. If they change, the profile
  // changed, and that must be deliberate.
  it('derives the documented slant height', () => {
    expect(g.slantMm).toBeCloseTo(86.2633, 4);
  });
  it('derives the documented sector angle', () => {
    expect(g.sectorAngleDeg).toBeCloseTo(38.8323, 4);
  });
  it('derives the documented apex radii', () => {
    expect(g.rBottomMm).toBeCloseTo(254.9890, 4);
    expect(g.rTopMm).toBeCloseTo(341.2523, 4);
  });
  it('derives the documented arc lengths', () => {
    expect(g.topArcMm).toBeCloseTo(231.28405, 4);
    expect(g.bottomArcMm).toBeCloseTo(172.81901, 4);
  });
  it('derives the documented taper', () => {
    expect((g.taperHalfAngleRad * 180) / Math.PI).toBeCloseTo(6.1924, 4);
  });

  /**
   * The check that ties all of the above to the physical die: the drawing's
   * own top arc, less its own 9mm no-print band, is where the cup's rim sits.
   */
  it('puts the rim exactly where the manufacturer drawing puts it', () => {
    expect(g.rTopMm + CUP_8OZ.margins.cut.topMm).toBeCloseTo(350.24, 1);
  });
});

describe('deriveFrustum — vertical vs slant height', () => {
  // RESOLVED: the profile's heightMm is the VERTICAL body height. The slant
  // reading is retained here to prove the engine handles both.
  //
  // Note this is a different question from the one the drawing settled. That
  // one was body vs FINISHED height (85.76 vs 90); this one is vertical vs
  // slant for whichever number is held.
  const H = CUP_8OZ.dimensions.heightMm;
  const DR = (CUP_8OZ.dimensions.topDiameterMm - CUP_8OZ.dimensions.bottomDiameterMm) / 2;

  it('the 8oz profile is pinned to the VERTICAL reading', () => {
    expect(CUP_8OZ.dimensions.heightIsSlant).toBe(false);
    expect(deriveFrustum(CUP_8OZ.dimensions).sectorAngleDeg).toBeCloseTo(38.8323, 4);
  });

  it('interpreting the height as slant shifts R_bottom measurably', () => {
    const vertical = deriveFrustum(CUP_8OZ.dimensions);
    const slant = deriveFrustum({ ...CUP_8OZ.dimensions, heightIsSlant: true });

    expect(slant.slantMm).toBeCloseTo(H, 10);
    // Reading the height as slant makes the cup shorter, so the apex radii
    // shrink. The gap is what is at stake in getting the reading right.
    expect(slant.rBottomMm).toBeLessThan(vertical.rBottomMm);
    expect(Math.abs(vertical.rBottomMm - slant.rBottomMm)).toBeCloseTo(1.4878, 3);
  });

  it('the arc-length identity still holds under the slant reading', () => {
    const g = deriveFrustum({ ...CUP_8OZ.dimensions, heightIsSlant: true });
    expect(g.rTopMm * g.sectorAngleRad).toBeCloseTo(Math.PI * 73.62, 10);
  });

  it('recovers vertical height from slant consistently', () => {
    const g = deriveFrustum({ ...CUP_8OZ.dimensions, heightIsSlant: true });
    // h = sqrt(L^2 - dr^2)
    expect(g.heightMm).toBeCloseTo(Math.sqrt(H * H - DR * DR), 8);
  });
});

describe('deriveFrustum — no profile can be a scaled copy of another', () => {
  it('sector angles differ across the three sizes', () => {
    const a = deriveFrustum(CUP_8OZ.dimensions).sectorAngleDeg;
    const b = deriveFrustum(CUP_12OZ.dimensions).sectorAngleDeg;
    const c = deriveFrustum(CUP_16OZ.dimensions).sectorAngleDeg;

    // Scaling a fan preserves its sector angle. So ANY difference in angle is
    // enough to prove no scale factor maps one onto another — the failure mode
    // this engine exists to prevent. The threshold is deliberately "not equal"
    // rather than a chosen number of degrees.
    //
    // Worth knowing how narrow this can get: with the 8oz corrected against
    // its manufacturer drawing it sits 0.92 deg from the 16oz, where before it
    // was 2.7 deg away. The two fans are still completely different shapes -
    // their apex radii differ by ~65mm - but the angle alone no longer
    // separates them by much, and the 12oz/16oz figures are placeholders.
    expect(a).not.toBeCloseTo(b, 1);
    expect(b).not.toBeCloseTo(c, 1);
    expect(a).not.toBeCloseTo(c, 1);

    // The apex radii are the other half of the shape, and are far apart.
    const r = (d: typeof CUP_8OZ.dimensions) => deriveFrustum(d).rBottomMm;
    expect(Math.abs(r(CUP_8OZ.dimensions) - r(CUP_16OZ.dimensions))).toBeGreaterThan(10);
  });

  it('12oz and 16oz share a top diameter yet differ in sector angle', () => {
    expect(CUP_12OZ.dimensions.topDiameterMm).toBe(CUP_16OZ.dimensions.topDiameterMm);
    const b = deriveFrustum(CUP_12OZ.dimensions);
    const c = deriveFrustum(CUP_16OZ.dimensions);
    expect(b.sectorAngleDeg).not.toBeCloseTo(c.sectorAngleDeg, 1);
  });
});

describe('deriveFrustum — rejects undevelopable input', () => {
  const base = { topDiameterMm: 73.62, bottomDiameterMm: 55, heightMm: 90 };

  it('rejects a cylinder (no cone apex)', () => {
    expect(() => deriveFrustum({ ...base, topDiameterMm: 55 })).toThrow(GeometryError);
  });
  it('rejects an inverted body', () => {
    expect(() => deriveFrustum({ ...base, topDiameterMm: 50 })).toThrow(GeometryError);
  });
  it.each([0, -1, NaN, Infinity])('rejects non-positive/non-finite height %s', (h) => {
    expect(() => deriveFrustum({ ...base, heightMm: h as number })).toThrow(GeometryError);
  });
  it('rejects a slant shorter than the radial difference', () => {
    expect(() =>
      deriveFrustum({ topDiameterMm: 100, bottomDiameterMm: 50, heightMm: 5, heightIsSlant: true }),
    ).toThrow(GeometryError);
  });
});

describe('split provenance: dimensions vs margins', () => {
  it('8oz has measured dimensions and is production ready', () => {
    expect(CUP_8OZ.dimensionsProvenance).toBe('MEASURED');
    expect(isProductionReady(CUP_8OZ)).toBe(true);
  });

  it('8oz is fully confirmed and raises no issues at all', () => {
    // As of 2026-08-26 every print-affecting margin has been supplied.
    expect(CUP_8OZ.marginsProvenance).toBe('MEASURED');
    expect(provenanceIssues(CUP_8OZ)).toHaveLength(0);
    expect(isProductionReady(CUP_8OZ)).toBe(true);
  });

  it('a profile with assumed margins WARNS without blocking', () => {
    // The whole point of splitting: a correctly-shaped cup must stay proofable
    // even while a margin is unconfirmed.
    const assumed = withMargins(CUP_8OZ, { provenance: 'PLACEHOLDER' });
    const issues = provenanceIssues(assumed);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.level).toBe('warning');
    expect(issues[0]!.field).toBe('margins');
    expect(isProductionReady(assumed)).toBe(true);
  });

  it('12oz and 16oz are blocked by placeholder DIMENSIONS', () => {
    for (const p of [CUP_12OZ, CUP_16OZ]) {
      expect(isProductionReady(p)).toBe(false);
      const errors = provenanceIssues(p).filter((i) => i.level === 'error');
      expect(errors).toHaveLength(1);
      expect(errors[0]!.field).toBe('dimensions');
    }
  });

  it('confirming margins clears the warning and keeps geometry untouched', () => {
    const assumed = withMargins(CUP_8OZ, { provenance: 'PLACEHOLDER' });
    expect(provenanceIssues(assumed)).toHaveLength(1);

    const confirmed = withMargins(assumed, {
      margins: { safeBottomMm: 4 },
      provenance: 'MEASURED',
      note: 'All margins confirmed by printer.',
    });
    expect(provenanceIssues(confirmed)).toHaveLength(0);
    expect(confirmed.margins.safeBottomMm).toBe(4);
    // Adjusting margins must never disturb the derived cup geometry.
    expect(confirmed.dimensions).toEqual(CUP_8OZ.dimensions);
    expect(deriveFrustum(confirmed.dimensions)).toEqual(deriveFrustum(CUP_8OZ.dimensions));
  });

  it('withMargins does not mutate the original profile', () => {
    const before = CUP_8OZ.margins.safeTopMm;
    withMargins(CUP_8OZ, { margins: { safeTopMm: 99 } });
    expect(CUP_8OZ.margins.safeTopMm).toBe(before);
  });
});

describe('confirmed 8oz margin values', () => {
  it('matches what Cupco supplied 2026-08-26', () => {
    // Cut: measured off the manufacturer's drawing 2026-09-07.
    expect(CUP_8OZ.margins.cut).toEqual({
      topMm: 8.988,
      bottomMm: 12.749,
      left: { atTopMm: 4.634, atBottomMm: 4.592 },
      right: { atTopMm: 4.664, atBottomMm: 4.585 },
    });
    // Supplied by Cupco for this press.
    expect(CUP_8OZ.margins.bleedMm).toBe(5.0);
    expect(CUP_8OZ.margins.safeSeamMm).toBe(4.0);
    // Extended 4mm at each end on Laith's instruction 2026-09-07, from
    // Cupco's 3 / 2. Negative = the safe line sits OUTSIDE the trim.
    expect(CUP_8OZ.margins.safeTopMm).toBe(-1.0);
    expect(CUP_8OZ.margins.safeBottomMm).toBe(-2.0);
    // From the drawing: lap 7.5mm, "right edge on top".
    expect(CUP_8OZ.seam.overlapMm).toBe(7.5);
    // Rim and base allowances are the same physical facts as the cut line's
    // top and bottom, and must not drift from them.
    expect(CUP_8OZ.rimBase.rimCurlAllowanceMm).toBe(CUP_8OZ.margins.cut.topMm);
    expect(CUP_8OZ.rimBase.baseAllowanceMm).toBe(CUP_8OZ.margins.cut.bottomMm);
    expect(CUP_8OZ.rimBase.finishedRimOuterDiameterMm).toBe(79.69);
  });

  it('the printable band is the cup height less the two print limits', () => {
    const g = deriveFrustum(CUP_8OZ.dimensions);
    const printable = g.slantMm - CUP_8OZ.margins.safeTopMm - CUP_8OZ.margins.safeBottomMm;
    // Both limits are now negative, so the printable band is LONGER than the
    // cup wall: printing runs past the trim at both ends.
    expect(printable).toBeCloseTo(86.2633 + 3, 3);
    expect(printable).toBeGreaterThan(g.slantMm);
  });

  /**
   * The 90mm in B55H90 is the FINISHED height - body, rim curl and base. Read
   * as the body height it contradicts the manufacturer's own blank. Pin the
   * body height so it cannot quietly revert.
   */
  it('carries the body height, not the finished B55H90 height', () => {
    expect(CUP_8OZ.dimensions.heightMm).toBe(85.76);
    expect(CUP_8OZ.dimensions.heightMm).not.toBe(90);
    expect(CUP_8OZ.dimensions.heightIsSlant).toBe(false);
    const g = deriveFrustum(CUP_8OZ.dimensions);
    // The drawing's own sector angle and top radius.
    expect(g.sectorAngleRad * (180 / Math.PI)).toBeCloseTo(38.8323, 3);
    expect(g.rTopMm).toBeCloseTo(341.2523, 3);
  });
});
