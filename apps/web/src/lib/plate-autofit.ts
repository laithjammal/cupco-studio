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
 *   3. the base - where those runs stop behaving like a tapering cup
 *   4. fit straight lines through the edge samples, discarding outliers
 *
 * It is a fit, not a certainty. The handles stay, and the operator can nudge.
 */

import { DEFAULT_VISIBLE_SPAN } from '@cupco/geometry';
import type { PlateCalibration } from '@cupco/geometry';

/** Width the search runs at. Detail beyond this only slows it down. */
const WORK_WIDTH = 420;

interface Grid {
  w: number;
  h: number;
  lum: Float32Array;
  sat: Float32Array;
  scale: number;
}

function toGrid(source: HTMLImageElement | HTMLCanvasElement): Grid {
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
  const sat = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = d[i * 4]! / 255, g = d[i * 4 + 1]! / 255, b = d[i * 4 + 2]! / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sat[i] = max <= 0 ? 0 : (max - min) / max;
  }
  return { w, h, lum, sat, scale: sw / w };
}

const at = (g: Grid, x: number, y: number) => g.lum[y * g.w + x] ?? 0;

/**
 * The lid: a dark band with a BRIGHT CUP DIRECTLY BENEATH IT.
 *
 * Both halves of that matter. Picking the widest dark run alone finds the
 * cafe interior behind the counter, which in a real photograph is darker and
 * wider than any lid. What no other dark region has is a tall, uninterrupted
 * bright column immediately below it - that is the cup wall, and it is what
 * makes the lid identifiable rather than merely dark.
 */
function findLid(g: Grid): { centre: number; bottom: number } | null {
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
function findBase(g: Grid, centre: number, startY: number): number {
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
 */
function edgeOnRow(g: Grid, y: number, centre: number, dir: -1 | 1, maxSpan: number): number | null {
  const startX = Math.round(centre);
  for (let k = 4; k < maxSpan; k++) {
    const x = startX + dir * k;
    if (x < 3 || x > g.w - 4) break;
    const step = at(g, x - dir * 2, y) - at(g, x + dir * 2, y);
    if (step < 0.06) continue;
    // Confirm it is an edge and not a ripple: still darker a little further out.
    const beyond = at(g, x + dir * 3, y);
    const inside = at(g, x - dir * 3, y);
    if (inside - beyond > 0.05) return x;
  }
  return null;
}

/** Least-squares line x = a*y + b, ignoring the worst quarter of the samples. */
function robustLine(pts: { x: number; y: number }[]): { a: number; b: number } | null {
  if (pts.length < 4) return null;
  const fit = (list: { x: number; y: number }[]) => {
    let sy = 0, sx = 0, syy = 0, sxy = 0;
    for (const p of list) { sy += p.y; sx += p.x; syy += p.y * p.y; sxy += p.x * p.y; }
    const n = list.length;
    const den = n * syy - sy * sy;
    if (Math.abs(den) < 1e-9) return { a: 0, b: sx / n };
    return { a: (n * sxy - sx * sy) / den, b: (sx * syy - sy * sxy) / den };
  };
  const first = fit(pts);
  const keep = pts
    .map((p) => ({ p, e: Math.abs(p.x - (first.a * p.y + first.b)) }))
    .sort((m, n) => m.e - n.e)
    .slice(0, Math.max(4, Math.floor(pts.length * 0.75)))
    .map((m) => m.p);
  return fit(keep);
}

export interface AutoFitResult {
  calibration: PlateCalibration;
  /** How much of the cup the fit is based on, 0-1. Low means treat with suspicion. */
  confidence: number;
}

export function autoFitPlate(
  source: HTMLImageElement | HTMLCanvasElement,
  centreU = 0.5,
): AutoFitResult | null {
  const g = toGrid(source);
  const lid = findLid(g);

  const centre = Math.round(lid ? lid.centre : g.w / 2);
  const topY = (lid ? lid.bottom : Math.round(g.h * 0.3)) + 2;
  const baseY = findBase(g, centre, topY);
  if (baseY - topY < g.h * 0.08) return null;

  const maxSpan = Math.round(g.w * 0.42);
  const left: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];

  // Sample the whole wall. Rows that find no convincing edge simply contribute
  // nothing - far better than stopping the scan on the first ambiguous one,
  // which is what an early-exit rule does on a busy photograph.
  // Stop short of the base: down there the silhouette is the base ELLIPSE
  // curving inward, not the straight wall, and including it bends the fit.
  const wallEnd = baseY - Math.round(g.h * 0.02);
  for (let y = topY; y < wallEnd; y++) {
    const l = edgeOnRow(g, y, centre, -1, maxSpan);
    const r = edgeOnRow(g, y, centre, 1, maxSpan);
    if (l !== null) left.push({ x: l, y });
    if (r !== null) right.push({ x: r, y });
  }

  /**
   * Fit an AXIS and a HALF-WIDTH, using whichever side of each row is visible.
   *
   * A cup is a solid of revolution, so its two silhouettes are one curve
   * mirrored about an axis - which means a row that shows only ONE edge still
   * says everything about the width, as long as the axis is known.
   *
   * That matters because one side is routinely unusable. On this plate the lit
   * right edge is found on every row while the shaded left edge disappears
   * below the midpoint: there is no luminance step to find when the cup and
   * what is behind it are equally dark. Requiring both edges threw away the
   * good side along with the bad, and the fit under-tapered by 35px.
   *
   * So: take the axis from the rows where both edges agree, then measure the
   * half-width from every edge found on either side.
   */
  const midpoints: number[] = [];
  for (const l of left) {
    const r = right.find((q) => q.y === l.y);
    if (r && r.x - l.x > g.w * 0.04) midpoints.push((l.x + r.x) / 2);
  }
  // The axis is a CONSTANT, taken as a median.
  //
  // Fitting it as a line gives the search a degree of freedom it does not need
  // - a cup stands upright - and a handful of false edges on the shaded side
  // are enough to tilt that line and drag the whole fit with it. A median
  // cannot be moved by outliers at all, only outvoted, and they are always the
  // minority. A genuinely tilted cup is what the handles are for.
  midpoints.sort((a, b) => a - b);
  const axis = midpoints.length >= 4
    ? midpoints[Math.floor(midpoints.length / 2)]!
    : centre;
  const lineAxis = { a: 0, b: axis };

  const val = (line: { a: number; b: number }, y: number) => line.a * y + line.b;

  const halves: { x: number; y: number }[] = [];
  for (const e of left) halves.push({ x: val(lineAxis, e.y) - e.x, y: e.y });
  for (const e of right) halves.push({ x: e.x - val(lineAxis, e.y), y: e.y });

  // A single wild edge - the far side of a shadow, the frame of a window -
  // would drag a least-squares line badly, and there are enough of them on a
  // shaded side to survive a plain trim. Cut on deviation from the median
  // first, which does not care how many outliers there are, only that they are
  // the minority.
  const sorted = [...halves].map((p) => p.x).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const devs = sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = devs[Math.floor(devs.length / 2)] ?? 1;
  const kept = halves.filter((p) => Math.abs(p.x - median) <= Math.max(mad * 3, g.w * 0.02));

  const lineHalf = robustLine(kept);
  if (!lineHalf || kept.length < 10) return null;

  const lineL = { a: lineAxis.a - lineHalf.a, b: lineAxis.b - lineHalf.b };
  const lineR = { a: lineAxis.a + lineHalf.a, b: lineAxis.b + lineHalf.b };
  const xOf = (line: { a: number; b: number }, y: number) => val(line, y);
  const s = g.scale;

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
    for (let y = topY + Math.round(g.h * 0.05); y < g.h - 3; y++) {
      const step = at(g, x, y - 2) - at(g, x, y + 2);
      if (step > best.step) best = { y, step };
    }
    return best.step > 0.05 ? best.y : baseY;
  };
  const spanAtBase = xOf(lineR, baseY) - xOf(lineL, baseY);
  const bottomBow = Math.max(0, Math.min(
    g.h * 0.05,
    shadowAt(centre) - Math.max(
      shadowAt(Math.round(xOf(lineL, baseY) + spanAtBase * 0.09)),
      shadowAt(Math.round(xOf(lineR, baseY) - spanAtBase * 0.09)),
    ),
  ));

  return {
    calibration: {
      topLeft: { x: xOf(lineL, topY) * s, y: topY * s },
      topRight: { x: xOf(lineR, topY) * s, y: topY * s },
      bottomLeft: { x: xOf(lineL, baseY) * s, y: baseY * s },
      bottomRight: { x: xOf(lineR, baseY) * s, y: baseY * s },
      // The lid line is a circle on the cup seen at the same angle as the base,
      // so it bows the same way - a little deeper for sitting on a wider part.
      topBow: bottomBow * 1.15 * s,
      bottomBow: bottomBow * s,
      centreU,
      visibleSpan: DEFAULT_VISIBLE_SPAN,
    },
    confidence: Math.min(1, kept.length / (2 * (baseY - topY) || 1)),
  };
}
