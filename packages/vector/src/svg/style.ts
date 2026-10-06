/**
 * Computed style: what each property's value actually is on an element, after
 * the cascade and inheritance.
 *
 * The distinction between inherited and non-inherited properties is not a
 * nicety. `fill` inherits, so a group's colour reaches its children; `opacity`
 * and `clip-path` do not, they apply to the group as a whole. `visibility:
 * hidden` inherits but a child may switch itself back on; `display: none`
 * removes the whole subtree and cannot be overridden. Each of those, got
 * wrong, is a logo that imports with parts missing or parts that should not
 * be there - hidden guide layers drawn over the artwork, for one.
 */

import type { RGB } from '../color';
import { colour, length, numbers, type Colour } from './values';

export type FillRule = 'nonzero' | 'evenodd';

export type Paint =
  | { kind: 'none' }
  | { kind: 'color'; rgb: RGB; alpha: number }
  | { kind: 'current' }
  | { kind: 'url'; id: string; fallback: Paint | null };

export interface Style {
  // Inherited.
  fill: Paint;
  fillOpacity: number;
  fillRule: FillRule;
  stroke: Paint;
  strokeWidth: number;
  strokeOpacity: number;
  lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'miter' | 'round' | 'bevel';
  miterLimit: number;
  dashArray: number[] | null;
  dashOffset: number;
  visibility: 'visible' | 'hidden';
  color: Colour;
  fontFamily: string[];
  fontSize: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic' | 'oblique';
  letterSpacing: number;
  wordSpacing: number;
  textAnchor: 'start' | 'middle' | 'end';
  clipRule: FillRule;
  dominantBaseline: string;
  paintOrder: 'fill' | 'stroke';
  preserveSpace: boolean;
  // Not inherited.
  opacity: number;
  display: boolean;
  clipPath: string | null;
  mask: string | null;
  filter: string | null;
  stopColor: Colour;
  stopOpacity: number;
  overflowVisible: boolean;
  nonScalingStroke: boolean;
  maskTypeAlpha: boolean;
  markers: boolean;
}

export const INITIAL: Style = {
  fill: { kind: 'color', rgb: [0, 0, 0], alpha: 1 },
  fillOpacity: 1,
  fillRule: 'nonzero',
  stroke: { kind: 'none' },
  strokeWidth: 1,
  strokeOpacity: 1,
  lineCap: 'butt',
  lineJoin: 'miter',
  miterLimit: 4,
  dashArray: null,
  dashOffset: 0,
  visibility: 'visible',
  color: { rgb: [0, 0, 0], alpha: 1 },
  fontFamily: ['sans-serif'],
  fontSize: 16,
  fontWeight: 400,
  fontStyle: 'normal',
  letterSpacing: 0,
  wordSpacing: 0,
  textAnchor: 'start',
  clipRule: 'nonzero',
  dominantBaseline: 'auto',
  paintOrder: 'fill',
  preserveSpace: false,
  opacity: 1,
  display: true,
  clipPath: null,
  mask: null,
  filter: null,
  stopColor: { rgb: [0, 0, 0], alpha: 1 },
  stopOpacity: 1,
  overflowVisible: false,
  nonScalingStroke: false,
  maskTypeAlpha: false,
  markers: false,
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** `url(#id) fallback`, a colour, `none`, or `currentColor`. */
export function parsePaint(raw: string): Paint | null {
  const v = raw.trim();
  if (v === 'none') return { kind: 'none' };
  // SVG 2 context paints only mean something inside markers; treat as none.
  if (v === 'context-fill' || v === 'context-stroke') return { kind: 'none' };
  const url = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)\s*(.*)$/i.exec(v);
  if (url) {
    const rest = url[2]!.trim();
    return { kind: 'url', id: url[1]!, fallback: rest ? parsePaint(rest) : null };
  }
  const c = colour(v);
  if (c === 'currentColor') return { kind: 'current' };
  if (c) return { kind: 'color', rgb: c.rgb, alpha: c.alpha };
  return null;
}

function opacityValue(raw: string): number | null {
  const t = raw.trim();
  const n = t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t);
  return Number.isFinite(n) ? clamp01(n) : null;
}

function weight(raw: string, parent: number): number {
  const t = raw.trim().toLowerCase();
  if (t === 'normal') return 400;
  if (t === 'bold') return 700;
  if (t === 'bolder') return parent < 400 ? 400 : parent < 600 ? 700 : 900;
  if (t === 'lighter') return parent > 700 ? 700 : parent > 500 ? 400 : 100;
  const n = parseFloat(t);
  return Number.isFinite(n) ? Math.max(1, Math.min(1000, n)) : parent;
}

/** `'Montserrat-Bold', Montserrat, sans-serif` -> ['Montserrat-Bold', 'Montserrat', 'sans-serif']. */
export function familyList(raw: string): string[] {
  const out: string[] = [];
  const re = /\s*(?:"([^"]*)"|'([^']*)'|([^,]+))\s*(?:,|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null && m[0] !== '') {
    const f = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (f) out.push(f);
  }
  return out;
}

export interface StyleContext {
  /** Nearest viewport, for percentages. */
  vw: number;
  vh: number;
}

/**
 * The computed style of one element.
 *
 * `decl` is the element's declared values after the cascade (presentation
 * attributes, stylesheet, inline style); `parent` is the parent's computed
 * style.
 */
export function computeStyle(
  decl: ReadonlyMap<string, string>,
  attrs: Readonly<Record<string, string>>,
  parent: Style,
  ctx: StyleContext,
): Style {
  const s: Style = {
    ...parent,
    // Non-inherited properties start from their initial values.
    opacity: 1, display: true, clipPath: null, mask: null, filter: null,
    stopColor: INITIAL.stopColor, stopOpacity: 1, overflowVisible: false,
    nonScalingStroke: false, maskTypeAlpha: false, markers: false,
  };
  const get = (p: string): string | undefined => {
    const v = decl.get(p);
    return v === undefined || v.trim().toLowerCase() === 'inherit' ? undefined : v.trim();
  };
  const isInherit = (p: string) => decl.get(p)?.trim().toLowerCase() === 'inherit';

  // Font size first: em units everywhere else depend on it.
  const fs = get('font-size');
  if (fs !== undefined) {
    const named: Record<string, number> = {
      'xx-small': 9, 'x-small': 10, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32,
    };
    const lower = fs.toLowerCase();
    if (named[lower]) s.fontSize = named[lower]!;
    else if (lower === 'larger') s.fontSize = parent.fontSize * 1.2;
    else if (lower === 'smaller') s.fontSize = parent.fontSize / 1.2;
    else s.fontSize = length(fs, { percentOf: parent.fontSize, fontSize: parent.fontSize }, parent.fontSize);
  }
  const lctx = (percentOf: number) => ({ percentOf, fontSize: s.fontSize });
  const diag = Math.sqrt((ctx.vw * ctx.vw + ctx.vh * ctx.vh) / 2);

  const c = get('color');
  if (c) { const v = colour(c); if (v && v !== 'currentColor') s.color = v; }

  const fill = get('fill');
  if (fill) { const p = parsePaint(fill); if (p) s.fill = p; }
  const stroke = get('stroke');
  if (stroke) { const p = parsePaint(stroke); if (p) s.stroke = p; }

  for (const [prop, key] of [['fill-opacity', 'fillOpacity'], ['stroke-opacity', 'strokeOpacity']] as const) {
    const v = get(prop);
    if (v !== undefined) { const o = opacityValue(v); if (o !== null) s[key] = o; }
  }
  const fr = get('fill-rule');
  if (fr === 'evenodd' || fr === 'nonzero') s.fillRule = fr;
  const cr = get('clip-rule');
  if (cr === 'evenodd' || cr === 'nonzero') s.clipRule = cr;

  const sw = get('stroke-width');
  if (sw !== undefined) s.strokeWidth = Math.max(0, length(sw, lctx(diag), s.strokeWidth));
  const lc = get('stroke-linecap');
  if (lc === 'butt' || lc === 'round' || lc === 'square') s.lineCap = lc;
  const lj = get('stroke-linejoin');
  if (lj === 'miter' || lj === 'round' || lj === 'bevel') s.lineJoin = lj;
  else if (lj === 'miter-clip' || lj === 'arcs') s.lineJoin = 'miter';
  const ml = get('stroke-miterlimit');
  if (ml !== undefined) { const n = parseFloat(ml); if (n >= 1) s.miterLimit = n; }
  const da = get('stroke-dasharray');
  if (da !== undefined) {
    if (da === 'none') s.dashArray = null;
    else {
      const list = da.split(/[\s,]+/).filter(Boolean).map((t) => length(t, lctx(diag), NaN));
      s.dashArray = list.length && list.every(Number.isFinite) ? list : null;
    }
  }
  const doff = get('stroke-dashoffset');
  if (doff !== undefined) s.dashOffset = length(doff, lctx(diag), 0);

  const vis = get('visibility');
  if (vis === 'hidden' || vis === 'collapse') s.visibility = 'hidden';
  else if (vis === 'visible') s.visibility = 'visible';

  const ff = get('font-family');
  if (ff) s.fontFamily = familyList(ff);
  const fw = get('font-weight');
  if (fw) s.fontWeight = weight(fw, parent.fontWeight);
  const fst = get('font-style');
  if (fst === 'italic' || fst === 'oblique' || fst === 'normal') s.fontStyle = fst;
  const ls = get('letter-spacing');
  if (ls !== undefined) s.letterSpacing = ls === 'normal' ? 0 : length(ls, lctx(s.fontSize), 0);
  const ws = get('word-spacing');
  if (ws !== undefined) s.wordSpacing = ws === 'normal' ? 0 : length(ws, lctx(s.fontSize), 0);
  const ta = get('text-anchor');
  if (ta === 'start' || ta === 'middle' || ta === 'end') s.textAnchor = ta;
  const db = get('dominant-baseline') ?? get('alignment-baseline');
  if (db) s.dominantBaseline = db.toLowerCase();
  const po = get('paint-order');
  if (po) s.paintOrder = po.trim().startsWith('stroke') ? 'stroke' : 'fill';
  const space = attrs['xml:space'];
  if (space === 'preserve') s.preserveSpace = true;
  else if (space === 'default') s.preserveSpace = false;
  const wsp = get('white-space');
  if (wsp) s.preserveSpace = /^pre/.test(wsp);

  // Non-inherited.
  const op = get('opacity');
  if (op !== undefined) { const o = opacityValue(op); if (o !== null) s.opacity = o; }
  if (isInherit('opacity')) s.opacity = parent.opacity;
  if (get('display') === 'none') s.display = false;
  const urlOf = (v: string | undefined) => {
    if (!v || v === 'none') return null;
    const m = /url\(\s*['"]?#([^'")]+)['"]?\s*\)/i.exec(v);
    return m ? m[1]! : '';
  };
  s.clipPath = urlOf(get('clip-path'));
  s.mask = urlOf(get('mask'));
  s.filter = get('filter') && get('filter') !== 'none' ? get('filter')! : null;
  const sc = get('stop-color');
  if (sc) {
    const v = colour(sc);
    if (v === 'currentColor') s.stopColor = s.color;
    else if (v) s.stopColor = v;
  }
  const so = get('stop-opacity');
  if (so !== undefined) { const o = opacityValue(so); if (o !== null) s.stopOpacity = o; }
  const ov = get('overflow');
  s.overflowVisible = ov === 'visible' || ov === 'auto';
  s.nonScalingStroke = get('vector-effect') === 'non-scaling-stroke';
  s.maskTypeAlpha = get('mask-type') === 'alpha';
  s.markers = ['marker-start', 'marker-mid', 'marker-end', 'marker']
    .some((p) => { const v = get(p); return !!v && v !== 'none'; });
  return s;
}

/** The colour a paint resolves to on this element, or null for none / a reference. */
export function solidOf(p: Paint, style: Style): { rgb: RGB; alpha: number } | null {
  if (p.kind === 'color') return { rgb: p.rgb, alpha: p.alpha };
  if (p.kind === 'current') return { rgb: style.color.rgb, alpha: style.color.alpha };
  return null;
}

export { numbers };
