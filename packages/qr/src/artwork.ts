/**
 * The shape this package emits.
 *
 * Declared here rather than imported so the package stands on its own: it
 * depends on `qrcode-generator` and nothing else, and drops into any project
 * without dragging a cup-printing monorepo behind it.
 *
 * It is deliberately identical to `PlacedArtwork` in @cupco/vector, which is
 * what the rest of Cupco Studio warps, proofs and exports. TypeScript is
 * structurally typed, so the two interoperate with no adapter — and a test in
 * the app asserts they stay mutually assignable, which is what stops the copy
 * quietly drifting from the original.
 *
 * Two conventions matter, because getting either wrong misplaces the code:
 *
 *   - the box is the UNIT SQUARE, 0..1 on both axes, quiet zone included
 *   - y points DOWN, the SVG convention, not up
 */

/** A colour, 0-255 per channel. */
export type RGB = readonly [number, number, number];

/** A point in the unit box. */
export interface ArtPoint { x: number; y: number }

/** One filled shape: a list of closed subpaths sharing a colour. */
export interface ArtShape {
  /**
   * Closed rings. Filled with the NONZERO winding rule, so a ring wound
   * opposite to the one containing it cuts a hole — which is how the finder
   * patterns get their light centres.
   */
  subpaths: ArtPoint[][];
  fill: RGB;
  opacity: number;
}

/** Artwork normalised into a unit box. */
export interface Artwork {
  shapes: ArtShape[];
  /** Height / width of the source. Always 1 for a QR: it must stay square. */
  aspect: number;
}
