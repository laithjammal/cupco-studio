'use client';

/**
 * Find the cup in a photograph, and fit the calibration to it.
 *
 * Dragging six handles onto a photo is fiddly and easy to get slightly wrong -
 * and slightly wrong is expensive here. Overshoot the silhouette and artwork
 * lands on the table; undershoot and a coloured design stops short of the
 * edge with a bare sliver of cup showing. Both look like a bad mockup rather
 * than a bad calibration, so neither gets diagnosed.
 *
 * HOW IT FINDS THE CUP
 * --------------------
 * Not by colour thresholds. A terrazzo counter is bright and neutral in
 * exactly the way a white cup is, so no absolute threshold separates them.
 * What does separate them is that a cup has EDGES: a strong, sustained
 * luminance step down each side, in the same place on row after row.
 *
 * So the search is:
 *
 *   1. the lid - a wide dark band - fixes the top of the wall and the centre
 *   2. from under it, walk outwards along each row to the first strong edge
 *   3. the base - the contact shadow straight down the centre
 *   4. fit each side by least median of squares, then fit the cup as a solid
 *      of revolution to whichever samples survived
 *   5. take the top edge from the LID's underside, measured across the cup
 *
 * It is a fit, not a certainty. The handles stay, and the operator can nudge.
 *
 * WHY THE TOP EDGE IS MEASURED SEPARATELY
 * ---------------------------------------
 * Because the wall does not start at one height. The lid's lower rim is a
 * circle seen at an angle, so it sits ~20px lower at the middle of the cup
 * than at its sides. Measuring that height down the centre column and then
 * using it for the CORNERS - which is what this did - puts the whole top edge
 * a lid's sag too low, and then `topBow` pushes the middle lower still,
 * counting the same sag twice. The symptom is a bare band under the lid,
 * widest exactly where the eye goes first.
 *
 * So the lid's underside is traced across the full width of the cup and fitted
 * as the arc it is. The corner heights and the bow then fall out of it
 * directly, and the sag is counted once.
 */

import { DEFAULT_VISIBLE_SPAN } from '@cupco/geometry';
import type { PlateCalibration } from '@cupco/geometry';

/** Width the search runs at. Detail beyond this only slows it down. */
const WORK_WIDTH = 420;

/** How far a side sample may sit from its fitted line and still be believed. */
const EDGE_TOLERANCE = 2;

/**
 * Steepest lean the axis may be given, as dx per dy.
 *
 * A cup on a table can lean a degree or two, and a camera that is not square
 * to it tilts the projected axis by about as much again. It cannot lean five
 * degrees, so this is a backstop against a fit that has gone wrong rather than
 * a modelling choice.
 */
const AXIS_MAX_SLOPE = 0.08;

/**
 * The luminance grid the whole search runs on.
 *
 * Kept free of the DOM so the fit can be exercised against a constructed cup
 * whose dimensions are known exactly, rather than only against photographs
 * whose answer has to be measured by hand first.
 */
export interface PlateGrid {
  w: number;
  h: number;
  lum: Float32Array;
  /** Source pixels per grid pixel. */
  scale: number;
}

export function toGrid(source: HTMLImageElement | HTMLCanvasElement): PlateGrid {
  const sw = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const sh = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const w = Math.min(WORK_WIDTH, sw);
  const h = Math.max(1, Math.round((sh * w) / sw));

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D context unavailable');
  ctx.drawImage(source, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;

  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    lum[i] = (0.2126 * d[i * 4]! + 0.7152 * d[i * 4 + 1]! + 0.0722 * d[i * 4 + 2]!) / 255;
  }
  return { w, h, lum, scale: sw / w };
}

const at = (g: PlateGrid, x: number, y: number) => g.lum[y * g.w + x] ?? 0;

interface Sample { x: number; y: number }
interface Line { a: number; b: number }
const valueAt = (line: Line, y: number) => line.a * y + line.b;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((m, n) => m - n);
  return s[Math.floor(s.length / 2)]!;
}

/**
 * The lid: a dark band with a BRIGHT CUP DIRECTLY BENEATH IT.
 *
 * Both halves of that matter. Picking the widest dark run alone finds the
 * cafe interior behind the counter, which in a real photograph is darker and
 * wider than any lid. What no other dark region has is a tall, uninterrupted
 * bright column immediately below it - that is the cup wall, and it is what
 * makes the lid identifiable rather than merely dark.
 */
function findLid(g: PlateGrid): { centre: number; bottom: number } | null {
  const wallLen = Math.round(g.h * 0.18);
  let best: { y: number; centre: number; score: number } | null = null;

  for (let y = Math.floor(g.h * 0.15); y < Math.floor(g.h * 0.72); y++) {
    let run = 0, start = 0;
    for (let x = 0; x <= g.w; x++) {
      const dark = x < g.w && at(g, x, y) < 0.26;
      if (dark) {
        if (run === 0) start = x;
        run++;
        continue;
      }
      // A lid is a decent slice of the frame, but never most of it.
      if (run >= g.w * 0.08 && run <= g.w * 0.45) {
        const mid = Math.round(start + run / 2);
        let bright = 0;
        for (let k = 3; k < wallLen; k++) if (at(g, mid, y + k) > 0.55) bright++;
        const score = run * (bright / (wallLen - 3));
        if (!best || score > best.score) best = { y, centre: mid, score };
      }
      run = 0;
    }
  }
  if (!best) return null;

  // Walk down from the widest part of the lid to where the wall begins.
  let bottom = best.y;
  for (let y = best.y; y < g.h - 3; y++) {
    if (at(g, best.centre, y) > 0.5 && at(g, best.centre, y + 2) > 0.5) { bottom = y; break; }
  }
  return { centre: best.centre, bottom };
}

/**
 * The base: the strongest bright-to-dark step straight down the cup's centre.
 *
 * A cup standing on a surface casts a contact shadow, and that shadow is the
 * sharpest horizontal transition anywhere below the wall - sharper than the
 * cup-to-counter boundary itself, which can be almost invisible when both are
 * near-white.
 */
function findBase(g: PlateGrid, centre: number, startY: number): number {
  let best = { y: g.h - 4, step: 0 };
  for (let y = startY + Math.round(g.h * 0.05); y < g.h - 3; y++) {
    const step = at(g, centre, y - 2) - at(g, centre, y + 2);
    if (step > best.step) best = { y, step };
  }
  return best.y;
}

/**
 * Walk outward from the centre of a row to the FIRST strong edge.
 *
 * First, not strongest. The cup's own silhouette is the first significant step
 * going outward from its centre; anything beyond it - the shadow it casts, a
 * dark background, the edge of a counter - can easily be a bigger step, and
 * taking the biggest walks straight past the cup and fits the line to whatever
 * is behind it.
 *
 * The step has to hold: a real silhouette stays darker outside it, while noise
 * and shading gradients inside the cup do not.
 *
 * Then the answer is refined to the HALF-WAY point of the transition. Taking
 * the first pixel that shows the step instead reports the silhouette about a
 * pixel and a half inside the cup on every single row - and a bias survives
 * any amount of averaging, so it lands intact in the finished fit as a bare
 * strip down both sides.
 */
function edgeOnRow(
  g: PlateGrid, y: number, centre: number, dir: -1 | 1, maxSpan: number,
): number | null {
  const startX = Math.round(centre);
  for (let k = 4; k < maxSpan; k++) {
    const x = startX + dir * k;
    if (x < 4 || x > g.w - 5) break;
    if (at(g, x - dir * 2, y) - at(g, x + dir * 2, y) < 0.06) continue;
    // Confirm it is an edge and not a ripple: still darker a little further out.
    const inside = at(g, x - dir * 3, y);
    const beyond = at(g, x + dir * 3, y);
    if (inside - beyond <= 0.05) continue;

    const half = (inside + beyond) / 2;
    for (let j = -3; j < 3; j++) {
      const a = at(g, x + dir * j, y);
      const b = at(g, x + dir * (j + 1), y);
      if (a >= half && b < half) return x + dir * (j + (a - half) / (a - b || 1e-6));
    }
    return x;
  }
  return null;
}

/**
 * Least median of squares: the line with the most samples close to it.
 *
 * Every pair of samples is tried, so the result is deterministic - the same
 * photograph always yields the same fit, which matters when a customer reopens
 * a mockup and expects to see what they were shown.
 *
 * This replaces trimming samples by their distance from the median. Trimming
 * assumes the outliers are a scattered minority; on the shaded side of a cup
 * they are neither. There, whole runs of rows lock onto the same wrong thing -
 * a strip of panelling, the far edge of a shadow - and they agree with each
 * other well enough to look like the signal. Only counting how many samples a
 * candidate line explains tells the cup's edge from a confederate of them.
 */
function lmsLine(pts: Sample[], tolerance: number, minSpan: number): Sample[] | null {
  if (pts.length < 4) return null;
  let best: { a: number; b: number; n: number } | null = null;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const p = pts[i]!, q = pts[j]!;
      const dy = q.y - p.y;
      if (Math.abs(dy) < minSpan) continue;
      const a = (q.x - p.x) / dy;
      if (Math.abs(a) > 0.5) continue;
      const b = p.x - a * p.y;
      let n = 0;
      for (const s of pts) if (Math.abs(s.x - (a * s.y + b)) <= tolerance) n++;
      if (!best || n > best.n) best = { a, b, n };
    }
  }
  if (!best) return null;
  const { a, b } = best;
  return pts.filter((s) => Math.abs(s.x - (a * s.y + b)) <= tolerance);
}

/** Ordinary least squares x = a*y + b. Only ever run on samples already vetted. */
function lsqLine(pts: Sample[]): Line {
  let sy = 0, sx = 0, syy = 0, sxy = 0;
  for (const p of pts) { sy += p.y; sx += p.x; syy += p.y * p.y; sxy += p.x * p.y; }
  const n = pts.length;
  const den = n * syy - sy * sy;
  if (n === 0) return { a: 0, b: 0 };
  if (Math.abs(den) < 1e-9) return { a: 0, b: sx / n };
  return { a: (n * sxy - sx * sy) / den, b: (sx * syy - sy * sxy) / den };
}

/**
 * The cup's axis, allowed to lean.
 *
 * Forcing it vertical was the safe choice while the side samples were dirty: a
 * handful of false edges could tilt a fitted line and drag the whole cup with
 * it. Now that each side has been through least median of squares, the
 * midpoints that reach here come only from rows where BOTH silhouettes were
 * believed, and they describe a line to within a pixel.
 *
 * Which is worth having, because cups do lean. This one leans by less than a
 * degree, and holding the axis vertical against it cost 8px at the rim - the
 * artwork hanging off the cup on one side while a bare strip showed on the
 * other.
 *
 * Returns null when the evidence is too thin to justify the extra freedom, and
 * the caller falls back to a vertical axis.
 */
function tiltedAxis(mids: Sample[], wallRows: number): Line | null {
  if (mids.length < 8) return null;
  let lo = Infinity, hi = -Infinity;
  for (const m of mids) { if (m.y < lo) lo = m.y; if (m.y > hi) hi = m.y; }
  if (hi - lo < wallRows * 0.35) return null;
  const inliers = lmsLine(mids, 1.2, wallRows * 0.2);
  if (!inliers || inliers.length < mids.length * 0.8) return null;
  const line = lsqLine(inliers);
  return Math.abs(line.a) > AXIS_MAX_SLOPE ? null : line;
}

/** Solve a 3x3 system by Gaussian elimination with partial pivoting. */
function solve3(m: number[][], v: number[]): [number, number, number] | null {
  const a = m.map((row, i) => [...row, v[i]!]);
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let k = i + 1; k < 3; k++) if (Math.abs(a[k]![i]!) > Math.abs(a[p]![i]!)) p = k;
    [a[i], a[p]] = [a[p]!, a[i]!];
    if (Math.abs(a[i]![i]!) < 1e-12) return null;
    for (let k = i + 1; k < 3; k++) {
      const f = a[k]![i]! / a[i]![i]!;
      for (let j = i; j < 4; j++) a[k]![j]! -= f * a[i]![j]!;
    }
  }
  const c: [number, number, number] = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let s = a[i]![3]!;
    for (let j = i + 1; j < 3; j++) s -= a[i]![j]! * c[j]!;
    c[i] = s / a[i]![i]!;
  }
  return c;
}

/**
 * Trace the lid's lower edge across the cup, and fit the arc it makes.
 *
 * From a row that is certainly wall, each column is walked UPWARDS to the
 * first dark pixel. That is the underside of the lid, and it is the single
 * most legible line in the photograph: a black rim against white board, with
 * nothing else between them.
 *
 * A circle seen at an angle projects to an ellipse, whose lower arc a parabola
 * matches closely over the width of a cup - and a parabola is exactly what
 * `topBow` draws, so the fit maps onto the calibration with nothing left over.
 */
function lidUnderside(
  g: PlateGrid, left: Line, right: Line, topY: number, baseY: number,
): ((x: number) => number) | null {
  const probeY = Math.min(g.h - 4, Math.round(topY + (baseY - topY) * 0.35));
  const x0 = Math.max(1, Math.ceil(valueAt(left, probeY)));
  const x1 = Math.min(g.w - 2, Math.floor(valueAt(right, probeY)));
  if (x1 - x0 < 12) return null;

  const pts: Sample[] = [];
  for (let x = x0; x <= x1; x++) {
    let y = probeY;
    while (y > 2 && at(g, x, y) > 0.34) y--;
    // A column that runs to the top of the frame never met a lid.
    if (y <= 2 || probeY - y > (baseY - topY) * 1.2) continue;
    pts.push({ x, y: y + 1 });
  }
  if (pts.length < 12) return null;

  const xc = (x0 + x1) / 2;
  const fit = (list: Sample[]): [number, number, number] | null => {
    const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const v = [0, 0, 0];
    for (const p of list) {
      const u = p.x - xc;
      const w = [1, u, u * u];
      for (let i = 0; i < 3; i++) {
        v[i]! += w[i]! * p.y;
        for (let j = 0; j < 3; j++) m[i]![j]! += w[i]! * w[j]!;
      }
    }
    return solve3(m, v);
  };

  let c = fit(pts);
  if (!c) return null;
  const evaluate = (k: [number, number, number], x: number) => {
    const u = x - xc;
    return k[0] + k[1] * u + k[2] * u * u;
  };
  // The sip hole and the lid's tab break the arc on a handful of columns.
  const keep = pts
    .map((p) => ({ p, e: Math.abs(p.y - evaluate(c!, p.x)) }))
    .sort((m, n) => m.e - n.e)
    .slice(0, Math.max(8, Math.floor(pts.length * 0.75)))
    .map((m) => m.p);
  c = fit(keep) ?? c;
  const coeffs = c;
  return (x: number) => evaluate(coeffs, x);
}

export interface AutoFitResult {
  calibration: PlateCalibration;
  /** How much of the cup the fit is based on, 0-1. Low means treat with suspicion. */
  confidence: number;
}

interface Sides { left: Line; right: Line; samples: number }

/**
 * Fit both silhouettes as ONE SOLID OF REVOLUTION - an axis and a half-width.
 *
 * A cup's two silhouettes are one curve mirrored about its axis, which means a
 * row that shows only ONE edge still says everything about the width. That
 * matters because one side is routinely unusable: on a lit-from-the-right
 * photograph the shaded left edge simply has no step to find below the
 * midpoint. Fitting the sides independently throws away the good side along
 * with the bad, and under-tapers the cup.
 */
function fitSides(g: PlateGrid, fromY: number, baseY: number, centre: number): Sides | null {
  const maxSpan = Math.round(g.w * 0.42);
  // Stop short of the base: down there the silhouette is the base ELLIPSE
  // curving inward, not the straight wall, and including it bends the fit.
  const wallEnd = baseY - Math.round(g.h * 0.02);
  const rows = wallEnd - fromY;
  if (rows < 8) return null;

  const rawLeft: Sample[] = [];
  const rawRight: Sample[] = [];
  // Rows that find no convincing edge simply contribute nothing - far better
  // than stopping the scan on the first ambiguous one, which is what an
  // early-exit rule does on a busy photograph.
  for (let y = fromY; y < wallEnd; y++) {
    const l = edgeOnRow(g, y, centre, -1, maxSpan);
    const r = edgeOnRow(g, y, centre, 1, maxSpan);
    if (l !== null) rawLeft.push({ x: l, y });
    if (r !== null) rawRight.push({ x: r, y });
  }

  const left = lmsLine(rawLeft, EDGE_TOLERANCE, rows * 0.3) ?? [];
  const right = lmsLine(rawRight, EDGE_TOLERANCE, rows * 0.3) ?? [];
  if (left.length + right.length < 10) return null;

  const rightAt = new Map(right.map((p) => [p.y, p.x]));
  const mids: Sample[] = [];
  for (const p of left) {
    const r = rightAt.get(p.y);
    if (r !== undefined && r - p.x > g.w * 0.04) mids.push({ x: (p.x + r) / 2, y: p.y });
  }

  const axis = tiltedAxis(mids, rows) ?? {
    a: 0,
    b: mids.length >= 4
      ? median(mids.map((m) => m.x))
      : left.length > 0 && right.length > 0
        ? (median(left.map((p) => p.x)) + median(right.map((p) => p.x))) / 2
        : centre,
  };

  const halves: Sample[] = [];
  for (const p of left) halves.push({ x: valueAt(axis, p.y) - p.x, y: p.y });
  for (const p of right) halves.push({ x: p.x - valueAt(axis, p.y), y: p.y });
  const half = lsqLine(halves);

  return {
    left: { a: axis.a - half.a, b: axis.b - half.b },
    right: { a: axis.a + half.a, b: axis.b + half.b },
    samples: halves.length,
  };
}

/** Fit a calibration to the cup in an already-prepared luminance grid. */
export function fitCupInGrid(g: PlateGrid, centreU = 0.5): AutoFitResult | null {
  const lid = findLid(g);
  const centre = Math.round(lid ? lid.centre : g.w / 2);
  const roughTop = (lid ? lid.bottom : Math.round(g.h * 0.3)) + 2;
  const baseY = findBase(g, centre, roughTop);
  if (baseY - roughTop < g.h * 0.08) return null;

  let sides = fitSides(g, roughTop, baseY, centre);
  if (!sides) return null;

  // The top edge, from the lid rather than from one column of it. Solved
  // twice: the corner heights depend on where the sides are at the top, and
  // the sides are refitted once the top is known.
  let topLeftY = roughTop;
  let topRightY = roughTop;
  let topBow = 0;
  const underside = lidUnderside(g, sides.left, sides.right, roughTop, baseY);
  if (underside) {
    for (let pass = 0; pass < 2; pass++) {
      const lx = valueAt(sides.left, topLeftY);
      const rx = valueAt(sides.right, topRightY);
      topLeftY = underside(lx);
      topRightY = underside(rx);
      topBow = underside((lx + rx) / 2) - (topLeftY + topRightY) / 2;
    }
    const refitted = fitSides(g, Math.round(Math.min(topLeftY, topRightY)), baseY, centre);
    if (refitted) {
      sides = refitted;
      const lx = valueAt(sides.left, topLeftY);
      const rx = valueAt(sides.right, topRightY);
      topLeftY = underside(lx);
      topRightY = underside(rx);
      topBow = underside((lx + rx) / 2) - (topLeftY + topRightY) / 2;
    }
  }
  if (!(topBow >= 0)) topBow = 0;

  /**
   * Sag of the base: how much lower the contact shadow sits at the cup's centre
   * than near its sides. That difference IS the depth of the base ellipse.
   *
   * Measured from the SHADOW rather than from "the last bright pixel", because
   * the surface the cup stands on is usually bright too - on a pale counter
   * the last bright pixel is the far edge of the room, and every column
   * reports the same answer, which is how this previously came out as zero.
   */
  const shadowAt = (x: number) => {
    let best = { y: baseY, step: 0 };
    for (let y = roughTop + Math.round(g.h * 0.05); y < g.h - 3; y++) {
      const step = at(g, x, y - 2) - at(g, x, y + 2);
      if (step > best.step) best = { y, step };
    }
    return best.step > 0.05 ? best.y : baseY;
  };
  const spanAtBase = valueAt(sides.right, baseY) - valueAt(sides.left, baseY);
  const bottomBow = Math.max(0, Math.min(
    g.h * 0.05,
    shadowAt(centre) - Math.max(
      shadowAt(Math.round(valueAt(sides.left, baseY) + spanAtBase * 0.09)),
      shadowAt(Math.round(valueAt(sides.right, baseY) - spanAtBase * 0.09)),
    ),
  ));

  const s = g.scale;
  return {
    calibration: {
      topLeft: { x: valueAt(sides.left, topLeftY) * s, y: topLeftY * s },
      topRight: { x: valueAt(sides.right, topRightY) * s, y: topRightY * s },
      bottomLeft: { x: valueAt(sides.left, baseY) * s, y: baseY * s },
      bottomRight: { x: valueAt(sides.right, baseY) * s, y: baseY * s },
      topBow: topBow * s,
      bottomBow: bottomBow * s,
      centreU,
      visibleSpan: DEFAULT_VISIBLE_SPAN,
    },
    confidence: Math.min(1, sides.samples / (2 * (baseY - roughTop) || 1)),
  };
}

export function autoFitPlate(
  source: HTMLImageElement | HTMLCanvasElement,
  centreU = 0.5,
): AutoFitResult | null {
  return fitCupInGrid(toGrid(source), centreU);
}
