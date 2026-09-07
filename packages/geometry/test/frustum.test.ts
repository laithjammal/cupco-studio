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

  // Supplied by Cupco: top 73.62mm, bottom 55.00mm, height 90.00mm.
  // These expectations are the numbers signed off in the architecture doc; if
  // they ever change, the profile changed and that must be deliberate.
  it('derives the documented slant height', () => {
    expect(g.slantMm).toBeCloseTo(90.4803, 4);
  });
  it('derives the documented sector angle', () => {
    expect(g.sectorAngleDeg).toBeCloseTo(37.0423, 4);
  });
  it('derives the documented apex radii', () => {
    expect(g.rBottomMm).toBeCloseTo(267.2618, 4);
    expect(g.rTopMm).toBeCloseTo(357.7420, 4);
  });
  it('derives the documented arc lengths', () => {
    expect(g.topArcMm).toBeCloseTo(231.28405, 4);
    expect(g.bottomArcMm).toBeCloseTo(172.7876, 4);
  });
  it('derives the documented taper', () => {
    expect((g.taperHalfAngleRad * 180) / Math.PI).toBeCloseTo(5.9059, 4);
  });
});

describe('deriveFrustum — vertical vs slant height', () => {
  // RESOLVED: Cupco confirmed 2026-08-26 that 90mm is the VERTICAL height.
  // The slant reading is retained here to prove the engine handles both, and
  // to document the 1.42mm that was at stake.
  it('the 8oz profile is pinned to the confirmed VERTICAL reading', () => {
    expect(CUP_8OZ.dimensions.heightIsSlant).toBe(false);
    expect(deriveFrustum(CUP_8OZ.dimensions).sectorAngleDeg).toBeCloseTo(37.0423, 4);
  });

  it('interpreting 90mm as slant shifts R_bottom by ~1.42mm', () => {
    const vertical = deriveFrustum(CUP_8OZ.dimensions);
    const slant = deriveFrustum({ ...CUP_8OZ.dimensions, heightIsSlant: true });

    expect(slant.slantMm).toBeCloseTo(90.0, 10);
    expect(slant.sectorAngleDeg).toBeCloseTo(37.24, 2);
    expect(Math.abs(vertical.rBottomMm - slant.rBottomMm)).toBeCloseTo(1.42, 2);
  });

  it('the arc-length identity still holds under the slant reading', () => {
    const g = deriveFrustum({ ...CUP_8OZ.dimensions, heightIsSlant: true });
    expect(g.rTopMm * g.sectorAngleRad).toBeCloseTo(Math.PI * 73.62, 10);
  });

  it('recovers vertical height from slant consistently', () => {
    const g = deriveFrustum({ ...CUP_8OZ.dimensions, heightIsSlant: true });
    // h = sqrt(L^2 - dr^2)
    expect(g.heightMm).toBeCloseTo(Math.sqrt(90 * 90 - 9.31 * 9.31), 8);
  });
});

describe('deriveFrustum — no profile can be a scaled copy of another', () => {
  it('sector angles differ materially across the three sizes', () => {
    const a = deriveFrustum(CUP_8OZ.dimensions).sectorAngleDeg;
    const b = deriveFrustum(CUP_12OZ.dimensions).sectorAngleDeg;
    const c = deriveFrustum(CUP_16OZ.dimensions).sectorAngleDeg;

    // If any pair matched, a single scaled fan could serve both — the exact
    // failure mode this engine exists to prevent.
    expect(Math.abs(a - b)).toBeGreaterThan(1);
    expect(Math.abs(b - c)).toBeGreaterThan(1);
    expect(Math.abs(a - c)).toBeGreaterThan(1);
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
    expect(CUP_8OZ.margins.cut).toEqual({ topMm: 9.0, bottomMm: 7.0, leftMm: 9.0, rightMm: 3.0 });
    expect(CUP_8OZ.seam.overlapMm).toBe(6.0);
    expect(CUP_8OZ.margins.safeSeamMm).toBe(4.0);
    expect(CUP_8OZ.rimBase.rimCurlAllowanceMm).toBe(7.0);
    expect(CUP_8OZ.margins.safeTopMm).toBe(3.0);
    expect(CUP_8OZ.margins.safeBottomMm).toBe(2.0);
  });

  it('the printable band is the cup height less the two print limits', () => {
    const g = deriveFrustum(CUP_8OZ.dimensions);
    const printable = g.slantMm - CUP_8OZ.margins.safeTopMm - CUP_8OZ.margins.safeBottomMm;
    expect(printable).toBeCloseTo(90.4803 - 5, 3);
  });
});
