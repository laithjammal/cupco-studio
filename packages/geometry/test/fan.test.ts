import { describe, it, expect } from 'vitest';
import {
  deriveFrustum,
  buildFanOutline,
  fanBounds,
  outlineToSvgPath,
  designBorderInFan,
  CUP_8OZ,
} from '../src/index';

const g8 = deriveFrustum(CUP_8OZ.dimensions);

describe('fan outline construction', () => {
  it('the trim outline sits exactly on the derived rims', () => {
    const { points } = buildFanOutline(CUP_8OZ, g8, 'trim');
    const radii = points.map((p) => Math.hypot(p.x, p.y));
    expect(Math.min(...radii)).toBeCloseTo(g8.rBottomMm, 6);
    expect(Math.max(...radii)).toBeCloseTo(g8.rTopMm, 6);
  });

  /** safe inside trim inside cut inside bleed, with nothing out of order. */
  it('nests the four boundaries in the only order that makes sense', () => {
    const [safe, trim, cut, bleed] = (['safe', 'trim', 'cut', 'bleed'] as const)
      .map((b) => fanBounds(buildFanOutline(CUP_8OZ, g8, b).points));
    for (const [inner, outer] of [[safe, trim], [trim, cut], [cut, bleed]] as const) {
      expect(inner!.widthMm).toBeLessThan(outer!.widthMm);
      expect(inner!.heightMm).toBeLessThan(outer!.heightMm);
    }
  });

  /**
   * Bleed is measured from the CUT, not from trim. Measuring it from trim put
   * the bleed line INSIDE the blank on any edge where the cut ran further out,
   * which is the opposite of what a bleed is for.
   */
  it('puts the bleed a uniform distance outside the cut, on every edge', () => {
    const b = CUP_8OZ.margins.bleedMm;
    const c = CUP_8OZ.margins.cut;
    const radii = (which: 'cut' | 'bleed') =>
      buildFanOutline(CUP_8OZ, g8, which, 512).points.map((p) => Math.hypot(p.x, p.y));
    expect(Math.max(...radii('bleed')) - Math.max(...radii('cut'))).toBeCloseTo(b, 6);
    expect(Math.min(...radii('cut')) - Math.min(...radii('bleed'))).toBeCloseTo(b, 6);
    // And on the seam edges, measured as linear mm at the outer radius.
    const rho = g8.rTopMm + c.topMm + b;
    const psi = buildFanOutline(CUP_8OZ, g8, 'bleed', 512).points
      .filter((p) => Math.abs(Math.hypot(p.x, p.y) - rho) < 1e-6)
      .map((p) => Math.atan2(p.x, -p.y));
    const half = g8.sectorAngleRad / 2;
    expect((-half - Math.min(...psi)) * rho).toBeCloseTo(c.left.atTopMm + b, 6);
    expect((Math.max(...psi) - half) * rho).toBeCloseTo(c.right.atTopMm + b, 6);
  });

  it('the cut extends each rim by exactly its own configured distance', () => {
    const { points } = buildFanOutline(CUP_8OZ, g8, 'cut');
    const radii = points.map((p) => Math.hypot(p.x, p.y));
    const c = CUP_8OZ.margins.cut;
    // rho grows toward the cup's TOP, so the bottom cut reduces the minimum.
    expect(Math.min(...radii)).toBeCloseTo(g8.rBottomMm - c.bottomMm, 6);
    expect(Math.max(...radii)).toBeCloseTo(g8.rTopMm + c.topMm, 6);
  });

  /**
   * The fault this was written for. A single uniform outset drew a blank that
   * was measurably the wrong shape against a real fan: too short at the base,
   * and the same on both seam edges when the real ones differ.
   */
  it('puts each seam edge at its own distance from trim', () => {
    const { points } = buildFanOutline(CUP_8OZ, g8, 'cut', 256);
    const c = CUP_8OZ.margins.cut;
    const halfTheta = g8.sectorAngleRad / 2;
    // psi and rho of every point; the extreme psi at a given rho is the edge.
    const polar = points.map((p) => ({
      rho: Math.hypot(p.x, p.y), psi: Math.atan2(p.x, -p.y),
    }));
    const atTop = polar.filter((q) => Math.abs(q.rho - (g8.rTopMm + c.topMm)) < 1e-6);
    const rhoTop = g8.rTopMm + c.topMm;
    const left = Math.min(...atTop.map((q) => q.psi));
    const right = Math.max(...atTop.map((q) => q.psi));
    // Linear mm out from the trim edge, measured at this radius.
    expect((-halfTheta - left) * rhoTop).toBeCloseTo(c.left.atTopMm, 6);
    expect((right - halfTheta) * rhoTop).toBeCloseTo(c.right.atTopMm, 6);

    // And the same at the bottom arc, from that edge's OWN figure. This is
    // the part a single per-edge number could not express: the die cuts a
    // straight line, so its distance from the radial trim edge changes along
    // the length, and fitting one number to the top missed the real blank's
    // bottom corner by 1.8mm.
    const rhoBot = g8.rBottomMm - c.bottomMm;
    const atBot = polar.filter((q) => Math.abs(q.rho - rhoBot) < 1e-6);
    expect((-halfTheta - Math.min(...atBot.map((q) => q.psi))) * rhoBot)
      .toBeCloseTo(c.left.atBottomMm, 6);
    expect((Math.max(...atBot.map((q) => q.psi)) - halfTheta) * rhoBot)
      .toBeCloseTo(c.right.atBottomMm, 6);
    expect(c.left.atTopMm).not.toBeCloseTo(c.left.atBottomMm, 3);
  });

  /**
   * The blank is longer than the cup because the base seam consumes material.
   * The two numbers are the same physical fact and must not drift apart.
   */
  it('runs past the cup base by the recorded base allowance', () => {
    expect(CUP_8OZ.margins.cut.bottomMm).toBeCloseTo(CUP_8OZ.rimBase.baseAllowanceMm, 6);
  });

  it('safe insets are ABSOLUTE, not additive with the rim curl', () => {
    // Cupco prints "up to 3mm of the top edge" while the curl takes ~9mm, so
    // print runs into the curl zone. Adding the two would wrongly inset by
    // ~12mm and crop artwork the customer expects to see.
    const { points } = buildFanOutline(CUP_8OZ, g8, 'safe');
    const radii = points.map((p) => Math.hypot(p.x, p.y));

    expect(Math.max(...radii)).toBeCloseTo(g8.rTopMm - CUP_8OZ.margins.safeTopMm, 6);
    expect(Math.min(...radii)).toBeCloseTo(g8.rBottomMm + CUP_8OZ.margins.safeBottomMm, 6);

    // Guard the specific regression: the additive reading must NOT reappear.
    const additive = CUP_8OZ.margins.safeTopMm + CUP_8OZ.rimBase.rimCurlAllowanceMm;
    expect(Math.max(...radii)).not.toBeCloseTo(g8.rTopMm - additive, 3);
  });

  it('the safe area is still asymmetric top vs bottom', () => {
    expect(CUP_8OZ.margins.safeTopMm).not.toBe(CUP_8OZ.margins.safeBottomMm);
  });

  it('print extends into the rim curl zone, as Cupco specified', () => {
    const intrusion = CUP_8OZ.rimBase.rimCurlAllowanceMm - CUP_8OZ.margins.safeTopMm;
    expect(intrusion).toBeGreaterThan(0);
    expect(intrusion).toBeCloseTo(5.988, 3);
  });

  /**
   * The manufacturer's drawing, checked against the outline we build from the
   * profile. These are the drawing's OWN labelled figures, not values copied
   * back out of the profile, so this fails if the profile drifts from the die.
   *
   * Source: "Final 8 Oz dimensions Lynn 2.pdf" (B55H90), read by parsing the
   * PDF's vector content stream.
   */
  it('the cut line is the manufacturer drawn blank', () => {
    const o = buildFanOutline(CUP_8OZ, g8, 'cut', 512);

    // The two arcs, labelled R350.24 and R242.24.
    expect(o.rhoOuterMm).toBeCloseTo(350.24, 2);
    expect(o.rhoInnerMm).toBeCloseTo(242.24, 2);
    // Radial extent, labelled 108.01.
    expect(o.rhoOuterMm - o.rhoInnerMm).toBeCloseTo(108.01, 1);

    // Width across the seam edges at each arc, labelled 241.59 and 169.7.
    const { outerLeft, outerRight, innerLeft, innerRight } = o.corners;
    expect(outerRight.x - outerLeft.x).toBeCloseTo(241.59, 1);
    expect(innerRight.x - innerLeft.x).toBeCloseTo(169.7, 1);

    // Included angle of the two straight seam edges, labelled 38.88 deg.
    // Taken as the angle BETWEEN the two edge vectors (atan2 of cross over
    // dot). Differencing their bearings instead wraps past 180 and reports
    // the reflex angle, 321 deg.
    const vec = (a: typeof outerLeft, b: typeof innerLeft) => ({ x: a.x - b.x, y: a.y - b.y });
    const vL = vec(outerLeft, innerLeft);
    const vR = vec(outerRight, innerRight);
    const included =
      Math.atan2(Math.abs(vL.x * vR.y - vL.y * vR.x), vL.x * vR.x + vL.y * vR.y) *
      (180 / Math.PI);
    expect(included).toBeCloseTo(38.88, 1);
  });

  /**
   * The drawing hatches its no-print bands over the note "the hatched part is
   * left blank for printing", and dimensions them 9 at the top and 7 at the
   * bottom, measured from the CUT. Those two bands are what fixed the body
   * height: 9mm inside the top arc is where the cup's rim has to be.
   */
  it('the cup top sits the drawing 9mm band inside the cut', () => {
    expect(CUP_8OZ.margins.cut.topMm).toBeCloseTo(9.0, 1);
    const g = deriveFrustum(CUP_8OZ.dimensions);
    expect(g.rTopMm + CUP_8OZ.margins.cut.topMm).toBeCloseTo(350.24, 1);
    // The sector the drawing labels 38.88 deg.
    expect(g.sectorAngleRad * (180 / Math.PI)).toBeCloseTo(38.88, 1);
  });

  /**
   * The regression this replaced. Reading B55H90's 90mm as the BODY height put
   * R_top at 357.74 - 7.5mm OUTSIDE the die's own top arc, so the cup did not
   * fit the blank it is cut from. Guard the direction, not just the number.
   */
  it('the whole cup fits inside the blank it is cut from', () => {
    const cut = buildFanOutline(CUP_8OZ, g8, 'cut', 256);
    const trim = buildFanOutline(CUP_8OZ, g8, 'trim', 256);
    expect(cut.rhoOuterMm).toBeGreaterThan(trim.rhoOuterMm);
    expect(cut.rhoInnerMm).toBeLessThan(trim.rhoInnerMm);
    const cutB = fanBounds(cut.points);
    const trimB = fanBounds(trim.points);
    expect(cutB.minX).toBeLessThan(trimB.minX);
    expect(cutB.maxX).toBeGreaterThan(trimB.maxX);
  });

  it('the outline is closed and non-degenerate', () => {
    const { points } = buildFanOutline(CUP_8OZ, g8, 'trim', 64);
    expect(points.length).toBe(130); // (64+1) inner + (64+1) outer
    const b = fanBounds(points);
    expect(b.widthMm).toBeGreaterThan(0);
    expect(b.heightMm).toBeGreaterThan(0);
  });

  it('tessellation is fine enough that refining barely moves the bounds', () => {
    const coarse = fanBounds(buildFanOutline(CUP_8OZ, g8, 'trim', 128).points);
    const fine = fanBounds(buildFanOutline(CUP_8OZ, g8, 'trim', 4096).points);
    // Sagitta error at the default segment count must be well under 0.01mm.
    expect(Math.abs(coarse.widthMm - fine.widthMm)).toBeLessThan(0.01);
    expect(Math.abs(coarse.heightMm - fine.heightMm)).toBeLessThan(0.01);
  });
});

describe('8oz fan physical size', () => {
  it('matches the derived geometry and fits a sane sheet', () => {
    const b = fanBounds(buildFanOutline(CUP_8OZ, g8, 'cut').points);
    // Chord across the sector at the outer radius, out to the cut. Sanity-checks
    // that we are producing a cup-sized blank rather than something absurd.
    expect(b.widthMm).toBeGreaterThan(200);
    expect(b.widthMm).toBeLessThan(270);
    expect(b.heightMm).toBeGreaterThan(90);
    expect(b.heightMm).toBeLessThan(140);
  });
});

describe('design border maps into the fan sector', () => {
  it('the design rectangle border becomes the fan trim outline', () => {
    const border = fanBounds(designBorderInFan(g8, 128));
    const trim = fanBounds(buildFanOutline(CUP_8OZ, g8, 'trim', 128).points);
    expect(border.widthMm).toBeCloseTo(trim.widthMm, 3);
    expect(border.heightMm).toBeCloseTo(trim.heightMm, 3);
  });
});

describe('SVG emission', () => {
  it('produces a closed path with finite coordinates', () => {
    const d = outlineToSvgPath(buildFanOutline(CUP_8OZ, g8, 'trim', 16));
    expect(d.startsWith('M ')).toBe(true);
    expect(d.endsWith(' Z')).toBe(true);
    expect(d).not.toMatch(/NaN|Infinity/);
  });
});
