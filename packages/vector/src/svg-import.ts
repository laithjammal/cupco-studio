/**
 * SVG document -> flat list of filled shapes.
 *
 * Deliberately DOM-free: a tiny XML reader rather than DOMParser, so the same
 * import path runs in the browser, in the export worker and in tests. That
 * matters because an import bug here would silently alter customer artwork,
 * and it must be testable without a browser.
 *
 * Scope: the subset Illustrator, Figma and Inkscape actually emit for logo
 * artwork - paths, primitives, groups, transforms and flat fills. Gradients,
 * filters, clip paths, masks and embedded images are NOT interpreted; shapes
 * using them are reported so the UI can warn instead of silently dropping or
 * mis-rendering them.
 */

import { flattenPathData, type Pt, type SubPath } from './path-data';
import { strokeToSubpaths } from './stroke';
import { hexToRgb, type RGB } from './color';

export interface ImportedShape {
  subpaths: SubPath[];
  fill: RGB;
  opacity: number;
}

export interface SvgImportResult {
  shapes: ImportedShape[];
  /** User units. */
  width: number;
  height: number;
  /** Human-readable notes about anything not fully supported. */
  warnings: string[];
}

/* ------------------------------- tiny XML -------------------------------- */

interface XNode {
  tag: string;
  attrs: Record<string, string>;
  children: XNode[];
}

function parseXml(src: string): XNode | null {
  // Strip comments, CDATA, doctype and processing instructions first so the
  // element scanner never sees markup-like text inside them.
  const clean = src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<\?[\s\S]*?\?>/g, '');

  // Attribute values may be unquoted, and an attribute may have no value at
  // all. Requiring `name="value"` for every one made a single stray attribute
  // fail the whole tag match, and the element was then dropped in silence.
  const tagRe = /<\s*(\/)?\s*([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/)?\s*>/g;
  const root: XNode = { tag: '#root', attrs: {}, children: [] };
  const stack: XNode[] = [root];
  let m: RegExpExecArray | null;

  while ((m = tagRe.exec(clean)) !== null) {
    const [, closing, tag, attrStr, selfClose] = m;
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node: XNode = { tag: tag!.toLowerCase(), attrs: parseAttrs(attrStr ?? ''), children: [] };
    stack[stack.length - 1]!.children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root.children.find((c) => c.tag === 'svg') ?? null;
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w.:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}

/* ------------------------------ transforms ------------------------------- */

/** 2D affine matrix [a b c d e f]. */
type Mat = [number, number, number, number, number, number];
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: Mat, p: Pt): Pt {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

function parseTransform(s: string | undefined): Mat {
  if (!s) return IDENTITY;
  let out: Mat = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const a = (m[2] ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
    let t: Mat = IDENTITY;
    switch (m[1]) {
      case 'matrix': if (a.length >= 6) t = [a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!]; break;
      case 'translate': t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]; break;
      case 'scale': t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const r = ((a[0] ?? 0) * Math.PI) / 180, c = Math.cos(r), s2 = Math.sin(r);
        const rot: Mat = [c, s2, -s2, c, 0, 0];
        if (a.length >= 3) {
          t = mul(mul([1, 0, 0, 1, a[1]!, a[2]!], rot), [1, 0, 0, 1, -a[1]!, -a[2]!]);
        } else t = rot;
        break;
      }
      case 'skewX': t = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewY': t = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]; break;
    }
    out = mul(out, t);
  }
  return out;
}

/* -------------------------------- paint ---------------------------------- */

const NAMED: Record<string, RGB> = {
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0],
  blue: [0, 0, 255], yellow: [255, 255, 0], grey: [128, 128, 128], gray: [128, 128, 128],
  orange: [255, 165, 0], purple: [128, 0, 128], silver: [192, 192, 192], navy: [0, 0, 128],
};

interface Paint {
  fill: RGB | null;
  opacity: number;
  /** A stroke is filled geometry by the time it leaves here - see ./stroke. */
  stroke: RGB | null;
  strokeWidth: number;
  warning?: string;
}

function resolvePaint(node: XNode, inherited: Paint, rules: readonly CssRule[] = []): Paint {
  const style = parseStyle(node.attrs['style']);
  const css = cssFor(node, rules);
  // Cascade order: an inline style wins, then the stylesheet, and a
  // presentation attribute loses to both - which is what the spec says, and
  // what tools rely on when they emit a placeholder fill alongside a class.
  const prop = (name: string) => style[name] ?? css[name] ?? node.attrs[name];

  const fillOpacity = num(prop('fill-opacity'), 1);
  const opacity = num(prop('opacity'), 1) * fillOpacity * inherited.opacity;

  let warning: string | undefined;
  const colour = (raw: string | undefined, inheritedColour: RGB | null): RGB | null => {
    const v = (raw ?? '').trim().toLowerCase();
    if (v === '') return inheritedColour;
    if (v === 'none' || v === 'transparent') return null;
    if (v.startsWith('url(')) {
      warning = 'gradient-or-pattern';
      return inheritedColour ?? [128, 128, 128];
    }
    return parseColour(v) ?? inheritedColour;
  };

  const strokeWidthRaw = prop('stroke-width');
  return {
    fill: colour(prop('fill'), inherited.fill),
    opacity,
    stroke: colour(prop('stroke'), inherited.stroke),
    strokeWidth: strokeWidthRaw === undefined ? inherited.strokeWidth : num(strokeWidthRaw, 1),
    warning,
  };
}

function parseStyle(s: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!s) return out;
  for (const part of s.split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
}

function parseColour(s: string): RGB | null {
  if (s.startsWith('#')) return hexToRgb(s);
  const rgbM = /^rgba?\(([^)]*)\)$/.exec(s);
  if (rgbM) {
    const a = rgbM[1]!.split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    if (a.length >= 3) return [clamp255(a[0]!), clamp255(a[1]!), clamp255(a[2]!)];
  }
  return NAMED[s] ?? null;
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const num = (s: string | undefined, d: number) => {
  const n = parseFloat(s ?? '');
  return Number.isFinite(n) ? n : d;
};

/* ------------------------------ primitives -------------------------------- */

function primitiveToSubpaths(node: XNode): SubPath[] | null {
  const a = node.attrs;
  const N = (k: string, d = 0) => num(a[k], d);

  switch (node.tag) {
    case 'path': return a['d'] ? flattenPathData(a['d']) : [];
    case 'rect': {
      const x = N('x'), y = N('y'), w = N('width'), h = N('height');
      if (w <= 0 || h <= 0) return [];
      return [{ points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }], closed: true }];
    }
    case 'circle': case 'ellipse': {
      const cx = N('cx'), cy = N('cy');
      const rx = node.tag === 'circle' ? N('r') : N('rx');
      const ry = node.tag === 'circle' ? N('r') : N('ry');
      if (rx <= 0 || ry <= 0) return [];
      const pts: Pt[] = [];
      const STEPS = 96;
      for (let i = 0; i <= STEPS; i++) {
        const t = (i / STEPS) * Math.PI * 2;
        pts.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
      }
      return [{ points: pts, closed: true }];
    }
    case 'polygon': case 'polyline': {
      const nums = (a['points'] ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
      const pts: Pt[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i]!, y: nums[i + 1]! });
      if (pts.length < 2) return [];
      const closed = node.tag === 'polygon';
      if (closed) pts.push({ ...pts[0]! });
      return [{ points: pts, closed }];
    }
    case 'line': {
      return [{ points: [{ x: N('x1'), y: N('y1') }, { x: N('x2'), y: N('y2') }], closed: false }];
    }
    default: return null;
  }
}

/* -------------------------------- import ---------------------------------- */

const UNSUPPORTED_CONTAINERS = new Set(['clippath', 'mask', 'filter', 'defs', 'symbol', 'marker']);

/* ------------------------------ stylesheets ------------------------------ */

/**
 * The internal stylesheet.
 *
 * Illustrator's default SVG export puts every fill in a <style> block and
 * references it by class - `.cls-1{fill:#e6a670}` - rather than writing
 * `fill` on each shape. Without this, every one of those shapes resolves to
 * the inherited default, and the whole logo imports as a solid black
 * silhouette with its detail welded shut. It is the commonest way a real
 * logo arrives, so it cannot be treated as an edge case.
 *
 * Only SIMPLE selectors are honoured - a chain of tag, .class and #id with no
 * combinator. That covers what drawing tools emit. Anything more elaborate is
 * reported rather than half-applied, because a selector we score wrongly
 * would put a confidently wrong colour on the artwork.
 */
interface CssRule {
  tag: string | null;
  classes: string[];
  id: string | null;
  specificity: number;
  order: number;
  decls: Record<string, string>;
}

const SIMPLE_SELECTOR = /^(?:[A-Za-z][\w-]*)?(?:[.#][A-Za-z_-][\w-]*)*$/;

/**
 * Pull every <style> block out of the raw source, returning the rules and the
 * source with those blocks removed.
 *
 * Done on the TEXT, before parsing, for two reasons: the element scanner keeps
 * no text content, so a parsed tree cannot reach the CSS at all; and CSS may
 * contain `>` and `<`, which would otherwise derail the scanner.
 */
function extractStylesheet(src: string): { rules: CssRule[]; rest: string; warn: string | null } {
  const rules: CssRule[] = [];
  let unsupported = false;
  let order = 0;

  const rest = src.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_all, body: string) => {
    const css = body
      .replace(/<!\[CDATA\[|\]\]>/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    // No @media, @font-face or other at-rules: their bodies nest braces and
    // this splitter cannot see that. Skipping is safer than mis-pairing.
    for (const block of css.split('}')) {
      const brace = block.indexOf('{');
      if (brace < 0) continue;
      const selectors = block.slice(0, brace);
      if (selectors.includes('@')) { unsupported = true; continue; }
      const decls = parseStyle(block.slice(brace + 1));
      for (const raw of selectors.split(',')) {
        const sel = raw.trim();
        if (!sel) continue;
        if (!SIMPLE_SELECTOR.test(sel)) { unsupported = true; continue; }
        const classes = [...sel.matchAll(/\.([A-Za-z_-][\w-]*)/g)].map((m) => m[1]!);
        const ids = [...sel.matchAll(/#([A-Za-z_-][\w-]*)/g)].map((m) => m[1]!);
        const tagM = /^[A-Za-z][\w-]*/.exec(sel);
        rules.push({
          tag: tagM ? tagM[0].toLowerCase() : null,
          classes,
          id: ids[0] ?? null,
          // The cascade's own weighting: an id beats any number of classes,
          // a class beats any number of tags.
          specificity: ids.length * 100 + classes.length * 10 + (tagM ? 1 : 0),
          order: order++,
          decls,
        });
      }
    }
    return '';
  });

  return {
    rules,
    rest,
    warn: unsupported ? 'some CSS rules were too complex to apply' : null,
  };
}

/** Declarations from the stylesheet that apply to one node, cascade applied. */
function cssFor(node: XNode, rules: readonly CssRule[]): Record<string, string> {
  if (rules.length === 0) return {};
  const classes = (node.attrs['class'] ?? '').split(/\s+/).filter(Boolean);
  const id = node.attrs['id'];
  const winners: Record<string, { spec: number; order: number; value: string }> = {};

  for (const r of rules) {
    if (r.tag && r.tag !== node.tag) continue;
    if (r.id && r.id !== id) continue;
    if (!r.classes.every((c) => classes.includes(c))) continue;
    for (const [prop, value] of Object.entries(r.decls)) {
      const held = winners[prop];
      if (!held || r.specificity > held.spec
        || (r.specificity === held.spec && r.order > held.order)) {
        winners[prop] = { spec: r.specificity, order: r.order, value };
      }
    }
  }

  const out: Record<string, string> = {};
  for (const [prop, w] of Object.entries(winners)) out[prop] = w.value;
  return out;
}

export function importSvg(source: string): SvgImportResult {
  const sheet = extractStylesheet(source);
  const root = parseXml(sheet.rest);
  if (!root) return { shapes: [], width: 0, height: 0, warnings: ['Not a valid SVG document'] };

  const warnings = new Set<string>();
  if (sheet.warn) warnings.add(sheet.warn);
  const shapes: ImportedShape[] = [];

  // Establish the user-unit box. viewBox wins; width/height is the fallback.
  let width = num(root.attrs['width'], 0);
  let height = num(root.attrs['height'], 0);
  let vb: number[] | null = null;
  if (root.attrs['viewbox']) {
    const v = root.attrs['viewbox'].split(/[\s,]+/).filter(Boolean).map(Number);
    if (v.length === 4 && v[2]! > 0 && v[3]! > 0) {
      vb = v;
      width = v[2]!; height = v[3]!;
    }
  }
  const base: Mat = vb ? [1, 0, 0, 1, -vb[0]!, -vb[1]!] : IDENTITY;

  // Every element carrying an id, so <use> can find what it points at. Built
  // over the WHOLE tree including <defs> and <symbol>, which is where the
  // referenced content almost always lives.
  const byId = new Map<string, XNode>();
  (function index(n: XNode) {
    const id = n.attrs['id'];
    if (id && !byId.has(id)) byId.set(id, n);
    for (const c of n.children) index(c);
  })(root);

  const emit = (child: XNode, ctm: Mat, paint: Paint, active: ReadonlySet<string>): void => {
    if (child.tag === 'image') { warnings.add('embedded <image> skipped'); return; }
    if (child.tag === 'text') { warnings.add('<text> skipped — convert type to outlines'); return; }

    const m = mul(ctm, parseTransform(child.attrs['transform']));
    const p = resolvePaint(child, paint, sheet.rules);
    if (p.warning) warnings.add('gradients/patterns flattened to a solid colour');
    if (child.attrs['clip-path'] || child.attrs['mask']) {
      warnings.add('clipping and masks are not applied — artwork may extend further than intended');
    }

    // <use> instantiates something defined elsewhere. Unresolved, it is a
    // silent hole in the artwork: the element draws nothing itself, and
    // whatever it points at usually sits in <defs>, which is never walked.
    if (child.tag === 'use') {
      const href = (child.attrs['href'] ?? child.attrs['xlink:href'] ?? '').trim();
      if (!href.startsWith('#')) { warnings.add('<use> of an external file skipped'); return; }
      const id = href.slice(1);
      const target = byId.get(id);
      if (!target) { warnings.add(`<use> points at "${id}", which is not in the file`); return; }
      // A reference cycle would otherwise recurse until the stack gives out.
      if (active.has(id)) { warnings.add('<use> refers to itself — the cycle was cut'); return; }
      const placed = mul(m, [1, 0, 0, 1, num(child.attrs['x'], 0), num(child.attrs['y'], 0)]);
      const next = new Set(active); next.add(id);
      // A referenced <symbol> or <g> contributes its children, anything else
      // contributes itself.
      if (target.tag === 'symbol' || target.tag === 'g' || target.tag === 'svg') {
        for (const c of target.children) emit(c, placed, p, next);
      } else {
        emit(target, placed, p, next);
      }
      return;
    }

    if (child.tag === 'g' || child.tag === 'svg' || child.tag === 'a') {
      for (const c of child.children) {
        if (UNSUPPORTED_CONTAINERS.has(c.tag)) {
          if (c.tag !== 'defs' && c.tag !== 'symbol') warnings.add(`<${c.tag}> is not interpreted`);
          continue;
        }
        emit(c, m, p, active);
      }
      return;
    }

    const subs = primitiveToSubpaths(child);
    if (subs === null) {
      for (const c of child.children) emit(c, m, p, active);
      return;
    }
    if (subs.length === 0) return;

    const place = (list: SubPath[]) => list.map((sp) => ({
      closed: sp.closed,
      points: sp.points.map((pt) => apply(m, pt)),
    }));

    if (p.fill) {
      shapes.push({ subpaths: place(subs), fill: p.fill, opacity: p.opacity });
    }

    // The stroke is outlined in the element's OWN coordinates and transformed
    // afterwards, so the width scales with the artwork exactly as the renderer
    // would have scaled it.
    if (p.stroke && p.strokeWidth > 0) {
      const outline = strokeToSubpaths(subs, p.strokeWidth);
      if (outline.length > 0) {
        shapes.push({ subpaths: place(outline), fill: p.stroke, opacity: p.opacity });
      }
    }
  };

  for (const c of root.children) {
    if (UNSUPPORTED_CONTAINERS.has(c.tag)) {
      if (c.tag !== 'defs' && c.tag !== 'symbol') warnings.add(`<${c.tag}> is not interpreted`);
      continue;
    }
    emit(c, base, { fill: [0, 0, 0], opacity: 1, stroke: null, strokeWidth: 1 }, new Set());
  }

  if (shapes.length === 0) warnings.add('No filled shapes found');
  if (!width || !height) {
    // Fall back to the artwork's own extent so it can still be placed.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of shapes) for (const sp of s.subpaths) for (const pt of sp.points) {
      minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y);
    }
    if (Number.isFinite(minX)) { width = maxX - minX; height = maxY - minY; }
  }

  return { shapes, width: width || 1, height: height || 1, warnings: [...warnings] };
}
