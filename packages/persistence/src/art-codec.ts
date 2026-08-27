/**
 * Storage encoding for vector artwork.
 *
 * WHY QUANTISE
 * ------------
 * A traced logo can carry several thousand points, and `JSON.stringify` writes
 * each coordinate at full double precision - `0.34827159881591797` is 19 bytes
 * to say something the press cannot resolve. Rounding to 6 decimal places cuts
 * the payload by roughly half and makes the content hash stable against
 * meaningless low-bit noise.
 *
 * WHY 6 PLACES IS SAFE
 * --------------------
 * Coordinates are normalised to a unit box spanning the artwork. A logo placed
 * at widthU 0.25 on the 8oz blank is about 60mm wide, so one unit is 60mm and
 * 1e-6 of a unit is 6e-5 mm - 60 nanometres. The path warper's flatness
 * tolerance is 0.02mm. Quantisation error is therefore ~300x below the
 * tolerance the export already accepts, and around six orders of magnitude
 * below anything a printing press can hold.
 *
 * This is the one place where the stored design is not bit-identical to the
 * runtime one, which is why the reasoning is written down rather than assumed.
 */

import type { StoredArt } from './types';

/** Decimal places kept for normalised path coordinates. */
export const COORD_PRECISION = 6;

const round = (n: number, dp: number): number => {
  const f = 10 ** dp;
  // `|| 0` normalises -0 to 0 so the JSON - and therefore the hash - is stable.
  return Math.round(n * f) / f || 0;
};

/** Round an artwork's coordinates for storage. */
export function quantiseArt(art: StoredArt): StoredArt {
  return {
    aspect: round(art.aspect, COORD_PRECISION),
    shapes: art.shapes.map((shape) => ({
      fill: [shape.fill[0], shape.fill[1], shape.fill[2]] as StoredArt['shapes'][number]['fill'],
      opacity: round(shape.opacity, 4),
      subpaths: shape.subpaths.map((sp) =>
        sp.map((p) => ({ x: round(p.x, COORD_PRECISION), y: round(p.y, COORD_PRECISION) }))),
    })),
  };
}

/**
 * Upper bound on the coordinate shift quantisation can introduce, in
 * normalised units.
 *
 * Rounding alone would be bounded by HALF a unit in the last place. This is
 * stated as a full unit because `Math.round(n * 1e6) / 1e6` is not exactly
 * half-bounded: scaling by 1e6 is itself inexact, so a value sitting on a
 * rounding boundary can land a few ULPs past the ideal limit. A full unit
 * covers that with room to spare and is still 300x below the export's flatness
 * tolerance, so nothing is lost by being honest about it.
 */
export const MAX_QUANTISATION_ERROR = 10 ** -COORD_PRECISION;
