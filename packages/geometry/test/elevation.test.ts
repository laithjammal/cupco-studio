import { describe, it, expect } from 'vitest';
import {
  CUP_8OZ, deriveFrustum, cupElevation, uAtAcross, facingAt,
  silhouettePath, VISIBLE_U_SPAN, DEFAULT_TILT_RAD,
} from '../src/index';

const GEOM = deriveFrustum(CUP_8OZ.dimensions);
const ELEV = cupElevation(GEOM);

describe('the cup reads at its real proportions', () => {
  it('is exactly as wide as the cup is across the rim', () => {
    // A mockup that flatters the shape is a mockup that misleads. 73.62mm top
    // diameter, straight from the profile.
    expect(ELEV.widthMm).toBeCloseTo(CUP_8OZ.dimensions.topDiameterMm, 10);
  });

  it('half-width at any height is the cup radius there', () => {
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      const expected = 27.5 + (36.81 - 27.5) * v; // radii from the 8oz profile
      expect(ELEV.radiusAt(v)).toBeCloseTo(expected, 2);
    }
  });

  it('tapers — the base is narrower than the rim', () => {
    expect(ELEV.radiusAt(0)).toBeLessThan(ELEV.radiusAt(1));
    expect(ELEV.radiusAt(0) * 2).toBeCloseTo(CUP_8OZ.dimensions.bottomDiameterMm, 10);
  });

  it('is shortened by the viewing angle, not by the cup changing', () => {
    // Looking down foreshortens the body. The CUP is still 90mm.
    const level = cupElevation(GEOM, { tiltRad: 0 });
    expect(level.yAt(0)).toBeCloseTo(CUP_8OZ.dimensions.heightMm, 10);
    expect(ELEV.yAt(0)).toBeLessThan(level.yAt(0));
    expect(ELEV.yAt(0)).toBeCloseTo(
      CUP_8OZ.dimensions.heightMm * Math.cos(DEFAULT_TILT_RAD), 6);
  });

  it('collapses the rim to a line when viewed dead level', () => {
    const level = cupElevation(GEOM, { tiltRad: 0 });
    expect(level.ellipseDepth(1)).toBeCloseTo(0, 10);
    expect(ELEV.ellipseDepth(1)).toBeGreaterThan(0);
  });

  it('draws the rim ellipse wider than the base ellipse', () => {
    // Both are the same viewing angle, so depth follows radius.
    expect(ELEV.ellipseDepth(1)).toBeGreaterThan(ELEV.ellipseDepth(0));
  });
});

describe('artwork compresses towards the edges', () => {
  it('shows the seam-centred design centred on the face', () => {
    expect(uAtAcross(0, 0.5)).toBeCloseTo(0.5, 12);
  });

  it('sweeps a quarter turn from centre to each edge', () => {
    // At the silhouette the surface has turned 90 degrees away, which is a
    // quarter of the circumference: 0.25 in u.
    expect(uAtAcross(1, 0.5)).toBeCloseTo(0.75, 12);
    expect(uAtAcross(-1, 0.5)).toBeCloseTo(0.25, 12);
  });

  it('covers exactly half the circumference, so half the design is behind', () => {
    const span = uAtAcross(1, 0.5) - uAtAcross(-1, 0.5);
    expect(span).toBeCloseTo(VISIBLE_U_SPAN, 12);
  });

  it('is NOT linear — that is the whole point', () => {
    // A flat stretch would put the halfway-across point halfway through the
    // visible u-span. It does not: the middle of the face is magnified.
    const mid = uAtAcross(0.5, 0.5);
    const linear = 0.5 + 0.25 * 0.5; // what a naive stretch would give
    expect(Math.abs(mid - linear)).toBeGreaterThan(0.01);
    // asin(0.5) = 30 degrees, a twelfth of a turn.
    expect(mid).toBeCloseTo(0.5 + 1 / 12, 10);
  });

  it('magnifies the centre of the face relative to the edges', () => {
    // The same slice of design occupies more screen width head-on than at the
    // edge, which is what makes a logo readable in the middle of a cup.
    const centreSlice = uAtAcross(0.1, 0.5) - uAtAcross(0, 0.5);
    const edgeSlice = uAtAcross(1.0, 0.5) - uAtAcross(0.9, 0.5);
    expect(edgeSlice).toBeGreaterThan(centreSlice * 2);
  });

  it('wraps u into [0,1) whatever the centre', () => {
    for (const centre of [0, 0.5, 0.9, 1]) {
      for (const across of [-1, -0.4, 0, 0.4, 1]) {
        const u = uAtAcross(across, centre);
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBeLessThan(1);
      }
    }
  });

  it('rotating the view rotates the design, one for one', () => {
    // Turning the cup by a tenth moves what is centred by a tenth.
    expect(uAtAcross(0, 0.6)).toBeCloseTo(0.6, 12);
    expect(uAtAcross(0, 0.1)).toBeCloseTo(0.1, 12);
  });

  it('clamps beyond the silhouette rather than producing NaN', () => {
    expect(Number.isFinite(uAtAcross(1.5, 0.5))).toBe(true);
    expect(uAtAcross(1.5, 0.5)).toBeCloseTo(uAtAcross(1, 0.5), 12);
  });
});

describe('shading follows the surface, not a gradient', () => {
  it('is fully lit head-on and fully turned away at the edges', () => {
    expect(facingAt(0)).toBeCloseTo(1, 12);
    expect(facingAt(1)).toBeCloseTo(0, 12);
    expect(facingAt(-1)).toBeCloseTo(0, 12);
  });

  it('is symmetric about the centre', () => {
    for (const a of [0.2, 0.5, 0.8]) {
      expect(facingAt(a)).toBeCloseTo(facingAt(-a), 12);
    }
  });

  it('falls off slowly in the middle and fast at the edge, as a cylinder does', () => {
    const nearCentre = facingAt(0) - facingAt(0.2);
    const nearEdge = facingAt(0.8) - facingAt(1.0);
    expect(nearEdge).toBeGreaterThan(nearCentre * 3);
  });

  it('never goes negative', () => {
    expect(facingAt(1.4)).toBeGreaterThanOrEqual(0);
  });
});

describe('silhouette', () => {
  const path = silhouettePath(ELEV);

  it('is closed and non-trivial', () => {
    expect(path.length).toBeGreaterThan(50);
  });

  it('never exceeds the rim radius', () => {
    const rTop = ELEV.radiusAt(1);
    for (const p of path) expect(Math.abs(p.x)).toBeLessThanOrEqual(rTop + 1e-9);
  });

  it('spans the full drawn height', () => {
    const ys = path.map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(ELEV.heightMm, 6);
  });

  it('is symmetric left to right', () => {
    const xs = path.map((p) => p.x);
    expect(Math.max(...xs)).toBeCloseTo(-Math.min(...xs), 6);
  });
});
