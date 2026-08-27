/**
 * Colour handling for print.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS AND IS NOT
 * ---------------------------------------------------------------------------
 * This performs an UNMANAGED RGB -> CMYK conversion. It is arithmetic, not
 * colour management: there is no ICC profile, no rendering intent and no
 * device characterisation, so the result is repeatable and sane but not
 * colorimetrically matched to a specific press.
 *
 * That is an acceptable default for a digital CMYK press, and it is what most
 * design tools do when no profile is supplied. It is NOT a substitute for the
 * printer's own profile.
 *
 * The accurate route for brand colours is to bypass conversion entirely:
 * `PaletteEntry.cmyk` can be overridden with the exact ink percentages the
 * brand specifies, and those values are then written into the PDF verbatim.
 * For flat-colour cup artwork - which is most of it - that is exact.
 */

export interface CMYK {
  /** All channels 0-1. */
  c: number; m: number; y: number; k: number;
}

export type RGB = readonly [number, number, number];

/**
 * RGB (0-255) to CMYK, with full Gray Component Replacement.
 *
 * GCR pushes neutral content into the K channel rather than building it from
 * C+M+Y. Two practical reasons on a digital press:
 *
 *   - Black text and thin black rules print as a SINGLE ink, so they stay
 *     sharp instead of showing colour fringing from slight misregistration.
 *   - Total ink coverage stays low. Because the maximum channel always
 *     reduces to zero, total ink can never exceed 300%, which is inside the
 *     limit of essentially every digital press.
 */
export function rgbToCmyk(rgb: RGB): CMYK {
  const r = clamp01(rgb[0] / 255);
  const g = clamp01(rgb[1] / 255);
  const b = clamp01(rgb[2] / 255);

  const k = 1 - Math.max(r, g, b);
  if (k >= 1 - 1e-9) return { c: 0, m: 0, y: 0, k: 1 }; // pure black
  const inv = 1 - k;
  return {
    c: clamp01((1 - r - k) / inv),
    m: clamp01((1 - g - k) / inv),
    y: clamp01((1 - b - k) / inv),
    k: clamp01(k),
  };
}

/**
 * Simulate what a CMYK ink mix actually looks like on press.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT JUST INVERT rgbToCmyk
 * ---------------------------------------------------------------------------
 * `cmykToRgb` below is the exact mathematical inverse of `rgbToCmyk`, so
 * round-tripping through it changes nothing at all — which makes it useless as
 * a soft proof. That formula assumes IDEAL inks: a cyan that reflects all
 * green and blue and no red.
 *
 * Real inks are not ideal. Process cyan is roughly rgb(0,158,224), not
 * (0,255,255); process black is a very dark brown, not true black. Modelling
 * each ink as a transmittance filter over the paper reproduces the effects
 * printers actually see: saturated screen colours come back duller, bright
 * greens and oranges lose the most, and blacks warm slightly.
 *
 * This is an approximation, not colour management — there is no ICC profile
 * and no press characterisation. It is honest about direction and magnitude,
 * which is what a designer needs to avoid a nasty surprise, but the printer's
 * own proof remains the authority.
 */

/** Solid-ink appearance of each process colour on white stock. */
const INK_SOLID: Record<'c' | 'm' | 'y' | 'k', RGB> = {
  c: [0, 158, 224],
  m: [228, 0, 126],
  y: [255, 237, 0],
  k: [26, 23, 27],
};

/** Uncoated cup board is warm and slightly off-white. */
const PAPER_WHITE: RGB = [250, 249, 245];

export function simulateCmykPrint(v: CMYK): RGB {
  const amounts: [keyof typeof INK_SOLID, number][] = [
    ['c', clamp01(v.c)], ['m', clamp01(v.m)], ['y', clamp01(v.y)], ['k', clamp01(v.k)],
  ];

  const out: number[] = [PAPER_WHITE[0], PAPER_WHITE[1], PAPER_WHITE[2]];
  for (const [ink, amount] of amounts) {
    if (amount <= 0) continue;
    const solid = INK_SOLID[ink];
    for (let ch = 0; ch < 3; ch++) {
      // Transmittance of a full layer, interpolated by how much ink is laid
      // down. Multiplying filters is how ink actually stacks.
      const full = solid[ch]! / 255;
      const t = 1 - amount * (1 - full);
      out[ch] = out[ch]! * t;
    }
  }
  return [
    Math.max(0, Math.min(255, Math.round(out[0]!))),
    Math.max(0, Math.min(255, Math.round(out[1]!))),
    Math.max(0, Math.min(255, Math.round(out[2]!))),
  ];
}

/** How far a colour will shift in print, 0-255 per channel summed. */
export function printShift(rgb: RGB): number {
  const p = simulateCmykPrint(rgbToCmyk(rgb));
  return Math.abs(rgb[0] - p[0]) + Math.abs(rgb[1] - p[1]) + Math.abs(rgb[2] - p[2]);
}

/** CMYK back to RGB, the exact inverse of rgbToCmyk. NOT a print simulation. */
export function cmykToRgb(v: CMYK): RGB {
  const inv = 1 - clamp01(v.k);
  return [
    Math.round(255 * (1 - clamp01(v.c)) * inv),
    Math.round(255 * (1 - clamp01(v.m)) * inv),
    Math.round(255 * (1 - clamp01(v.y)) * inv),
  ];
}

/** Total area coverage, as a percentage. Digital presses typically cap ~300%. */
export function totalInkPct(v: CMYK): number {
  return (v.c + v.m + v.y + v.k) * 100;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function rgbToHex(rgb: RGB): string {
  return '#' + rgb.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* -------------------------------------------------------------------------- */
/* Palette                                                                     */
/* -------------------------------------------------------------------------- */

export interface PaletteEntry {
  rgb: RGB;
  hex: string;
  /** Ink values written to the PDF. Defaults to the converted rgb. */
  cmyk: CMYK;
  /** True once a human has supplied exact ink values for this colour. */
  overridden: boolean;
  /** How much of the artwork uses this colour, 0-1. */
  coverage: number;
}

export function makePaletteEntry(rgb: RGB, coverage = 0): PaletteEntry {
  return { rgb, hex: rgbToHex(rgb), cmyk: rgbToCmyk(rgb), overridden: false, coverage };
}

/**
 * Collect the distinct fill colours used by a set of shapes.
 *
 * Traced artwork often produces near-duplicate colours from antialiased edges,
 * so colours within `mergeDistance` of one another are merged. That keeps the
 * ink list short enough for a human to actually check and override.
 */
export function extractPalette(
  fills: readonly { fill: RGB; weight?: number }[],
  mergeDistance = 12,
): PaletteEntry[] {
  const buckets: { sum: [number, number, number]; n: number; weight: number }[] = [];

  for (const f of fills) {
    const w = f.weight ?? 1;
    let found = false;
    for (const b of buckets) {
      const c: RGB = [b.sum[0] / b.n, b.sum[1] / b.n, b.sum[2] / b.n];
      if (colourDistance(c, f.fill) <= mergeDistance) {
        b.sum[0] += f.fill[0]; b.sum[1] += f.fill[1]; b.sum[2] += f.fill[2];
        b.n++; b.weight += w;
        found = true;
        break;
      }
    }
    if (!found) buckets.push({ sum: [f.fill[0], f.fill[1], f.fill[2]], n: 1, weight: w });
  }

  const total = buckets.reduce((s, b) => s + b.weight, 0) || 1;
  return buckets
    .map((b) => makePaletteEntry(
      [Math.round(b.sum[0] / b.n), Math.round(b.sum[1] / b.n), Math.round(b.sum[2] / b.n)],
      b.weight / total,
    ))
    .sort((a, b) => b.coverage - a.coverage);
}

function colourDistance(a: RGB, b: RGB): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Nearest palette entry to a colour, so a shape can find its ink values. */
export function matchPalette(palette: readonly PaletteEntry[], rgb: RGB): PaletteEntry | null {
  let best: PaletteEntry | null = null;
  let bestD = Infinity;
  for (const p of palette) {
    const d = colourDistance(p.rgb, rgb);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}
