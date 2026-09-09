/**
 * Layout strategies.
 *
 * The brief is explicit that these must not all be "put the logo in the
 * middle". Each one below is a different *idea* about how branding meets a
 * cup — scale, repetition, colour blocking, asymmetry — not the same idea at
 * different sizes.
 *
 * Every strategy is deterministic given the same input and seed, so a customer
 * who reloads sees the same proposals they were shown before.
 */

import { chooseBackground, chooseForeground, isDark, shade, toHex } from './contrast';
import {
  safeBounds,
  type BrandColour, type ConceptInput, type ConceptLayout, type ConceptStrategy, type Placement,
} from './types';
import type { RGB } from '@cupco/vector';
import { SEASONAL_STRATEGIES } from './seasonal';

/**
 * The palette as bare colours.
 *
 * Contrast pairing only asks which colours are available and how they read
 * against one another - coverage is not part of that judgement, so it is
 * dropped here rather than threaded through every helper.
 */
const hues = (palette: readonly BrandColour[]): RGB[] => palette.map((c) => c.rgb);

/** Dominant artwork colour, falling back to a neutral when there is none. */
function subjectColour(input: ConceptInput): RGB {
  return input.palette[0]?.rgb ?? [40, 40, 40];
}

/**
 * Width that fits the artwork within a target height.
 *
 * Design space is angular, so a tall logo constrained only by width can easily
 * run past the rim. Solving for height keeps every strategy inside the safe
 * band regardless of the artwork's proportions.
 */
function widthForHeight(targetV: number, input: ConceptInput): number {
  return Math.max(0.03, Math.min(2.5, targetV / Math.max(0.01, heightPerWidth(input))));
}

/**
 * Height in v units that one unit of widthU produces.
 *
 * Mirrors halfExtent() in the design model exactly:
 *   heightV = widthU * artworkAspect * (canvasWidth / canvasHeight)
 *
 * The canvas ratio is the easy thing to invert here, and inverting it scales
 * every generated element by the square of that ratio - roughly 6.5x on the
 * 8oz canvas, which turns "small centred mark" into a full wrap.
 */
function heightPerWidth(input: ConceptInput): number {
  const { widthPx, heightPx } = input.profile.designCanvas;
  return input.artworkAspect * (widthPx / heightPx);
}

/** Clamp a centre so an element of the given half-height stays inside safe. */
function clampV(v: number, halfV: number, input: ConceptInput): number {
  const s = safeBounds(input.profile, input.geom);
  return Math.max(s.vBottom + halfV, Math.min(s.vTop - halfV, v));
}

function heightOf(widthU: number, input: ConceptInput): number {
  return widthU * heightPerWidth(input);
}

/* -------------------------------------------------------------------------- */

const centred: ConceptStrategy = {
  id: 'centred',
  label: 'Centred',
  generate(input) {
    const subject = subjectColour(input);
    const bg = chooseBackground(hues(input.palette), subject);
    const widthU = widthForHeight(0.26, input);
    return {
      id: 'centred',
      label: 'Centred',
      description: 'One mark, generous space. The safest, most premium option.',
      background: toHex(bg),
      placements: [{
        kind: 'artwork', u: 0.5, v: clampV(0.55, heightOf(widthU, input) / 2, input),
        widthU, rotation: 0,
      }],
    };
  },
};

const oversized: ConceptStrategy = {
  id: 'oversized',
  label: 'Oversized',
  generate(input) {
    const subject = subjectColour(input);
    const bg = chooseBackground(hues(input.palette), subject);
    // Deliberately larger than the safe area: the mark bleeds off the sides,
    // which reads as confident rather than cropped.
    const widthU = Math.min(1.35, widthForHeight(0.62, input));
    return {
      id: 'oversized',
      label: 'Oversized',
      description: 'The mark runs off both edges. Bold and unmissable.',
      background: toHex(bg),
      placements: [{ kind: 'artwork', u: 0.5, v: 0.52, widthU, rotation: 0 }],
    };
  },
};

const repeatGrid: ConceptStrategy = {
  id: 'repeat',
  label: 'Repeating pattern',
  generate(input) {
    const subject = subjectColour(input);
    const bg = chooseBackground(hues(input.palette), subject);
    const cols = 4, rows = 3;
    const widthU = Math.min(0.16, widthForHeight(0.13, input));
    const s = safeBounds(input.profile, input.geom);
    const placements: Placement[] = [];
    for (let r = 0; r < rows; r++) {
      // Half-step offset per row so the grid reads as a pattern, not a table.
      const stagger = (r % 2) * (0.5 / cols);
      for (let c = 0; c < cols; c++) {
        placements.push({
          kind: 'artwork',
          u: (c / cols + stagger + 0.5 / cols) % 1,
          v: s.vBottom + ((r + 0.5) / rows) * (s.vTop - s.vBottom),
          widthU, rotation: 0, opacity: 0.92,
        });
      }
    }
    return {
      id: 'repeat',
      label: 'Repeating pattern',
      description: 'The mark tiled around the cup. Reads as a brand pattern.',
      background: toHex(bg),
      placements,
    };
  },
};

const diagonal: ConceptStrategy = {
  id: 'diagonal',
  label: 'Diagonal repeat',
  generate(input) {
    const subject = subjectColour(input);
    const bg = chooseBackground(hues(input.palette), subject);
    const widthU = Math.min(0.19, widthForHeight(0.15, input));
    const s = safeBounds(input.profile, input.geom);
    const placements: Placement[] = [];
    const n = 9;
    for (let i = 0; i < n; i++) {
      placements.push({
        kind: 'artwork',
        u: (i / n * 1.5) % 1,
        v: s.vBottom + ((i % 3) + 0.5) / 3 * (s.vTop - s.vBottom),
        widthU, rotation: -18, opacity: 0.9,
      });
    }
    return {
      id: 'diagonal',
      label: 'Diagonal repeat',
      description: 'Tilted repeat for movement. Livelier than a straight grid.',
      background: toHex(bg),
      placements,
    };
  },
};

const colourBlock: ConceptStrategy = {
  id: 'colour-block',
  label: 'Two-tone block',
  generate(input) {
    const subject = subjectColour(input);
    const upper = chooseBackground(hues(input.palette), subject);
    // A true second field rather than a stripe: the lower two-fifths of the
    // cup is a contrasting colour, so the cup reads as two-tone in the hand.
    const lower = chooseForeground(upper, hues(input.palette));
    const widthU = widthForHeight(0.19, input);
    const splitAt = 0.4;

    return {
      id: 'colour-block',
      label: 'Two-tone block',
      description: 'The lower half in a second colour, mark held in the upper field.',
      background: toHex(upper),
      placements: [
        // Band centred on the lower field, sized to reach the base exactly.
        {
          kind: 'band', u: 0.5, v: splitAt / 2, heightV: splitAt, rotation: 0,
          color: toHex(lower),
        },
        {
          kind: 'artwork', u: 0.5,
          v: clampV(splitAt + (1 - splitAt) / 2, heightOf(widthU, input) / 2, input),
          widthU, rotation: 0,
          treatment: { dropPlate: true },
        },
      ],
    };
  },
};

const bandStripe: ConceptStrategy = {
  id: 'band',
  label: 'Ruled band',
  generate(input) {
    const subject = subjectColour(input);
    const bg = chooseBackground(hues(input.palette), subject);
    const rule = chooseForeground(bg, hues(input.palette));
    const widthU = widthForHeight(0.2, input);
    const centre = 0.56;
    const markH = heightOf(widthU, input);
    // Two thin rules bracketing the mark, rather than a solid block behind it.
    // Keeps the customer's own colours dominant instead of burying them.
    const gap = markH / 2 + 0.055;

    return {
      id: 'band',
      label: 'Ruled band',
      description: 'Thin rules above and below the mark. Restrained and editorial.',
      background: toHex(bg),
      placements: [
        { kind: 'band', u: 0.5, v: centre + gap, heightV: 0.012, rotation: 0, color: toHex(rule) },
        { kind: 'band', u: 0.5, v: centre - gap, heightV: 0.012, rotation: 0, color: toHex(rule) },
        {
          kind: 'artwork', u: 0.5, v: clampV(centre, markH / 2, input), widthU, rotation: 0,
          treatment: { dropPlate: true },
        },
      ],
    };
  },
};

const minimalCorner: ConceptStrategy = {
  id: 'minimal',
  label: 'Minimal white',
  generate(input) {
    const widthU = widthForHeight(0.24, input);
    return {
      id: 'minimal',
      label: 'Minimal white',
      description: 'Plain white cup, mark centred. The cleanest option there is.',
      background: '#ffffff',
      placements: [{
        kind: 'artwork', u: 0.5,
        v: clampV(0.55, heightOf(widthU, input) / 2, input),
        widthU, rotation: 0,
        // A white plate on a white cup is invisible, but stripping it keeps
        // the mark's own bounding box honest if the customer recolours later.
        treatment: { dropPlate: true },
      }],
    };
  },
};

/**
 * Mark on black.
 *
 * A flat black cup with just the mark on it. Two adaptations make it work with
 * any logo: the background plate is stripped so no white box appears, and a
 * dark mark is lightened — otherwise a navy or black logo simply vanishes.
 */
const onBlack: ConceptStrategy = {
  id: 'on-black',
  label: 'Mark on black',
  generate(input) {
    const widthU = widthForHeight(0.3, input);
    return {
      id: 'on-black',
      label: 'Mark on black',
      description: 'Flat black cup, mark only. Dark logos are lightened to hold up.',
      background: '#000000',
      placements: [{
        kind: 'artwork', u: 0.5,
        v: clampV(0.55, heightOf(widthU, input) / 2, input),
        widthU, rotation: 0,
        treatment: { dropPlate: true, tone: 'lighten' },
      }],
    };
  },
};

/**
 * Mark and QR, side by side.
 *
 * Both sit on the same horizontal line, each centred in its own half of the
 * cup — so as the cup turns, one is always squarely facing the customer. The
 * QR carries a placeholder until a real URL is supplied.
 */
const markAndQr: ConceptStrategy = {
  id: 'qr',
  label: 'Mark and QR',
  generate(input) {
    const subject = subjectColour(input);
    const bg = chooseBackground(hues(input.palette), subject);
    const widthU = widthForHeight(0.2, input);
    const v = 0.55;
    // A QR must stay square and large enough to scan off a curved surface.
    const qrHeightV = 0.34;
    const qrWidthU = qrHeightV * (input.profile.designCanvas.heightPx / input.profile.designCanvas.widthPx);

    return {
      id: 'qr',
      label: 'Mark and QR',
      description: 'Mark on one half, scannable QR on the other. Add your URL to make it live.',
      background: toHex(bg),
      placements: [
        {
          kind: 'artwork', u: 0.25, v: clampV(v, heightOf(widthU, input) / 2, input),
          widthU, rotation: 0, treatment: { dropPlate: true },
        },
        {
          kind: 'qr', u: 0.75, v, widthU: qrWidthU, rotation: 0,
          placeholderUrl: 'https://example.com',
        },
      ],
    };
  },
};

/**
 * Mark above, name beneath.
 *
 * Shows a placeholder when no brand name is set, rather than hiding the
 * concept: the customer can see the layout and type over it.
 */
const wordmark: ConceptStrategy = {
  id: 'wordmark',
  label: 'Mark and name',
  generate(input) {
    const name = (input.brandName ?? '').trim() || 'Type Your Name';
    const subject = subjectColour(input);
    const bg = chooseBackground(hues(input.palette), subject);
    const fg = chooseForeground(bg, hues(input.palette));
    const widthU = widthForHeight(0.22, input);
    const markV = 0.62;

    return {
      id: 'wordmark',
      label: 'Mark and name',
      description: 'Mark above, name set beneath it in wide-spaced caps.',
      background: toHex(bg),
      placements: [
        {
          kind: 'artwork', u: 0.5, v: markV, widthU, rotation: 0,
          treatment: { dropPlate: true },
        },
        {
          kind: 'text', u: 0.5, v: markV - heightOf(widthU, input) / 2 - 0.1,
          sizeV: 0.075, rotation: 0, text: name.toUpperCase(),
          color: toHex(fg), tracking: 0.22, weight: 700,
        },
      ],
    };
  },
};

export const STRATEGIES: ConceptStrategy[] = [
  centred, oversized, colourBlock, bandStripe,
  repeatGrid, diagonal, minimalCorner, onBlack, markAndQr, wordmark,
];

/**
 * All strategies: the layout ideas, then the seasonal campaigns.
 *
 * Seasonal ones come second because they answer a different question. A café
 * arriving with a logo wants to see how it sits on a cup before it sees a
 * Halloween version of it.
 */
export const ALL_STRATEGIES: ConceptStrategy[] = [...STRATEGIES, ...SEASONAL_STRATEGIES];

/**
 * Every concept a strategy will produce for this artwork.
 *
 * The default is ALL of them, not a round number. It used to be 10, which was
 * exactly the count of the layout strategies - so when the seasonal campaigns
 * were added they were generated and then silently dropped, and the app showed
 * no sign they existed. A cap that happens to equal the current list length is
 * indistinguishable from no cap until the list grows.
 */
export function generateConcepts(
  input: ConceptInput,
  limit = ALL_STRATEGIES.length,
): ConceptLayout[] {
  // Deterministic RNG so the same upload always yields the same proposals.
  let seed = (input.seed ?? 1) >>> 0;
  const rng = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const out: ConceptLayout[] = [];
  for (const s of ALL_STRATEGIES) {
    if (out.length >= limit) break;
    const layout = s.generate(input, rng);
    if (layout) out.push(layout);
  }
  return out;
}
