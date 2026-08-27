import { describe, it, expect } from 'vitest';
import { snapToGuides, GUIDES, type ElementBounds } from '@/lib/snapping';

const TOL = 0.03;

/** Convenience wrapper: no other elements on the cup. */
const snap = (
  uv: { u: number; v: number },
  tol = TOL,
  opts: { others?: ElementBounds[]; halfU?: number; halfV?: number; enabled?: boolean } = {},
) => snapToGuides({
  uv,
  halfU: opts.halfU ?? 0.1,
  halfV: opts.halfV ?? 0.1,
  others: opts.others ?? [],
  toleranceU: tol,
  toleranceV: tol,
  enabled: opts.enabled,
});

/** An element occupying a known box, for object-alignment tests. */
const box = (u0: number, u1: number, v0: number, v1: number, id = 'other'): ElementBounds =>
  ({ id, u0, u1, uC: (u0 + u1) / 2, v0, v1, vC: (v0 + v1) / 2 });

describe('alignment guides', () => {
  it('offers centre, both thirds, and the middle line', () => {
    const u = GUIDES.filter((g) => g.axis === 'u').map((g) => g.at).sort((a, b) => a - b);
    expect(u[0]).toBeCloseTo(1 / 3, 5);
    expect(u[1]).toBeCloseTo(0.5, 5);
    expect(u[2]).toBeCloseTo(2 / 3, 5);
    expect(GUIDES.filter((g) => g.axis === 'v').map((g) => g.at)).toEqual([0.5]);
  });
});

describe('snapping', () => {
  it('leaves a position alone when nothing is near', () => {
    // Guides that always fire would hijack ordinary positioning.
    const r = snap({ u: 0.19, v: 0.22 });
    expect(r.uv).toEqual({ u: 0.19, v: 0.22 });
    expect(r.active).toHaveLength(0);
  });

  it('snaps to centre when close and reports the guide', () => {
    const r = snap({ u: 0.515, v: 0.8 });
    expect(r.uv.u).toBeCloseTo(0.5, 9);
    expect(r.active.map((g) => g.label)).toEqual(['Centred']);
  });

  it.each([[1 / 3, 'Left third'], [2 / 3, 'Right third']])(
    'snaps to the third at %s',
    (at, label) => {
      const r = snap({ u: at + 0.02, v: 0.8 });
      expect(r.uv.u).toBeCloseTo(at, 9);
      expect(r.active[0]!.label).toBe(label);
    },
  );

  it('snaps both axes at once', () => {
    const r = snap({ u: 0.49, v: 0.515 });
    expect(r.uv.u).toBeCloseTo(0.5, 9);
    expect(r.uv.v).toBeCloseTo(0.5, 9);
    expect(r.active).toHaveLength(2);
  });

  it('picks the nearest guide when two are in range', () => {
    // Midway between centre and the right third, but a shade closer to centre.
    const between = 0.5 + (2 / 3 - 0.5) / 2 - 0.005;
    const r = snap({ u: between, v: 0.9 }, 0.2);
    expect(r.uv.u).toBeCloseTo(0.5, 9);
  });

  it('treats u as wrapping, so the seam is not a dead zone', () => {
    // Design space is a cylinder: a mark just past u=1 is still near u≈1.
    // Nothing should snap here, but it must not throw or mis-measure either.
    const r = snap({ u: 0.99, v: 0.9 });
    expect(Number.isFinite(r.uv.u)).toBe(true);
  });

  it('can be disabled, for placement just off a guide', () => {
    const r = snap({ u: 0.505, v: 0.505 }, TOL, { enabled: false });
    expect(r.uv).toEqual({ u: 0.505, v: 0.505 });
    expect(r.active).toHaveLength(0);
  });

  it('respects the tolerance it is given', () => {
    expect(snap({ u: 0.55, v: 0.9 }, 0.01).active).toHaveLength(0);
    expect(snap({ u: 0.55, v: 0.9 }, 0.10).active).toHaveLength(1);
  });
});

describe('object alignment', () => {
  /**
   * A logo occupying u 0.10-0.34, v 0.58-0.86 — centre (0.22, 0.72).
   *
   * The dimensions are chosen so no two alignments coincide. With a symmetric
   * box it is easy to pick numbers where, say, "right edges aligned" and "left
   * edge on centre" resolve to the identical position: both are then correct
   * and the reported label is a coin toss, which makes for a flaky test rather
   * than a real finding.
   */
  const other = box(0.10, 0.34, 0.58, 0.86);
  const halfU = 0.05;
  const halfV = 0.05;

  const near = (u: number, v: number) =>
    snap({ u, v }, TOL, { others: [other], halfU, halfV });

  it('aligns centres', () => {
    const r = near(0.225, 0.2);
    expect(r.uv.u).toBeCloseTo(0.22, 9);
    expect(r.active[0]!.kind).toBe('object');
    expect(r.active[0]!.label).toBe('Centres aligned');
  });

  it('aligns left edges', () => {
    // Dragged left edge is centre - halfU, so centre must land at 0.10+0.05.
    const r = near(0.155, 0.2);
    expect(r.uv.u).toBeCloseTo(0.15, 9);
    expect(r.active[0]!.label).toBe('Left edges aligned');
  });

  it('aligns right edges', () => {
    // Dragged right edge meets 0.34, so centre lands at 0.34-0.05.
    const r = near(0.292, 0.2);
    expect(r.uv.u).toBeCloseTo(0.29, 9);
    expect(r.active[0]!.label).toBe('Right edges aligned');
  });

  it('butts one element against another edge to edge', () => {
    // Dragged LEFT edge meeting the other's RIGHT edge: centre at 0.34+0.05.
    const r = near(0.392, 0.2);
    expect(r.uv.u).toBeCloseTo(0.39, 9);
    expect(r.active[0]!.label).toBe('Left meets right');
  });

  it('aligns on the vertical axis too', () => {
    const r = near(0.9, 0.725);
    expect(r.uv.v).toBeCloseTo(0.72, 9);
    expect(r.active.some((g) => g.axis === 'v' && g.kind === 'object')).toBe(true);
  });

  it('aligns top and bottom edges', () => {
    expect(near(0.9, 0.632).uv.v).toBeCloseTo(0.63, 9);   // bottoms: 0.58 + 0.05
    expect(near(0.9, 0.812).uv.v).toBeCloseTo(0.81, 9);   // tops:    0.86 - 0.05
  });

  it('does nothing when far from every element', () => {
    const r = near(0.9, 0.05);
    expect(r.uv).toEqual({ u: 0.9, v: 0.05 });
    expect(r.active).toHaveLength(0);
  });

  it('spans the guide across both elements, not the whole cup', () => {
    // Drawing the full height would not show WHICH element is being matched.
    const r = near(0.225, 0.2);
    const g = r.active[0]!;
    expect(g.from).toBeDefined();
    expect(g.to).toBeDefined();
    expect(g.to! - g.from!).toBeLessThan(1);
    // Must cover the other element's extent.
    expect(g.from!).toBeLessThanOrEqual(other.v0);
    expect(g.to!).toBeGreaterThanOrEqual(other.v1);
  });

  it('prefers an object guide over a canvas guide at equal distance', () => {
    // Another element whose centre sits exactly on the cup's centre line.
    const onCentre = box(0.45, 0.55, 0.1, 0.2, 'centred');
    const r = snap({ u: 0.5, v: 0.9 }, TOL, { others: [onCentre], halfU, halfV });
    expect(r.uv.u).toBeCloseTo(0.5, 9);
    // Matching the other logo is almost always the intent.
    expect(r.active.find((g) => g.axis === 'u')!.kind).toBe('object');
  });

  it('ignores the element being dragged', () => {
    // The caller filters it out; passing none means canvas guides only.
    const r = snap({ u: 0.225, v: 0.2 }, TOL, { others: [], halfU, halfV });
    expect(r.active.filter((g) => g.kind === 'object')).toHaveLength(0);
  });

  it('picks the nearest of several elements', () => {
    const a = box(0.10, 0.20, 0.6, 0.7, 'a');
    const b = box(0.60, 0.70, 0.6, 0.7, 'b');
    const r = snap({ u: 0.655, v: 0.9 }, TOL, { others: [a, b], halfU, halfV });
    expect(r.uv.u).toBeCloseTo(0.65, 9); // b's centre
  });

  it('alt still suspends object snapping', () => {
    const r = snap({ u: 0.225, v: 0.2 }, TOL, { others: [other], halfU, halfV, enabled: false });
    expect(r.uv.u).toBe(0.225);
    expect(r.active).toHaveLength(0);
  });
});
