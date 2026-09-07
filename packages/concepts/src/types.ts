/**
 * Concept generation contract.
 *
 * Strategies emit a neutral LAYOUT — placements in design space — rather than
 * application objects. That keeps the engine pure and testable, and means an
 * AI-backed generator can be added later by implementing the same interface,
 * exactly as the brief asks, without touching the data model.
 */

import type { CupProfile, FrustumGeometry } from '@cupco/geometry';
import type { RGB } from '@cupco/vector';

export interface ConceptInput {
  /** Height / width of the uploaded artwork. */
  artworkAspect: number;
  /** Colours found in the artwork, most-used first. */
  palette: RGB[];
  profile: CupProfile;
  geom: FrustumGeometry;
  /** Optional brand name, used by strategies that pair a mark with type. */
  brandName?: string;
  /** Same seed gives the same concepts — proposals must be reproducible. */
  seed?: number;
}

export type PlacementKind = 'artwork' | 'text' | 'band' | 'qr';

/**
 * How a concept wants the artwork adapted before placing it.
 *
 * Declared here rather than performed here: the engine stays pure and the
 * adapter does the pixel work, so a strategy can say "lighten this for a dark
 * ground" without the engine needing to know how artwork is represented.
 */
export interface ArtworkTreatment {
  /** Strip a full-bleed background rectangle from behind the mark. */
  dropPlate?: boolean;
  /** Force the mark light or dark so it reads against the ground. */
  tone?: 'lighten' | 'darken';
}

export interface Placement {
  kind: PlacementKind;
  treatment?: ArtworkTreatment;
  /** Centre in design space. */
  u: number;
  v: number;
  rotation: number;
  /** artwork: width as a fraction of the circumference. */
  widthU?: number;
  /** text: cap height as a fraction of cup height. */
  sizeV?: number;
  /** band: height as a fraction of cup height. */
  heightV?: number;
  /** 0-1. */
  opacity?: number;
  text?: string;
  /** Hex. */
  color?: string;
  tracking?: number;
  weight?: number;
  /** qr: placeholder shown until the customer supplies their own URL. */
  placeholderUrl?: string;
}

export interface ConceptLayout {
  id: string;
  label: string;
  /** One line explaining the idea, shown under the thumbnail. */
  description: string;
  /** Hex. */
  background: string;
  /** Painted in order; last is on top. */
  placements: Placement[];
}

/** Safe bounds in design space, derived from the profile's print margins. */
export interface SafeBounds {
  vBottom: number;
  vTop: number;
  uInset: number;
}

export function safeBounds(profile: CupProfile, geom: FrustumGeometry): SafeBounds {
  // CLAMPED to the design canvas on purpose.
  //
  // The safe margins may be negative, meaning the printable area extends past
  // the cup's trim line. That is legitimate for a GUIDE, but not for a layout
  // band: design space v=0..1 is the trim, so an element placed above 1 or
  // below 0 is simply not on the canvas and never renders. Concepts would be
  // silently laying artwork into a strip only bleed can reach.
  const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  return {
    vBottom: clamp(profile.margins.safeBottomMm / geom.slantMm),
    vTop: clamp(1 - profile.margins.safeTopMm / geom.slantMm),
    uInset: profile.margins.safeSeamMm / geom.topArcMm,
  };
}

export interface ConceptStrategy {
  id: string;
  label: string;
  /** Produce a layout, or null when the strategy does not suit this artwork. */
  generate(input: ConceptInput, rng: () => number): ConceptLayout | null;
}
