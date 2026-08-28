/**
 * Mockup plates: mapping artwork onto a cup in a PHOTOGRAPH.
 *
 * This is how commercial mockup templates work, and it is the only route to a
 * genuinely photographic result - because the base IS a photograph. Nothing is
 * simulated: the table, the light, the shadows, the hand, the out-of-focus
 * background are all real. All this has to do is put the artwork on the cup
 * that is already in the picture, following its real shape.
 *
 * WHAT A PLATE NEEDS TO KNOW
 * -------------------------
 * Where the cup's printable area sits in the image, and how it curves. Six
 * numbers' worth, which an operator sets by dragging handles onto the photo:
 *
 *   topLeft, topRight        ends of the top edge of the print area
 *   bottomLeft, bottomRight  ends of the bottom edge
 *   topBow, bottomBow        how far those edges bow, in pixels
 *
 * The bow is what makes it a cup rather than a poster. Looking slightly down
 * at a cylinder, the top edge curves DOWN at its centre and the bottom edge
 * curves down too - both are ellipse arcs, and their sag is what tells the eye
 * it is looking at something round.
 *
 * WHY NOT A PERSPECTIVE TRANSFORM
 * -------------------------------
 * A homography maps a flat rectangle to a flat quadrilateral. A cup is neither
 * flat nor a quadrilateral: artwork compresses towards the silhouette because
 * the surface is turning away, and no perspective transform reproduces that.
 * The horizontal mapping here is the same arcsine used by the 3D preview and
 * the elevation view, so a logo lands in the same place in all three.
 */

import type { Point2 } from './types';

export interface PlateCalibration {
  /** Ends of the print area's top edge, in image pixels. */
  topLeft: Point2;
  topRight: Point2;
  /** Ends of the print area's bottom edge, in image pixels. */
  bottomLeft: Point2;
  bottomRight: Point2;
  /**
   * How far the edges bow at their centre, in pixels, positive = sagging down.
   * Both are normally positive when looking down at a cup.
   */
  topBow: number;
  bottomBow: number;
  /** Design u facing the camera at the centre of the visible face. */
  centreU: number;
  /**
   * Fraction of the circumference visible edge to edge.
   *
   * Exactly 0.5 for a cup filling the frame face-on. Less when the photo shows
   * the cup at an angle, or when the operator has calibrated to only part of
   * the visible face.
   */
  visibleSpan: number;
  /**
   * Design v at the top and bottom edges of the calibrated area.
   *
   * These exist because the calibrated area is usually NOT the whole printable
   * wall. A lid covers the top of it. What the operator can mark - and what the
   * automatic fit can find - is the part of the cup they can SEE.
   *
   * Assuming the marked band is the whole wall crams a 90mm design into the
   * 76mm of it that shows, which squashes every element vertically and drags
   * it downward. Nothing about that reads as a calibration fault; it reads as
   * artwork that does not sit right on the cup.
   *
   * Default to the whole wall (1 and 0) when absent, which is correct for an
   * unlidded cup and is what plates calibrated before this existed assumed.
   */
  vTop?: number;
  vBottom?: number;
}

export const DEFAULT_VISIBLE_SPAN = 0.5;

/** Design v at vertical fraction `t` across the calibrated area, 0 top to 1 bottom. */
export function plateV(t: number, cal: PlateCalibration): number {
  const top = cal.vTop ?? 1;
  const bottom = cal.vBottom ?? 0;
  return top + (bottom - top) * t;
}

/**
 * How much of the cup's height the calibrated band covers, from its own width.
 *
 * The band's WIDTH is a ruler. A cup's diameters are known exactly from its
 * profile, so the marked width in pixels fixes the scale in pixels per
 * millimetre - and once the scale is known, the band's height in pixels says
 * how many millimetres of cup it spans. No one has to estimate how far down
 * the lid reaches; the photograph answers it.
 *
 * The scale is taken as the mean of the two ends. They rarely agree exactly:
 * the top of a cup is nearer the camera than its base, so it is magnified, and
 * on a plate that is a rendering rather than a photograph the two ends can
 * disagree by more than perspective alone explains. Averaging spreads that
 * error over the whole cup instead of loading it onto one end.
 *
 * Iterated because the top diameter depends on the answer - the cup tapers, so
 * how wide it is where the band stops depends on where the band stops. It
 * settles in a handful of rounds.
 */
export function plateVerticalCoverage(
  band: { topWidth: number; bottomWidth: number; height: number },
  cup: { topDiameterMm: number; bottomDiameterMm: number; heightMm: number },
): number {
  const { topWidth, bottomWidth, height } = band;
  const { topDiameterMm: dTop, bottomDiameterMm: dBottom, heightMm } = cup;
  if (!(topWidth > 0 && bottomWidth > 0 && height > 0)) return 1;
  if (!(dBottom > 0 && heightMm > 0)) return 1;

  const scaleAtBottom = bottomWidth / dBottom;
  let v = 1;
  for (let i = 0; i < 24; i++) {
    const diameterAtTop = dBottom + (dTop - dBottom) * v;
    if (diameterAtTop <= 0) break;
    const scale = (topWidth / diameterAtTop + scaleAtBottom) / 2;
    const next = height / (heightMm * scale);
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - v) < 1e-6) { v = next; break; }
    v = next;
  }
  // A band taller than the cup means the marks are wrong, not that the cup
  // grew; a band under a fifth of it means the fit failed. Neither is worth
  // acting on, so fall back to "the whole wall" and let the operator see it.
  return v > 1 || v < 0.2 || !Number.isFinite(v) ? 1 : v;
}

/**
 * Design u at horizontal position `s` across the calibrated area.
 *
 * `s` runs 0 at the left handle to 1 at the right. The arcsine is the
 * foreshortening: near the middle of the face a step across the image is a
 * small step around the cup, and at the edges the same step sweeps much
 * further round.
 */
export function plateU(s: number, cal: PlateCalibration): number {
  const clamped = s < 0 ? 0 : s > 1 ? 1 : s;
  const across = clamped * 2 - 1;
  // asin spans [-pi/2, pi/2]; scale so the full width covers visibleSpan.
  const turn = (Math.asin(across) / Math.PI) * cal.visibleSpan;
  const u = cal.centreU + turn;
  return u - Math.floor(u);
}

/**
 * How much the surface faces the camera at `s`, 1 head-on and 0 at the edges.
 *
 * Used to fade artwork out as it wraps out of sight, so it does not end in a
 * hard line at the silhouette.
 */
export function plateFacing(s: number): number {
  const across = (s < 0 ? 0 : s > 1 ? 1 : s) * 2 - 1;
  return Math.sqrt(Math.max(0, 1 - across * across));
}

/** A point on the bowed top or bottom edge, at horizontal fraction `s`. */
function edgePoint(a: Point2, b: Point2, bow: number, s: number): Point2 {
  const x = a.x + (b.x - a.x) * s;
  const y = a.y + (b.y - a.y) * s;
  // Parabolic sag, greatest at the centre and zero at both handles.
  const sag = bow * 4 * s * (1 - s);
  // Perpendicular to the edge, so a tilted cup bows the right way.
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: x - (dy / len) * sag * 0, y: y + sag };
}

/**
 * Image position of a point on the cup surface.
 *
 * `s` runs left to right across the calibrated area, `t` from the top edge
 * (0) to the bottom edge (1).
 */
export function platePoint(s: number, t: number, cal: PlateCalibration): Point2 {
  const top = edgePoint(cal.topLeft, cal.topRight, cal.topBow, s);
  const bottom = edgePoint(cal.bottomLeft, cal.bottomRight, cal.bottomBow, s);
  return {
    x: top.x + (bottom.x - top.x) * t,
    y: top.y + (bottom.y - top.y) * t,
  };
}

/** A sensible starting calibration for a cup roughly centred in the image. */
export function defaultCalibration(width: number, height: number): PlateCalibration {
  const cx = width / 2;
  const halfW = width * 0.17;
  const top = height * 0.34;
  const bottom = height * 0.72;
  return {
    topLeft: { x: cx - halfW, y: top },
    topRight: { x: cx + halfW, y: top },
    bottomLeft: { x: cx - halfW * 0.78, y: bottom },
    bottomRight: { x: cx + halfW * 0.78, y: bottom },
    topBow: height * 0.03,
    bottomBow: height * 0.022,
    centreU: 0.5,
    visibleSpan: DEFAULT_VISIBLE_SPAN,
  };
}

/** Axis-aligned bounds of the calibrated area, for cheap hit tests. */
export function plateBounds(cal: PlateCalibration): {
  minX: number; minY: number; maxX: number; maxY: number;
} {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i <= 16; i++) {
    for (const t of [0, 1]) {
      const p = platePoint(i / 16, t, cal);
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, minY, maxX, maxY };
}
