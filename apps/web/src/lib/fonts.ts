/**
 * Font loading and text outlining.
 *
 * ---------------------------------------------------------------------------
 * WHY BUNDLED FONTS, NOT SYSTEM FONTS
 * ---------------------------------------------------------------------------
 * To export text as vector we must extract glyph outlines, and to do that we
 * need the font FILE — not a CSS family name. System fonts cannot be read by
 * the page, and even if they could, the file on the designer's machine may not
 * be the file on the printer's.
 *
 * So the app bundles a small set of SIL Open Font License faces. The browser
 * renders the preview from that exact file and opentype.js outlines the export
 * from that exact file, which is what makes the two provably identical.
 *
 * POSITIONING
 * Glyphs are advanced individually, using the font's own advance widths, in
 * BOTH the preview and the export. Letting canvas lay out the string (with its
 * own kerning and ligature handling) while outlining glyph-by-glyph would let
 * the two drift apart — the printed file would not match what was approved.
 */

import type { Font, Path } from 'opentype.js';
import type { DesignShape } from '@cupco/geometry';
import { flattenPathData } from '@cupco/vector';

export interface FontChoice {
  id: string;
  label: string;
  /** CSS family name registered by the @fontsource stylesheet. */
  css: string;
  /** Weights we have files for. */
  weights: number[];
}

export const FONT_CHOICES: FontChoice[] = [
  { id: 'inter',      label: 'Inter',            css: 'Inter',            weights: [400, 700] },
  { id: 'montserrat', label: 'Montserrat',       css: 'Montserrat',       weights: [400, 700] },
  { id: 'oswald',     label: 'Oswald',           css: 'Oswald',           weights: [400, 700] },
  { id: 'bebas',      label: 'Bebas Neue',       css: 'Bebas Neue',       weights: [400] },
  { id: 'playfair',   label: 'Playfair Display', css: 'Playfair Display', weights: [400, 700] },
  { id: 'slab',       label: 'Roboto Slab',      css: 'Roboto Slab',      weights: [400, 700] },
];

export function fontChoice(id: string): FontChoice {
  return FONT_CHOICES.find((f) => f.id === id) ?? FONT_CHOICES[0]!;
}

/** Nearest weight we actually have a file for. */
export function resolveWeight(id: string, weight: number): number {
  const w = fontChoice(id).weights;
  return w.reduce((best, cur) => (Math.abs(cur - weight) < Math.abs(best - weight) ? cur : best), w[0]!);
}

export function cssFamily(id: string): string {
  return `"${fontChoice(id).css}", sans-serif`;
}

/* -------------------------------------------------------------------------- */
/* Loading                                                                     */
/* -------------------------------------------------------------------------- */

const cache = new Map<string, Font>();
const inflight = new Map<string, Promise<Font | null>>();

function key(id: string, weight: number): string {
  return `${id}-${resolveWeight(id, weight)}`;
}

/** Already-loaded font, or null. Synchronous — safe to call while rendering. */
export function getLoadedFont(id: string, weight: number): Font | null {
  return cache.get(key(id, weight)) ?? null;
}

/**
 * Load a font file for outlining.
 *
 * Returns null rather than throwing: a missing font must degrade to
 * canvas-measured text, not break the editor.
 */
export async function loadFont(id: string, weight: number): Promise<Font | null> {
  const k = key(id, weight);
  const hit = cache.get(k);
  if (hit) return hit;
  const pending = inflight.get(k);
  if (pending) return pending;

  const p = (async () => {
    try {
      const res = await fetch(`/fonts/${k}.ttf`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      const opentype = await import('opentype.js');
      const font = opentype.parse(buf);
      cache.set(k, font);
      return font;
    } catch {
      return null;
    } finally {
      inflight.delete(k);
    }
  })();

  inflight.set(k, p);
  return p;
}

/** Load every bundled face, so previews and exports never wait mid-edit. */
export async function preloadFonts(): Promise<void> {
  await Promise.all(
    FONT_CHOICES.flatMap((f) => f.weights.map((w) => loadFont(f.id, w))),
  );
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

export interface GlyphLayout {
  /** Per-character x offset from the start of the string, in px. */
  offsets: number[];
  /** Total advance including tracking, in px. */
  width: number;
  /**
   * Distance from the baseline UP to the visual centre, in px.
   *
   * Used so text is centred on its em box the way canvas `textBaseline:
   * middle` does, while both paths still work in baseline coordinates.
   */
  centreOffset: number;
}

/**
 * Lay out a string using the font's own metrics.
 *
 * This is the single source of truth for glyph positions: the preview draws at
 * these offsets and the outliner emits at these offsets.
 */
export function layoutText(
  font: Font,
  text: string,
  sizePx: number,
  tracking: number,
): GlyphLayout {
  const upem = font.unitsPerEm || 1000;
  const scale = sizePx / upem;
  const extra = tracking * sizePx;

  const offsets: number[] = [];
  let x = 0;
  for (const ch of text) {
    offsets.push(x);
    const g = font.charToGlyph(ch);
    x += (g.advanceWidth ?? 0) * scale + extra;
  }
  // The trailing tracking gap is not part of the visible width.
  const width = Math.max(0, x - (text.length > 0 ? extra : 0));

  return {
    offsets,
    width,
    centreOffset: ((font.ascender + font.descender) / 2) * scale,
  };
}

/* -------------------------------------------------------------------------- */
/* Outlining                                                                   */
/* -------------------------------------------------------------------------- */

export interface OutlineOptions {
  text: string;
  font: Font;
  sizePx: number;
  tracking: number;
  /** Centre of the text block in design space. */
  u: number;
  v: number;
  rotationDeg: number;
  canvasW: number;
  canvasH: number;
  fill: readonly [number, number, number];
  opacity: number;
}

/**
 * Convert a text element into filled design-space shapes.
 *
 * Glyph outlines come out of opentype in y-down pixel space with the baseline
 * at zero — the same convention the canvas preview uses — so the conversion to
 * design space is the same flip applied to imported artwork.
 */
export function outlineText(o: OutlineOptions): DesignShape[] {
  if (!o.text.trim()) return [];

  const layout = layoutText(o.font, o.text, o.sizePx, o.tracking);
  const rad = (o.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);

  const shapes: DesignShape[] = [];
  const chars = [...o.text];

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch === ' ') continue;
    const glyph = o.font.charToGlyph(ch);

    // Baseline sits below the visual centre by centreOffset, so shifting the
    // glyph down by that amount centres the block on (u,v).
    const path: Path = glyph.getPath(
      layout.offsets[i]! - layout.width / 2,
      layout.centreOffset,
      o.sizePx,
    );

    const d = path.toPathData(3);
    if (!d) continue;

    const subpaths = flattenPathData(d)
      .filter((sp) => sp.points.length > 2)
      .map((sp) => sp.points.map((p) => {
        const rx = p.x * cos - p.y * sin;
        const ry = p.x * sin + p.y * cos;
        return {
          u: o.u + rx / o.canvasW,
          // Glyph space is y-down; design space is v-up.
          v: o.v - ry / o.canvasH,
        };
      }));

    if (subpaths.length) shapes.push({ subpaths, fill: o.fill, opacity: o.opacity });
  }
  return shapes;
}
