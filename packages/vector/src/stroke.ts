/**
 * Strokes converted to filled outlines.
 *
 * A stroke is a rendering instruction, not a shape: it has no area of its own,
 * and everything downstream of the importer - the fan warp, the CMYK palette,
 * the vector export - works on filled areas. So a stroked path either becomes
 * a filled outline here or it does not print at all.
 *
 * HOW: the area a pen sweeps is exactly the union of simple convex pieces -
 * one quadrilateral per segment, one wedge per corner, one cap per open end.
 * Each piece is trivially correct on its own, and a polygon union stitches
 * them into the outline. That makes every join and cap SVG defines (miter,
 * round, bevel; butt, round, square) exact, where the first version rounded
 * every corner whatever the file asked for - a stroked square came out with
 * soft corners - and drew every line end as a semicircle.
 *
 * Dashes are cut from the centreline BEFORE outlining, so each dash gets its
 * own caps - which is also how `stroke-dasharray="0 16"` with round caps makes
 * a line of dots.
 */

import type { Pt, SubPath } from './path-data';
import { Regions, signedArea, boxOf } from './svg/region';

export type LineJoin = 'miter' | 'round' | 'bevel';
export type LineCap = 'butt' | 'round' | 'square';

export interface StrokeStyle {
  width: number;
  join: LineJoin;
  cap: LineCap;
  /** SVG's stroke-miterlimit: beyond this ratio a miter becomes a bevel. */
  miterLimit: number;
  /** Maximum deviation of rounded joins and caps from a true circle. */
  tolerance?: number;
}

/** Points closer together than this are the same point. */
const EPS = 1e-9;

function dedupe(points: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > EPS) out.push({ x: p.x, y: p.y });
  }
  return out;
}

/** Segments for a half turn of a circle of radius r. */
function halfTurnSteps(r: number, tol?: number): number {
  if (!tol || tol >= r) return 8;
  const step = 2 * Math.acos(1 - tol / r);
  return Math.max(4, Math.min(64, Math.ceil(Math.PI / step)));
}

function norm(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

/** A fan from the centre along an arc. `via` names the direction to pass through. */
function fan(c: Pt, r: number, a0: number, a1: number, via: number | null, tol?: number): Pt[] {
  const sweep = via === null ? norm(a1 - a0) : norm(via - a0) + norm(a1 - via);
  const steps = Math.max(1, Math.ceil((Math.abs(sweep) / Math.PI) * halfTurnSteps(r, tol)));
  const out: Pt[] = [c];
  for (let i = 0; i <= steps; i++) {
    const t = a0 + (sweep * i) / steps;
    out.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
  }
  return out;
}

function disc(c: Pt, r: number, tol?: number): Pt[] {
  const steps = 2 * halfTurnSteps(r, tol);
  const out: Pt[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    out.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
  }
  return out;
}

const angle = (v: Pt) => Math.atan2(v.y, v.x);

/**
 * The convex pieces whose union is one stroked subpath, in its own units.
 *
 * Exported for testing; strokeOutline is what callers want.
 */
export function strokePieces(sp: SubPath, s: StrokeStyle): Pt[][] {
  const h = s.width / 2;
  if (!(h > 0)) return [];
  const pts = dedupe(sp.points);
  if (sp.closed && pts.length > 1) {
    const a = pts[0]!, b = pts[pts.length - 1]!;
    if (Math.hypot(a.x - b.x, a.y - b.y) <= EPS) pts.pop();
  }
  if (pts.length === 0) return [];

  // Zero-length: nothing for a butt cap, a dot or a square for the others.
  if (pts.length === 1) {
    const p = pts[0]!;
    if (s.cap === 'round') return [disc(p, h, s.tolerance)];
    if (s.cap === 'square') return [[{ x: p.x - h, y: p.y - h }, { x: p.x + h, y: p.y - h }, { x: p.x + h, y: p.y + h }, { x: p.x - h, y: p.y + h }]];
    return [];
  }

  const closed = sp.closed && pts.length >= 2;
  const n = pts.length;
  const segCount = closed ? n : n - 1;
  const dirs: Pt[] = [];
  for (let i = 0; i < segCount; i++) {
    const a = pts[i]!, b = pts[(i + 1) % n]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    dirs.push({ x: (b.x - a.x) / len, y: (b.y - a.y) / len });
  }
  const left = (d: Pt): Pt => ({ x: -d.y, y: d.x });
  const pieces: Pt[][] = [];

  // One quadrilateral per segment.
  for (let i = 0; i < segCount; i++) {
    const a = pts[i]!, b = pts[(i + 1) % n]!, nl = left(dirs[i]!);
    pieces.push([
      { x: a.x + nl.x * h, y: a.y + nl.y * h }, { x: b.x + nl.x * h, y: b.y + nl.y * h },
      { x: b.x - nl.x * h, y: b.y - nl.y * h }, { x: a.x - nl.x * h, y: a.y - nl.y * h },
    ]);
  }

  // One wedge per corner, on its outer side.
  const joinAt = (v: Pt, d1: Pt, d2: Pt) => {
    const cross = d1.x * d2.y - d1.y * d2.x;
    const dot = d1.x * d2.x + d1.y * d2.y;
    if (Math.abs(cross) < 1e-12 && dot > 0) return; // straight on: nothing to fill
    const side = cross > 0 ? -1 : 1;
    const n1 = left(d1), n2 = left(d2);
    const A = { x: v.x + side * n1.x * h, y: v.y + side * n1.y * h };
    const B = { x: v.x + side * n2.x * h, y: v.y + side * n2.y * h };
    // The wedge is anchored half a stroke INSIDE the corner rather than at the
    // corner itself. Anchored exactly at the vertex, its sides only touch the
    // two segment pieces along a line through that point - a T-junction - and
    // once coordinates are rounded to integers the union cannot always see
    // that they touch, leaving the wedge as a detached island. Overlapping
    // them instead makes the merge unconditional.
    const bx0 = n1.x + n2.x, by0 = n1.y + n2.y, bl0 = Math.hypot(bx0, by0);
    const anchor = bl0 > 1e-9
      ? { x: v.x - side * (bx0 / bl0) * h * 0.5, y: v.y - side * (by0 / bl0) * h * 0.5 }
      : { x: v.x - d1.x * h * 0.5, y: v.y - d1.y * h * 0.5 };
    if (s.join === 'round') {
      // A U-turn has no "short way round"; it goes round the outside, which is
      // the direction of travel.
      const via = dot < -1 + 1e-9 ? angle(d1) : null;
      const arc = fan(v, h, angle({ x: A.x - v.x, y: A.y - v.y }), angle({ x: B.x - v.x, y: B.y - v.y }), via, s.tolerance);
      arc[0] = anchor;
      pieces.push(arc);
      return;
    }
    if (s.join === 'miter') {
      const turn = Math.acos(Math.max(-1, Math.min(1, dot)));
      const ratio = 1 / Math.cos(turn / 2);
      if (Number.isFinite(ratio) && ratio <= s.miterLimit) {
        const bx = side * (n1.x + n2.x), by = side * (n1.y + n2.y);
        const bl = Math.hypot(bx, by);
        if (bl > EPS) {
          const tip = { x: v.x + (bx / bl) * h * ratio, y: v.y + (by / bl) * h * ratio };
          pieces.push([anchor, A, tip, B]);
          return;
        }
      }
    }
    pieces.push([anchor, A, B]); // bevel, and any miter over its limit
  };
  if (closed) {
    for (let i = 0; i < n; i++) joinAt(pts[i]!, dirs[(i - 1 + segCount) % segCount]!, dirs[i]!);
  } else {
    for (let i = 1; i < n - 1; i++) joinAt(pts[i]!, dirs[i - 1]!, dirs[i]!);
    // Caps.
    // Caps reach half a stroke back into their segment for the same reason
    // the corner wedges do: overlapping, not merely touching.
    const capAt = (p: Pt, outward: Pt) => {
      const nl = left(outward);
      const back = { x: p.x - outward.x * h * 0.5, y: p.y - outward.y * h * 0.5 };
      if (s.cap === 'round') {
        const arc = fan(p, h, angle(nl), angle({ x: -nl.x, y: -nl.y }), angle(outward), s.tolerance);
        arc[0] = back;
        pieces.push(arc);
      } else if (s.cap === 'square') {
        pieces.push([
          { x: back.x + nl.x * h, y: back.y + nl.y * h },
          { x: p.x + nl.x * h + outward.x * h, y: p.y + nl.y * h + outward.y * h },
          { x: p.x - nl.x * h + outward.x * h, y: p.y - nl.y * h + outward.y * h },
          { x: back.x - nl.x * h, y: back.y - nl.y * h },
        ]);
      }
    };
    const d0 = dirs[0]!, dn = dirs[segCount - 1]!;
    capAt(pts[0]!, { x: -d0.x, y: -d0.y });
    capAt(pts[n - 1]!, dn);
  }
  return pieces;
}

/**
 * Cut a dash pattern out of the centreline.
 *
 * An odd-length pattern is repeated, as SVG specifies; a pattern with any
 * negative value or that sums to zero means a solid line. Zero-length dashes
 * are kept as zero-length subpaths so their caps still draw.
 */
export function dashSubpaths(subpaths: readonly SubPath[], pattern: readonly number[], offset: number): SubPath[] {
  if (pattern.length === 0 || pattern.some((v) => !(v >= 0))) return [...subpaths];
  const pat = pattern.length % 2 ? [...pattern, ...pattern] : [...pattern];
  const total = pat.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return [...subpaths];

  const out: SubPath[] = [];
  for (const sp of subpaths) {
    const pts = dedupe(sp.points);
    if (sp.closed && pts.length > 1) {
      const a = pts[0]!, b = pts[pts.length - 1]!;
      if (Math.hypot(a.x - b.x, a.y - b.y) > EPS) pts.push({ ...a });
    }
    if (pts.length < 2) { out.push(sp); continue; }

    let phase = ((offset % total) + total) % total;
    let idx = 0;
    // Skip whole elements the offset has passed. A zero-length element AT the
    // phase is not passed - it is a dash that starts and ends right here.
    while (phase > pat[idx]! || (phase === pat[idx]! && pat[idx]! > 0)) {
      phase -= pat[idx]!;
      idx = (idx + 1) % pat.length;
    }
    let remaining = pat[idx]! - phase;
    let on = idx % 2 === 0;
    let current: Pt[] = on ? [{ ...pts[0]! }] : [];

    // Walk the centreline. Each pattern element either runs past the end of
    // the current segment, or ends inside it - at which point the next
    // element starts. A zero-length element ends where it starts, which is
    // exactly the zero-length dash a round cap turns into a dot.
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!, b = pts[i + 1]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      let t = 0;
      for (;;) {
        if (remaining > len - t) {
          remaining -= len - t;
          if (on) current.push({ ...b });
          break;
        }
        t += remaining;
        const p = { x: a.x + ((b.x - a.x) * t) / len, y: a.y + ((b.y - a.y) * t) / len };
        if (on) {
          current.push(p);
          out.push({ points: current, closed: false });
        }
        idx = (idx + 1) % pat.length;
        remaining = pat[idx]!;
        on = !on;
        current = on ? [{ ...p }] : [];
      }
    }
    if (on && current.length > 1) out.push({ points: current, closed: false });
  }
  return out;
}

/** Make a piece wind positively, so a NonZero union adds pieces instead of cancelling them. */
function orient(r: Pt[]): Pt[] {
  return signedArea(r) < 0 ? [...r].reverse() : r;
}

/**
 * The filled outline of a stroke, as clean rings.
 *
 * `map` carries pieces into the coordinate space the union should happen in -
 * the importer outlines in the element's own units (that is what the stroke
 * width is measured in) and unions in document units.
 */
export function strokeOutline(
  subpaths: readonly SubPath[],
  style: StrokeStyle,
  regions: Regions,
  map: (p: Pt) => Pt = (p) => p,
): Pt[][] {
  const pieces: Pt[][] = [];
  for (const sp of subpaths) {
    for (const piece of strokePieces(sp, style)) {
      if (piece.length >= 3) pieces.push(orient(piece.map(map)));
    }
  }
  return regions.unionPieces(pieces);
}

/* ---------------------------- earlier API --------------------------------- */

const ROUND: Omit<StrokeStyle, 'width'> = { join: 'round', cap: 'round', miterLimit: 4 };

function regionsFor(subpaths: readonly SubPath[], width: number): Regions {
  const b = boxOf(subpaths.map((s) => s.points));
  const size = b ? Math.max(b.x1 - b.x0, b.y1 - b.y0) + width * 2 : 1;
  return new Regions(size || 1);
}

/**
 * The filled outline of one stroked subpath, with round joins and caps.
 *
 * A closed subpath comes back as a ring - an outer boundary and a hole - and
 * an open one as a single loop.
 */
export function strokeSubpath(sp: SubPath, width: number): SubPath[] {
  if (!(width > 0)) return [];
  return strokeOutline([sp], { ...ROUND, width }, regionsFor([sp], width))
    .map((points) => ({ points, closed: true }));
}

/** The filled outline of a whole stroked shape, round joins and caps. */
export function strokeToSubpaths(subpaths: readonly SubPath[], width: number): SubPath[] {
  if (!(width > 0)) return [];
  return strokeOutline(subpaths, { ...ROUND, width }, regionsFor(subpaths, width))
    .map((points) => ({ points, closed: true }));
}
