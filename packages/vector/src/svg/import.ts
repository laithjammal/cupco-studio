/**
 * SVG document -> filled shapes and positioned images, as a browser draws it.
 *
 * The test of this module is simple to state: take any SVG, render it in a
 * real renderer, render what this produced, and the two pictures should be the
 * same. The fidelity suite in test/fidelity does exactly that, file by file,
 * against resvg - so a gap here is a measured number, not a guess.
 *
 * What it handles: the full style cascade (stylesheets with real selectors,
 * inheritance, !important); every basic shape and path; transforms, nested
 * viewports, <use>/<symbol>, <switch> and conditional attributes; hidden and
 * display:none content; fills and strokes with every join, cap and dash;
 * linear and radial gradients and patterns, as banded and tiled vector
 * geometry; clip paths and masks, as real boolean geometry; live text,
 * outlined from fonts; embedded images, kept as images; embedded SVG images,
 * imported as vector. What it does not: filters (shadows, blurs) and markers.
 * Both are REPORTED, so the gap is never silent.
 */

import type { RGB } from '../color';
import { flattenPathData, type Pt, type SubPath } from '../path-data';
import { strokeOutline, dashSubpaths } from '../stroke';
import { parseXml, elements, textContent, type XElement } from './xml';
import { parseStylesheet, declared, type Stylesheet } from './css';
import { computeStyle, INITIAL, solidOf, type Style, type Paint, type FillRule } from './style';
import { Regions, boxOf, rectRing, boxWithin, type Ring, type Box } from './region';
import { gradientBands, type Gradient, type Stop } from './paint';
import { layoutText, type OutlineFont, type FontMatch } from './text';
import { parseDataUrl, imageSize, utf8 } from './image';
import { gposKerning } from './kerning';
import {
  IDENTITY, apply, invert, mul, scaleOf, translate, scaling, transform, viewBox, aspectRatio,
  viewBoxTransform, length, numbers, colour, type Mat,
} from './values';

export type { FillRule } from './style';
export type { OutlineFont, OutlineGlyph, FontMatch } from './text';

export interface ImportedShape {
  subpaths: SubPath[];
  fill: RGB;
  opacity: number;
  fillRule: FillRule;
}

/**
 * An embedded bitmap, kept as a bitmap.
 *
 * `matrix` maps the image's unit square (0..1, y down) into document units, so
 * any rotation or skew survives; `clip` is the visible outline in document
 * units when something clips it, and `before` is its place in the drawing
 * order - it is painted before shapes[before].
 */
export interface ImportedRaster {
  href: string;
  mime: string;
  matrix: Mat;
  naturalWidth: number;
  naturalHeight: number;
  opacity: number;
  clip: SubPath[] | null;
  before: number;
}

export interface FontUse { requested: string; used: string; exact: boolean }

export interface SvgImportResult {
  shapes: ImportedShape[];
  rasters: ImportedRaster[];
  /** The document's visible area, in document units. */
  width: number;
  height: number;
  /** Human-readable notes about anything not reproduced exactly. */
  warnings: string[];
  fonts: FontUse[];
}

export interface FontResolver {
  /** The best available face for a CSS font request. */
  resolve(families: readonly string[], weight: number, italic: boolean): FontMatch | null;
  /** Parse font file bytes, for fonts embedded in the SVG with @font-face. */
  parse?(bytes: Uint8Array): OutlineFont | null;
}

export interface SvgImportOptions {
  /** Fonts for live text. Without them, text is reported and not drawn. */
  fonts?: FontResolver;
}

/** Bumped whenever the importer's output for some file changes. Saved logos re-import when it does. */
export const IMPORTER_VERSION = 2;

/* -------------------------------------------------------------------------- */

interface Sink { shapes: ImportedShape[]; rasters: ImportedRaster[] }
interface MaskPart { rings: Ring[]; value: number; box: Box | null }

interface Ctx {
  /** User space -> document. */
  ctm: Mat;
  /** Computed style of the parent, for inheritance. */
  parent: Style;
  /** Accumulated clip, clean, in document units. null: unclipped. */
  clip: Ring[] | null;
  masks: MaskPart[][];
  /** Product of group opacities. */
  opacity: number;
  /** Nearest viewport, for percentages. */
  vw: number;
  vh: number;
  sink: Sink;
  /** References being expanded, to cut cycles. */
  chain: ReadonlySet<XElement>;
}

const GRAPHICS = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const RENDERED = new Set([...GRAPHICS, 'g', 'a', 'switch', 'svg', 'use', 'image', 'text']);

const lum = (c: RGB) => (0.2125 * c[0] + 0.7154 * c[1] + 0.0721 * c[2]) / 255;
const closed = (rings: Ring[]): SubPath[] => rings.map((points) => ({ points, closed: true }));
const boxesMeet = (a: Box | null, b: Box | null) =>
  !!a && !!b && a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

class Importer {
  private root: XElement | null;
  private sheet: Stylesheet = { rules: [], fontFaces: [], skipped: 0 };
  private byId = new Map<string, XElement>();
  private warnings = new Set<string>();
  private fontUses = new Map<string, FontUse>();
  private declCache = new Map<XElement, Map<string, string>>();
  private chainCache = new Map<XElement, Style>();
  private embedded = new Map<string, OutlineFont | null>();
  private regions = new Regions(1000);
  /** Curve tolerance in document units. */
  private tol = 0.25;
  private rootBox: Box | null = null;
  private result: Sink = { shapes: [], rasters: [] };
  private width = 0;
  private height = 0;

  constructor(src: string, private opts: SvgImportOptions, private nesting = 0) {
    this.root = parseXml(src);
  }

  private warn(m: string) { this.warnings.add(m); }

  run(): SvgImportResult {
    const root = this.root;
    if (!root) return { shapes: [], rasters: [], width: 0, height: 0, warnings: ['Not a valid SVG document'], fonts: [] };

    // Style sheets, from every <style> in the document, in document order.
    const walkAll = (el: XElement) => {
      if (el.tag === 'style') {
        const type = (el.attrs['type'] ?? 'text/css').toLowerCase();
        if (type === 'text/css' || type === '') parseStylesheet(textContent(el), this.sheet);
      }
      const id = el.attrs['id'];
      if (id && !this.byId.has(id)) this.byId.set(id, el);
      for (const c of elements(el)) walkAll(c);
    };
    walkAll(root);
    if (this.sheet.skipped) this.warn('some style rules use selectors that could not be applied');

    // The visible area: the root viewBox, or its width and height.
    const vb = viewBox(root.attrs['viewbox']);
    const w = length(root.attrs['width'], { percentOf: vb?.w ?? NaN, fontSize: 16 }, NaN);
    const h = length(root.attrs['height'], { percentOf: vb?.h ?? NaN, fontSize: 16 }, NaN);
    let base: Mat = IDENTITY;
    if (vb) {
      this.width = vb.w; this.height = vb.h;
      base = translate(-vb.x, -vb.y);
      this.rootBox = { x0: 0, y0: 0, x1: vb.w, y1: vb.h };
      if (w > 0 && h > 0) {
        // Letterboxing from preserveAspectRatio widens what is visible.
        const vbt = viewBoxTransform(vb, aspectRatio(root.attrs['preserveaspectratio']), w, h);
        const inv = invert(vbt);
        if (inv) {
          const a = apply(inv, { x: 0, y: 0 }), b = apply(inv, { x: w, y: h });
          this.rootBox = {
            x0: Math.min(a.x, b.x) - vb.x, y0: Math.min(a.y, b.y) - vb.y,
            x1: Math.max(a.x, b.x) - vb.x, y1: Math.max(a.y, b.y) - vb.y,
          };
        }
      }
    } else if (w > 0 && h > 0) {
      this.width = w; this.height = h;
      this.rootBox = { x0: 0, y0: 0, x1: w, y1: h };
    }
    const size = Math.max(this.width, this.height) || 1000;
    this.regions = new Regions(size);
    this.tol = size / 4000;

    const style = this.styleFor(root, INITIAL, { vw: this.width || 100, vh: this.height || 100 });
    if (style.display) {
      const ctx: Ctx = {
        ctm: base, parent: style, clip: null, masks: [], opacity: style.opacity,
        vw: this.width || 100, vh: this.height || 100, sink: this.result, chain: new Set(),
      };
      const fx = this.effects(root, style, base, ctx);
      if (fx) this.children(root, { ...ctx, clip: fx.clip, masks: fx.masks });
    }

    if (!(this.width > 0) || !(this.height > 0)) {
      const all = [
        ...this.result.shapes.flatMap((s) => s.subpaths.map((p) => p.points)),
        ...this.result.rasters.map((r) => [apply(r.matrix, { x: 0, y: 0 }), apply(r.matrix, { x: 1, y: 1 })]),
      ];
      const b = boxOf(all);
      this.width = b ? b.x1 : 1;
      this.height = b ? b.y1 : 1;
    }
    if (this.result.shapes.length === 0 && this.result.rasters.length === 0) this.warn('No visible artwork found');

    return {
      shapes: this.result.shapes,
      rasters: this.result.rasters,
      width: this.width || 1,
      height: this.height || 1,
      warnings: [...this.warnings],
      fonts: [...this.fontUses.values()],
    };
  }

  /* ------------------------------- style -------------------------------- */

  private declOf(el: XElement): Map<string, string> {
    let d = this.declCache.get(el);
    if (!d) { d = declared(el, this.sheet); this.declCache.set(el, d); }
    return d;
  }

  private styleFor(el: XElement, parent: Style, vp: { vw: number; vh: number }): Style {
    return computeStyle(this.declOf(el), el.attrs, parent, vp);
  }

  /** Style from the element's own place in the document - for <defs> content. */
  private styleInPlace(el: XElement): Style {
    const hit = this.chainCache.get(el);
    if (hit) return hit;
    const parent = el.parent ? this.styleInPlace(el.parent) : INITIAL;
    const s = this.styleFor(el, parent, { vw: this.width || 100, vh: this.height || 100 });
    this.chainCache.set(el, s);
    return s;
  }

  /** systemLanguage / requiredExtensions, as a browser evaluates them. */
  private passes(el: XElement): boolean {
    if (el.attrs['requiredextensions'] !== undefined) return false;
    const lang = el.attrs['systemlanguage'];
    if (lang !== undefined) {
      const langs = lang.split(',').map((s) => s.trim().toLowerCase());
      if (!langs.some((l) => l === 'en' || l.startsWith('en-'))) return false;
    }
    return true;
  }

  /* ------------------------------ traversal ------------------------------ */

  private children(el: XElement, ctx: Ctx): void {
    for (const c of elements(el)) this.element(c, ctx);
  }

  private element(el: XElement, ctx: Ctx): void {
    if (!RENDERED.has(el.tag)) {
      if (el.tag === 'foreignobject' && this.passes(el) && elements(el).length) {
        this.warn('embedded HTML (<foreignObject>) is not drawn');
      }
      return;
    }
    if (!this.passes(el)) return;
    const style = this.styleFor(el, ctx.parent, ctx);
    if (!style.display) return;
    const m = mul(ctx.ctm, transform(el.attrs['transform']));

    const fx = this.effects(el, style, m, ctx);
    if (!fx) return;
    if (style.filter) this.warn('filter effects (shadows, blurs) are not reproduced — the artwork is shown without them');
    if (style.markers) this.warn('markers (arrowheads) are not drawn');
    const c: Ctx = { ...ctx, ctm: m, parent: style, clip: fx.clip, masks: fx.masks, opacity: ctx.opacity * style.opacity };

    switch (el.tag) {
      case 'g': case 'a': this.children(el, c); return;
      case 'switch': {
        for (const k of elements(el)) {
          if (RENDERED.has(k.tag) && this.passes(k)) { this.element(k, c); break; }
        }
        return;
      }
      case 'svg': this.nestedSvg(el, style, c); return;
      case 'use': this.use(el, style, c); return;
      case 'image': this.image(el, style, c); return;
      case 'text': this.text(el, style, c); return;
      default: {
        const subs = this.geometry(el, c, style.fontSize);
        if (subs.length) this.paint(subs, style, c, () => this.boxOfSubs(subs));
      }
    }
  }

  private nestedSvg(el: XElement, style: Style, ctx: Ctx): void {
    const L = (a: string, of: number, d: string) => length(el.attrs[a] ?? d, { percentOf: of, fontSize: style.fontSize }, 0);
    const x = L('x', ctx.vw, '0'), y = L('y', ctx.vh, '0');
    const w = L('width', ctx.vw, '100%'), h = L('height', ctx.vh, '100%');
    if (!(w > 0) || !(h > 0)) return;
    this.viewport(el, style, ctx, mul(ctx.ctm, translate(x, y)), w, h, el);
  }

  /** Shared by nested <svg> and <use> of a <symbol>/<svg>: viewBox, aspect, overflow clip. */
  private viewport(content: XElement, style: Style, ctx: Ctx, at: Mat, w: number, h: number, viewSource: XElement): void {
    const vb = viewBox(viewSource.attrs['viewbox']);
    const par = aspectRatio(viewSource.attrs['preserveaspectratio']);
    let clip = ctx.clip;
    if (!style.overflowVisible) {
      const rect = this.regions.clean([rectRing(0, 0, w, h).map((p) => apply(at, p))], 'nonzero');
      clip = clip ? this.regions.intersect(clip, rect) : rect;
      if (!clip.length) return;
    }
    const inner = vb ? mul(at, viewBoxTransform(vb, par, w, h)) : at;
    this.children(content, { ...ctx, ctm: inner, clip, vw: vb?.w ?? w, vh: vb?.h ?? h });
  }

  private use(el: XElement, style: Style, ctx: Ctx): void {
    const href = (el.attrs['href'] ?? el.attrs['xlink:href'] ?? '').trim();
    const hash = href.indexOf('#');
    if (hash !== 0) {
      if (href) this.warn('a <use> refers to another file, which cannot be followed — embed it instead');
      return;
    }
    const target = this.byId.get(href.slice(1));
    if (!target) { this.warn(`a <use> points at "${href.slice(1)}", which is not in the file`); return; }
    if (ctx.chain.has(target)) { this.warn('a <use> refers to itself — the loop was cut'); return; }
    const L = (a: string, of: number) => length(el.attrs[a], { percentOf: of, fontSize: style.fontSize }, 0);
    const at = mul(ctx.ctm, translate(L('x', ctx.vw), L('y', ctx.vh)));
    const chain = new Set(ctx.chain).add(target);

    if (target.tag === 'symbol' || target.tag === 'svg') {
      if (!this.passes(target)) return;
      const ts = this.styleFor(target, style, ctx);
      if (!ts.display) return;
      const D = (a: string, of: number) => length(el.attrs[a] ?? target.attrs[a] ?? '100%', { percentOf: of, fontSize: ts.fontSize }, 0);
      const w = D('width', ctx.vw), h = D('height', ctx.vh);
      if (!(w > 0) || !(h > 0)) return;
      const fx = this.effects(target, ts, at, ctx);
      if (!fx) return;
      this.viewport(target, ts, { ...ctx, parent: ts, clip: fx.clip, masks: fx.masks, opacity: ctx.opacity * ts.opacity, chain }, at, w, h, target);
      return;
    }
    this.element(target, { ...ctx, ctm: at, parent: style, chain });
  }

  /* ------------------------------- geometry ------------------------------ */

  private geometry(el: XElement, ctx: Ctx, fontSize: number): SubPath[] {
    const a = el.attrs;
    const tol = this.tol / Math.max(1e-12, scaleOf(ctx.ctm));
    const diag = Math.sqrt((ctx.vw * ctx.vw + ctx.vh * ctx.vh) / 2);
    const L = (k: string, of: number, d = 0) => length(a[k], { percentOf: of, fontSize }, d);
    const ellipse = (cx: number, cy: number, rx: number, ry: number) => flattenPathData(
      `M${cx + rx} ${cy}A${rx} ${ry} 0 1 1 ${cx - rx} ${cy}A${rx} ${ry} 0 1 1 ${cx + rx} ${cy}Z`, { tolerance: tol });

    switch (el.tag) {
      case 'path': return a['d'] ? flattenPathData(a['d'], { tolerance: tol }) : [];
      case 'rect': {
        const x = L('x', ctx.vw), y = L('y', ctx.vh), w = L('width', ctx.vw), h = L('height', ctx.vh);
        if (!(w > 0) || !(h > 0)) return [];
        let rx = a['rx'] !== undefined && a['rx'] !== 'auto' ? L('rx', ctx.vw, NaN) : NaN;
        let ry = a['ry'] !== undefined && a['ry'] !== 'auto' ? L('ry', ctx.vh, NaN) : NaN;
        if (Number.isNaN(rx)) rx = Number.isNaN(ry) ? 0 : ry;
        if (Number.isNaN(ry)) ry = rx;
        rx = Math.min(Math.max(0, rx), w / 2);
        ry = Math.min(Math.max(0, ry), h / 2);
        if (rx === 0 || ry === 0) {
          return [{ points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }], closed: true }];
        }
        return flattenPathData(
          `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}`
          + `A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}`
          + `V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`, { tolerance: tol });
      }
      case 'circle': {
        const r = L('r', diag);
        return r > 0 ? ellipse(L('cx', ctx.vw), L('cy', ctx.vh), r, r) : [];
      }
      case 'ellipse': {
        let rx = a['rx'] !== undefined && a['rx'] !== 'auto' ? L('rx', ctx.vw, NaN) : NaN;
        let ry = a['ry'] !== undefined && a['ry'] !== 'auto' ? L('ry', ctx.vh, NaN) : NaN;
        if (Number.isNaN(rx)) rx = ry;
        if (Number.isNaN(ry)) ry = rx;
        return rx > 0 && ry > 0 ? ellipse(L('cx', ctx.vw), L('cy', ctx.vh), rx, ry) : [];
      }
      case 'line':
        return [{ points: [{ x: L('x1', ctx.vw), y: L('y1', ctx.vh) }, { x: L('x2', ctx.vw), y: L('y2', ctx.vh) }], closed: false }];
      case 'polyline': case 'polygon': {
        const n = numbers(a['points']);
        const pts: Pt[] = [];
        for (let i = 0; i + 1 < n.length; i += 2) pts.push({ x: n[i]!, y: n[i + 1]! });
        if (pts.length < 2) return [];
        if (el.tag === 'polygon') { pts.push({ ...pts[0]! }); return [{ points: pts, closed: true }]; }
        return [{ points: pts, closed: false }];
      }
    }
    return [];
  }

  private boxOfSubs(subs: SubPath[]): { x: number; y: number; w: number; h: number } {
    const b = boxOf(subs.map((s) => s.points));
    return b ? { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 } : { x: 0, y: 0, w: 0, h: 0 };
  }

  /** Geometric bounding box of an element, in its own user space - for objectBoundingBox units. */
  private localBox(el: XElement, ctx: Ctx): { x: number; y: number; w: number; h: number } {
    const pts: Pt[][] = [];
    const visit = (node: XElement, m: Mat, depth: number) => {
      if (depth > 16 || !this.passes(node)) return;
      if (GRAPHICS.has(node.tag)) {
        for (const sp of this.geometry(node, { ...ctx, ctm: m }, ctx.parent.fontSize)) pts.push(sp.points.map((p) => apply(m, p)));
      } else if (node.tag === 'g' || node.tag === 'a' || node.tag === 'switch') {
        for (const k of elements(node)) visit(k, mul(m, transform(k.attrs['transform'])), depth + 1);
      } else if (node.tag === 'use') {
        const t = this.byId.get((node.attrs['href'] ?? node.attrs['xlink:href'] ?? '').replace(/^#/, ''));
        if (t && t !== el) visit(t, mul(mul(m, translate(length(node.attrs['x'], { percentOf: ctx.vw, fontSize: 16 }, 0), length(node.attrs['y'], { percentOf: ctx.vh, fontSize: 16 }, 0))), transform(t.attrs['transform'])), depth + 1);
      } else if (node.tag === 'image' || node.tag === 'svg') {
        const L = (a: string, of: number) => length(node.attrs[a], { percentOf: of, fontSize: 16 }, 0);
        const x = L('x', ctx.vw), y = L('y', ctx.vh), w = L('width', ctx.vw), h = L('height', ctx.vh);
        pts.push(rectRing(x, y, w, h).map((p) => apply(m, p)));
      } else if (node.tag === 'text') {
        const runs = layoutText(node, this.styleFor(node, ctx.parent, ctx), this.textEnv(ctx));
        for (const r of runs) for (const sp of r.subpaths) pts.push(sp.points.map((p) => apply(m, p)));
      }
    };
    visit(el, IDENTITY, 0);
    const b = boxOf(pts);
    return b ? { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 } : { x: 0, y: 0, w: 0, h: 0 };
  }

  /* -------------------------------- paint -------------------------------- */

  private paint(subs: SubPath[], style: Style, ctx: Ctx, box: () => { x: number; y: number; w: number; h: number }): void {
    if (style.visibility !== 'visible') return;
    const m = ctx.ctm;
    const order: ('fill' | 'stroke')[] = style.paintOrder === 'stroke' ? ['stroke', 'fill'] : ['fill', 'stroke'];
    for (const which of order) {
      if (which === 'fill' && style.fill.kind !== 'none') {
        const rings = subs.map((sp) => sp.points.map((p) => apply(m, p)));
        this.emit(rings, style.fillRule, false, style.fill, style.fillOpacity, style, ctx, box);
      }
      if (which === 'stroke' && style.stroke.kind !== 'none' && style.strokeWidth > 0) {
        const k = Math.max(1e-12, scaleOf(m));
        const width = style.nonScalingStroke ? style.strokeWidth / k : style.strokeWidth;
        const dashed = style.dashArray ? dashSubpaths(subs, style.dashArray, style.dashOffset) : subs;
        const outline = strokeOutline(dashed, {
          width, join: style.lineJoin, cap: style.lineCap, miterLimit: style.miterLimit, tolerance: this.tol / k,
        }, this.regions, (p) => apply(m, p));
        if (outline.length) this.emit(outline, 'nonzero', true, style.stroke, style.strokeOpacity, style, ctx, box);
      }
    }
  }

  private outsideRoot(rings: readonly Ring[]): boolean {
    if (!this.rootBox) return false;
    const b = boxOf(rings);
    const e = (this.rootBox.x1 - this.rootBox.x0) * 1e-6;
    return !!b && !boxWithin(b, { x0: this.rootBox.x0 - e, y0: this.rootBox.y0 - e, x1: this.rootBox.x1 + e, y1: this.rootBox.y1 + e });
  }

  private rootRing(): Ring[] {
    const b = this.rootBox!;
    return [rectRing(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0)];
  }

  /** Paint one region (a fill or a stroke outline) with a paint, honouring clip and masks. */
  private emit(
    rings: Ring[], rule: FillRule, isClean: boolean, paint: Paint, paintOpacity: number,
    style: Style, ctx: Ctx, box: () => { x: number; y: number; w: number; h: number },
  ): void {
    const opacity = ctx.opacity * paintOpacity;
    if (opacity <= 0.001) return;

    let server: XElement | null = null;
    let solid = solidOf(paint, style);
    if (paint.kind === 'url') {
      const ref = this.byId.get(paint.id);
      if (ref && (ref.tag === 'lineargradient' || ref.tag === 'radialgradient' || ref.tag === 'pattern')) server = ref;
      else {
        const fb = paint.fallback;
        if (!fb) {
          if (!ref) this.warn(`a fill or stroke refers to "${paint.id}", which is not in the file`);
          return;
        }
        if (fb.kind === 'none') return;
        solid = solidOf(fb, style);
      }
    }
    if (!server && !solid) return;

    const outside = this.outsideRoot(rings);
    if (solid && !server && !ctx.clip && ctx.masks.length === 0 && !outside) {
      ctx.sink.shapes.push({ subpaths: closed(rings), fill: solid.rgb, opacity: opacity * solid.alpha, fillRule: rule });
      return;
    }

    let region = isClean ? rings : this.regions.clean(rings, rule);
    if (outside) {
      region = this.regions.intersect(region, this.rootRing());
      if (ctx.sink === this.result) this.warn('part of the artwork lies outside the file’s visible area and was left out, as a browser would');
    }
    if (ctx.clip) region = this.regions.intersect(region, ctx.clip);
    if (!region.length) return;

    if (!server) { this.push(region, solid!.rgb, opacity * solid!.alpha, ctx); return; }
    if (server.tag === 'pattern') { this.pattern(server, region, box(), ctx, opacity); return; }
    const g = this.gradient(server);
    if (!g) return;
    const layered = opacity >= 0.999 && ctx.masks.length === 0 && g.stops.every((st) => st.alpha >= 0.999);
    for (const band of gradientBands(g, region, box(), ctx.ctm, { regions: this.regions, tolerance: this.tol, layered })) {
      this.push(band.rings, band.rgb, opacity * band.alpha, ctx);
    }
  }

  /** Emit a clean region, split by any masks into pieces of different opacity. */
  private push(rings: Ring[], rgb: RGB, opacity: number, ctx: Ctx): void {
    let pieces: { rings: Ring[]; o: number }[] = [{ rings, o: opacity }];
    for (const mask of ctx.masks) {
      const next: { rings: Ring[]; o: number }[] = [];
      for (const piece of pieces) {
        const pb = boxOf(piece.rings);
        for (const part of mask) {
          const o = piece.o * part.value;
          if (o <= 0.002 || !boxesMeet(pb, part.box)) continue;
          const r = this.regions.intersect(piece.rings, part.rings);
          if (r.length) next.push({ rings: r, o });
        }
      }
      pieces = next;
    }
    for (const p of pieces) {
      if (p.o > 0.001) ctx.sink.shapes.push({ subpaths: closed(p.rings), fill: rgb, opacity: Math.min(1, p.o), fillRule: 'evenodd' });
    }
  }

  /* ------------------------------ effects -------------------------------- */

  /** Clip and mask for an element. null when it is clipped or masked away entirely. */
  private effects(el: XElement, style: Style, m: Mat, ctx: Ctx): { clip: Ring[] | null; masks: MaskPart[][] } | null {
    let clip = ctx.clip;
    let masks = ctx.masks;
    let box: { x: number; y: number; w: number; h: number } | null = null;
    const getBox = () => (box ??= this.localBox(el, ctx));

    if (style.clipPath !== null) {
      const ref = style.clipPath ? this.byId.get(style.clipPath) : undefined;
      if (!ref || ref.tag !== 'clippath') {
        this.warn(style.clipPath ? `a clip-path points at "${style.clipPath}", which is not in the file` : 'a CSS shape clip-path is not supported');
      } else {
        const region = this.clipRegion(ref, m, getBox, ctx, new Set(ctx.chain));
        if (region) {
          clip = clip ? this.regions.intersect(clip, region) : region;
          if (!clip.length) return null;
        }
      }
    }
    if (style.mask) {
      const ref = this.byId.get(style.mask);
      if (!ref || ref.tag !== 'mask') this.warn(`a mask points at "${style.mask}", which is not in the file`);
      else if (!ctx.chain.has(ref)) {
        const parts = this.maskParts(ref, m, getBox, ctx);
        if (!parts.length) return null;
        masks = [...masks, parts];
      }
    }
    return { clip, masks };
  }

  private clipRegion(
    clipEl: XElement, mRef: Mat, getBox: () => { x: number; y: number; w: number; h: number },
    ctx: Ctx, seen: Set<XElement>,
  ): Ring[] | null {
    if (seen.has(clipEl)) { this.warn('a clip path refers to itself — the loop was cut'); return null; }
    seen.add(clipEl);
    let M = mRef;
    if (clipEl.attrs['clippathunits'] === 'objectBoundingBox') {
      const b = getBox();
      if (!(b.w > 0) || !(b.h > 0)) return [];
      M = mul(M, [b.w, 0, 0, b.h, b.x, b.y]);
    }
    M = mul(M, transform(clipEl.attrs['transform']));
    const clipStyle = this.styleInPlace(clipEl);
    const pieces: Ring[] = [];

    for (const child of elements(clipEl)) {
      if (!this.passes(child)) continue;
      let target = child;
      let mc = mul(M, transform(child.attrs['transform']));
      let cs = this.styleFor(child, clipStyle, ctx);
      if (!cs.display || cs.visibility !== 'visible') continue;
      if (child.tag === 'use') {
        const t = this.byId.get((child.attrs['href'] ?? child.attrs['xlink:href'] ?? '').replace(/^#/, ''));
        if (!t || !(GRAPHICS.has(t.tag) || t.tag === 'text')) continue;
        mc = mul(mul(mc, translate(length(child.attrs['x'], { percentOf: ctx.vw, fontSize: 16 }, 0), length(child.attrs['y'], { percentOf: ctx.vh, fontSize: 16 }, 0))), transform(t.attrs['transform']));
        cs = this.styleFor(t, cs, ctx);
        target = t;
      }
      let subs: SubPath[] = [];
      if (GRAPHICS.has(target.tag)) subs = this.geometry(target, { ...ctx, ctm: mc }, cs.fontSize);
      else if (target.tag === 'text') subs = layoutText(target, cs, this.textEnv({ ...ctx, ctm: mc })).flatMap((r) => r.subpaths);
      else continue;
      let region = this.regions.clean(subs.map((sp) => sp.points.map((p) => apply(mc, p))), cs.clipRule);
      if (cs.clipPath) {
        const inner = this.byId.get(cs.clipPath);
        if (inner && inner.tag === 'clippath') {
          const sub = this.clipRegion(inner, mc, () => this.boxOfSubs(subs), ctx, new Set(seen));
          if (sub) region = this.regions.intersect(region, sub);
        }
      }
      pieces.push(...region);
    }
    let region = pieces.length ? this.regions.unionPieces(pieces) : [];
    if (clipStyle.clipPath) {
      const outer = this.byId.get(clipStyle.clipPath);
      if (outer && outer.tag === 'clippath') {
        const sub = this.clipRegion(outer, mRef, getBox, ctx, new Set(seen));
        if (sub) region = this.regions.intersect(region, sub);
      }
    }
    return region;
  }

  /**
   * A mask, as regions of constant mask value.
   *
   * The mask's content is rendered like any other artwork, then composited in
   * paint order into a partition of the plane, each piece carrying the
   * luminance (or, for mask-type: alpha, the opacity) the mask has there. A
   * gradient in a mask arrives already banded, so a soft fade becomes a fade.
   */
  private maskParts(maskEl: XElement, mRef: Mat, getBox: () => { x: number; y: number; w: number; h: number }, ctx: Ctx): MaskPart[] {
    const bboxUnits = (maskEl.attrs['maskunits'] ?? 'objectBoundingBox') === 'objectBoundingBox';
    const frac = (v: string | undefined, d: number) => {
      if (v === undefined) return d;
      const t = v.trim();
      return t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t);
    };
    let rect: Ring;
    if (bboxUnits) {
      const b = getBox();
      if (!(b.w > 0) || !(b.h > 0)) return [];
      const fx = frac(maskEl.attrs['x'], -0.1), fy = frac(maskEl.attrs['y'], -0.1);
      const fw = frac(maskEl.attrs['width'], 1.2), fh = frac(maskEl.attrs['height'], 1.2);
      rect = rectRing(b.x + fx * b.w, b.y + fy * b.h, fw * b.w, fh * b.h);
    } else {
      const L = (a: string, of: number, d: string) => length(maskEl.attrs[a] ?? d, { percentOf: of, fontSize: 16 }, 0);
      rect = rectRing(L('x', ctx.vw, '-10%'), L('y', ctx.vh, '-10%'), L('width', ctx.vw, '120%'), L('height', ctx.vh, '120%'));
    }
    const rectRegion = this.regions.clean([rect.map((p) => apply(mRef, p))], 'nonzero');
    if (!rectRegion.length) return [];

    let Mc = mRef;
    if (maskEl.attrs['maskcontentunits'] === 'objectBoundingBox') {
      const b = getBox();
      Mc = mul(Mc, [b.w, 0, 0, b.h, b.x, b.y]);
    }
    const ms = this.styleInPlace(maskEl);
    const sink: Sink = { shapes: [], rasters: [] };
    this.children(maskEl, {
      ctm: Mc, parent: ms, clip: rectRegion, masks: [], opacity: 1, vw: ctx.vw, vh: ctx.vh,
      sink, chain: new Set(ctx.chain).add(maskEl),
    });
    if (sink.rasters.length) this.warn('an image used inside a mask is ignored');

    let parts: MaskPart[] = [];
    for (const s of sink.shapes) {
      const P = this.regions.clean(s.subpaths.map((sp) => sp.points), s.fillRule);
      if (!P.length || s.opacity <= 0) continue;
      const a = s.opacity, v = ms.maskTypeAlpha ? 1 : lum(s.fill);
      const pb = boxOf(P);
      const next: MaskPart[] = [];
      const touched: Ring[] = [];
      for (const part of parts) {
        if (!boxesMeet(pb, part.box)) { next.push(part); continue; }
        const inter = this.regions.intersect(part.rings, P);
        if (!inter.length) { next.push(part); continue; }
        const rest = this.regions.subtract(part.rings, P);
        next.push({ rings: inter, value: part.value * (1 - a) + v * a, box: boxOf(inter) });
        if (rest.length) next.push({ rings: rest, value: part.value, box: boxOf(rest) });
        touched.push(...part.rings);
      }
      const fresh = touched.length ? this.regions.subtract(P, this.regions.unionPieces(touched)) : P;
      if (fresh.length) next.push({ rings: fresh, value: v * a, box: boxOf(fresh) });
      parts = next;
    }
    return parts.filter((p) => p.value > 0.002);
  }

  /* ------------------------------ servers -------------------------------- */

  private hrefChain(el: XElement): XElement[] {
    const out: XElement[] = [el];
    let cur = el;
    for (let i = 0; i < 16; i++) {
      const h = (cur.attrs['href'] ?? cur.attrs['xlink:href'] ?? '').trim();
      if (!h.startsWith('#')) break;
      const next = this.byId.get(h.slice(1));
      if (!next || out.includes(next)) break;
      out.push(next);
      cur = next;
    }
    return out;
  }

  private gradient(el: XElement): Gradient | null {
    const chain = this.hrefChain(el);
    const attr = (k: string) => chain.find((e) => e.attrs[k] !== undefined)?.attrs[k];
    const bboxUnits = (attr('gradientunits') ?? 'objectBoundingBox') === 'objectBoundingBox';
    const vw = this.width || 100, vh = this.height || 100;
    const diag = Math.sqrt((vw * vw + vh * vh) / 2);
    const coord = (k: string, d: string, of: number) => {
      const v = attr(k) ?? d;
      if (bboxUnits) {
        const t = v.trim();
        return t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t);
      }
      return length(v, { percentOf: of, fontSize: 16 }, 0);
    };
    const stopsEl = chain.find((e) => elements(e).some((c) => c.tag === 'stop'));
    const stops: Stop[] = [];
    if (stopsEl) {
      const gs = this.styleInPlace(stopsEl);
      let last = 0;
      for (const s of elements(stopsEl)) {
        if (s.tag !== 'stop') continue;
        const ss = this.styleFor(s, gs, { vw, vh });
        const raw = (s.attrs['offset'] ?? '0').trim();
        let off = raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw);
        if (!Number.isFinite(off)) off = 0;
        off = Math.max(last, Math.min(1, Math.max(0, off)));
        last = off;
        stops.push({ offset: off, rgb: ss.stopColor.rgb, alpha: ss.stopColor.alpha * ss.stopOpacity });
      }
    }
    if (stops.length === 0) return null;
    const spreadRaw = attr('spreadmethod');
    const spread = spreadRaw === 'reflect' || spreadRaw === 'repeat' ? spreadRaw : 'pad';
    const gradientTransform = transform(attr('gradienttransform'));
    if (el.tag === 'lineargradient') {
      return {
        geometry: { kind: 'linear', x1: coord('x1', '0%', vw), y1: coord('y1', '0%', vh), x2: coord('x2', '100%', vw), y2: coord('y2', '0%', vh) },
        bboxUnits, gradientTransform, spread, stops,
      };
    }
    const cx = coord('cx', '50%', vw), cy = coord('cy', '50%', vh);
    return {
      geometry: {
        kind: 'radial', cx, cy, r: coord('r', '50%', diag),
        fx: attr('fx') !== undefined ? coord('fx', '50%', vw) : cx,
        fy: attr('fy') !== undefined ? coord('fy', '50%', vh) : cy,
        fr: coord('fr', '0%', diag),
      },
      bboxUnits, gradientTransform, spread, stops,
    };
  }

  /**
   * A pattern, as its tiles of real artwork.
   *
   * Each tile is the pattern's content drawn again, clipped to the tile and
   * to the shape - so stripes stay stripes and an image fill (Figma exports
   * every placed photo this way) stays an image.
   */
  private pattern(el: XElement, region: Ring[], box: { x: number; y: number; w: number; h: number }, ctx: Ctx, opacity: number): void {
    if (ctx.chain.has(el)) return;
    const chain = this.hrefChain(el);
    const attr = (k: string) => chain.find((e) => e.attrs[k] !== undefined)?.attrs[k];
    const content = chain.find((e) => elements(e).length > 0);
    if (!content) return;
    const bboxUnits = (attr('patternunits') ?? 'objectBoundingBox') === 'objectBoundingBox';
    const frac = (k: string, d: number) => {
      const v = attr(k);
      if (v === undefined) return d;
      const t = v.trim();
      return t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t);
    };
    const L = (k: string, of: number) => length(attr(k), { percentOf: of, fontSize: 16 }, 0);
    let x: number, y: number, w: number, h: number;
    if (bboxUnits) {
      x = box.x + frac('x', 0) * box.w; y = box.y + frac('y', 0) * box.h;
      w = frac('width', 0) * box.w; h = frac('height', 0) * box.h;
    } else {
      x = L('x', ctx.vw); y = L('y', ctx.vh); w = L('width', ctx.vw); h = L('height', ctx.vh);
    }
    if (!(w > 0) || !(h > 0)) return;
    const P = mul(ctx.ctm, transform(attr('patterntransform')));
    const Pi = invert(P);
    const rb = boxOf(region);
    if (!Pi || !rb) return;
    const vb = viewBox(attr('viewbox'));
    const contentM: Mat = vb
      ? viewBoxTransform(vb, aspectRatio(attr('preserveaspectratio')), w, h)
      : attr('patterncontentunits') === 'objectBoundingBox' ? scaling(box.w, box.h) : IDENTITY;

    const corners = [
      { x: rb.x0, y: rb.y0 }, { x: rb.x1, y: rb.y0 }, { x: rb.x1, y: rb.y1 }, { x: rb.x0, y: rb.y1 },
    ].map((p) => apply(Pi, p));
    const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
    const i0 = Math.floor((Math.min(...xs) - x) / w), i1 = Math.ceil((Math.max(...xs) - x) / w);
    const j0 = Math.floor((Math.min(...ys) - y) / h), j1 = Math.ceil((Math.max(...ys) - y) / h);
    if ((i1 - i0) * (j1 - j0) > 2500) {
      this.warn('a pattern is too fine to reproduce as vector and was filled with one colour');
      const probe: Sink = { shapes: [], rasters: [] };
      this.children(content, { ...ctx, ctm: IDENTITY, parent: this.styleInPlace(content), clip: null, masks: [], opacity: 1, sink: probe, chain: new Set(ctx.chain).add(el) });
      const s = probe.shapes[0];
      if (s) this.push(region, s.fill, opacity * s.opacity, ctx);
      return;
    }
    const style = this.styleInPlace(content);
    const sub: ReadonlySet<XElement> = new Set(ctx.chain).add(el);
    for (let i = i0; i < i1; i++) {
      for (let j = j0; j < j1; j++) {
        const tx = x + i * w, ty = y + j * h;
        const tile = this.regions.clean([rectRing(tx, ty, w, h).map((p) => apply(P, p))], 'nonzero');
        const clip = this.regions.intersect(region, tile);
        if (!clip.length) continue;
        this.children(content, {
          ...ctx, ctm: mul(mul(P, translate(tx, ty)), contentM), parent: style,
          clip, opacity, chain: sub, vw: vb?.w ?? w, vh: vb?.h ?? h,
        });
      }
    }
  }

  /* -------------------------------- text --------------------------------- */

  private textEnv(ctx: Ctx) {
    return {
      styleOf: (el: XElement, parent: Style) => this.styleFor(el, parent, ctx),
      font: (s: Style) => this.font(s),
      tolerance: this.tol / Math.max(1e-12, scaleOf(ctx.ctm)),
      warn: (m: string) => this.warn(m),
      vw: ctx.vw,
      vh: ctx.vh,
    };
  }

  private text(el: XElement, style: Style, ctx: Ctx): void {
    const runs = layoutText(el, style, this.textEnv(ctx));
    if (!runs.length) return;
    const all = runs.flatMap((r) => r.subpaths);
    const box = () => this.boxOfSubs(all);
    for (const r of runs) this.paint(r.subpaths, r.style, ctx, box);
  }

  private font(style: Style): FontMatch | null {
    const families = style.fontFamily;
    const italic = style.fontStyle !== 'normal';
    // Fonts embedded in the file are the font the designer used. Use them.
    for (const fam of families) {
      const key = fam.toLowerCase();
      if (!this.embedded.has(key)) {
        let parsed: OutlineFont | null = null;
        const face = this.sheet.fontFaces.find((f) => f.family.toLowerCase() === key);
        const url = face ? /url\(\s*['"]?(data:[^'")]+)['"]?\s*\)/i.exec(face.src)?.[1] : undefined;
        if (url && this.opts.fonts?.parse) {
          const d = parseDataUrl(url);
          if (d) {
            try {
              parsed = this.opts.fonts.parse(d.bytes);
              if (parsed && !parsed.kernPairs) parsed.kernPairs = gposKerning(d.bytes) ?? undefined;
            } catch { parsed = null; }
          }
        }
        this.embedded.set(key, parsed);
      }
      const font = this.embedded.get(key);
      if (font) return this.record(families[0] ?? fam, { font, family: fam, exact: true });
    }
    if (!this.opts.fonts) {
      this.warn('live text was not drawn: no fonts are available to outline it');
      return null;
    }
    // Illustrator writes PostScript names - "Montserrat-Bold" - so also try the
    // family with its style suffix stripped, carrying the weight it named.
    let weight = style.fontWeight;
    const candidates: string[] = [];
    for (const fam of families) {
      candidates.push(fam);
      const m = /^(.+?)[-\s]?(Thin|ExtraLight|UltraLight|Light|Regular|Book|Roman|Medium|SemiBold|DemiBold|Bold|ExtraBold|UltraBold|Black|Heavy)(Italic|It|Oblique)?$/i.exec(fam);
      if (m && m[1]) {
        candidates.push(m[1]);
        const wmap: Record<string, number> = {
          thin: 100, extralight: 200, ultralight: 200, light: 300, regular: 400, book: 400, roman: 400,
          medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900,
        };
        if (style.fontWeight === 400 && wmap[m[2]!.toLowerCase()]) weight = wmap[m[2]!.toLowerCase()]!;
      }
    }
    const match = this.opts.fonts.resolve(candidates, weight, italic);
    if (!match) {
      this.warn('some text could not be drawn: no font was available for it');
      return null;
    }
    return this.record(families[0] ?? match.family, match);
  }

  private record(requested: string, match: FontMatch): FontMatch {
    const key = `${requested}\u0000${match.family}`;
    if (!this.fontUses.has(key)) {
      const generic = /^(sans-serif|serif|monospace|cursive|fantasy|system-ui)$/i.test(requested);
      const exact = match.exact || generic;
      this.fontUses.set(key, { requested, used: match.family, exact });
      if (!exact) this.warn(`text set in "${match.family}" — "${requested}" is not available; convert type to outlines in the original for an exact match`);
    }
    return match;
  }

  /* ------------------------------- images -------------------------------- */

  private image(el: XElement, style: Style, ctx: Ctx): void {
    if (style.visibility !== 'visible') return;
    const href = (el.attrs['href'] ?? el.attrs['xlink:href'] ?? '').trim();
    const data = parseDataUrl(href);
    if (!data) {
      if (href) this.warn('an image linked from outside the file could not be loaded — embed images in the SVG');
      return;
    }
    const L = (a: string, of: number) => {
      const v = el.attrs[a];
      return v === undefined || v === 'auto' ? NaN : length(v, { percentOf: of, fontSize: style.fontSize }, NaN);
    };
    const x = L('x', ctx.vw) || 0, y = L('y', ctx.vh) || 0;
    let w = L('width', ctx.vw), h = L('height', ctx.vh);
    const par = aspectRatio(el.attrs['preserveaspectratio']);

    if (data.mime.includes('svg')) {
      if (this.nesting > 3) return;
      const inner = new Importer(utf8(data.bytes), this.opts, this.nesting + 1).run();
      for (const wmsg of inner.warnings) if (wmsg !== 'No visible artwork found') this.warn(wmsg);
      if (Number.isNaN(w) && Number.isNaN(h)) { w = inner.width; h = inner.height; }
      else if (Number.isNaN(w)) w = (h * inner.width) / inner.height;
      else if (Number.isNaN(h)) h = (w * inner.height) / inner.width;
      if (!(w > 0) || !(h > 0)) return;
      const P = mul(mul(ctx.ctm, translate(x, y)), viewBoxTransform({ x: 0, y: 0, w: inner.width, h: inner.height }, par, w, h));
      const port = this.regions.clean([rectRing(x, y, w, h).map((p) => apply(ctx.ctm, p))], 'nonzero');
      const clip = ctx.clip ? this.regions.intersect(ctx.clip, port) : port;
      for (const s of inner.shapes) {
        const rings = s.subpaths.map((sp) => sp.points.map((p) => apply(P, p)));
        this.emit(rings, s.fillRule, false, { kind: 'color', rgb: s.fill, alpha: 1 }, s.opacity, style, { ...ctx, clip }, () => ({ x: 0, y: 0, w: 0, h: 0 }));
      }
      for (const r of inner.rasters) {
        const innerClip = r.clip ? this.regions.clean(r.clip.map((sp) => sp.points.map((p) => apply(P, p))), 'nonzero') : null;
        const c = innerClip ? this.regions.intersect(innerClip, clip) : clip;
        this.raster({ ...r, matrix: mul(P, r.matrix) }, c, ctx);
      }
      return;
    }

    const size = imageSize(data.bytes);
    if (!size) {
      if (!(w > 0) || !(h > 0)) { this.warn('an embedded image is in a format that could not be read'); return; }
    }
    const nw = size?.w ?? w, nh = size?.h ?? h;
    if (Number.isNaN(w) && Number.isNaN(h)) { w = nw; h = nh; }
    else if (Number.isNaN(w)) w = (h * nw) / nh;
    else if (Number.isNaN(h)) h = (w * nh) / nw;
    if (!(w > 0) || !(h > 0) || !(nw > 0) || !(nh > 0)) return;

    const fit = viewBoxTransform({ x: 0, y: 0, w: nw, h: nh }, size ? par : { align: 'none', slice: false }, w, h);
    const matrix = mul(mul(mul(ctx.ctm, translate(x, y)), fit), scaling(nw, nh));
    let clip = ctx.clip;
    if (par.slice) {
      const port = this.regions.clean([rectRing(x, y, w, h).map((p) => apply(ctx.ctm, p))], 'nonzero');
      clip = clip ? this.regions.intersect(clip, port) : port;
      if (!clip.length) return;
    }
    this.raster({ href, mime: data.mime, matrix, naturalWidth: nw, naturalHeight: nh, opacity: 1, clip: null, before: 0 }, clip, ctx);
  }

  /** Place an image, applying clip, root area and masks. */
  private raster(r: ImportedRaster, clip: Ring[] | null, ctx: Ctx): void {
    let c = clip;
    const quad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }].map((p) => apply(r.matrix, p));
    if (this.outsideRoot([quad])) c = c ? this.regions.intersect(c, this.rootRing()) : this.rootRing();
    let opacity = r.opacity * ctx.opacity;
    for (const mask of ctx.masks) {
      const solid = mask.filter((p) => p.value >= 0.5);
      if (mask.some((p) => p.value > 0.05 && p.value < 0.95)) this.warn('a soft-edged mask over an image was simplified to a hard edge');
      const region = solid.length ? this.regions.unionPieces(solid.flatMap((p) => p.rings)) : [];
      c = c ? this.regions.intersect(c, region) : region;
      const avg = solid.length ? solid.reduce((a, p) => a + p.value, 0) / solid.length : 0;
      opacity *= Math.min(1, avg);
    }
    if (c && !c.length) return;
    ctx.sink.rasters.push({ ...r, opacity, clip: c ? closed(c) : null, before: ctx.sink.shapes.length });
  }
}

/** Import an SVG document. */
export function importSvg(source: string, options: SvgImportOptions = {}): SvgImportResult {
  return new Importer(source, options).run();
}

export { colour as parseCssColour };
