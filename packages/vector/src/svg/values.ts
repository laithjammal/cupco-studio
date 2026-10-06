/**
 * Parsing the values SVG attributes and CSS properties carry: numbers,
 * lengths, colours, transforms, viewBoxes.
 *
 * Every one of these used to be parsed with a split and a parseFloat, and each
 * failed SILENTLY on input real files contain: `translate(10-5)` (a minifier's
 * output) became NaN and the shape vanished; `darkgreen` was not one of the
 * twelve known colour names and became black; `#0f08` was misread as
 * `#000f08`. Nothing errored. The artwork was simply wrong.
 */

import type { RGB } from '../color';

/* -------------------------------- matrix ---------------------------------- */

/** 2D affine matrix [a b c d e f], the same layout SVG's matrix() uses. */
export type Mat = [number, number, number, number, number, number];
export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function apply(m: Mat, p: { x: number; y: number }): { x: number; y: number } {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function invert(m: Mat): Mat | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det || !Number.isFinite(det)) return null;
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/** The average linear scale a matrix applies - what a stroke width becomes. */
export function scaleOf(m: Mat): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

export const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
export const scaling = (x: number, y: number): Mat => [x, 0, 0, y, 0, 0];

/* -------------------------------- numbers --------------------------------- */

/**
 * Every number in a string, however it is run together.
 *
 * `10-5` is two numbers, `.5.5` is two numbers, `1e-5` is one. This is the
 * grammar SVG actually specifies, and minifiers lean on all of it.
 */
const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

export function numbers(s: string | undefined): number[] {
  if (!s) return [];
  return (s.match(NUMBER) ?? []).map(Number).filter(Number.isFinite);
}

export function number(s: string | undefined, fallback: number): number {
  const n = numbers(s)[0];
  return n === undefined ? fallback : n;
}

/* -------------------------------- lengths --------------------------------- */

/** Context a length needs: what 100% means, and what 1em means. */
export interface LengthContext {
  /** The value 100% resolves to, for THIS attribute. */
  percentOf: number;
  /** Font size in user units, for em and ex. */
  fontSize: number;
}

const UNIT: Record<string, number> = {
  '': 1, px: 1, pt: 4 / 3, pc: 16, in: 96, mm: 96 / 25.4, cm: 96 / 2.54, q: 96 / 101.6,
};

/**
 * A length in user units.
 *
 * Units are converted rather than dropped: `width="10mm"` used to become 10
 * user units, a third of its real size.
 */
export function length(s: string | undefined, ctx: LengthContext, fallback: number): number {
  if (s === undefined) return fallback;
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(%|[a-zA-Z]*)\s*$/.exec(s);
  if (!m) return fallback;
  const v = Number(m[1]);
  const unit = (m[2] ?? '').toLowerCase();
  if (unit === '%') return (v / 100) * ctx.percentOf;
  if (unit === 'em') return v * ctx.fontSize;
  if (unit === 'ex') return v * ctx.fontSize * 0.5;
  if (unit === 'rem') return v * 16;
  const k = UNIT[unit];
  return k === undefined ? fallback : v * k;
}

/** A length list, as stroke-dasharray and text x/y/dx/dy use. */
export function lengthList(s: string | undefined, ctx: LengthContext): number[] {
  if (!s) return [];
  return s.trim().split(/[\s,]+/).filter(Boolean).map((t) => length(t, ctx, NaN));
}

/* -------------------------------- colours --------------------------------- */

/** All 148 CSS named colours. Twelve of them used to be known. */
const NAMED: Record<string, string> = {
  aliceblue: 'f0f8ff', antiquewhite: 'faebd7', aqua: '00ffff', aquamarine: '7fffd4',
  azure: 'f0ffff', beige: 'f5f5dc', bisque: 'ffe4c4', black: '000000',
  blanchedalmond: 'ffebcd', blue: '0000ff', blueviolet: '8a2be2', brown: 'a52a2a',
  burlywood: 'deb887', cadetblue: '5f9ea0', chartreuse: '7fff00', chocolate: 'd2691e',
  coral: 'ff7f50', cornflowerblue: '6495ed', cornsilk: 'fff8dc', crimson: 'dc143c',
  cyan: '00ffff', darkblue: '00008b', darkcyan: '008b8b', darkgoldenrod: 'b8860b',
  darkgray: 'a9a9a9', darkgreen: '006400', darkgrey: 'a9a9a9', darkkhaki: 'bdb76b',
  darkmagenta: '8b008b', darkolivegreen: '556b2f', darkorange: 'ff8c00', darkorchid: '9932cc',
  darkred: '8b0000', darksalmon: 'e9967a', darkseagreen: '8fbc8f', darkslateblue: '483d8b',
  darkslategray: '2f4f4f', darkslategrey: '2f4f4f', darkturquoise: '00ced1', darkviolet: '9400d3',
  deeppink: 'ff1493', deepskyblue: '00bfff', dimgray: '696969', dimgrey: '696969',
  dodgerblue: '1e90ff', firebrick: 'b22222', floralwhite: 'fffaf0', forestgreen: '228b22',
  fuchsia: 'ff00ff', gainsboro: 'dcdcdc', ghostwhite: 'f8f8ff', gold: 'ffd700',
  goldenrod: 'daa520', gray: '808080', green: '008000', greenyellow: 'adff2f',
  grey: '808080', honeydew: 'f0fff0', hotpink: 'ff69b4', indianred: 'cd5c5c',
  indigo: '4b0082', ivory: 'fffff0', khaki: 'f0e68c', lavender: 'e6e6fa',
  lavenderblush: 'fff0f5', lawngreen: '7cfc00', lemonchiffon: 'fffacd', lightblue: 'add8e6',
  lightcoral: 'f08080', lightcyan: 'e0ffff', lightgoldenrodyellow: 'fafad2', lightgray: 'd3d3d3',
  lightgreen: '90ee90', lightgrey: 'd3d3d3', lightpink: 'ffb6c1', lightsalmon: 'ffa07a',
  lightseagreen: '20b2aa', lightskyblue: '87cefa', lightslategray: '778899', lightslategrey: '778899',
  lightsteelblue: 'b0c4de', lightyellow: 'ffffe0', lime: '00ff00', limegreen: '32cd32',
  linen: 'faf0e6', magenta: 'ff00ff', maroon: '800000', mediumaquamarine: '66cdaa',
  mediumblue: '0000cd', mediumorchid: 'ba55d3', mediumpurple: '9370db', mediumseagreen: '3cb371',
  mediumslateblue: '7b68ee', mediumspringgreen: '00fa9a', mediumturquoise: '48d1cc',
  mediumvioletred: 'c71585', midnightblue: '191970', mintcream: 'f5fffa', mistyrose: 'ffe4e1',
  moccasin: 'ffe4b5', navajowhite: 'ffdead', navy: '000080', oldlace: 'fdf5e6',
  olive: '808000', olivedrab: '6b8e23', orange: 'ffa500', orangered: 'ff4500',
  orchid: 'da70d6', palegoldenrod: 'eee8aa', palegreen: '98fb98', paleturquoise: 'afeeee',
  palevioletred: 'db7093', papayawhip: 'ffefd5', peachpuff: 'ffdab9', peru: 'cd853f',
  pink: 'ffc0cb', plum: 'dda0dd', powderblue: 'b0e0e6', purple: '800080',
  rebeccapurple: '663399', red: 'ff0000', rosybrown: 'bc8f8f', royalblue: '4169e1',
  saddlebrown: '8b4513', salmon: 'fa8072', sandybrown: 'f4a460', seagreen: '2e8b57',
  seashell: 'fff5ee', sienna: 'a0522d', silver: 'c0c0c0', skyblue: '87ceeb',
  slateblue: '6a5acd', slategray: '708090', slategrey: '708090', snow: 'fffafa',
  springgreen: '00ff7f', steelblue: '4682b4', tan: 'd2b48c', teal: '008080',
  thistle: 'd8bfd8', tomato: 'ff6347', turquoise: '40e0d0', violet: 'ee82ee',
  wheat: 'f5deb3', white: 'ffffff', whitesmoke: 'f5f5f5', yellow: 'ffff00',
  yellowgreen: '9acd32',
};

export interface Colour { rgb: RGB; alpha: number }

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** A channel that may be a percentage. */
function channel(tok: string): number {
  const t = tok.trim();
  return t.endsWith('%') ? byte((parseFloat(t) / 100) * 255) : byte(parseFloat(t));
}

function alphaOf(tok: string | undefined): number {
  if (tok === undefined) return 1;
  const t = tok.trim();
  const v = t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t);
  return Number.isFinite(v) ? clamp01(v) : 1;
}

function hue(tok: string): number {
  const t = tok.trim().toLowerCase();
  const v = parseFloat(t);
  if (t.endsWith('turn')) return v * 360;
  if (t.endsWith('grad')) return v * 0.9;
  if (t.endsWith('rad')) return (v * 180) / Math.PI;
  return v;
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const hh = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [byte(l * 255), byte(l * 255), byte(l * 255)];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t0: number) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [byte(ch(hh + 1 / 3) * 255), byte(ch(hh) * 255), byte(ch(hh - 1 / 3) * 255)];
}

/** Split a functional colour's arguments, comma or space syntax, with `/ alpha`. */
function args(inner: string): { parts: string[]; alpha?: string } {
  const [main, slashAlpha] = inner.split('/');
  const parts = (main ?? '').split(/[\s,]+/).map((p) => p.trim()).filter(Boolean);
  if (slashAlpha !== undefined) return { parts, alpha: slashAlpha.trim() };
  return parts.length >= 4 ? { parts: parts.slice(0, 3), alpha: parts[3] } : { parts };
}

/**
 * A CSS colour, or the keyword 'currentColor', or null.
 *
 * Alpha is returned separately rather than dropped: `#1d3f2b80` and
 * `rgba(..., .5)` are half-transparent, and printing them solid is wrong.
 */
export function colour(input: string): Colour | 'currentColor' | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (s === 'currentcolor') return 'currentColor';
  if (s === 'transparent') return { rgb: [0, 0, 0], alpha: 0 };
  if (s.startsWith('#')) {
    const h = s.slice(1);
    if (!/^[0-9a-f]+$/.test(h)) return null;
    if (h.length === 3 || h.length === 4) {
      const v = h.split('').map((c) => parseInt(c + c, 16));
      return { rgb: [v[0]!, v[1]!, v[2]!], alpha: h.length === 4 ? v[3]! / 255 : 1 };
    }
    if (h.length === 6 || h.length === 8) {
      const v = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16));
      return { rgb: [v[0]!, v[1]!, v[2]!], alpha: h.length === 8 ? v[3]! / 255 : 1 };
    }
    return null;
  }
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s);
  if (fn) {
    const { parts, alpha } = args(fn[2]!);
    if (parts.length < 3) return null;
    if (fn[1]!.startsWith('rgb')) {
      return { rgb: [channel(parts[0]!), channel(parts[1]!), channel(parts[2]!)], alpha: alphaOf(alpha) };
    }
    const sat = clamp01(parseFloat(parts[1]!) / 100);
    const lig = clamp01(parseFloat(parts[2]!) / 100);
    return { rgb: hslToRgb(hue(parts[0]!), sat, lig), alpha: alphaOf(alpha) };
  }
  const named = NAMED[s];
  if (named) {
    return { rgb: [parseInt(named.slice(0, 2), 16), parseInt(named.slice(2, 4), 16), parseInt(named.slice(4, 6), 16)], alpha: 1 };
  }
  return null;
}

/* ------------------------------- transforms ------------------------------- */

/**
 * A transform attribute, as a single matrix.
 *
 * Arguments go through the full number grammar, so `translate(10-5)` is a
 * translation by (10, -5) rather than NaN.
 */
export function transform(s: string | undefined): Mat {
  if (!s) return IDENTITY;
  let out: Mat = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewx|skewy)\s*\(([^)]*)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const a = numbers(m[2]);
    let t: Mat = IDENTITY;
    switch (m[1]!.toLowerCase()) {
      case 'matrix':
        if (a.length >= 6) t = [a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!];
        break;
      case 'translate': t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]; break;
      case 'scale': t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const r = ((a[0] ?? 0) * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
        const rot: Mat = [c, sn, -sn, c, 0, 0];
        t = a.length >= 3 ? mul(mul(translate(a[1]!, a[2]!), rot), translate(-a[1]!, -a[2]!)) : rot;
        break;
      }
      case 'skewx': t = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewy': t = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]; break;
    }
    out = mul(out, t);
  }
  return out.every(Number.isFinite) ? out : IDENTITY;
}

/* ------------------------------ viewport maths ----------------------------- */

export interface ViewBox { x: number; y: number; w: number; h: number }

export function viewBox(s: string | undefined): ViewBox | null {
  const v = numbers(s);
  if (v.length !== 4 || !(v[2]! > 0) || !(v[3]! > 0)) return null;
  return { x: v[0]!, y: v[1]!, w: v[2]!, h: v[3]! };
}

export interface AspectRatio {
  align: 'none' | `x${'Min' | 'Mid' | 'Max'}Y${'Min' | 'Mid' | 'Max'}`;
  slice: boolean;
}

export function aspectRatio(s: string | undefined): AspectRatio {
  const t = (s ?? '').trim().split(/\s+/).filter((x) => x && x !== 'defer');
  const align = (t[0] ?? 'xMidYMid') as AspectRatio['align'];
  const ok = align === 'none' || /^x(Min|Mid|Max)Y(Min|Mid|Max)$/.test(align);
  return { align: ok ? align : 'xMidYMid', slice: t[1] === 'slice' };
}

/** The matrix mapping a viewBox into a w x h viewport, honouring preserveAspectRatio. */
export function viewBoxTransform(vb: ViewBox, par: AspectRatio, w: number, h: number): Mat {
  let sx = w / vb.w, sy = h / vb.h;
  if (par.align === 'none') return [sx, 0, 0, sy, -vb.x * sx, -vb.y * sy];
  const s = par.slice ? Math.max(sx, sy) : Math.min(sx, sy);
  sx = s; sy = s;
  let tx = -vb.x * s, ty = -vb.y * s;
  const ax = par.align.slice(1, 4), ay = par.align.slice(5, 8);
  if (ax === 'Mid') tx += (w - vb.w * s) / 2;
  if (ax === 'Max') tx += w - vb.w * s;
  if (ay === 'Mid') ty += (h - vb.h * s) / 2;
  if (ay === 'Max') ty += h - vb.h * s;
  return [sx, 0, 0, sy, tx, ty];
}
