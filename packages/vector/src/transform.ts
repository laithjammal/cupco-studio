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
  const isPlate = first.subpaths.length === 1 && isFullBleedRect(first.subpaths[0]!);
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
