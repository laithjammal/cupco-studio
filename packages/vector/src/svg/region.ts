/**
 * Boolean operations on filled regions: the machinery behind clip paths,
 * masks, gradient bands and stroke outlines.
 *
 * Built on Clipper 6 (clipper-lib), which works in integers - so coordinates
 * are scaled by a per-document factor on the way in and back out. The factor
 * puts the document at about 1e5 units across: a resolution of a
 * hundred-thousandth of the artwork, with every intermediate product far
 * inside the range a JavaScript number holds exactly.
 *
 * WHY THIS LIBRARY. The first choice was clipper2-js, a newer port, and it
 * silently loses area: a stroke built from 70 overlapping pieces came back
 * 1.2% short, as 40 rings where there should be one, with wedge-shaped
 * notches cut into the line. Measured against a grid-sampled ground truth,
 * clipper-lib matches to within 0.01% on every join and cap - so it is used,
 * and the stroke tests check area to hold it there.
 */

import ClipperLib from 'clipper-lib';

export interface Pt { x: number; y: number }
/** A closed ring. The closing point is implied, not repeated. */
export type Ring = Pt[];

export type Rule = 'nonzero' | 'evenodd';

type IntPath = { X: number; Y: number }[];

export class Regions {
  /** Document units -> integer units. */
  readonly k: number;
  /** Rings smaller than this (document units squared) are rounding debris. */
  private readonly minArea: number;

  constructor(documentSize: number) {
    const size = Math.max(1e-6, documentSize);
    this.k = 1e5 / size;
    // A ring under 1/2000 of the document across - 0.03mm on a 60mm logo -
    // is integer-rounding debris, not artwork.
    this.minArea = (size / 2000) ** 2;
  }

  private toPaths(rings: readonly Ring[]): IntPath[] {
    const out: IntPath[] = [];
    for (const r of rings) {
      if (r.length < 3) continue;
      out.push(r.map((q) => ({ X: Math.round(q.x * this.k), Y: Math.round(q.y * this.k) })));
    }
    return out;
  }

  private fromPaths(paths: IntPath[]): Ring[] {
    const out: Ring[] = [];
    for (const p of paths) {
      if (p.length < 3) continue;
      const ring = p.map((q) => ({ x: q.X / this.k, y: q.Y / this.k }));
      if (Math.abs(signedArea(ring)) >= this.minArea) out.push(ring);
    }
    return out;
  }

  private run(
    type: number, subject: readonly Ring[], clip: readonly Ring[] | null, rule: number,
  ): Ring[] {
    const c = new ClipperLib.Clipper();
    c.AddPaths(this.toPaths(subject), ClipperLib.PolyType.ptSubject, true);
    if (clip) c.AddPaths(this.toPaths(clip), ClipperLib.PolyType.ptClip, true);
    const solution: IntPath[] = [];
    c.Execute(type, solution, rule, rule);
    return this.fromPaths(solution);
  }

  /**
   * Resolve a set of rings under a fill rule into clean, non-overlapping
   * polygons - outers and holes, consistently wound.
   */
  clean(rings: readonly Ring[], rule: Rule): Ring[] {
    if (rings.length === 0) return [];
    return this.run(ClipperLib.ClipType.ctUnion, rings, null,
      rule === 'evenodd' ? ClipperLib.PolyFillType.pftEvenOdd : ClipperLib.PolyFillType.pftNonZero);
  }

  /** a AND b. Both must already be clean. */
  intersect(a: readonly Ring[], b: readonly Ring[]): Ring[] {
    if (a.length === 0 || b.length === 0) return [];
    return this.run(ClipperLib.ClipType.ctIntersection, a, b, ClipperLib.PolyFillType.pftNonZero);
  }

  /** a AND NOT b. Both must already be clean. */
  subtract(a: readonly Ring[], b: readonly Ring[]): Ring[] {
    if (a.length === 0) return [];
    if (b.length === 0) return [...a];
    return this.run(ClipperLib.ClipType.ctDifference, a, b, ClipperLib.PolyFillType.pftNonZero);
  }

  /**
   * Union of many pieces, all wound the same way. How a stroke becomes one
   * outline: every segment, join and cap is a convex piece, and their union
   * is exactly the area a pen of that width sweeps.
   */
  unionPieces(pieces: readonly Ring[]): Ring[] {
    if (pieces.length === 0) return [];
    return this.run(ClipperLib.ClipType.ctUnion, pieces, null, ClipperLib.PolyFillType.pftNonZero);
  }

  /** Total area, holes subtracted. */
  area(rings: readonly Ring[]): number {
    let a = 0;
    for (const r of rings) a += signedArea(r);
    return Math.abs(a);
  }
}

export function signedArea(r: readonly Pt[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    a += (r[j]!.x + r[i]!.x) * (r[j]!.y - r[i]!.y);
  }
  return a / 2;
}

export interface Box { x0: number; y0: number; x1: number; y1: number }

export function boxOf(rings: readonly (readonly Pt[])[]): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) {
    for (const p of r) {
      if (p.x < x0) x0 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x;
      if (p.y > y1) y1 = p.y;
    }
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

export const rectRing = (x: number, y: number, w: number, h: number): Ring =>
  [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

/** Is box `a` entirely inside box `b`? */
export function boxWithin(a: Box, b: Box): boolean {
  return a.x0 >= b.x0 && a.y0 >= b.y0 && a.x1 <= b.x1 && a.y1 <= b.y1;
}
