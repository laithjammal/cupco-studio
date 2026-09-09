/**
 * Strokes converted to filled outlines.
 *
 * A stroke is a rendering instruction, not a shape: it has no area of its own,
 * and everything downstream of the importer - the fan warp, the CMYK palette,
 * the vector export - works on filled areas. So a stroked path either becomes
 * a filled outline here or it does not print at all.
 *
 * It used to not print at all. A line-art logo - a monogram in an outlined
 * circle, which is a very ordinary way to draw a cafe mark - arrived with
 * every stroked element missing and no warning to say so.
 *
 * The outline is built by offsetting the polyline by half the stroke width on
 * each side. Joins and caps are rounded regardless of what the file asked for:
 * a round join is never wrong by more than half a stroke width, whereas a
 * mitre computed badly spikes off to infinity on a shallow angle. At the sizes
 * a cup prints, that difference is invisible; a spike is not.
 */

import type { Pt, SubPath } from './path-data';

/** Points closer together than this are the same point. */
const EPS = 1e-9;

/** Segments per half-turn when rounding a join or a cap. */
const ARC_STEPS = 8;

function dedupe(points: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > EPS) out.push({ x: p.x, y: p.y });
  }
  return out;
}

/** Twice the signed area. Positive and negative are orientations, not sizes. */
function signedArea(points: readonly Pt[]): number {
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    a += (points[j]!.x + points[i]!.x) * (points[j]!.y - points[i]!.y);
  }
  return a / 2;
}

/** An angle difference brought into (-pi, pi]. */
function norm(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x <= -Math.PI) x += Math.PI * 2;
  return x;
}

/** Points along an arc of the given total sweep, endpoints excluded. */
function arcPoints(cx: number, cy: number, r: number, a0: number, sweep: number): Pt[] {
  const steps = Math.max(1, Math.ceil((Math.abs(sweep) / Math.PI) * ARC_STEPS));
  const out: Pt[] = [];
  for (let i = 1; i < steps; i++) {
    const t = a0 + (sweep * i) / steps;
    out.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  }
  return out;
}

/** Arc from a0 to a1 about a centre, taking the short way round. */
function arc(cx: number, cy: number, r: number, a0: number, a1: number): Pt[] {
  return arcPoints(cx, cy, r, a0, norm(a1 - a0));
}

/**
 * Arc from a0 to a1 that passes through `via`.
 *
 * A cap turns through half a circle exactly, and at exactly half a turn the
 * short way round is a coin toss - the two ends of a straight line came out
 * bulging in opposite directions, one cap adding area and the other removing
 * the same amount. Naming the direction the arc must pass through settles it.
 */
function arcVia(cx: number, cy: number, r: number, a0: number, a1: number, via: number): Pt[] {
  const sweep = norm(via - a0) + norm(a1 - via);
  return arcPoints(cx, cy, r, a0, sweep);
}

/**
 * One side of an offset polyline.
 *
 * Walks the segments offsetting each by `h` along its left normal, rounding
 * the corner between consecutive segments. The rounding is emitted on both the
 * convex and the concave side: on the concave side it self-overlaps slightly,
 * which a non-zero fill absorbs, and that is far cheaper than the intersection
 * tests a tight join would need.
 */
function offsetSide(points: readonly Pt[], h: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!, b = points[i + 1]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len <= EPS) continue;
    const nx = -dy / len, ny = dx / len;
    const from = { x: a.x + nx * h, y: a.y + ny * h };
    const to = { x: b.x + nx * h, y: b.y + ny * h };
    if (out.length > 0) {
      // Round the corner about the vertex we are leaving.
      const prev = out[out.length - 1]!;
      out.push(...arc(a.x, a.y, Math.abs(h),
        Math.atan2(prev.y - a.y, prev.x - a.x),
        Math.atan2(from.y - a.y, from.x - a.x)));
    }
    out.push(from, to);
  }
  return out;
}

/** A full circle, used for a round cap on a degenerate path. */
function disc(c: Pt, r: number): SubPath {
  const pts: Pt[] = [];
  const steps = ARC_STEPS * 2;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    pts.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
  }
  return { points: pts, closed: true };
}

/**
 * The filled outline of one stroked subpath.
 *
 * A closed subpath becomes a ring: an outer boundary and an inner one wound
 * the opposite way, so a non-zero fill leaves the middle empty rather than
 * flooding it. An open one becomes a single loop up one side and back the
 * other, with a round cap at each end.
 */
export function strokeSubpath(sp: SubPath, width: number): SubPath[] {
  const h = width / 2;
  if (!(h > 0)) return [];

  let pts = dedupe(sp.points);

  // A closed subpath may or may not repeat its first point; normalise to not.
  if (sp.closed && pts.length > 1) {
    const first = pts[0]!, last = pts[pts.length - 1]!;
    if (Math.hypot(first.x - last.x, first.y - last.y) <= EPS) pts.pop();
  }

  if (pts.length === 0) return [];
  if (pts.length === 1) return [disc(pts[0]!, h)];

  if (sp.closed) {
    if (pts.length < 3) return strokeSubpath({ points: pts, closed: false }, width);
    const ring = [...pts, pts[0]!, pts[1]!];
    // Which offset points outwards depends on the winding, so read it off the
    // path rather than assuming a direction.
    const outward = signedArea(pts) > 0 ? h : -h;
    const outer = offsetSide(ring, outward);
    const inner = offsetSide(ring, -outward);
    return [
      { points: outer, closed: true },
      // Reversed, so the two boundaries wind oppositely and the ring is hollow.
      { points: inner.reverse(), closed: true },
    ];
  }

  const forward = offsetSide(pts, h);
  const backward = offsetSide([...pts].reverse(), h);
  if (forward.length === 0 || backward.length === 0) return [];

  const start = pts[0]!;
  const end = pts[pts.length - 1]!;
  const angleAt = (c: Pt, p: Pt) => Math.atan2(p.y - c.y, p.x - c.x);
  // A cap bulges AWAY from the path, so each one is steered through the
  // direction the path is travelling as it arrives at that end.
  const outAtEnd = (() => {
    const a = pts[pts.length - 2]!;
    return Math.atan2(end.y - a.y, end.x - a.x);
  })();
  const outAtStart = (() => {
    const b = pts[1]!;
    return Math.atan2(start.y - b.y, start.x - b.x);
  })();

  const loop = [
    ...forward,
    ...arcVia(end.x, end.y, h,
      angleAt(end, forward[forward.length - 1]!), angleAt(end, backward[0]!), outAtEnd),
    ...backward,
    ...arcVia(start.x, start.y, h,
      angleAt(start, backward[backward.length - 1]!), angleAt(start, forward[0]!), outAtStart),
  ];
  return [{ points: loop, closed: true }];
}

/** The filled outline of a whole stroked shape. */
export function strokeToSubpaths(subpaths: readonly SubPath[], width: number): SubPath[] {
  const out: SubPath[] = [];
  for (const sp of subpaths) out.push(...strokeSubpath(sp, width));
  return out;
}
