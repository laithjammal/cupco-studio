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
import { boundaryURange, boundaryVRange } from '@cupco/geometry';

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
  logo: { u: 0.4989, v: 0.4911, diameter: 0.1617 },
  paper: '#f9f7f1',
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

    // Sized to fill the BLEED BOX exactly - every edge of the die reached,
    // and none of them overrun.
    //
    // Both halves of that matter. Fall short and paper shows at a trimmed
    // edge; overrun and the ink lands outside the blank, which on an imposed
    // sheet means on the neighbouring cup. The raster export clips to the
    // outline, but the vector export does not, so overhang is a real defect
    // rather than a cosmetic one.
    //
    // The centring is taken from the BLANK, not from the cup. The die is
    // asymmetric - the base tuck takes 17.7mm against the top curl's 14.0mm
    // - so a design centred on the visible wall sits 0.02 short at the
    // bottom while overhanging the top. Scaling up to close that gap pushes
    // 3.7mm past the bleed at the seam edges; shifting to the blank's own
    // centre closes it for nothing. The composition lands 2.9mm below the
    // middle of the visible wall as a result, which is the cheaper price.
    //
    // Matching the width leaves the height 0.39% proud - 0.17mm at each arc,
    // inside the trim tolerance and clipped by the raster in any case.
    const bleedU = boundaryURange(input.profile, input.geom, 'bleed');
    const bleedV = boundaryVRange(input.profile, input.geom, 'bleed');
    const uLeft = Math.min(bleedU.atTop.uLeft, bleedU.atBottom.uLeft);
    const uRight = Math.max(bleedU.atTop.uRight, bleedU.atBottom.uRight);

    const widthU = uRight - uLeft;
    const heightV = widthU * TEMPLATE.aspect * canvasRatio;
    const centreU = (uLeft + uRight) / 2;
    const centreV = (bleedV.vBottom + bleedV.vTop) / 2;

    const placements: Placement[] = [{
      kind: 'template', template: TEMPLATE.id, color: accent,
      u: centreU, v: centreV, rotation: 0, widthU, bleeds: true,
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
