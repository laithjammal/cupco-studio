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

/**
 * One colour found in the uploaded artwork, with how much of it that colour
 * covers.
 *
 * Coverage is carried rather than dropped because saturation alone picks the
 * wrong colour: a traced logo's antialiased fringe is often the most saturated
 * thing in the file while occupying a fraction of a percent of it. A colour
 * without its coverage cannot say whether it is the brand or an artefact.
 */
export interface BrandColour {
  rgb: RGB;
  /** Share of the artwork's area, 0-1. */
  coverage: number;
}

export interface ConceptInput {
  /** Height / width of the uploaded artwork. */
  artworkAspect: number;
  /** Colours found in the artwork, most-covering first. */
  palette: readonly BrandColour[];
  profile: CupProfile;
  geom: FrustumGeometry;
  /** Optional brand name, used by strategies that pair a mark with type. */
  brandName?: string;
  /** Same seed gives the same concepts — proposals must be reproducible. */
  seed?: number;
}

export type PlacementKind = 'artwork' | 'text' | 'band' | 'qr' | 'motif' | 'template';

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
  /**
   * What the mark will actually sit on, as hex.
   *
   * A tone is a guess about the ground made when the layout was written. Given
   * the ground itself, the adapter can CHECK the guess rather than trust it,
   * and refuse a treatment that would leave the mark unreadable - light type
   * on a light panel, which is how a logo disappears without anything failing.
   */
  against?: string;
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
  /**
   * This element is MEANT to run off an edge of the cup.
   *
   * A sea, a snow line, a sun cropped by the rim: each is deliberately outside
   * the safe area, and saying so in the data is better than a checker keeping
   * a list of which motif ids are allowed to. Without it, "everything must sit
   * inside safe" is either wrong or has to be quietly weakened.
   */
  bleeds?: boolean;
  text?: string;
  /** Hex. */
  color?: string;
  tracking?: number;
  weight?: number;
  /** text: a font id from the app's FONT_CHOICES. Defaults to the app's own. */
  fontFamily?: string;
  italic?: boolean;
  /** qr: placeholder shown until the customer supplies their own URL. */
  placeholderUrl?: string;
  /**
   * motif: which piece of seasonal artwork to draw, and in what colours.
   *
   * Named rather than embedded, so a layout stays plain data - the same reason
   * artwork is referenced rather than carried. The adapter builds the vector.
   */
  motif?: string;
  motifColors?: {
    primary: string; ink: string; accent: string; secondary: string;
  };
  /**
   * template: a finished illustration, recoloured to the brand.
   *
   * `template` names the artwork and `color` is the accent it is recoloured
   * to. The concept says which and what colour; the adapter does the pixels,
   * for the same reason artwork treatments are declared rather than performed.
   */
  template?: string;
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
