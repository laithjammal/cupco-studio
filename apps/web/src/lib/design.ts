/**
 * Design document — multiple elements in logical design space.
 *
 * Design space is the unrolled cup: u in [0,1) around the circumference with
 * u=0 at the seam, v in [0,1] from base to rim. Every element stores its
 * position and size in these NORMALISED units, never in pixels, so the same
 * document renders correctly at preview resolution, at the 3D texture size,
 * and at 600dpi export.
 */

import type { PlacedArtwork } from '@cupco/vector';
import {
  rgbToCmyk, simulateCmykPrint, hexToRgb, rgbToHex,
} from '@cupco/vector';
import { buildQrArtwork, normaliseUrl, getQrStyle, type QrFrameId } from '@cupco/qr';
import { cssFamily, getLoadedFont, layoutText, resolveWeight } from './fonts';

export type ElementId = string;

interface ElementBase {
  id: ElementId;
  /** Centre, design space. */
  u: number;
  v: number;
  /** Degrees, clockwise on the unrolled artwork. */
  rotation: number;
  name: string;
  /** 0-1. Defaults to fully opaque when absent. */
  opacity?: number;
  /**
   * Vertical stretch, as a multiple of the artwork's natural aspect.
   * Absent or 1 means untouched.
   *
   * Artwork is otherwise sized by `widthU` alone, with height following the
   * source's own proportions - which is right for a logo, where distorting it
   * is nearly always a mistake, and wrong for a shape, where an ellipse or a
   * long rectangle is the point. This is what the EDGE handles drive; the
   * corner handles still scale both axes together and leave it alone.
   */
  stretchV?: number;
}

export interface ImageElement extends ElementBase {
  type: 'image';
  image: HTMLImageElement;
  /**
   * Content hash of the ORIGINAL uploaded bytes, in the asset store.
   *
   * Carried on the element because an HTMLImageElement cannot be turned back
   * into the file it came from: reading it out through a canvas would
   * re-encode it, inflating a 200KB JPEG into a multi-megabyte PNG and losing
   * the original in the process. So the reference is captured at upload, when
   * the bytes are still in hand.
   *
   * Vector elements need no equivalent: their artwork IS plain data, so its
   * hash can be computed from the element itself at save time.
   */
  assetId: string;
  /** Width as a fraction of the full circumference. Height follows aspect. */
  widthU: number;
}

export interface TextElement extends ElementBase {
  type: 'text';
  content: string;
  /** Cap height as a fraction of cup height. */
  sizeV: number;
  color: string;
  /** 100-900. */
  weight: number;
  /** A key from FONT_CHOICES. */
  fontFamily: string;
  italic: boolean;
  /** Extra letter spacing, as a fraction of the font size. */
  tracking: number;
  align: 'left' | 'center' | 'right';
}

/** Re-exported so the UI has a single import for font choices. */
export { FONT_CHOICES, cssFamily } from './fonts';

/**
 * Vector artwork — the only element type that can be exported as true vector.
 *
 * Held as normalised shapes so it can be re-placed, re-scaled and re-warped at
 * any resolution without loss. Raster uploads become this too, if traced.
 */
export interface VectorElement extends ElementBase {
  type: 'vector';
  art: PlacedArtwork;
  /** Width as a fraction of the full circumference. */
  widthU: number;
  /** True when produced by tracing a raster upload rather than an SVG. */
  traced: boolean;
}

/**
 * A horizontal band of flat colour, spanning the full circumference.
 *
 * Cup artwork leans on these constantly — a base block, a stripe under the
 * rim, a two-tone split — and none of them can be expressed with images and
 * text alone. Because it wraps the whole cup there is no seam to align, which
 * is exactly why the shape is so common on real cups.
 */
export interface BandElement extends ElementBase {
  type: 'band';
  /** Height as a fraction of the cup height. */
  heightV: number;
  color: string;
}

/**
 * A QR code.
 *
 * Holds the URL, with the rendered modules cached as vector artwork so it
 * travels the same path as a logo — warped onto the fan, exported as vector,
 * crisp at any size. Changing the URL regenerates `art`.
 */
export interface QrElement extends ElementBase {
  type: 'qr';
  /** What the code points at. Empty means the placeholder is showing. */
  url: string;
  /** Whether `url` is a real, resolvable address. */
  live: boolean;
  art: PlacedArtwork;
  /** Width as a fraction of the circumference. Height matches (QRs are square). */
  widthU: number;
  moduleCount: number;
  /** A preset from QR_STYLES. Only changes how modules are DRAWN. */
  styleId: string;
  /** A preset from QR_FRAMES: the SHAPE the code sits in. */
  frameId: QrFrameId;
  /**
   * A shape drawn AS the code rather than around it.
   *
   * 'none' unless chosen. The two are alternatives, not layers: a shape is
   * either the ground the code sits on, or the code itself.
   */
  silhouetteId: QrFrameId;
  /** How much larger than normal a module must print. 3 for a silhouette. */
  minModuleScale: number;
  /**
   * Width of the code and its quiet zone as a fraction of the artwork's width.
   *
   * 1 for the plain square, less inside any frame. Carried on the element
   * because the printable floor is a MODULE size, and preflight cannot work
   * that out from `widthU` alone once the artwork is bigger than the code.
   */
  codeFraction: number;
}

export type DesignElement =
  | ImageElement | TextElement | VectorElement | BandElement | QrElement;

export interface Design {
  background: string;
  /** Painted in order; last is on top. */
  elements: DesignElement[];
}

let idCounter = 0;
export const nextId = (): ElementId => `el-${++idCounter}`;

/**
 * Advance the id counter past every id in `elements`.
 *
 * Ids are assigned from a module-level counter that restarts at zero on every
 * page load. Opening a saved project would therefore hand the next new element
 * an id a loaded element already holds - and since selection, hit-testing and
 * undo all key on id, the two would become the same element. Call this
 * immediately after loading a document, before anything new can be created.
 */
export function reserveIds(elements: readonly DesignElement[]): void {
  for (const el of elements) {
    const match = /^el-(\d+)$/.exec(el.id);
    if (match) idCounter = Math.max(idCounter, Number(match[1]));
  }
}

export const EMPTY_DESIGN: Design = { background: '#1c4532', elements: [] };

export function createTextElement(content = 'CUPCO'): TextElement {
  return {
    id: nextId(), type: 'text', name: content || 'Text',
    u: 0.5, v: 0.55, rotation: 0,
    content, sizeV: 0.16, color: '#f7fafc', weight: 700,
    fontFamily: 'inter', italic: false, tracking: 0, align: 'center',
  };
}

/**
 * Rebuild a QR's artwork.
 *
 * One place, because URL, style and frame all feed the same builder and three
 * near-identical copies of this call is how they drift apart.
 */
function qrArt(url: string, styleId: string, frameId: QrFrameId, silhouetteId: QrFrameId) {
  const target = normaliseUrl(url) ?? 'https://example.com';
  const { art, moduleCount, codeFraction, minModuleScale } = buildQrArtwork(target, {
    style: getQrStyle(styleId),
    frame: frameId,
    silhouette: silhouetteId,
    // A silhouette spends error-correction budget on the picture, so it gets
    // the highest level rather than the default.
    level: silhouetteId === 'none' ? 'M' : 'H',
  });
  return { art, moduleCount, codeFraction, minModuleScale };
}

export function createQrElement(
  url: string,
  placeholderUrl = 'https://example.com',
  styleId = 'classic',
  frameId: QrFrameId = 'none',
  silhouetteId: QrFrameId = 'none',
): QrElement {
  const live = normaliseUrl(url) !== null;
  const built = qrArt(normaliseUrl(url) ?? placeholderUrl, styleId, frameId, silhouetteId);
  return {
    id: nextId(), type: 'qr', name: live ? 'QR code' : 'QR code (placeholder)',
    u: 0.75, v: 0.55, rotation: 0,
    url, live, widthU: 0.13, styleId, frameId, silhouetteId, ...built,
  };
}

/** Rebuild a QR element's artwork for a new URL, keeping its style and frame. */
export function withQrUrl(el: QrElement, url: string): QrElement {
  const normalised = normaliseUrl(url);
  return {
    ...el, url, live: normalised !== null,
    ...qrArt(normalised ?? 'https://example.com', el.styleId, el.frameId, el.silhouetteId),
    name: normalised ? 'QR code' : 'QR code (placeholder)',
  };
}

/**
 * Rebuild a QR element's artwork in a different style, keeping its URL.
 *
 * The data is untouched - only how each module is drawn changes - so the
 * module count and everything the code encodes stay identical.
 */
export function withQrStyle(el: QrElement, styleId: string): QrElement {
  return { ...el, styleId, ...qrArt(el.url, styleId, el.frameId, el.silhouetteId) };
}

/**
 * Rebuild a QR element's artwork in a different frame, keeping its URL.
 *
 * The frame is the light ground the code sits on, so the code itself is
 * untouched here too - only how much of the artwork it occupies changes.
 */
export function withQrFrame(el: QrElement, frameId: QrFrameId): QrElement {
  // A frame and a silhouette are alternatives: choosing one clears the other.
  return {
    ...el, frameId, silhouetteId: 'none',
    ...qrArt(el.url, el.styleId, frameId, 'none'),
  };
}

/**
 * Draw the code AS a shape rather than putting a shape around it.
 *
 * The silhouette is painted over the code and each module's centre restored to
 * its true value, which is the only part a decoder reads. Structural modules -
 * the eyes, timing and alignment patterns - are never painted over.
 */
export function withQrSilhouette(el: QrElement, silhouetteId: QrFrameId): QrElement {
  return {
    ...el, silhouetteId, frameId: 'none',
    ...qrArt(el.url, el.styleId, 'none', silhouetteId),
  };
}

export function createBandElement(color = '#0f172a', v = 0.25, heightV = 0.22): BandElement {
  return {
    id: nextId(), type: 'band', name: 'Colour band',
    u: 0.5, v, rotation: 0,
    heightV, color,
  };
}

export function createVectorElement(art: PlacedArtwork, name: string, traced: boolean): VectorElement {
  return {
    id: nextId(), type: 'vector', name,
    u: 0.5, v: 0.55, rotation: 0,
    widthU: 0.25, art, traced,
  };
}

export function createImageElement(
  image: HTMLImageElement,
  name: string,
  assetId: string,
): ImageElement {
  return {
    id: nextId(), type: 'image', name,
    u: 0.5, v: 0.55, rotation: 0,
    widthU: 0.25,
    image, assetId,
  };
}

/** Vertical stretch multiplier, defaulting to 1 when never touched. */
export function stretchOf(el: { stretchV?: number }): number {
  const v = el.stretchV;
  return v === undefined || !Number.isFinite(v) || v <= 0 ? 1 : v;
}

/** Half-extents of an element in design space (u,v), before rotation. */
export interface HalfExtent { du: number; dv: number }

/**
 * Size of an element in design-space units.
 *
 * The canvas aspect ratio is needed because u and v are both normalised but
 * span different physical distances: preserving an image's pixel aspect
 * requires converting through the canvas dimensions.
 */
export function halfExtent(
  el: DesignElement,
  canvasW: number,
  canvasH: number,
  measure?: CanvasRenderingContext2D,
): HalfExtent {
  if (el.type === 'band') {
    // Full width by definition; rotation is meaningless for a wrapping band.
    return { du: 0.5, dv: el.heightV / 2 };
  }
  if (el.type === 'image' || el.type === 'vector' || el.type === 'qr') {
    const wPx = el.widthU * canvasW;
    const aspect = el.type === 'image'
      ? el.image.naturalHeight / Math.max(1, el.image.naturalWidth)
      : el.art.aspect;
    return { du: el.widthU / 2, dv: (wPx * aspect * stretchOf(el)) / canvasH / 2 };
  }
  const sizePx = el.sizeV * canvasH;
  const wPx = measure
    ? measureText(el, sizePx, measure)
    : sizePx * 0.62 * Math.max(1, el.content.length); // fallback estimate
  return { du: wPx / canvasW / 2, dv: sizePx / canvasH / 2 };
}

function fontFor(el: TextElement, sizePx: number): string {
  const w = resolveWeight(el.fontFamily, el.weight);
  return `${el.italic ? 'italic ' : ''}${w} ${Math.round(sizePx)}px ${cssFamily(el.fontFamily)}`;
}

/**
 * Width of a text element in px, including tracking.
 *
 * Uses the FONT's advance widths when the file is loaded, falling back to
 * canvas measurement only until it is. Sharing one metric source with the
 * outliner is what guarantees the printed text matches the preview.
 */
function measureText(el: TextElement, sizePx: number, ctx: CanvasRenderingContext2D): number {
  const font = getLoadedFont(el.fontFamily, el.weight);
  if (font) return layoutText(font, el.content, sizePx, el.tracking).width;

  ctx.save();
  ctx.font = fontFor(el, sizePx);
  const base = ctx.measureText(el.content).width;
  ctx.restore();
  return base + el.tracking * sizePx * Math.max(0, el.content.length - 1);
}

/**
 * Draw text glyph by glyph at the font's own advances.
 *
 * Deliberately NOT a single fillText: canvas would apply its own kerning and
 * ligature handling, while the vector outliner advances per glyph. Laying both
 * out the same way is the only way the two can be guaranteed identical.
 */
function drawTextGlyphs(
  ctx: CanvasRenderingContext2D,
  el: TextElement,
  sizePx: number,
): void {
  const font = getLoadedFont(el.fontFamily, el.weight);
  ctx.textAlign = 'left';

  if (!font) {
    // Pre-load fallback: centre the string and let canvas lay it out.
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(el.content, 0, 0);
    return;
  }

  const layout = layoutText(font, el.content, sizePx, el.tracking);
  // Work in baseline coordinates, matching the outliner exactly.
  ctx.textBaseline = 'alphabetic';
  const chars = [...el.content];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch === ' ') continue;
    ctx.fillText(ch, layout.offsets[i]! - layout.width / 2, layout.centreOffset);
  }
}

/**
 * The four corners of an element in design space, rotation applied.
 *
 * Used for hit-testing pointer input and for drawing selection handles on the
 * warped fan - each corner is mapped through the geometry engine individually,
 * so the selection box follows the warp rather than floating over it.
 */
export function elementCorners(
  el: DesignElement,
  canvasW: number,
  canvasH: number,
  measure?: CanvasRenderingContext2D,
): { u: number; v: number }[] {
  const { du, dv } = halfExtent(el, canvasW, canvasH, measure);
  const rad = (el.rotation * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  // Rotate in PIXEL space so the result is not sheared by the u/v aspect
  // difference, then convert back to normalised units.
  const pxs: [number, number][] = [[-du * canvasW, -dv * canvasH], [du * canvasW, -dv * canvasH],
                                   [du * canvasW, dv * canvasH], [-du * canvasW, dv * canvasH]];
  return pxs.map(([x, y]) => ({
    u: el.u + (x * cos - y * sin) / canvasW,
    // v increases upward while canvas y increases downward.
    v: el.v - (x * sin + y * cos) / canvasH,
  }));
}

/** Point-in-polygon, used for hit-testing in design space. */
export function pointInPolygon(
  pt: { u: number; v: number },
  poly: { u: number; v: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.v > pt.v) !== (b.v > pt.v) &&
        pt.u < ((b.u - a.u) * (pt.v - a.v)) / (b.v - a.v) + a.u) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Topmost element under a design-space point, or null.
 *
 * u is tested at three offsets because design space wraps: an element
 * straddling the seam is visible on both sides of the canvas, and must be
 * selectable from either.
 */
export function hitTest(
  design: Design,
  pt: { u: number; v: number },
  canvasW: number,
  canvasH: number,
  measure?: CanvasRenderingContext2D,
): DesignElement | null {
  for (let i = design.elements.length - 1; i >= 0; i--) {
    const el = design.elements[i]!;
    const corners = elementCorners(el, canvasW, canvasH, measure);
    for (const du of [-1, 0, 1]) {
      if (pointInPolygon({ u: pt.u + du, v: pt.v }, corners)) return el;
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Draw a Design onto a 2D canvas in design space.
 *
 * Canvas row 0 is the TOP of the cup, matching both the Three.js texture
 * convention (flipY) and the rasteriser's sampling convention. Getting this
 * backwards would print every cup upside down.
 *
 * Every element is drawn THREE times - at x-width, x, and x+width - so
 * anything overlapping the seam appears continuous. Without this a logo
 * straddling u=0 would be clipped on the finished cup.
 */
export interface RenderOptions {
  /**
   * The design-space v range this canvas covers, bottom and top.
   *
   * Default 0..1, i.e. exactly the cup wall. Widen it and the canvas gains
   * overscan above the rim and below the base, so artwork pushed out towards
   * the die is actually drawn rather than falling off the canvas.
   *
   * Pixels-per-v is held constant (height / span), so nothing changes size:
   * a wider range means a taller canvas showing more, not the same design
   * squashed. Pass `@cupco/geometry`'s boundaryVRange to fill a given
   * boundary.
   */
  vRange?: { bottom: number; top: number };
  /**
   * Show colours as they will print in CMYK ink.
   *
   * CMYK has a smaller gamut than a screen, so saturated colours genuinely
   * cannot be reproduced — which is why an exported PDF can look different
   * from the editor. Rather than hiding that, this simulates the conversion so
   * the screen and the print file agree. This is a VIEW setting only; export
   * always uses the real values.
   */
  proofCmyk?: boolean;
  /**
   * Leave the background transparent and draw only the artwork.
   *
   * For a photo mockup the cup's own paper IS the background: it is right
   * there in the photograph, with its real shading and texture. Painting the
   * design's background over it puts a flat panel on the cup with a visible
   * edge - the artwork stops reading as printed and starts reading as a
   * sticker. So the plate compositor asks for artwork only, unless the design
   * genuinely calls for a coloured cup.
   */
  transparentBackground?: boolean;
}

/**
 * Map a colour through a simulated ink print, for soft proofing.
 *
 * Uses simulateCmykPrint rather than the exact inverse of rgbToCmyk — the
 * inverse round-trips losslessly and would show no change at all, which is
 * precisely the bug this replaced.
 */
export function proofColor(hex: string): string {
  return rgbToHex(simulateCmykPrint(rgbToCmyk(hexToRgb(hex))));
}

export function renderDesign(
  ctx: CanvasRenderingContext2D,
  design: Design,
  width: number,
  height: number,
  options: RenderOptions = {},
): void {
  const paint = (hex: string) => (options.proofCmyk ? proofColor(hex) : hex);

  // Vertical mapping. `height` is the canvas; `pxPerV` is what a unit of
  // design v is worth in it. They are the same thing only when the canvas
  // covers exactly v=0..1, which is why every vertical measurement below goes
  // through pxPerV rather than height.
  const vTop = options.vRange?.top ?? 1;
  const vBottom = options.vRange?.bottom ?? 0;
  const pxPerV = height / (vTop - vBottom);
  const yOf = (v: number) => (vTop - v) * pxPerV;

  ctx.clearRect(0, 0, width, height);
  if (!options.transparentBackground) {
    ctx.fillStyle = paint(design.background);
    ctx.fillRect(0, 0, width, height);
  }

  for (const el of design.elements) {
    for (const dx of [-width, 0, width]) {
      ctx.save();
      ctx.globalAlpha = el.opacity ?? 1;
      ctx.translate(el.u * width + dx, yOf(el.v));
      ctx.rotate((el.rotation * Math.PI) / 180);

      if (el.type === 'band') {
        const bh = el.heightV * pxPerV;
        ctx.fillStyle = paint(el.color);
        // Drawn at triple width so the three seam passes cannot leave a gap.
        ctx.fillRect(-width, -bh / 2, width * 3, bh);
      } else if (el.type === 'image') {
        const w = el.widthU * width;
        const h = w * (el.image.naturalHeight / Math.max(1, el.image.naturalWidth)) * stretchOf(el);
        ctx.drawImage(el.image, -w / 2, -h / 2, w, h);
      } else if (el.type === 'qr') {
        const w = el.widthU * width;
        const h = w * el.art.aspect * stretchOf(el);
        // The light ground is the artwork's FIRST shape now, emitted by the QR
        // builder with the frame, so it is drawn like any other - not painted
        // here as a white rectangle. It stopped being a rectangle the moment
        // frames existed, and each shape carries its own fill.
        for (const shape of el.art.shapes) {
          ctx.fillStyle = `rgb(${shape.fill[0]},${shape.fill[1]},${shape.fill[2]})`;
          ctx.beginPath();
          for (const sp of shape.subpaths) {
            sp.forEach((pt, i) => {
              const x = (pt.x - 0.5) * w;
              const y = (pt.y - 0.5) * h;
              if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.closePath();
          }
          ctx.fill();
        }
      } else if (el.type === 'vector') {
        // Preview only. Export re-warps the SAME shapes as real paths, so what
        // is drawn here and what is printed come from one source.
        const w = el.widthU * width;
        const h = w * el.art.aspect * stretchOf(el);
        for (const shape of el.art.shapes) {
          ctx.globalAlpha = (el.opacity ?? 1) * shape.opacity;
          const c = options.proofCmyk ? simulateCmykPrint(rgbToCmyk(shape.fill)) : shape.fill;
          ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
          ctx.beginPath();
          for (const sp of shape.subpaths) {
            sp.forEach((pt, i) => {
              const x = (pt.x - 0.5) * w;
              const y = (pt.y - 0.5) * h;
              if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.closePath();
          }
          ctx.fill('evenodd');
        }
      } else if (el.content.trim() !== '') {
        const sizePx = Math.max(4, el.sizeV * pxPerV);
        ctx.fillStyle = paint(el.color);
        ctx.font = fontFor(el, sizePx);
        drawTextGlyphs(ctx, el, sizePx);
      }
      ctx.restore();
    }
  }
}

/** Render a Design to an offscreen canvas and return it. */
export function renderDesignToCanvas(
  design: Design,
  width: number,
  height: number,
  reuse?: HTMLCanvasElement,
  options: RenderOptions = {},
): HTMLCanvasElement {
  const canvas = reuse ?? document.createElement('canvas');
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas context unavailable');
  renderDesign(ctx, design, width, height, options);
  return canvas;
}
