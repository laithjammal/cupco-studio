/**
 * Gradients, as real vector geometry.
 *
 * Everything downstream - the fan warp, the CMYK palette, the vector PDF -
 * works on flat-filled shapes. A gradient used to be "flattened": a linear
 * fade from red to green became one grey rectangle. Now the shape is cut into
 * bands, each a solid colour sampled from the gradient. Bands are fine enough
 * that neighbouring colours differ by a few levels per channel - below what
 * the eye resolves - and because each band is ordinary geometry, the gradient
 * warps onto the fan exactly like everything else and prints as CMYK paths.
 *
 * Linear bands are strips perpendicular to the gradient vector; radial bands
 * are annuli between the gradient's interpolated circles, which handles an
 * off-centre focal point exactly. pad, reflect and repeat are all honoured.
 */

import type { RGB } from '../color';
import { Regions, boxOf, type Ring, type Pt } from './region';
import { apply, invert, mul, scaleOf, type Mat } from './values';

export interface Stop { offset: number; rgb: RGB; alpha: number }

export interface Gradient {
  geometry:
    | { kind: 'linear'; x1: number; y1: number; x2: number; y2: number }
    | { kind: 'radial'; cx: number; cy: number; r: number; fx: number; fy: number; fr: number };
  /** gradientUnits="objectBoundingBox". */
  bboxUnits: boolean;
  gradientTransform: Mat;
  spread: 'pad' | 'reflect' | 'repeat';
  stops: Stop[];
}

export interface Band { rings: Ring[]; rgb: RGB; alpha: number }

/** Largest per-channel step between neighbouring bands, out of 255. */
const STEP = 4;
const MAX_BANDS = 320;

function sample(stops: readonly Stop[], t: number): { rgb: RGB; alpha: number } {
  const first = stops[0]!, last = stops[stops.length - 1]!;
  if (t <= first.offset) return first;
  if (t >= last.offset) return last;
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i]!, b = stops[i + 1]!;
    if (t >= a.offset && t <= b.offset) {
      if (b.offset - a.offset < 1e-9) return b;
      const f = (t - a.offset) / (b.offset - a.offset);
      return {
        rgb: [0, 1, 2].map((k) => Math.round(a.rgb[k]! + (b.rgb[k]! - a.rgb[k]!) * f)) as unknown as RGB,
        alpha: a.alpha + (b.alpha - a.alpha) * f,
      };
    }
  }
  return last;
}

function spreadT(t: number, spread: Gradient['spread']): number {
  if (spread === 'pad') return Math.max(0, Math.min(1, t));
  if (spread === 'repeat') return t - Math.floor(t);
  const m = ((t % 2) + 2) % 2;
  return m > 1 ? 2 - m : m;
}

/**
 * Split [t0, t1] into intervals of near-constant colour.
 *
 * Breakpoints fall on every stop (in every repeated or reflected period), and
 * each stretch between breakpoints is subdivided by how far its colour moves.
 * Regions where the colour cannot change - the padded ends - stay one band.
 */
function intervals(g: Gradient, t0: number, t1: number): { a: number; b: number; rgb: RGB; alpha: number }[] {
  const cuts = new Set<number>([t0, t1]);
  if (g.spread === 'pad') {
    for (const s of g.stops) if (s.offset > t0 && s.offset < t1) cuts.add(s.offset);
    if (t0 < 0 && t1 > 0) cuts.add(0);
    if (t0 < 1 && t1 > 1) cuts.add(1);
  } else {
    for (let k = Math.floor(t0); k <= Math.ceil(t1); k++) {
      for (const s of g.stops) {
        for (const t of [k + s.offset, k + 1 - s.offset]) if (t > t0 && t < t1) cuts.add(t);
      }
      if (k > t0 && k < t1) cuts.add(k);
    }
  }
  const pts = [...cuts].sort((x, y) => x - y);

  // How many bands each stretch needs, before any capping.
  const stretches = [];
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    if (b - a < 1e-12) continue;
    const ca = sample(g.stops, spreadT(a + 1e-9, g.spread));
    const cb = sample(g.stops, spreadT(b - 1e-9, g.spread));
    const diff = Math.max(
      ...[0, 1, 2].map((k) => Math.abs(ca.rgb[k]! - cb.rgb[k]!)),
      Math.abs(ca.alpha - cb.alpha) * 255,
    );
    const n = Math.max(1, Math.ceil(diff / STEP));
    stretches.push({ a, b, n });
    total += n;
  }
  const scale = total > MAX_BANDS ? MAX_BANDS / total : 1;

  const out: { a: number; b: number; rgb: RGB; alpha: number }[] = [];
  for (const s of stretches) {
    const n = Math.max(1, Math.round(s.n * scale));
    for (let i = 0; i < n; i++) {
      const a = s.a + ((s.b - s.a) * i) / n;
      const b = s.a + ((s.b - s.a) * (i + 1)) / n;
      const c = sample(g.stops, spreadT((a + b) / 2, g.spread));
      const prev = out[out.length - 1];
      if (prev && prev.rgb.every((v, k) => v === c.rgb[k]) && Math.abs(prev.alpha - c.alpha) < 1e-3) prev.b = b;
      else out.push({ a, b, rgb: c.rgb, alpha: c.alpha });
    }
  }
  return out;
}

export interface BandContext {
  regions: Regions;
  /** Curve tolerance in document units. */
  tolerance: number;
  /**
   * Overlap the bands instead of tiling them. Each band then extends beneath
   * its neighbour, so no shared edge is ever antialiased against whatever is
   * behind the shape - tiled bands let the background bleed through every
   * seam, which shows as hairlines and, over a dark shape, as a gradient that
   * looks half transparent. Only valid when every band is fully opaque: with
   * any transparency, the overlaps would show.
   */
  layered?: boolean;
}

/**
 * Cut a region into gradient bands.
 *
 * `region` is clean and in document units. `localToDoc` maps the painted
 * element's user space into the document; `bbox` is the element's bounding
 * box in that user space, which objectBoundingBox gradients are measured in.
 */
export function gradientBands(
  g: Gradient,
  region: readonly Ring[],
  bbox: { x: number; y: number; w: number; h: number },
  localToDoc: Mat,
  bc: BandContext,
): Band[] {
  if (g.stops.length === 0 || region.length === 0) return [];
  if (g.stops.length === 1) return [{ rings: [...region], ...g.stops[0]! }];
  if (g.bboxUnits && (!(bbox.w > 0) || !(bbox.h > 0))) return [];

  const units: Mat = g.bboxUnits ? [bbox.w, 0, 0, bbox.h, bbox.x, bbox.y] : [1, 0, 0, 1, 0, 0];
  const G = mul(mul(localToDoc, units), g.gradientTransform);
  const Gi = invert(G);
  if (!Gi) return [];
  const box = boxOf(region);
  if (!box) return [];
  const corners = [
    { x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 },
    { x: box.x1, y: box.y1 }, { x: box.x0, y: box.y1 },
  ].map((p) => apply(Gi, p));
  const toDoc = (pts: Pt[]): Ring => pts.map((p) => apply(G, p));
  const { regions } = bc;

  if (g.geometry.kind === 'linear') {
    const { x1, y1, x2, y2 } = g.geometry;
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    // A zero-length vector paints the area in the last stop's colour.
    if (len2 < 1e-18) return [{ rings: [...region], ...g.stops[g.stops.length - 1]! }];
    const len = Math.sqrt(len2);
    const ux = -dy / len, uy = dx / len;
    const ts = corners.map((c) => ((c.x - x1) * dx + (c.y - y1) * dy) / len2);
    const reach = Math.max(...corners.map((c) => Math.abs((c.x - x1) * ux + (c.y - y1) * uy))) * 1.05 + 1e-6;
    const tMin = Math.min(...ts), tMax = Math.max(...ts);
    const pad = (tMax - tMin) * 1e-3 + 1e-9;

    const bands: Band[] = [];
    const ivs = intervals(g, tMin - pad, tMax + pad);
    const far = ivs.length ? ivs[ivs.length - 1]!.b : tMax + pad;
    for (const iv of ivs) {
      const a = { x: x1 + dx * iv.a, y: y1 + dy * iv.a };
      const end = bc.layered ? far : iv.b;
      const b = { x: x1 + dx * end, y: y1 + dy * end };
      const strip = toDoc([
        { x: a.x + ux * reach, y: a.y + uy * reach }, { x: b.x + ux * reach, y: b.y + uy * reach },
        { x: b.x - ux * reach, y: b.y - uy * reach }, { x: a.x - ux * reach, y: a.y - uy * reach },
      ]);
      const rings = regions.intersect(region, regions.clean([strip], 'nonzero'));
      if (rings.length) bands.push({ rings, rgb: iv.rgb, alpha: iv.alpha });
    }
    return bands;
  }

  // Radial: circles C(t) with centre f + (c - f) t and radius fr + (r - fr) t.
  let { cx, cy, r, fx, fy, fr } = g.geometry;
  if (!(r > 0)) return [{ rings: [...region], ...g.stops[g.stops.length - 1]! }];
  fr = Math.max(0, Math.min(fr, r * 0.999));
  // SVG 1.1: a focal point outside the end circle is pulled onto it.
  const fd = Math.hypot(fx - cx, fy - cy);
  const maxFd = (r - fr) * 0.999;
  if (fd > maxFd) { fx = cx + ((fx - cx) / fd) * maxFd; fy = cy + ((fy - cy) / fd) * maxFd; }
  const ddx = cx - fx, ddy = cy - fy, dr = r - fr;
  const centre = (t: number) => ({ x: fx + ddx * t, y: fy + ddy * t });
  const radius = (t: number) => fr + dr * t;

  // The t at which a circle first contains every corner of the region.
  const qa = ddx * ddx + ddy * ddy - dr * dr;
  let tEnd = 1;
  for (const q of corners) {
    const wx = q.x - fx, wy = q.y - fy;
    const qb = -2 * (wx * ddx + wy * ddy + fr * dr);
    const qc = wx * wx + wy * wy - fr * fr;
    const disc = qb * qb - 4 * qa * qc;
    if (disc >= 0 && qa !== 0) {
      const r1 = (-qb + Math.sqrt(disc)) / (2 * qa), r2 = (-qb - Math.sqrt(disc)) / (2 * qa);
      tEnd = Math.max(tEnd, r1, r2);
    }
  }
  tEnd *= 1.01;

  const circle = (t: number): Ring => {
    const c = centre(t), rad = Math.max(1e-9, radius(t));
    const docR = rad * scaleOf(G);
    const step = bc.tolerance < docR ? 2 * Math.acos(1 - bc.tolerance / docR) : Math.PI / 12;
    const n = Math.max(24, Math.min(360, Math.ceil((2 * Math.PI) / step)));
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI;
      pts.push({ x: c.x + rad * Math.cos(a), y: c.y + rad * Math.sin(a) });
    }
    return toDoc(pts);
  };
  const within = (t: number): Ring[] => regions.intersect(region, regions.clean([circle(t)], 'nonzero'));

  const span = g.spread === 'pad' ? Math.min(1, tEnd) : tEnd;
  const ivs = intervals(g, 0, span);

  if (bc.layered) {
    // Largest disc first; each smaller one paints over the middle of the last.
    const layers: Band[] = [];
    if (g.spread === 'pad' && tEnd > 1) layers.push({ rings: [...region], ...g.stops[g.stops.length - 1]! });
    for (let i = ivs.length - 1; i >= 0; i--) {
      const iv = ivs[i]!;
      const rings = iv.b >= tEnd ? [...region] : within(iv.b);
      if (rings.length) layers.push({ rings, rgb: iv.rgb, alpha: iv.alpha });
    }
    if (fr > 0) {
      const core = within(0);
      if (core.length) layers.push({ rings: core, ...sample(g.stops, 0) });
    }
    return layers;
  }

  const bands: Band[] = [];
  let inner: Ring[] = fr > 0 ? within(0) : [];
  if (inner.length) bands.push({ rings: inner, ...sample(g.stops, 0) });
  for (const iv of ivs) {
    const outer = within(iv.b);
    const rings = inner.length ? regions.subtract(outer, inner) : outer;
    if (rings.length) bands.push({ rings, rgb: iv.rgb, alpha: iv.alpha });
    inner = outer;
  }
  if (g.spread === 'pad' && tEnd > 1) {
    const rest = regions.subtract([...region], inner);
    if (rest.length) bands.push({ rings: rest, ...g.stops[g.stops.length - 1]! });
  }
  return bands;
}
