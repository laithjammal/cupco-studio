import { describe, it, expect } from 'vitest';
import { strokeSubpath } from '../src/stroke';
import { shapeArea } from '../src/place';

/**
 * Stroke outlining, checked by AREA.
 *
 * Area is the property that catches the mistakes that matter: a ring whose
 * hole is filled in, or a cap that bulges the wrong way. Both look plausible
 * as a list of points.
 */
describe('strokeSubpath', () => {
  const ring = (r: number, n = 256) => {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      pts.push({ x: r * Math.cos(t), y: r * Math.sin(t) });
    }
    return { points: pts, closed: true };
  };

  it('makes a hollow ring, not a filled disc', () => {
    const r = 40, w = 6;
    const out = strokeSubpath(ring(r), w);
    expect(out).toHaveLength(2);
    // The annulus, 2*pi*r*w - within the error of a 256-gon.
    expect(shapeArea(out.map((s) => s.points))).toBeCloseTo(2 * Math.PI * r * w, 0);
  });

  it('is hollow whichever way the path is wound', () => {
    const r = 40, w = 6;
    const cw = ring(r);
    cw.points.reverse();
    expect(shapeArea(strokeSubpath(cw, w).map((s) => s.points)))
      .toBeCloseTo(2 * Math.PI * r * w, 0);
  });

  it('caps both ends outwards', () => {
    // Both caps bulging out adds a full disc of area. The bug they had was
    // one bulging out and one in, which cancels to exactly length * width and
    // looks entirely reasonable until you measure it.
    const len = 100, w = 6;
    const out = strokeSubpath({ points: [{ x: 0, y: 0 }, { x: len, y: 0 }], closed: false }, w);
    expect(out).toHaveLength(1);
    const expected = len * w + Math.PI * (w / 2) ** 2;
    const got = shapeArea(out.map((s) => s.points));
    expect(got).toBeGreaterThan(len * w);
    // Within 0.5%: the caps are polygons, so they fall a shade under a circle.
    expect(Math.abs(got - expected) / expected).toBeLessThan(0.005);
  });

  it('scales with the stroke width', () => {
    const a = shapeArea(strokeSubpath({ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], closed: false }, 2).map((s) => s.points));
    const b = shapeArea(strokeSubpath({ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], closed: false }, 4).map((s) => s.points));
    expect(b / a).toBeGreaterThan(1.9);
  });

  it('gives a dot for a zero-length path and nothing for zero width', () => {
    expect(strokeSubpath({ points: [{ x: 5, y: 5 }], closed: false }, 4)).toHaveLength(1);
    expect(strokeSubpath({ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], closed: false }, 0)).toHaveLength(0);
  });
});
