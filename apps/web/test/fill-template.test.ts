/**
 * "Fill to bleed" and "Fit to safe area".
 *
 * The bug these were written for: both targets were computed by dividing a
 * millimetre margin by the TOP arc length. Design u is angular, so the same
 * millimetre offset is a bigger fraction of u at the base than at the rim -
 * and measuring only at the rim made "fill to bleed" stop 2.9mm inside the
 * blank on each side, worst at the base, exactly where a white sliver shows.
 * "Fit to safe" had the same error in the dangerous direction.
 */
import { describe, it, expect } from 'vitest';
import {
  CUP_8OZ, deriveFrustum, boundaryURange, boundaryVRange, designToFan, buildFanOutline,
} from '@cupco/geometry';
import { fillToTemplate, type FillMode } from '../src/lib/tools';
import type { DesignElement } from '../src/lib/design';

const geom = deriveFrustum(CUP_8OZ.dimensions);

// fillToTemplate returns a Partial over a UNION of element types, so the
// per-type fields are not reachable through it. These name what the patch is
// asserted to carry, at the one place the cast lives.
type Patch = Partial<Record<'u' | 'v' | 'widthU' | 'heightV' | 'sizeV', number>>;
const patch = (e: DesignElement, mode: FillMode): Patch =>
  fillToTemplate(e, CUP_8OZ, geom, mode) as Patch;

const band = (over: Partial<DesignElement> = {}): DesignElement => ({
  id: 'b1', type: 'band', name: 'Colour band',
  u: 0.5, v: 0.4, rotation: 0, color: '#ff0000', heightV: 0.2, widthU: 1,
} as DesignElement);

const box = (over: Partial<DesignElement> = {}): DesignElement => ({
  id: 'v1', type: 'vector', name: 'Red box',
  u: 0.5, v: 0.5, rotation: 0, widthU: 0.3,
  art: { aspect: 1, shapes: [] },
  ...over,
} as DesignElement);

describe('fill to bleed', () => {
  it('covers the blank at the BASE arc, not just at the rim', () => {
    const p = patch(box(), 'bleed');
    const halfU = p.widthU! / 2;
    const left = p.u! - halfU;
    const right = p.u! + halfU;

    const u = boundaryURange(CUP_8OZ, geom, 'bleed');
    // The base arc is the demanding one - it needs the widest u.
    expect(left).toBeLessThanOrEqual(u.atBottom.uLeft + 1e-9);
    expect(right).toBeGreaterThanOrEqual(u.atBottom.uRight - 1e-9);
    // And the rim, which is the easier one.
    expect(left).toBeLessThanOrEqual(u.atTop.uLeft + 1e-9);
    expect(right).toBeGreaterThanOrEqual(u.atTop.uRight - 1e-9);
  });

  it('the regression: measuring at the rim alone falls short at the base', () => {
    // What the old code produced, kept as a control so the fix cannot be
    // undone by "simplifying" back to one arc length.
    const c = CUP_8OZ.margins.cut;
    const b = CUP_8OZ.margins.bleedMm;
    const oldSpan = 1
      + (Math.max(c.left.atTopMm, c.left.atBottomMm) + b) / geom.topArcMm
      + (Math.max(c.right.atTopMm, c.right.atBottomMm) + b) / geom.topArcMm;
    const u = boundaryURange(CUP_8OZ, geom, 'bleed');
    const needed = u.atBottom.uRight - u.atBottom.uLeft;
    expect(oldSpan).toBeLessThan(needed);
    // Nearly 3mm of bare board per side, at the base.
    const shortMm = ((needed - oldSpan) / 2) * geom.sectorAngleRad
      * buildFanOutline(CUP_8OZ, geom, 'bleed', 8).rhoInnerMm;
    expect(shortMm).toBeGreaterThan(2.5);
  });

  it('reaches the bleed at every radius, checked in fan space', () => {
    const p = patch(box(), 'bleed');
    const halfU = p.widthU! / 2;
    const o = buildFanOutline(CUP_8OZ, geom, 'bleed', 64);
    // Every point on the bleed outline must fall inside the filled element's
    // angular span - that is what "runs off every edge" has to mean.
    for (const q of o.points) {
      const uAt = Math.atan2(q.x, -q.y) / geom.sectorAngleRad + 0.5;
      expect(uAt).toBeGreaterThanOrEqual(p.u! - halfU - 1e-9);
      expect(uAt).toBeLessThanOrEqual(p.u! + halfU + 1e-9);
    }
  });

  it('a band fills the full height of the blank, not just the cup', () => {
    const p = patch(band(), 'bleed');
    const v = boundaryVRange(CUP_8OZ, geom, 'bleed');
    expect(p.heightV!).toBeCloseTo(v.vTop - v.vBottom, 9);
    // The old clamp to 1 stopped it at the trim, 31.7mm short.
    expect(p.heightV!).toBeGreaterThan(1);
    expect(p.heightV! - 1).toBeGreaterThan(0.3);
  });

  it('centres on the blank, which is not centred on the cup', () => {
    const p = patch(band(), 'bleed');
    const v = boundaryVRange(CUP_8OZ, geom, 'bleed');
    expect(p.v!).toBeCloseTo((v.vBottom + v.vTop) / 2, 9);
    // The blank runs further past the base than past the rim, so the centre
    // sits BELOW the middle of the cup.
    expect(p.v!).toBeLessThan(0.5);
  });
});

describe('fit to safe area', () => {
  it('stays inside the safe area at the BASE arc, the tight one', () => {
    const p = patch(box(), 'safe');
    const halfU = p.widthU! / 2;
    const u = boundaryURange(CUP_8OZ, geom, 'safe');
    expect(p.u! - halfU).toBeGreaterThanOrEqual(u.atBottom.uLeft - 1e-9);
    expect(p.u! + halfU).toBeLessThanOrEqual(u.atBottom.uRight + 1e-9);
  });

  it('the regression: the rim-only reading left artwork outside safe', () => {
    const oldSpan = 1 - (CUP_8OZ.margins.safeSeamMm / geom.topArcMm) * 2;
    const u = boundaryURange(CUP_8OZ, geom, 'safe');
    const allowed = u.atBottom.uRight - u.atBottom.uLeft;
    expect(oldSpan).toBeGreaterThan(allowed);
  });

  it('never grows past what it is given — safe contains, bleed covers', () => {
    const s = patch(box(), 'safe');
    const b = patch(box(), 'bleed');
    expect(s.widthU!).toBeLessThan(b.widthU!);
  });
});

/**
 * Single-axis fills.
 *
 * 'bleed' scales to COVER, taking the larger of the two ratios, so asking for
 * a sideways bleed also grew the element tall enough to swallow the cup. One
 * axis at a time was not expressible, and it is the common case.
 */
describe('single-axis bleed', () => {
  it('bleed-h reaches both seam edges and leaves v alone', () => {
    const before = box({ v: 0.32 });
    const p = patch(before, 'bleed-h');
    const u = boundaryURange(CUP_8OZ, geom, 'bleed');
    const halfU = p.widthU! / 2;
    expect(p.u! - halfU).toBeLessThanOrEqual(Math.min(u.atTop.uLeft, u.atBottom.uLeft) + 1e-9);
    expect(p.u! + halfU).toBeGreaterThanOrEqual(Math.max(u.atTop.uRight, u.atBottom.uRight) - 1e-9);
    // The whole point: it must not move vertically.
    expect(p.v).toBeUndefined();
  });

  it('bleed-v reaches the rim and the base and leaves u alone', () => {
    const p = patch(box({ u: 0.2 }), 'bleed-v');
    expect(p.u).toBeUndefined();
    const v = boundaryVRange(CUP_8OZ, geom, 'bleed');
    expect(p.v!).toBeCloseTo((v.vBottom + v.vTop) / 2, 9);
  });

  it('each axis mode scales less than filling both, which has to overshoot', () => {
    const both = patch(box(), 'bleed');
    const h = patch(box(), 'bleed-h');
    const v = patch(box(), 'bleed-v');
    expect(both.widthU!).toBeGreaterThanOrEqual(h.widthU!);
    expect(both.widthU!).toBeGreaterThanOrEqual(v.widthU!);
    // A square box on a blank wider than it is tall bleeds sideways at a
    // smaller scale than it bleeds top-to-bottom.
    expect(h.widthU).not.toBeCloseTo(v.widthU!, 6);
  });

  it('a band ignores bleed-h — it already wraps the whole circumference', () => {
    const p = patch(band(), 'bleed-h');
    expect(p.heightV).toBeUndefined();
    expect(p.v).toBeUndefined();
  });

  it('a band bleeds vertically to the full height of the blank', () => {
    const p = patch(band(), 'bleed-v');
    const v = boundaryVRange(CUP_8OZ, geom, 'bleed');
    expect(p.heightV!).toBeCloseTo(v.vTop - v.vBottom, 9);
  });
});
