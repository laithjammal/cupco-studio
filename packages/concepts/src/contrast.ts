/**
 * Contrast, so generated concepts are legible rather than merely arranged.
 *
 * A layout engine that picks backgrounds at random will eventually put a dark
 * navy logo on a dark navy field. Choosing by measured contrast is what makes
 * the output usable without a human fixing it first.
 */

import type { RGB } from '@cupco/vector';

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(rgb: RGB): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a), lb = luminance(b);
  const light = Math.max(la, lb), dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

export function isDark(rgb: RGB): boolean {
  return luminance(rgb) < 0.4;
}

/** Lighten or darken a colour by a proportion, staying in gamut. */
export function shade(rgb: RGB, amount: number): RGB {
  const f = (v: number) => {
    const out = amount >= 0 ? v + (255 - v) * amount : v * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(out)));
  };
  return [f(rgb[0]), f(rgb[1]), f(rgb[2])];
}

/**
 * Pick a background that the artwork will actually read against.
 *
 * Prefers a colour drawn from the artwork itself so the result looks
 * considered rather than arbitrary, but only accepts one that clears a
 * contrast threshold against the artwork's dominant colour. Falls back to a
 * tinted near-white or near-black derived from the brand colour, which always
 * contrasts and still feels related.
 */
export function chooseBackground(
  palette: readonly RGB[],
  subject: RGB,
  minRatio = 3.5,
): RGB {
  let best: RGB | null = null;
  let bestRatio = 0;
  for (const c of palette) {
    const r = contrastRatio(c, subject);
    if (r >= minRatio && r > bestRatio) { best = c; bestRatio = r; }
  }
  if (best) return best;
  // Nothing in the palette works: derive a tint of the subject instead.
  return isDark(subject) ? shade(subject, 0.88) : shade(subject, -0.82);
}

/** A colour that reads clearly ON the given background. */
export function chooseForeground(background: RGB, palette: readonly RGB[]): RGB {
  let best: RGB = isDark(background) ? [255, 255, 255] : [17, 24, 39];
  let bestRatio = contrastRatio(best, background);
  for (const c of palette) {
    const r = contrastRatio(c, background);
    if (r > bestRatio) { best = c; bestRatio = r; }
  }
  return best;
}

export function toHex(rgb: RGB): string {
  return '#' + rgb.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
}
