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
import {
  flattenPathData, gposKerning, describeFace,
  type FontResolver, type FontMatch, type OutlineFont, type OutlineGlyph,
} from '@cupco/vector';

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
/** The file each face was parsed from, kept for reading its kerning. */
const files = new Map<string, Uint8Array>();

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
      files.set(k, new Uint8Array(buf));
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

/* -------------------------------------------------------------------------- */
/* Fonts for text inside uploaded SVGs                                         */
/* -------------------------------------------------------------------------- */

/**
 * Which bundled face answers a CSS font-family list.
 *
 * A logo file names the font its designer used - "Brandon Grotesque",
 * "Futura PT", "Montserrat-Bold". Unless that font is embedded in the file,
 * the browser cannot have it either, and neither can the printer. What can be
 * done honestly is to set the text in the nearest face that IS here, of the
 * same kind - geometric for geometric, condensed for condensed, serif for
 * serif - and say so, rather than drawing nothing or drawing Times.
 *
 * `exact` is true only when the file named one of the bundled families.
 */
export interface FamilyMatch { id: string; exact: boolean }

const norm = (f: string) => f.toLowerCase().replace(/['"]/g, '').replace(/[\s_-]+/g, '');

const EXACT = new Map(FONT_CHOICES.map((f) => [norm(f.css), f.id]));
EXACT.set('intervariable', 'inter');

const GENERIC: Record<string, string> = {
  sansserif: 'inter', systemui: 'inter', uisansserif: 'inter', applesystem: 'inter',
  blinkmacsystemfont: 'inter', serif: 'playfair', uiserif: 'playfair',
  monospace: 'slab', uimonospace: 'slab', cursive: 'playfair', fantasy: 'oswald',
};

const CONDENSED = /condensed|compressed|narrow|impact|anton|leaguegothic|bebas|alternategothic|knockout|teko|fjalla|antonio|pathwaygothic|sixcaps/;
const SLAB = /slab|rockwell|arvo|courier|mono|clarendon|zilla|bitter|typewriter|consolas|menlo|monaco|egyptienne/;
const SERIF = /serif|times|georgia|garamond|baskerville|didot|bodoni|playfair|caslon|minion|merriweather|lora|cormorant|palatino|bookantiqua|cambria|crimson|abril|cinzel|trajan|optima|freight|canela|recoleta|ogg|tiempos|chronicle|mercury|sabon|bembo|plantin|goudy|century|bookman|didone|prata|marcellus|cardo/;
const GEOMETRIC = /futura|avenir|gotham|proximanova|centurygothic|poppins|raleway|nunito|quicksand|josefin|spartan|twcen|kumbh|urbanist|outfit|lexend|dmsans|worksans|sofia|brandon|museosans|circular|productsans|googlesans|gilroy|metropolis|montserrat|gothambook|vag|comfortaa|questrial|didact|mulish|figtree|jost|manrope/;
const SANS = /sans|helvetica|arial|inter|roboto|lato|segoe|sfpro|sanfrancisco|system|verdana|tahoma|trebuchet|gill|frutiger|myriad|univers|din|calibri|ubuntu|noto|plex|fira|karla|rubik|heebo|barlow|archivo|jakarta|geist|grotesk|grotesque|neue|akzidenz|aktiv|graphik|haas|franklin|nimbus|source/;

function classify(n: string): string | null {
  if (n.includes('bebas')) return 'bebas';
  if (CONDENSED.test(n)) return 'oswald';
  if (SLAB.test(n)) return 'slab';
  // "Merriweather Sans", "Noto Sans": the word sans outranks the family's
  // serif cousin, so it has to be asked before the serif list is.
  if (n.includes('sans')) return GEOMETRIC.test(n) ? 'montserrat' : 'inter';
  if (SERIF.test(n)) return 'playfair';
  if (GEOMETRIC.test(n)) return 'montserrat';
  if (SANS.test(n)) return 'inter';
  return null;
}

export function matchFamily(families: readonly string[]): FamilyMatch {
  for (const f of families) {
    const hit = EXACT.get(norm(f));
    if (hit) return { id: hit, exact: true };
  }
  for (const f of families) {
    const n = norm(f);
    const generic = GENERIC[n];
    if (generic) return { id: generic, exact: false };
    const kind = classify(n);
    if (kind) return { id: kind, exact: false };
  }
  // Nothing recognisable. A browser would fall back to its default serif;
  // for a cafe's wordmark a clean sans is the far likelier intent, and the
  // substitution is reported either way.
  return { id: 'inter', exact: false };
}

/**
 * The weight a browser would pick from the weights there are files for.
 *
 * CSS's own matching rule, not "nearest": 500 falls back to 400, 600 goes up
 * to 700. Using nearest would set SemiBold text in Regular half the time, and
 * the browser the file was checked in never does.
 */
export function cssWeightMatch(available: readonly number[], desired: number): number {
  const ws = [...available].sort((a, b) => a - b);
  if (ws.includes(desired)) return desired;
  const up = (from: number, to = Infinity) => ws.find((w) => w >= from && w <= to);
  const down = (from: number) => [...ws].reverse().find((w) => w <= from);
  if (desired >= 400 && desired <= 500) return up(desired, 500) ?? down(desired) ?? up(500)!;
  if (desired < 400) return down(desired) ?? up(desired)!;
  return up(desired) ?? down(desired)!;
}

/** CSS's default oblique angle, 14 degrees, as a skew. */
const SLANT = Math.tan((14 * Math.PI) / 180);

/** A loaded face, with its GPOS kerning attached - opentype.js reads none of it. */
const outlineFonts = new Map<string, OutlineFont>();

function outlineFontFor(id: string, weight: number): OutlineFont | null {
  const k = key(id, weight);
  const hit = outlineFonts.get(k);
  if (hit) return hit;
  const font = cache.get(k);
  if (!font) return null;
  const bytes = files.get(k);
  const kern = bytes ? gposKerning(bytes) : null;
  const wrapped: OutlineFont = {
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascender,
    descender: font.descender,
    charToGlyph: (ch: string) => font.charToGlyph(ch) as OutlineGlyph,
    getKerningValue: (a: OutlineGlyph, b: OutlineGlyph) =>
      font.getKerningValue(a as never, b as never),
    ...(kern ? { kernPairs: kern } : {}),
    tables: font.tables,
  };
  outlineFonts.set(k, wrapped);
  return wrapped;
}

let resolver: Promise<FontResolver> | null = null;

/**
 * Fonts for outlining live text in uploaded SVGs.
 *
 * Resolves once every bundled face has loaded, so the importer - which is
 * synchronous - never meets a face that is still on its way. A failure is not
 * cached: the next upload tries again.
 */
export function loadSvgFonts(): Promise<FontResolver> {
  resolver ??= (async () => {
    await preloadFonts();
    const opentype = await import('opentype.js');
    const fonts: FontResolver = {
      resolve(families, weight, italic): FontMatch | null {
        const { id, exact } = matchFamily(families);
        const choice = fontChoice(id);
        const w = cssWeightMatch(choice.weights, weight);
        const font = outlineFontFor(id, w);
        if (!font) return null;
        return {
          font,
          family: describeFace(choice.label, w, false) + (italic ? ', slanted' : ''),
          exact: exact && w === weight && !italic,
          key: key(id, w),
          ...(italic ? { skewX: SLANT } : {}),
        };
      },
      // Fonts embedded in the file itself, with @font-face.
      parse(bytes): OutlineFont | null {
        try {
          return opentype.parse(bytes.slice().buffer as ArrayBuffer) as unknown as OutlineFont;
        } catch {
          return null;
        }
      },
    };
    return fonts;
  })().catch((err: unknown) => { resolver = null; throw err; });
  return resolver;
}

/**
 * The file behind a face key ("montserrat-700"), with its weight - for
 * lending the browser the same face the importer used. Null if not loaded.
 */
export function fontFile(faceKey: string): { bytes: Uint8Array; weight: number } | null {
  const bytes = files.get(faceKey);
  const weight = Number(/-(\d+)$/.exec(faceKey)?.[1]);
  return bytes && Number.isFinite(weight) ? { bytes, weight } : null;
}
