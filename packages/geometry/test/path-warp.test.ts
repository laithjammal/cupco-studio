import { describe, it, expect } from 'vitest';
import {
  deriveFrustum, designToFan, warpPolyline, warpShape, warpShapeWrapped,
  fanShapeToSvgPath, shapePointCount, DEFAULT_FLATNESS_MM, CUP_8OZ,
  type DesignShape,
} from '../src/index';

const g8 = deriveFrustum(CUP_8OZ.dimensions);

/** Max deviation of the flattened polyline from the true warped curve. */
function maxError(a: { u: number; v: number }, b: { u: number; v: number }, tol: number): number {
  const poly = warpPolyline([a, b], g8, tol);
  let worst = 0;
  // Sample the TRUE curve densely and measure distance to the polyline.
  for (let i = 0; i <= 400; i++) {
    const t = i / 400;
    const truePt = designToFan({ u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t }, g8);
    let best = Infinity;
    for (let s = 1; s < poly.length; s++) {
      const p0 = poly[s - 1]!, p1 = poly[s]!;
      const dx = p1.x - p0.x, dy = p1.y - p0.y;
      const len2 = dx * dx + dy * dy;
      let k = len2 === 0 ? 0 : ((truePt.x - p0.x) * dx + (truePt.y - p0.y) * dy) / len2;
      k = k < 0 ? 0 : k > 1 ? 1 : k;
      const d = Math.hypot(truePt.x - (p0.x + k * dx), truePt.y - (p0.y + k * dy));
      if (d < best) best = d;
    }
    if (best > worst) worst = best;
  }
  return worst;
}

describe('warpPolyline — flattening accuracy', () => {
  it('a full horizontal sweep stays within tolerance of the true arc', () => {
    // Constant v maps to an ARC on the fan — the hardest case.
    expect(maxError({ u: 0, v: 0.5 }, { u: 1, v: 0.5 }, DEFAULT_FLATNESS_MM))
      .toBeLessThanOrEqual(DEFAULT_FLATNESS_MM * 1.5);
  });

  it('holds at the cup base, where the warp is tightest', () => {
    expect(maxError({ u: 0.1, v: 0 }, { u: 0.9, v: 0 }, DEFAULT_FLATNESS_MM))
      .toBeLessThanOrEqual(DEFAULT_FLATNESS_MM * 1.5);
  });

  it('a tighter tolerance produces a measurably tighter curve', () => {
    const coarse = maxError({ u: 0, v: 0.5 }, { u: 1, v: 0.5 }, 0.5);
    const fine = maxError({ u: 0, v: 0.5 }, { u: 1, v: 0.5 }, 0.01);
    expect(fine).toBeLessThan(coarse);
    expect(fine).toBeLessThanOrEqual(0.015);
  });
});

describe('warpPolyline — subdivision is adaptive, not uniform', () => {
  it('a VERTICAL line needs no subdivision: it maps to a straight radial line', () => {
    // This is the payoff of measuring flatness in fan space — the algorithm
    // discovers that radial lines are already straight.
    const pts = warpPolyline([{ u: 0.5, v: 0 }, { u: 0.5, v: 1 }], g8);
    expect(pts.length).toBe(2);
  });

  it('a HORIZONTAL line needs many segments', () => {
    const pts = warpPolyline([{ u: 0, v: 0.5 }, { u: 1, v: 0.5 }], g8);
    expect(pts.length).toBeGreaterThan(16);
  });

  it('spends more segments on a wider sweep than a narrow one', () => {
    const wide = warpPolyline([{ u: 0, v: 0.5 }, { u: 1, v: 0.5 }], g8).length;
    const narrow = warpPolyline([{ u: 0.45, v: 0.5 }, { u: 0.55, v: 0.5 }], g8).length;
    expect(wide).toBeGreaterThan(narrow);
  });

  it('endpoints land exactly where designToFan puts them', () => {
    const a = { u: 0.2, v: 0.3 }, b = { u: 0.8, v: 0.7 };
    const pts = warpPolyline([a, b], g8);
    const fa = designToFan(a, g8), fb = designToFan(b, g8);
    expect(pts[0]!.x).toBeCloseTo(fa.x, 9);
    expect(pts[0]!.y).toBeCloseTo(fa.y, 9);
    expect(pts[pts.length - 1]!.x).toBeCloseTo(fb.x, 9);
    expect(pts[pts.length - 1]!.y).toBeCloseTo(fb.y, 9);
  });

  it('handles degenerate input without hanging', () => {
    expect(warpPolyline([], g8)).toEqual([]);
    expect(warpPolyline([{ u: 0.5, v: 0.5 }], g8)).toHaveLength(1);
    const same = warpPolyline([{ u: 0.5, v: 0.5 }, { u: 0.5, v: 0.5 }], g8);
    expect(same.length).toBeLessThanOrEqual(3);
  });
});

describe('warpShape', () => {
  const square: DesignShape = {
    subpaths: [[
      { u: 0.4, v: 0.4 }, { u: 0.6, v: 0.4 }, { u: 0.6, v: 0.6 }, { u: 0.4, v: 0.6 }, { u: 0.4, v: 0.4 },
    ]],
    fill: [255, 0, 0],
    opacity: 1,
  };

  it('warps every subpath and preserves paint', () => {
    const w = warpShape(square, g8);
    expect(w.subpaths).toHaveLength(1);
    expect(w.fill).toEqual([255, 0, 0]);
    expect(w.opacity).toBe(1);
    // The two horizontal edges become arcs, so the ring gains points.
    expect(shapePointCount(w)).toBeGreaterThan(5);
  });

  it('the warped square lies inside the fan sector', () => {
    const w = warpShape(square, g8);
    for (const p of w.subpaths[0]!) {
      const rho = Math.hypot(p.x, p.y);
      expect(rho).toBeGreaterThanOrEqual(g8.rBottomMm - 0.01);
      expect(rho).toBeLessThanOrEqual(g8.rTopMm + 0.01);
    }
  });

  it('emits a closed SVG path with finite coordinates', () => {
    const d = fanShapeToSvgPath(warpShape(square, g8));
    expect(d.startsWith('M ')).toBe(true);
    expect(d.endsWith(' Z')).toBe(true);
    expect(d).not.toMatch(/NaN|Infinity/);
  });
});

describe('warpShapeWrapped — seam continuity', () => {
  const nearSeam: DesignShape = {
    subpaths: [[
      { u: 0.98, v: 0.4 }, { u: 1.04, v: 0.4 }, { u: 1.04, v: 0.6 }, { u: 0.98, v: 0.6 }, { u: 0.98, v: 0.4 },
    ]],
    fill: [0, 0, 255],
    opacity: 1,
  };

  it('a shape crossing the seam emits copies on BOTH sides', () => {
    // Without this the logo would be sliced in half at the glue seam.
    const parts = warpShapeWrapped(nearSeam, g8);
    expect(parts.length).toBeGreaterThanOrEqual(2);
  });

  it('a shape far from the seam emits exactly one copy', () => {
    const middle: DesignShape = { ...nearSeam, subpaths: [nearSeam.subpaths[0]!.map((p) => ({ u: p.u - 0.5, v: p.v }))] };
    expect(warpShapeWrapped(middle, g8)).toHaveLength(1);
  });
});

describe('vector warp agrees with the raster mapping', () => {
  // Both pipelines must place artwork identically — that is the whole point
  // of a single geometry engine. A vector corner and the raster's forward map
  // must land on the same millimetre.
  it('warped vertices match designToFan exactly', () => {
    for (const uv of [{ u: 0.1, v: 0.1 }, { u: 0.5, v: 0.5 }, { u: 0.9, v: 0.95 }]) {
      const viaWarp = warpPolyline([uv, uv], g8)[0]!;
      const viaMap = designToFan(uv, g8);
      expect(viaWarp.x).toBeCloseTo(viaMap.x, 12);
      expect(viaWarp.y).toBeCloseTo(viaMap.y, 12);
    }
  });
});

/**
 * The same seam-wrap trap on the vector path.
 *
 * warpShapeWrapped emits a copy either side of the seam so a shape crossing it
 * still prints on both. A shape that already spans the whole circumference
 * must NOT get them: the copies overlap it and lay its far side over its near
 * side, which on a full-bleed design silently buries content.
 */
describe('warpShapeWrapped on a full-circumference shape', () => {
  const geom = deriveFrustum(CUP_8OZ.dimensions);
  const rect = (u0: number, u1: number): DesignShape => ({
    subpaths: [[
      { u: u0, v: 0.2 }, { u: u1, v: 0.2 }, { u: u1, v: 0.8 }, { u: u0, v: 0.8 },
    ]],
    fill: [0, 0, 0],
    opacity: 1,
  });

  it('emits one copy, not three, when it already spans the wrap', () => {
    expect(warpShapeWrapped(rect(-0.06, 1.06), geom)).toHaveLength(1);
    expect(warpShapeWrapped(rect(0, 1), geom)).toHaveLength(1);
  });

  it('still emits the seam copies for a shape narrower than the wrap', () => {
    // Straddling u = 0: it has to appear at both edges.
    expect(warpShapeWrapped(rect(-0.1, 0.1), geom).length).toBeGreaterThan(1);
  });
});
