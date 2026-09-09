/**
 * JANUARY — the supplied illustration, recoloured to the café.
 *
 * This one is not generated. It is a finished piece of artwork with two things
 * marked in it: an accent colour meant to be replaced, and a disc reserved for
 * the customer's logo. Everything else - the coffee leaves, the beans, the
 * hills, the lettering - is left exactly as the designer drew it.
 *
 * That is a deliberate second kind of concept. The scatter-and-band scenes
 * next door are built from primitives and can adapt to anything; this one
 * keeps a designer's craft and only follows the brand where it was told to.
 * Both belong: one scales, the other looks like someone made it.
 *
 * The accent colour comes from the logo's most saturated colour that actually
 * covers some of it - a mark's commonest colour is very often its black
 * outline or white ground, and its most saturated is often a traced fringe.
 * Neither says anything about the brand. See harmonise.
 */

import { harmonise } from './harmonise';
import {
  type ConceptInput, type ConceptLayout, type ConceptStrategy, type Placement,
} from './types';
import { boundaryURange } from '@cupco/geometry';

/**
 * The template's own geometry, mirrored from apps/web's template-art.ts.
 *
 * Duplicated on purpose rather than imported: this package has no dependency
 * on the app, and cannot grow one without losing the property that the concept
 * engine runs anywhere. The numbers are measured off the artwork and a test
 * pins them, so a drift would fail rather than silently misplace a logo.
 */
const TEMPLATE = {
  id: 'january-2027',
  /** Height / width of the artwork. */
  aspect: 848 / 1855,
  /** The reserved disc, in IMAGE coordinates: u across, v UP. */
  logo: { u: 0.4992, v: 0.6044, diameter: 0.202 },
  paper: '#f6f5ec',
};

/**
 * How much of the disc a square mark can use.
 *
 * A square inside a circle reaches 1/sqrt(2) of its diameter; 0.68 leaves a
 * little air so the mark is not touching the ring.
 */
const FIT_IN_DISC = 0.68;

export const january: ConceptStrategy = {
  id: 'season-january',
  label: 'January — New Year',
  generate(input) {
    const accent = harmonise(input.palette).accent;
    const { widthPx, heightPx } = input.profile.designCanvas;
    const canvasRatio = widthPx / heightPx;

    // Sized to the VISIBLE CUP WALL, not to the blank.
    //
    // The blank is 118mm tall against an 85.8mm cup: the die's top curl,
    // base tuck and bleed together add 37%. So artwork drawn to fill the
    // blank edge-to-edge only shows its middle 73% once the cup is made -
    // it reads as far too big, with the sky and the hills cut away.
    //
    // Fitting the illustration's HEIGHT to v 0..1 puts the whole of it on
    // the part of the cup a person actually sees. The width that leaves
    // over is filled by the design's own background, which is the artwork's
    // cream - so the join is invisible and there is no white sliver to
    // bleed against.
    const bleedU = boundaryURange(input.profile, input.geom, 'bleed');
    const centreU = (Math.min(bleedU.atTop.uLeft, bleedU.atBottom.uLeft)
      + Math.max(bleedU.atTop.uRight, bleedU.atBottom.uRight)) / 2;
    const centreV = 0.5;

    const heightV = 1;
    const widthU = heightV / (TEMPLATE.aspect * canvasRatio);

    const placements: Placement[] = [{
      kind: 'template', template: TEMPLATE.id, color: accent,
      u: centreU, v: centreV, rotation: 0, widthU,
    }];

    // The disc, carried from image coordinates onto the cup.
    const discU = centreU + (TEMPLATE.logo.u - 0.5) * widthU;
    const discV = centreV + (TEMPLATE.logo.v - 0.5) * heightV;
    const discWidthU = TEMPLATE.logo.diameter * widthU;

    // Sized so the mark fits the disc whichever way round it is: a wide mark
    // is limited by the disc's width, a tall one by its height, and both come
    // out the same size on the cup.
    const perWidth = input.artworkAspect * canvasRatio;
    const discHeightV = discWidthU * canvasRatio;
    const byWidth = discWidthU * FIT_IN_DISC;
    const byHeight = (discHeightV * FIT_IN_DISC) / Math.max(0.01, perWidth);

    placements.push({
      kind: 'artwork', u: discU, v: discV, rotation: 0,
      widthU: Math.max(0.02, Math.min(byWidth, byHeight)),
      // The disc is dark, so the mark has to read light on it - and a logo
      // carrying its own white plate would sit in a visible box.
      treatment: { dropPlate: true, tone: 'lighten' },
    });

    return {
      id: 'season-january',
      label: 'January — New Year',
      description:
        'Cheers to the New Year: the illustrated January template, with its accent colour '
        + 'taken from your logo and the mark set in the reserved disc.',
      background: TEMPLATE.paper,
      placements,
    };
  },
};
