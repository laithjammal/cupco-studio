/**
 * Deriving a scene's palette from an uploaded logo.
 *
 * A seasonal template has a fixed IDEA - a summer New Year, sun and palms and
 * a rolling sea - but a fixed set of colours would make every café's cup look
 * like the same café's cup. So the composition is fixed and the colours are
 * not: the logo's own hue is taken and spread into the three tones an
 * illustration needs.
 *
 *   ground  the paper. Very light, barely tinted.
 *   dark    line work, type, the deep water, the palms.
 *   mid     everything that recedes: sun, clouds, the shallow wave.
 *
 * Three tones of ONE hue rather than three sampled colours. Sampling a logo's
 * actual palette gives you whatever two colours a designer happened to use,
 * which is rarely a scene; a tonal family always reads as designed, and still
 * looks like the café it came from.
 */
import type { RGB } from '@cupco/vector';
import type { BrandColour } from './types';
import { toHex } from './contrast';

export interface ScenePalette {
  ground: string;
  dark: string;
  mid: string;
  /**
   * The brand colour itself, not a tone derived from it.
   *
   * Used where a template already has an accent drawn into it and simply wants
   * replacing - there the point is the café's actual colour, not a version of
   * it that happens to suit a generated scene.
   */
  accent: string;
}

function toHsl(rgb: RGB): { h: number; s: number; l: number } {
  const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}

function fromHsl(h: number, s: number, l: number): RGB {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [
    Math.round(ch(h + 1 / 3) * 255),
    Math.round(ch(h) * 255),
    Math.round(ch(h - 1 / 3) * 255),
  ];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * A colour too small to be the brand.
 *
 * Half a percent of the artwork. Below this a colour is a fringe, a stray
 * anchor, or a tracer artefact - never the mark's identity.
 */
const SLIVER = 0.005;

/**
 * How much coverage counts towards being the brand colour.
 *
 * Saturation alone is wrong: a traced logo's antialiased edge is frequently
 * the most saturated colour in the file. Raw coverage alone is also wrong: the
 * commonest colour is usually the black outline or the white ground.
 *
 * So the two are combined, with coverage deliberately FLATTENED by a fourth
 * root. That leaves saturation as the main signal - which is what identifies a
 * brand colour - while still letting a large pale wash beat a saturated
 * sliver. A linear weighting would hand every decision to whichever colour
 * happens to fill the background.
 */
const presence = (coverage: number) => Math.pow(Math.max(0, coverage), 0.25);

/**
 * The colour to build a scene around.
 *
 * Scored on saturation weighted by presence, having first thrown away
 * near-black and near-white (which carry a hue but no intent) and anything
 * below a sliver's worth of the artwork.
 */
function subjectHue(palette: readonly BrandColour[]): { h: number; s: number; rgb: RGB | null } {
  let best: { h: number; s: number; rgb: RGB | null } = { h: 0, s: 0, rgb: null };
  let bestScore = 0;
  const consider = (list: readonly BrandColour[], floor: number) => {
    for (const c of list) {
      const { h, s, l } = toHsl(c.rgb);
      if (l < 0.06 || l > 0.96) continue;
      if (c.coverage < floor) continue;
      const score = s * presence(c.coverage);
      if (score > bestScore) { bestScore = score; best = { h, s, rgb: c.rgb }; }
    }
  };
  consider(palette, SLIVER);
  // A mark made entirely of slivers - a fine line drawing - still has a brand
  // colour. Better to take its most saturated one than to fall back to grey.
  if (!best.rgb) consider(palette, 0);
  return best;
}

/**
 * Three tones of the logo's own hue.
 *
 * A logo with no colour in it at all - a black mark, a greyscale one - yields
 * a neutral scheme rather than an invented hue. Choosing a colour for a
 * customer who did not choose one is worse than leaving it grey.
 */
export function harmonise(palette: readonly BrandColour[]): ScenePalette {
  const { h, s, rgb } = subjectHue(palette);
  return {
    ground: toHex(fromHsl(h, clamp(s * 0.3, 0, 0.16), 0.955)),
    dark: toHex(fromHsl(h, clamp(s * 0.9, 0.18, 0.62), 0.17)),
    mid: toHex(fromHsl(h, clamp(s * 0.45, 0.06, 0.3), 0.63)),
    // A logo with no colour at all leaves the accent a mid neutral rather
    // than an invented hue.
    accent: toHex(rgb ?? fromHsl(0, 0, 0.45)),
  };
}
