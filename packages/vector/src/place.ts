/**
 * Placing imported artwork into design space.
 *
 * Imported shapes arrive in the artwork's own user units with y pointing DOWN
 * (SVG convention). Design space is normalised with v pointing UP. This module
 * does that conversion once, so nothing downstream has to remember it.
 */

import type { DesignShape } from '@cupco/geometry';
import type { ImportedShape, ImportedRaster } from './svg-import';
import type { RGB } from './color';
import type { FillRule } from './svg-import';

/** 2D affine matrix [a b c d e f], laid out as SVG's matrix() is. */
export type Affine = [number, number, number, number, number, number];

const mulAffine = (m: Affine, n: Affine): Affine => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

const applyAffine = (m: Affine, x: number, y: number) =>
  ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

/**
 * A bitmap inside imported artwork: a photograph in a badge, a texture, or
 * the whole of an SVG that is really a PNG in a wrapper.
 *
 * It cannot become paths, so it travels as itself - the original encoded
 * bytes, untouched, as a data URL. `matrix` places the image's unit square
 * (0..1, y down) in the artwork's unit box, so rotation and skew survive.
 * `clip` is the visible outline when something clipped it, in unit-box
 * units, filled nonzero. `before` is its place in the painting order: it is
 * painted before shapes[before], so it can sit under one shape and over the
 * next exactly as it did in the file.
 */
export interface PlacedRaster {
  href: string;
  mime: string;
  matrix: Affine;
  naturalWidth: number;
  naturalHeight: number;
  opacity: number;
  clip?: { x: number; y: number }[][];
  before: number;
}

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
  /**
   * Embedded bitmaps, in the same unit box. Absent for artwork that has none,
   * which is nearly all of it - so everything that predates them, stored or
   * generated, is unchanged.
   */
  rasters?: PlacedRaster[];
  /** Aspect ratio (height / width) of the source artwork. */
  aspect: number;
}

interface Bounds { x0: number; y0: number; x1: number; y1: number }

/**
 * Where a raster actually shows: its placed quad, cut down to its clip.
 * The box of the intersection is bounded by the smaller of the two boxes,
 * which is what fitting needs.
 */
function rasterBounds(matrix: Affine, clip: readonly (readonly { x: number; y: number }[])[] | undefined): Bounds | null {
  let b: Bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [x, y] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
    const p = applyAffine(matrix, x, y);
    b = { x0: Math.min(b.x0, p.x), y0: Math.min(b.y0, p.y), x1: Math.max(b.x1, p.x), y1: Math.max(b.y1, p.y) };
  }
  if (clip && clip.length) {
    let c: Bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const ring of clip) {
      for (const p of ring) c = { x0: Math.min(c.x0, p.x), y0: Math.min(c.y0, p.y), x1: Math.max(c.x1, p.x), y1: Math.max(c.y1, p.y) };
    }
    b = { x0: Math.max(b.x0, c.x0), y0: Math.max(b.y0, c.y0), x1: Math.min(b.x1, c.x1), y1: Math.min(b.y1, c.y1) };
  }
  return Number.isFinite(b.x0) && b.x1 > b.x0 && b.y1 > b.y0 ? b : null;
}

/** Map a raster's placement and clip through a box-to-box rescale. */
function rescaleRaster(r: PlacedRaster, x0: number, y0: number, w: number, h: number): PlacedRaster {
  const m = r.matrix;
  return {
    ...r,
    matrix: [m[0] / w, m[1] / h, m[2] / w, m[3] / h, (m[4] - x0) / w, (m[5] - y0) / h],
    ...(r.clip ? { clip: r.clip.map((ring) => ring.map((p) => ({ x: (p.x - x0) / w, y: (p.y - y0) / h }))) } : {}),
  };
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
  rasters: readonly ImportedRaster[] = [],
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
  // An embedded image is artwork too: leaving it out of the box would crop a
  // photo badge down to whatever vector line work sits on top of it.
  const placed: PlacedRaster[] = rasters.map((r) => ({
    href: r.href, mime: r.mime, matrix: [...r.matrix] as Affine,
    naturalWidth: r.naturalWidth, naturalHeight: r.naturalHeight,
    opacity: r.opacity, before: r.before,
    ...(r.clip ? { clip: r.clip.map((sp) => sp.points.map((p) => ({ x: p.x, y: p.y }))) } : {}),
  }));
  for (const r of placed) {
    const b = rasterBounds(r.matrix, r.clip);
    if (!b) continue;
    minX = Math.min(minX, b.x0); minY = Math.min(minY, b.y0);
    maxX = Math.max(maxX, b.x1); maxY = Math.max(maxY, b.y1);
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
    ...(placed.length ? { rasters: placed.map((r) => rescaleRaster(r, minX, minY, w, h)) } : {}),
  };
}

/**
 * The unit box an artwork's content actually occupies, in its own units -
 * shapes and images both. Null when there is nothing in it.
 */
export function artworkBounds(art: PlacedArtwork): Bounds | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of art.shapes) {
    for (const sp of s.subpaths) {
      for (const p of sp) {
        if (p.x < x0) x0 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.x > x1) x1 = p.x;
        if (p.y > y1) y1 = p.y;
      }
    }
  }
  for (const r of art.rasters ?? []) {
    const b = rasterBounds(r.matrix, r.clip);
    if (!b) continue;
    x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0);
    x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

/**
 * Fit artwork to its content again, after something was taken out of it.
 *
 * Dropping a background plate leaves the mark floating in the plate's box,
 * which makes it arrive too small and off-centre. Physical proportions are
 * kept: the unit box is normalised separately on each axis, so the aspect is
 * recomputed from the real extents rather than from the box.
 */
export function refitArtwork(art: PlacedArtwork): PlacedArtwork {
  const b = artworkBounds(art);
  if (!b) return art;
  const w = Math.max(1e-9, b.x1 - b.x0), h = Math.max(1e-9, b.y1 - b.y0);
  if (Math.abs(b.x0) < 1e-12 && Math.abs(b.y0) < 1e-12 && Math.abs(w - 1) < 1e-12 && Math.abs(h - 1) < 1e-12) return art;
  return {
    ...art,
    aspect: (art.aspect * h) / w,
    shapes: art.shapes.map((s) => ({
      ...s,
      subpaths: s.subpaths.map((sp) => sp.map((p) => ({ x: (p.x - b.x0) / w, y: (p.y - b.y0) / h }))),
    })),
    ...(art.rasters ? { rasters: art.rasters.map((r) => rescaleRaster(r, b.x0, b.y0, w, h)) } : {}),
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
 * Where an embedded image lands in design space.
 *
 * The same placement as placeArtwork, composed into one affine map from the
 * image's unit square (0..1, y down) to design (u, v) - affine because the
 * whole placement is: scale, rotate in pixel space, normalise. Exporters
 * invert it to sample the image straight from its own pixels, with no
 * intermediate canvas to cost resolution.
 */
export function rasterPlacement(raster: PlacedRaster, art: PlacedArtwork, t: PlacementTransform): Affine {
  const wPx = t.widthU * t.canvasW;
  const hPx = wPx * art.aspect * (t.stretchV && t.stretchV > 0 ? t.stretchV : 1);
  const rad = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  // unit box -> centred pixels -> rotated -> design (v up)
  const toPx: Affine = [wPx, 0, 0, hPx, -0.5 * wPx, -0.5 * hPx];
  const rot: Affine = [cos, sin, -sin, cos, 0, 0];
  const toDesign: Affine = [1 / t.canvasW, 0, 0, -1 / t.canvasH, t.u, t.v];
  return mulAffine(toDesign, mulAffine(rot, mulAffine(toPx, raster.matrix)));
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
