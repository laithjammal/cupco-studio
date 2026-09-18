/**
 * Non-destructive transforms on imported artwork.
 *
 * Concepts need to adapt a customer's logo to a layout — dropping the white
 * plate behind it, or lightening it for a dark ground. Doing that here, on a
 * copy, means the original upload is never altered and the change can be
 * undone by simply re-applying a different concept.
 */

import type { PlacedArtwork } from './place';
import type { RGB } from './color';

/** Is this subpath an axis-aligned rectangle covering the whole unit box? */
function isFullBleedRect(subpath: { x: number; y: number }[], tolerance = 0.02): boolean {
  // A rect has 4 corners, usually with the first repeated to close it.
  if (subpath.length < 4 || subpath.length > 6) return false;
  const xs = subpath.map((p) => p.x);
  const ys = subpath.map((p) => p.y);
  const spansX = Math.max(...xs) - Math.min(...xs) > 1 - tolerance;
  const spansY = Math.max(...ys) - Math.min(...ys) > 1 - tolerance;
  if (!spansX || !spansY) return false;
  // Every point must sit on one of the four extremes to be a rectangle.
  return subpath.every((p) =>
    (Math.abs(p.x - Math.min(...xs)) < tolerance || Math.abs(p.x - Math.max(...xs)) < tolerance) &&
    (Math.abs(p.y - Math.min(...ys)) < tolerance || Math.abs(p.y - Math.max(...ys)) < tolerance));
}

/** Area of a closed ring, unsigned. */
function ringArea(subpath: readonly { x: number; y: number }[]): number {
  let a = 0;
  for (let i = 0, j = subpath.length - 1; i < subpath.length; j = i++) {
    a += (subpath[j]!.x + subpath[i]!.x) * (subpath[j]!.y - subpath[i]!.y);
  }
  return Math.abs(a / 2);
}

/** Perceptual lightness, 0-1. Cheap sRGB approximation, good enough to sort light from dark. */
function lightness(fill: RGB): number {
  return (0.2126 * fill[0] + 0.7152 * fill[1] + 0.0722 * fill[2]) / 255;
}

/**
 * How solid a shape is within its own bounding box.
 *
 * A plate is a filled blob: a rectangle scores 1.0, a circle pi/4 = 0.785, a
 * rounded rectangle a little under 1. Line work and letterforms score far
 * lower, which is what keeps this from eating the logo itself.
 */
function solidity(subpath: readonly { x: number; y: number }[]): number {
  const xs = subpath.map((p) => p.x);
  const ys = subpath.map((p) => p.y);
  const box = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  return box > 0 ? ringArea(subpath) / box : 0;
}

/**
 * A plate that is not a rectangle - a disc, a rounded panel, a squircle.
 *
 * Round badges are how a great many cafe logos are drawn, and the rectangle
 * test missed every one of them: it caps out at six points, and a circle
 * arrives as ninety-seven.
 *
 * The extra condition here is COLOUR, and it is the whole reason this can be
 * done safely. A full-bleed rectangle behind a mark is an export artefact
 * whatever colour it is. A full-bleed *disc* is frequently the design - a
 * green roundel with white type is a logo, not a logo on a plate - so a
 * non-rectangular plate is only removed when it is near-white, which is to say
 * when it is standing in for paper.
 */
function isFullBleedPlate(
  subpath: readonly { x: number; y: number }[],
  fill: RGB,
  tolerance = 0.04,
): boolean {
  if (subpath.length < 4) return false;
  const xs = subpath.map((p) => p.x);
  const ys = subpath.map((p) => p.y);
  if (Math.max(...xs) - Math.min(...xs) < 1 - tolerance) return false;
  if (Math.max(...ys) - Math.min(...ys) < 1 - tolerance) return false;
  if (solidity(subpath) < 0.6) return false;
  return lightness(fill) >= 0.82;
}

/**
 * Remove a background plate behind a logo.
 *
 * Exported logos very often carry a white (or coloured) rectangle behind the
 * mark. On a coloured cup that plate shows as an ugly box, so concepts that
 * place a logo on a strong ground need it gone. Only a BOTTOM-most shape that
 * covers the whole artwork is removed — anything else could be part of the
 * design.
 */
export function dropBackgroundPlate(art: PlacedArtwork): PlacedArtwork {
  if (art.shapes.length < 2) return art; // nothing left if we drop the only shape
  const first = art.shapes[0]!;
  // One subpath only: a ring with a hole is a drawn element, not a ground.
  if (first.subpaths.length !== 1) return art;
  const ring = first.subpaths[0]!;
  const isPlate = isFullBleedRect(ring) || isFullBleedPlate(ring, first.fill);
  if (!isPlate) return art;
  return { ...art, shapes: art.shapes.slice(1) };
}

/** True when the artwork carries a removable background plate. */
export function hasBackgroundPlate(art: PlacedArtwork): boolean {
  return dropBackgroundPlate(art).shapes.length !== art.shapes.length;
}

/** Recolour every shape through a mapping function. */
export function recolourArtwork(
  art: PlacedArtwork,
  map: (fill: RGB) => RGB,
): PlacedArtwork {
  return { ...art, shapes: art.shapes.map((s) => ({ ...s, fill: map(s.fill) })) };
}
