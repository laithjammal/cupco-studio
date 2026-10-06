/**
 * Live <text>, outlined into glyph shapes.
 *
 * A logo whose wordmark was never converted to outlines used to lose the
 * wordmark entirely - "skipped, convert type to outlines" - which for many
 * cafe logos is most of the logo. Text is now laid out the way a browser lays
 * it out (absolute and relative positioning per character, text chunks and
 * text-anchor, letter- and word-spacing, kerning, whitespace collapsing) and
 * each glyph is outlined from a real font file.
 *
 * The font is the honest limit. The file names a family; if that family is
 * embedded in the file (@font-face) it is used exactly, otherwise the nearest
 * available face is used and the substitution is REPORTED, never silent.
 */

import type { Pt, SubPath } from '../path-data';
import type { Style } from './style';
import { elements, type XElement } from './xml';
import { lengthList } from './values';

export interface PathCommand {
  type: string;
  x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number;
}

/** The subset of an opentype.js glyph this needs. */
export interface OutlineGlyph {
  advanceWidth?: number;
  /** Glyph id, for kerning lookups. */
  index?: number;
  getPath(x: number, y: number, fontSize: number): { commands: PathCommand[] };
}

/** The subset of an opentype.js Font this needs. Any compatible object will do. */
export interface OutlineFont {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  charToGlyph(ch: string): OutlineGlyph;
  getKerningValue?(left: OutlineGlyph, right: OutlineGlyph): number;
  /**
   * Pair kerning by glyph id, from the font's GPOS table - see ./kerning.
   * Preferred over getKerningValue, which reads no GPOS kerning at all from
   * fonts that keep it in extension lookups.
   */
  kernPairs?: (left: number, right: number) => number;
  tables?: { os2?: { sxHeight?: number } };
}

export interface FontMatch {
  font: OutlineFont;
  /** The face actually used, named for the operator: "Inter Bold". */
  family: string;
  /** False when a substitute stood in for what the file asked for. */
  exact: boolean;
  /**
   * A synthetic slant, as the tangent of its angle, for italic asked of a
   * family with only upright faces. Browsers do the same - CSS's default
   * oblique is 14 degrees - so an italic tagline still leans the way it does
   * on screen.
   */
  skewX?: number;
  /**
   * The resolver's own name for the face, carried into FontUse untouched -
   * so whoever supplied the fonts can tell afterwards which file set what.
   */
  key?: string;
}

export interface TextRun { subpaths: SubPath[]; style: Style }

export interface TextEnv {
  styleOf(el: XElement, parent: Style): Style;
  font(style: Style): FontMatch | null;
  /** Curve tolerance in the text element's own units. */
  tolerance: number;
  warn(message: string): void;
  vw: number;
  vh: number;
}

interface Char {
  ch: string;
  style: Style;
  x?: number;
  y?: number;
  dx: number;
  dy: number;
  rotate?: number;
}

/** Positioning lists an element declares, over the characters it contains. */
interface Positioning {
  start: number;
  end: number;
  depth: number;
  x: number[]; y: number[]; dx: number[]; dy: number[]; rotate: number[];
}

function outline(commands: PathCommand[], tol: number): SubPath[] {
  const out: SubPath[] = [];
  let pts: Pt[] = [];
  let cur: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };
  const steps = (len: number) => Math.max(2, Math.min(32, Math.ceil(Math.sqrt(len / Math.max(tol, 1e-9)) / 2)));
  const flush = (closed: boolean) => { if (pts.length > 2) out.push({ points: pts, closed }); pts = []; };
  for (const c of commands) {
    switch (c.type) {
      case 'M': flush(true); cur = { x: c.x!, y: c.y! }; start = cur; pts = [cur]; break;
      case 'L': cur = { x: c.x!, y: c.y! }; pts.push(cur); break;
      case 'Q': {
        const p1 = { x: c.x1!, y: c.y1! }, p2 = { x: c.x!, y: c.y! };
        const n = steps(Math.hypot(p1.x - cur.x, p1.y - cur.y) + Math.hypot(p2.x - p1.x, p2.y - p1.y));
        for (let i = 1; i <= n; i++) {
          const t = i / n, mt = 1 - t;
          pts.push({ x: mt * mt * cur.x + 2 * mt * t * p1.x + t * t * p2.x, y: mt * mt * cur.y + 2 * mt * t * p1.y + t * t * p2.y });
        }
        cur = p2;
        break;
      }
      case 'C': {
        const c1 = { x: c.x1!, y: c.y1! }, c2 = { x: c.x2!, y: c.y2! }, p = { x: c.x!, y: c.y! };
        const n = steps(Math.hypot(c1.x - cur.x, c1.y - cur.y) + Math.hypot(c2.x - c1.x, c2.y - c1.y) + Math.hypot(p.x - c2.x, p.y - c2.y));
        for (let i = 1; i <= n; i++) {
          const t = i / n, mt = 1 - t;
          pts.push({
            x: mt * mt * mt * cur.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p.x,
            y: mt * mt * mt * cur.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p.y,
          });
        }
        cur = p;
        break;
      }
      case 'Z': cur = start; flush(true); break;
    }
  }
  flush(true);
  return out;
}

/** Vertical shift of the alphabetic baseline for a dominant-baseline value. */
function baselineShift(font: OutlineFont, size: number, baseline: string): number {
  const k = size / (font.unitsPerEm || 1000);
  const asc = font.ascender * k, desc = font.descender * k;
  const xh = (font.tables?.os2?.sxHeight ?? font.ascender * 0.5) * k;
  switch (baseline) {
    case 'middle': return xh / 2;
    case 'central': return (asc + desc) / 2;
    case 'hanging': return asc * 0.8;
    case 'text-before-edge': case 'text-top': case 'before-edge': return asc;
    case 'text-after-edge': case 'text-bottom': case 'after-edge': case 'ideographic': return desc;
    case 'mathematical': return asc * 0.5;
    default: return 0;
  }
}

/**
 * Lay out and outline one <text> element, in its own user space.
 *
 * Returns runs of glyph shapes, one per run of characters sharing a style, so
 * a coloured <tspan> stays its own colour.
 */
export function layoutText(textEl: XElement, textStyle: Style, env: TextEnv): TextRun[] {
  const chars: Char[] = [];
  const lists: Positioning[] = [];
  let lastSpace = true; // collapses leading whitespace

  const pos = (el: XElement, attr: string, horizontal: boolean, fontSize: number) =>
    lengthList(el.attrs[attr], { percentOf: horizontal ? env.vw : env.vh, fontSize });

  const walk = (el: XElement, style: Style, depth: number) => {
    const start = chars.length;
    for (const child of el.children) {
      if (child.kind === 'text') {
        for (let ch of child.text) {
          if (style.preserveSpace) {
            if (ch === '\n' || ch === '\r' || ch === '\t') ch = ' ';
          } else {
            if (ch === '\n' || ch === '\r' || ch === '\t') ch = ' ';
            if (ch === ' ' && lastSpace) continue;
          }
          lastSpace = ch === ' ';
          chars.push({ ch, style, dx: 0, dy: 0 });
        }
      } else if (child.tag === 'tspan' || child.tag === 'a') {
        const cs = env.styleOf(child, style);
        if (cs.display) walk(child, cs, depth + 1);
      } else if (child.tag === 'textpath') {
        env.warn('text on a path (<textPath>) is not drawn');
      }
    }
    lists.push({
      start, end: chars.length, depth,
      x: pos(el, 'x', true, style.fontSize), y: pos(el, 'y', false, style.fontSize),
      dx: pos(el, 'dx', true, style.fontSize), dy: pos(el, 'dy', false, style.fontSize),
      rotate: (el.attrs['rotate'] ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number),
    });
  };
  walk(textEl, textStyle, 0);

  // Trailing whitespace is stripped, as browsers do, unless preserved.
  while (chars.length && chars[chars.length - 1]!.ch === ' ' && !chars[chars.length - 1]!.style.preserveSpace) chars.pop();
  if (chars.length === 0) return [];

  // Positioning lists: inner elements override outer ones for their characters.
  lists.sort((a, b) => a.depth - b.depth);
  for (const l of lists) {
    for (let k = 0; l.start + k < Math.min(l.end, chars.length); k++) {
      const c = chars[l.start + k]!;
      if (k < l.x.length && Number.isFinite(l.x[k]!)) c.x = l.x[k];
      if (k < l.y.length && Number.isFinite(l.y[k]!)) c.y = l.y[k];
      if (k < l.dx.length && Number.isFinite(l.dx[k]!)) c.dx = l.dx[k]!;
      if (k < l.dy.length && Number.isFinite(l.dy[k]!)) c.dy = l.dy[k]!;
      if (l.rotate.length) c.rotate = l.rotate[Math.min(k, l.rotate.length - 1)];
    }
  }

  /**
   * `step` is how far the pen actually moved past the glyph: its advance,
   * kerning, and letter- and word-spacing. It is what anchoring measures.
   */
  interface Placed { c: Char; match: FontMatch; x: number; y: number; adv: number; step: number; glyph: OutlineGlyph; chunk: number }
  const placed: Placed[] = [];
  let penX = 0, penY = 0, chunk = 0, missing = false;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    if (i > 0 && (c.x !== undefined || c.y !== undefined)) chunk++;
    if (c.x !== undefined) penX = c.x;
    if (c.y !== undefined) penY = c.y;
    penX += c.dx;
    penY += c.dy;
    const match = env.font(c.style);
    if (!match) { missing = true; continue; }
    const k = c.style.fontSize / (match.font.unitsPerEm || 1000);
    const glyph = match.font.charToGlyph(c.ch);
    const adv = (glyph.advanceWidth ?? 0) * k;
    const here: Placed = { c, match, x: penX, y: penY, adv, step: adv, glyph, chunk };
    placed.push(here);
    let kern = 0;
    const next = chars[i + 1];
    if (next && next.x === undefined && next.style.fontSize === c.style.fontSize) {
      const nm = env.font(next.style);
      if (nm && nm.font === match.font) {
        const ng = match.font.charToGlyph(next.ch);
        if (match.font.kernPairs && glyph.index !== undefined && ng.index !== undefined) {
          kern = match.font.kernPairs(glyph.index, ng.index) * k;
        } else if (match.font.getKerningValue) {
          kern = match.font.getKerningValue(glyph, ng) * k;
        }
      }
    }
    here.step = adv + kern + c.style.letterSpacing + (c.ch === ' ' ? c.style.wordSpacing : 0);
    penX += here.step;
  }
  if (missing) env.warn('some text could not be drawn: no font was available for it');

  // text-anchor, per chunk, from the first character of the chunk.
  const byChunk = new Map<number, Placed[]>();
  for (const p of placed) {
    const list = byChunk.get(p.chunk) ?? [];
    list.push(p);
    byChunk.set(p.chunk, list);
  }
  for (const list of byChunk.values()) {
    const anchor = list[0]!.c.style.textAnchor;
    if (anchor === 'start') continue;
    const first = list[0]!, last = list[list.length - 1]!;
    // The whole advance, letter-spacing after the LAST letter included.
    // That is how Chrome and Illustrator both measure tracked text - checked
    // in Chrome: right-aligned "END" tracked by 2 ends its last glyph 2 short
    // of the anchor. resvg leaves the trailing space out, so the fidelity
    // corpus cannot see this one; a browser-verified test holds it instead.
    const width = last.x + last.step - first.x;
    const shift = anchor === 'middle' ? -width / 2 : -width;
    for (const p of list) p.x += shift;
  }

  // Outline, grouping consecutive glyphs that share a style.
  const runs: TextRun[] = [];
  for (const p of placed) {
    const size = p.c.style.fontSize;
    const y = p.y + baselineShift(p.match.font, size, p.c.style.dominantBaseline);
    let subs = outline(p.glyph.getPath(p.x, y, size).commands, env.tolerance);
    const skew = p.match.skewX;
    if (skew) {
      // About the baseline, leaning forward: y points down, so higher is less.
      subs = subs.map((sp) => ({ closed: sp.closed, points: sp.points.map((q) => ({ x: q.x + (y - q.y) * skew, y: q.y })) }));
    }
    if (p.c.rotate) {
      const a = (p.c.rotate * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
      subs = subs.map((sp) => ({
        closed: sp.closed,
        points: sp.points.map((q) => ({ x: p.x + (q.x - p.x) * co - (q.y - y) * si, y: y + (q.x - p.x) * si + (q.y - y) * co })),
      }));
    }
    if (subs.length === 0) continue;
    const prev = runs[runs.length - 1];
    if (prev && prev.style === p.c.style) prev.subpaths.push(...subs);
    else runs.push({ subpaths: subs, style: p.c.style });
  }
  return runs;
}

export { elements };
