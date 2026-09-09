/**
 * JANUARY — "Hello 2027", after the supplied template.
 *
 * A summer New Year, which is the right one for an Australian café: sun,
 * palms, a rolling sea along the base, and the year set large in the middle.
 *
 * TWO THINGS MAKE IT A TEMPLATE RATHER THAN A PICTURE
 *
 * The composition is fixed and the COLOUR IS NOT. Three tones are derived from
 * the uploaded logo's own hue - see harmonise() - so the scene belongs to the
 * café that uploaded it rather than to whoever drew it. Sampling a logo's
 * actual colours instead would give you whatever two a designer happened to
 * use, which is rarely a scene.
 *
 * And the logo has a RESERVED PLACE. The template marks it with a ring and the
 * words "your logo here"; the mark simply goes there, painted last so nothing
 * in the scene can land on top of it.
 *
 * A note on sizing. Design space is angular and the canvas is ~2.6x wider than
 * it is tall, so a motif's height on the cup is its width times its aspect
 * times that ratio. Every size below is chosen against that, not against how
 * the shape looks on a square page - which is why the wave is authored wide
 * and shallow rather than at the proportions it has on paper.
 */

import { harmonise } from './harmonise';
import {
  safeBounds, type ConceptInput, type ConceptLayout, type ConceptStrategy, type Placement,
} from './types';
import { motifAspect, type MotifId } from '@cupco/vector';

/** Height on the cup that a motif of this width will occupy. */
function hv(id: MotifId, widthU: number, input: ConceptInput): number {
  const { widthPx, heightPx } = input.profile.designCanvas;
  return widthU * motifAspect(id) * (widthPx / heightPx);
}

export const january: ConceptStrategy = {
  id: 'season-january',
  label: 'January — New Year',
  generate(input) {
    const c = harmonise(input.palette);
    const safe = safeBounds(input.profile, input.geom);
    const P: Placement[] = [];

    const motif = (
      id: MotifId, u: number, v: number, widthU: number,
      color: string, rotation = 0, bleeds = false,
    ) => {
      P.push({
        kind: 'motif', motif: id, u, v, rotation, widthU, bleeds,
        motifColors: { primary: color, ink: color, accent: color, secondary: color },
      });
    };

    /* ---- the sea ------------------------------------------------------- */
    // Three passes, each a shade lighter than the one below and set a little
    // higher, which is what makes a flat band read as water.
    // Each layer is a little WIDER than the one above it rather than shifted
    // sideways: widening moves the crests relative to the cup, where an offset
    // just slides the band off one edge and leaves the other bare.
    const sea: [string, number, number][] = [
      [c.mid, 0.30, 1.06],      // the shallow crest
      [c.ground, 0.255, 1.21],  // the light line between
      [c.dark, 0.205, 1.39],
    ];
    for (const [color, topV, w] of sea) {
      const h = hv('wave', w, input);
      // Positioned by its TOP edge, then run off the base of the cup.
      P.push({
        kind: 'motif', motif: 'wave', u: 0.5, v: topV - h / 2,
        rotation: 0, widthU: w, bleeds: true,
        motifColors: { primary: color, ink: color, accent: color, secondary: color },
      });
      // The wave alone is a thin ribbon; the band beneath fills to the base.
      P.push({
        kind: 'band', u: 0.5, v: (topV - h * 0.55) / 2, rotation: 0,
        heightV: Math.max(0.02, topV - h * 0.55), color,
      });
    }

    /* ---- sky ----------------------------------------------------------- */
    // Cropped by the rim, as the template has it.
    motif('sunrays', 0.77, 0.99, 0.115, c.mid, 0, true);
    // Cropped by the rim, as in the template.
    motif('cloud', 0.045, 0.93, 0.09, c.mid, 0, true);
    motif('cloud', 0.965, 0.87, 0.075, c.mid);

    /* ---- the shoreline ------------------------------------------------- */
    // Palms on the left, leaves on the right, both standing in the shallows.
    motif('palm', 0.045, 0.44, 0.175, c.dark);
    motif('palm', 0.125, 0.38, 0.135, c.dark);
    motif('frond', 0.955, 0.42, 0.075, c.dark, 16);
    motif('frond', 0.995, 0.37, 0.062, c.mid, -12);
    motif('frond', 0.915, 0.34, 0.052, c.dark, 33);

    /* ---- the burst behind the year ------------------------------------- */
    motif('sunburst', 0.5, 0.56, 0.155, c.mid);

    /* ---- scatter ------------------------------------------------------- */
    for (const [u, v, w] of [[0.245, 0.78, 0.028], [0.255, 0.5, 0.022], [0.72, 0.86, 0.02],
      [0.755, 0.42, 0.026], [0.86, 0.62, 0.018]] as const) {
      motif('sparkle', u, v, w, c.mid);
    }
    for (const [u, v, w, r] of [[0.33, 0.87, 0.03, 0], [0.26, 0.62, 0.024, -12],
      [0.7, 0.7, 0.026, 8], [0.79, 0.55, 0.02, -6]] as const) {
      motif('bird', u, v, w, c.dark, r);
    }
    motif('heart', 0.19, 0.62, 0.022, c.dark);
    motif('heart', 0.855, 0.47, 0.019, c.dark);
    for (const [u, v] of [[0.155, 0.55], [0.215, 0.45], [0.83, 0.78], [0.895, 0.66], [0.68, 0.4]] as const) {
      motif('dot', u, v, 0.007, c.dark);
    }

    /* ---- type ---------------------------------------------------------- */
    const script = (text: string, u: number, v: number, rot: number) => {
      P.push({
        kind: 'text', text, u, v, rotation: rot, sizeV: 0.05,
        color: c.dark, weight: 700, fontFamily: 'playfair', italic: true, tracking: 0.01,
      });
    };
    script('Good Coffee', 0.155, 0.81, -10);
    script('Brighter Days', 0.172, 0.73, -10);
    script('Same Great People', 0.85, 0.76, 9);
    script('A Brighter Year', 0.865, 0.68, 9);

    P.push({
      kind: 'text', text: 'Hello', u: 0.5, v: 0.64, rotation: 0,
      sizeV: 0.155, color: c.dark, weight: 700, fontFamily: 'playfair', italic: true,
    });
    P.push({
      kind: 'text', text: '2027', u: 0.5, v: 0.45, rotation: 0,
      sizeV: 0.185, color: c.dark, weight: 700, fontFamily: 'playfair',
    });
    P.push({
      kind: 'text', text: 'FRESH START', u: 0.5, v: 0.315, rotation: 0,
      sizeV: 0.042, color: c.dark, weight: 400, fontFamily: 'montserrat', tracking: 0.24,
    });
    P.push({
      kind: 'text', text: 'BRIGHTER DAYS', u: 0.5, v: 0.255, rotation: 0,
      sizeV: 0.042, color: c.dark, weight: 400, fontFamily: 'montserrat', tracking: 0.24,
    });

    /* ---- the logo, in its reserved place, painted LAST ------------------ */
    const { widthPx, heightPx } = input.profile.designCanvas;
    const perWidth = input.artworkAspect * (widthPx / heightPx);
    const targetH = 0.155;
    // The floor is low on purpose. A very tall mark needs a very small WIDTH
    // to land on the same printed height, and a 0.05 floor was overriding that
    // and making a tall logo two and a half times the size of a wide one.
    const widthU = Math.max(0.02, Math.min(0.5, targetH / Math.max(0.01, perWidth)));
    P.push({
      kind: 'artwork', u: 0.5, v: Math.min(safe.vTop - targetH / 2, 0.87),
      rotation: 0, widthU,
      // The scene is a flat tinted ground, so a logo carrying its own white
      // plate would sit in a visible box.
      treatment: { dropPlate: true, tone: 'darken' },
    });

    return {
      id: 'season-january',
      label: 'January — New Year',
      description:
        'Hello 2027: a summer New Year — sun, palms and a rolling sea, with the year set large '
        + 'and the mark held above it. Colours are taken from the uploaded logo.',
      background: c.ground,
      placements: P,
    };
  },
};
