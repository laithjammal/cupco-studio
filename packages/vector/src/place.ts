/**
 * Placing imported artwork into design space.
 *
 * Imported shapes arrive in the artwork's own user units with y pointing DOWN
 * (SVG convention). Design space is normalised with v pointing UP. This module
 * does that conversion once, so nothing downstream has to remember it.
 */

import type { DesignShape } from '@cupco/geometry';
import type { ImportedShape } from './svg-import';
import type { RGB } from './color';
import type { FillRule } from './svg-import';

export interface PlacedArtwork {
  /**
   * Source shapes, normalised to a unit box with y still pointing down.
   *
   * `fillRule` is OPTIONAL, and its absence means `evenodd`. That is not the
   * SVG default - it is the house rule the generated artwork in this package
   * was drawn against, and flipping it under them would punch holes through
   * motifs that are correct today. Imported artwork always states its rule
   * explicitly, taken from the file.
   */
  shapes: {
    subpaths: { x: number; y: number }[][];
    fill: RGB;
    opacity: number;
    fillRule?: FillRule;
  }[];
  /** Aspect ratio (height / width) of the source artwork. */
  aspect: number;
}

/**
 * Normalise imported shapes into a unit box, preserving aspect ratio.
 *
 * Fitting to the artwork's real bounding box (rather than the SVG canvas)
 * means a logo with generous whitespace around it does not arrive looking
 * tiny on the cup.
 */
export function normaliseArtwork(
  shapes: readonly ImportedShape[],
): PlacedArtwork {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) {
    for (const sp of s.subpaths) {
      for (const p of sp.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
  }
  if (!Number.isFinite(minX)) return { shapes: [], aspect: 1 };

  const w = Math.max(1e-9, maxX - minX);
  const h = Math.max(1e-9, maxY - minY);

  return {
    aspect: h / w,
    shapes: shapes.map((s) => ({
      fill: s.fill,
      opacity: s.opacity,
      fillRule: s.fillRule,
      subpaths: s.subpaths.map((sp) => sp.points.map((p) => ({
        x: (p.x - minX) / w,   // 0..1
        y: (p.y - minY) / h,   // 0..1, still y-down
      }))),
    })),
  };
}

export interface PlacementTransform {
  /** Centre in design space. */
  u: number;
  v: number;
  /** Width as a fraction of the circumference. */
  widthU: number;
  /** Degrees. */
  rotation: number;
  /** Design canvas dimensions, needed to keep the pixel aspect correct. */
  canvasW: number;
  canvasH: number;
  /**
   * Vertical stretch, as a multiple of the artwork's natural aspect.
   * Omitted or 1 keeps the source's own proportions.
   */
  stretchV?: number;
}

/**
 * Convert normalised artwork into design-space shapes at a given placement.
 *
 * Rotation is applied in PIXEL space and converted back, because u and v are
 * normalised over different physical distances - rotating in normalised units
 * would shear the artwork.
 */
export function placeArtwork(
  art: PlacedArtwork,
  t: PlacementTransform,
): DesignShape[] {
  const wPx = t.widthU * t.canvasW;
  const hPx = wPx * art.aspect * (t.stretchV && t.stretchV > 0 ? t.stretchV : 1);
  const rad = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);

  return art.shapes.map((s) => ({
    fill: s.fill,
    opacity: s.opacity,
    // Carried through to the printer: dropping it here would let the exported
    // file fill differently from the preview that was approved.
    fillRule: s.fillRule,
    subpaths: s.subpaths.map((sp) => sp.map((p) => {
      // Centre the unit box, scale to pixels, rotate, then normalise.
      const x = (p.x - 0.5) * wPx;
      const y = (p.y - 0.5) * hPx;
      const rx = x * cos - y * sin;
      const ry = x * sin + y * cos;
      return {
        u: t.u + rx / t.canvasW,
        // Design v points up; artwork y points down.
        v: t.v - ry / t.canvasH,
      };
    })),
  }));
}

/**
 * The area a shape covers, in unit-box units.
 *
 * Signed by the shoelace formula and summed across subpaths, so a hole wound
 * the opposite way to its outer ring subtracts rather than adds - an "O"
 * counts as the ring, not as the ring plus the counter.
 *
 * This is what lets a palette say how MUCH of a logo a colour occupies.
 * Counting shapes instead would let a traced logo's hundred antialiased
 * slivers outvote the two paths carrying the brand colour.
 */
export function shapeArea(
  subpaths: readonly { x: number; y: number }[][],
): number {
  let total = 0;
  for (const sp of subpaths) {
    let a = 0;
    for (let i = 0, j = sp.length - 1; i < sp.length; j = i++) {
      const p = sp[i]!, q = sp[j]!;
      a += (q.x + p.x) * (q.y - p.y);
    }
    total += a / 2;
  }
  return Math.abs(total);
}
