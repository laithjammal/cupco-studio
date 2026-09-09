/**
 * Turn generated concept layouts into editable designs.
 *
 * The engine deliberately emits neutral placements rather than app objects, so
 * this is the one place that knows about both. Materialising here means a
 * selected concept becomes an ORDINARY design — every element movable,
 * recolourable and deletable, with no special "generated" mode. That is what
 * the brief asks for: reliable, editable output rather than a black box.
 */

import { deriveFrustum, type CupProfile } from '@cupco/geometry';
import {
  extractPalette, hexToRgb, dropBackgroundPlate, recolourArtwork,
  buildMotifArtwork,
  type PlacedArtwork, type RGB, type MotifId,
} from '@cupco/vector';
import { luminance, shade } from '@cupco/concepts';
import {
  generateConcepts, type ConceptInput, type ConceptLayout,
} from '@cupco/concepts';
import {
  createBandElement, createTextElement, createVectorElement, createQrElement,
  renderDesign, type Design, type DesignElement,
} from './design';
import type { ArtworkTreatment } from '@cupco/concepts';

export interface ConceptSource {
  art: PlacedArtwork;
  name: string;
}

/** Build the engine input from an uploaded asset. */
export function conceptInputFor(
  source: ConceptSource,
  profile: CupProfile,
  brandName?: string,
): ConceptInput {
  const palette = extractPalette(source.art.shapes.map((s) => ({ fill: s.fill })));
  return {
    artworkAspect: source.art.aspect,
    palette: palette.map((p) => p.rgb),
    profile,
    geom: deriveFrustum(profile.dimensions),
    brandName,
    // Seeded from the asset name, so re-uploading the same logo gives the
    // same proposals rather than a different set each time.
    seed: [...source.name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7),
  };
}

export function conceptsFor(
  source: ConceptSource,
  profile: CupProfile,
  brandName?: string,
): ConceptLayout[] {
  return generateConcepts(conceptInputFor(source, profile, brandName));
}

/**
 * Apply a concept's requested adaptation to the artwork.
 *
 * Two problems this solves, both of which otherwise ruin a layout:
 *   - a white plate behind an exported logo shows as a box on a coloured cup
 *   - a dark logo on a black ground simply disappears
 *
 * The transform is applied to a COPY, so the original upload is untouched and
 * switching concepts restores it.
 */
function treatArtwork(art: PlacedArtwork, treatment?: ArtworkTreatment): PlacedArtwork {
  // The plate is stripped by DEFAULT. Exported logos routinely carry a white
  // rectangle behind the mark; harmless on white paper, but on any coloured
  // cup it prints as a box around the logo. A strategy has to opt out
  // explicitly to keep it.
  let out = treatment?.dropPlate === false ? art : dropBackgroundPlate(art);
  if (!treatment) return out;

  if (treatment.tone === 'lighten') {
    // Only lift shapes that are actually too dark to read; a logo that already
    // contains white or a bright accent keeps those colours intact.
    out = recolourArtwork(out, (fill: RGB) =>
      (luminance(fill) < 0.35 ? shade(fill, 0.78) : fill));
  } else if (treatment.tone === 'darken') {
    out = recolourArtwork(out, (fill: RGB) =>
      (luminance(fill) > 0.65 ? shade(fill, -0.7) : fill));
  }
  return out;
}

/** Materialise one layout into a fully editable design document. */
export function materialiseConcept(
  layout: ConceptLayout,
  source: ConceptSource,
): Design {
  const elements: DesignElement[] = [];

  for (const p of layout.placements) {
    if (p.kind === 'band') {
      const el = createBandElement(p.color ?? '#000000', p.v, p.heightV ?? 0.2);
      elements.push({ ...el, opacity: p.opacity ?? 1 });
    } else if (p.kind === 'text') {
      const el = createTextElement(p.text ?? '');
      elements.push({
        ...el,
        u: p.u, v: p.v, rotation: p.rotation,
        sizeV: p.sizeV ?? el.sizeV,
        color: p.color ?? el.color,
        tracking: p.tracking ?? 0,
        weight: p.weight ?? el.weight,
        fontFamily: p.fontFamily ?? el.fontFamily,
        italic: p.italic ?? el.italic,
        opacity: p.opacity ?? 1,
      });
    } else if (p.kind === 'motif') {
      // Seasonal artwork, built here rather than carried through the layout:
      // a concept stays plain data, and a motif arrives as an ordinary vector
      // element the operator can move, recolour or delete like any other.
      const c = p.motifColors;
      const art = buildMotifArtwork(p.motif as MotifId, {
        primary: hexToRgb(c?.primary ?? '#ffffff'),
        ink: hexToRgb(c?.ink ?? '#101010'),
        accent: hexToRgb(c?.accent ?? '#c0392b'),
        secondary: hexToRgb(c?.secondary ?? '#9aa8bd'),
      });
      const el = createVectorElement(art, p.motif ?? 'Motif', false);
      elements.push({
        ...el,
        u: p.u, v: p.v, rotation: p.rotation,
        widthU: p.widthU ?? el.widthU,
        opacity: p.opacity ?? 1,
      });
    } else if (p.kind === 'qr') {
      // Starts as a placeholder; the operator pastes a URL to make it live.
      const el = createQrElement('', p.placeholderUrl);
      elements.push({
        ...el,
        u: p.u, v: p.v, rotation: p.rotation,
        widthU: p.widthU ?? el.widthU,
      });
    } else {
      const art = treatArtwork(source.art, p.treatment);
      const el = createVectorElement(art, source.name, false);
      elements.push({
        ...el,
        u: p.u, v: p.v, rotation: p.rotation,
        widthU: p.widthU ?? el.widthU,
        opacity: p.opacity ?? 1,
      });
    }
  }

  return { background: layout.background, elements };
}

/**
 * Render a concept to a thumbnail.
 *
 * Thumbnails show the FLAT design rather than the warped fan: side by side,
 * the flat version makes the layouts directly comparable, and it renders in
 * about a millisecond instead of the ~150ms a warp costs. The fan and the 3D
 * cup are one click away once a concept is chosen.
 */
export function renderConceptThumbnail(
  layout: ConceptLayout,
  source: ConceptSource,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) renderDesign(ctx, materialiseConcept(layout, source), width, height);
  return canvas;
}

/** Dominant colours of a concept, for the swatch row under a thumbnail. */
export function conceptSwatches(layout: ConceptLayout, source: ConceptSource): string[] {
  const seen = new Set<string>([layout.background.toLowerCase()]);
  for (const p of layout.placements) {
    if (p.color) seen.add(p.color.toLowerCase());
  }
  for (const s of source.art.shapes.slice(0, 4)) {
    seen.add('#' + s.fill.map((n) => n.toString(16).padStart(2, '0')).join(''));
  }
  return [...seen].slice(0, 6);
}

/** Reject colours that would be invisible against the concept background. */
export function readableAgainst(hex: string, background: string): boolean {
  const a = hexToRgb(hex), b = hexToRgb(background);
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 24;
}
