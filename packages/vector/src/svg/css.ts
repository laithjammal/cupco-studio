/**
 * Enough of CSS to style an SVG the way a browser would.
 *
 * The previous version honoured only bare `.class`, `#id` and `tag`
 * selectors, so `.logo .mark { fill: ... }` - an ordinary descendant selector
 * - was skipped and the shape fell back to black. This is a real selector
 * engine: compound selectors, all four combinators, attribute selectors and
 * the structural pseudo-classes, with specificity and !important honoured, and
 * @media / @supports blocks applied rather than dropped.
 */

import { elements, type XElement } from './xml';

export interface Declaration { prop: string; value: string; important: boolean }

type AttrOp = '=' | '~=' | '|=' | '^=' | '$=' | '*=';

type Simple =
  | { t: 'type'; name: string }
  | { t: 'any' }
  | { t: 'id'; v: string }
  | { t: 'class'; v: string }
  | { t: 'attr'; name: string; op?: AttrOp; value?: string; ci: boolean }
  | { t: 'pseudo'; name: string; nth?: [number, number]; sel?: Complex[] }
  | { t: 'never' };

interface Complex {
  /** Rightmost first, for matching right to left. */
  parts: { compound: Simple[]; combinator: ' ' | '>' | '+' | '~' | '' }[];
  specificity: number;
}

export interface Rule { selector: Complex; order: number; decls: Declaration[] }

export interface FontFace { family: string; src: string; weight: string; style: string }

export interface Stylesheet {
  rules: Rule[];
  fontFaces: FontFace[];
  /** Selectors this engine could not interpret. They are skipped, not guessed. */
  skipped: number;
}

/* ---------------------------- declarations -------------------------------- */

/** Split on `sep` outside quotes and parentheses - `url(data:x;base64,...)` has semicolons in it. */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = '', cur = '';
  for (const c of s) {
    if (quote) { if (c === quote) quote = ''; cur += c; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    if (c === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

export function parseDeclarations(text: string | undefined): Declaration[] {
  if (!text) return [];
  const out: Declaration[] = [];
  for (const part of splitTop(text, ';')) {
    const i = part.indexOf(':');
    if (i <= 0) continue;
    const prop = part.slice(0, i).trim().toLowerCase();
    let value = part.slice(i + 1).trim();
    let important = false;
    const imp = /!\s*important\s*$/i.exec(value);
    if (imp) { important = true; value = value.slice(0, imp.index).trim(); }
    if (prop && value) out.push(...expand(prop, value, important));
  }
  return out;
}

/** Shorthands that real exports use. */
function expand(prop: string, value: string, important: boolean): Declaration[] {
  if (prop !== 'font') return [{ prop, value, important }];
  // font: [style] [variant] [weight] [stretch] size[/line-height] family
  const m = /^\s*((?:(?:italic|oblique|normal|small-caps|bold|bolder|lighter|\d{3}|condensed|expanded|semi-condensed|semi-expanded)\s+)*)([\d.]+(?:px|pt|em|rem|%|mm|cm|in)?)(?:\s*\/\s*[^\s]+)?\s+(.+)$/i.exec(value);
  if (!m) return [];
  const words = (m[1] ?? '').trim().split(/\s+/).filter(Boolean).map((w) => w.toLowerCase());
  const out: Declaration[] = [
    { prop: 'font-size', value: m[2]!, important },
    { prop: 'font-family', value: m[3]!, important },
    { prop: 'font-style', value: words.find((w) => w === 'italic' || w === 'oblique') ?? 'normal', important },
    { prop: 'font-weight', value: words.find((w) => /^(bold|bolder|lighter|\d{3})$/.test(w)) ?? 'normal', important },
  ];
  return out;
}

/* ------------------------------- selectors -------------------------------- */

function parseNth(arg: string): [number, number] | null {
  const s = arg.replace(/\s+/g, '').toLowerCase();
  if (s === 'odd') return [2, 1];
  if (s === 'even') return [2, 0];
  const m = /^([-+]?\d*)n([-+]\d+)?$/.exec(s);
  if (m) {
    const a = m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : parseInt(m[1]!, 10);
    return [a, m[2] ? parseInt(m[2], 10) : 0];
  }
  return /^[-+]?\d+$/.test(s) ? [0, parseInt(s, 10)] : null;
}

const IDENT = /^-?[_a-zA-Z -￿][_a-zA-Z0-9 -￿-]*|^\\./;

/** Parse one complex selector, or null if it uses something we cannot match. */
function parseSelector(text: string): Complex | null {
  const s = text.trim();
  const parts: Complex['parts'] = [];
  let compound: Simple[] = [];
  let combinator: Complex['parts'][number]['combinator'] = '';
  let a = 0, b = 0, c = 0;
  let i = 0;

  const ident = (): string | null => {
    const m = /^-?(?:[_a-zA-Z -￿]|\\.)(?:[_a-zA-Z0-9 -￿-]|\\.)*/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return m[0].replace(/\\(.)/g, '$1');
  };
  const closeCompound = (next: Complex['parts'][number]['combinator']) => {
    if (compound.length === 0) return false;
    parts.unshift({ compound, combinator });
    compound = [];
    combinator = next;
    return true;
  };

  while (i < s.length) {
    const ch = s[i]!;
    if (/\s/.test(ch) || ch === '>' || ch === '+' || ch === '~') {
      let comb: ' ' | '>' | '+' | '~' = ' ';
      while (i < s.length && /[\s>+~]/.test(s[i]!)) {
        if (s[i] !== ' ' && !/\s/.test(s[i]!)) comb = s[i] as '>' | '+' | '~';
        i++;
      }
      if (i >= s.length) break;
      if (!closeCompound(comb)) return null;
      continue;
    }
    if (ch === '*') { compound.push({ t: 'any' }); i++; continue; }
    if (ch === '#') { i++; const v = ident(); if (!v) return null; compound.push({ t: 'id', v }); a++; continue; }
    if (ch === '.') { i++; const v = ident(); if (!v) return null; compound.push({ t: 'class', v }); b++; continue; }
    if (ch === '[') {
      const end = s.indexOf(']', i);
      if (end < 0) return null;
      const body = s.slice(i + 1, end);
      i = end + 1;
      const m = /^\s*([^\s~|^$*=\]]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*(i|s)?)?\s*$/.exec(body);
      if (!m) return null;
      compound.push({
        t: 'attr', name: m[1]!.toLowerCase().replace(/^\w+\|/, ''),
        op: m[2] as AttrOp | undefined, value: m[3] ?? m[4] ?? m[5], ci: m[6] === 'i',
      });
      b++;
      continue;
    }
    if (ch === ':') {
      if (s[i + 1] === ':') return null; // pseudo-elements never match an element
      i++;
      const name = ident()?.toLowerCase();
      if (!name) return null;
      let arg: string | undefined;
      if (s[i] === '(') {
        let depth = 0, j = i;
        for (; j < s.length; j++) {
          if (s[j] === '(') depth++;
          else if (s[j] === ')' && --depth === 0) break;
        }
        arg = s.slice(i + 1, j);
        i = j + 1;
      }
      if (['first-child', 'last-child', 'only-child', 'first-of-type', 'last-of-type', 'only-of-type', 'root', 'empty'].includes(name)) {
        compound.push({ t: 'pseudo', name }); b++;
      } else if (['nth-child', 'nth-last-child', 'nth-of-type', 'nth-last-of-type'].includes(name)) {
        const nth = arg ? parseNth(arg) : null;
        if (!nth) return null;
        compound.push({ t: 'pseudo', name, nth }); b++;
      } else if (['not', 'is', 'where', 'matches', '-webkit-any'].includes(name)) {
        const list = splitTop(arg ?? '', ',').map(parseSelector);
        if (list.some((x) => !x)) return null;
        const sels = list as Complex[];
        compound.push({ t: 'pseudo', name: name === 'not' ? 'not' : name === 'where' ? 'where' : 'is', sel: sels });
        if (name !== 'where') {
          const best = Math.max(0, ...sels.map((x) => x.specificity));
          a += Math.floor(best / 10000); b += Math.floor((best % 10000) / 100); c += best % 100;
        }
      } else if (['hover', 'focus', 'active', 'visited', 'focus-within', 'focus-visible', 'target', 'checked', 'disabled'].includes(name)) {
        // Interaction states: never true in a static file.
        compound.push({ t: 'never' }); b++;
      } else if (name === 'link' || name === 'any-link') {
        compound.push({ t: 'type', name: 'a' }); compound.push({ t: 'attr', name: 'href', ci: false }); b++;
      } else {
        return null;
      }
      continue;
    }
    if (IDENT.test(s.slice(i))) {
      const v = ident();
      if (!v) return null;
      compound.push({ t: 'type', name: v.toLowerCase().replace(/^\w+\|/, '') });
      c++;
      continue;
    }
    return null;
  }
  if (!closeCompound('')) return null;
  return { parts, specificity: a * 10000 + b * 100 + c };
}

/* ------------------------------- matching --------------------------------- */

function siblings(el: XElement): XElement[] {
  return el.parent ? elements(el.parent) : [el];
}

function attrMatch(el: XElement, s: Extract<Simple, { t: 'attr' }>): boolean {
  const raw = el.attrs[s.name];
  if (raw === undefined) return false;
  if (!s.op || s.value === undefined) return true;
  const v = s.ci ? raw.toLowerCase() : raw;
  const w = s.ci ? s.value.toLowerCase() : s.value;
  switch (s.op) {
    case '=': return v === w;
    case '~=': return v.split(/\s+/).includes(w);
    case '|=': return v === w || v.startsWith(w + '-');
    case '^=': return w !== '' && v.startsWith(w);
    case '$=': return w !== '' && v.endsWith(w);
    case '*=': return w !== '' && v.includes(w);
  }
}

function nthOk(index1: number, [a, b]: [number, number]): boolean {
  if (a === 0) return index1 === b;
  const n = (index1 - b) / a;
  return Number.isInteger(n) && n >= 0;
}

function simpleMatch(el: XElement, s: Simple): boolean {
  switch (s.t) {
    case 'any': return true;
    case 'never': return false;
    case 'type': return el.tag === s.name;
    case 'id': return el.attrs['id'] === s.v;
    case 'class': return (el.attrs['class'] ?? '').split(/\s+/).includes(s.v);
    case 'attr': return attrMatch(el, s);
    case 'pseudo': {
      const sib = siblings(el);
      const i = sib.indexOf(el);
      const sameType = sib.filter((x) => x.tag === el.tag);
      const ti = sameType.indexOf(el);
      switch (s.name) {
        case 'root': return el.parent === null;
        case 'empty': return el.children.every((c) => c.kind === 'text' && !c.text.trim());
        case 'first-child': return i === 0;
        case 'last-child': return i === sib.length - 1;
        case 'only-child': return sib.length === 1;
        case 'first-of-type': return ti === 0;
        case 'last-of-type': return ti === sameType.length - 1;
        case 'only-of-type': return sameType.length === 1;
        case 'nth-child': return nthOk(i + 1, s.nth!);
        case 'nth-last-child': return nthOk(sib.length - i, s.nth!);
        case 'nth-of-type': return nthOk(ti + 1, s.nth!);
        case 'nth-last-of-type': return nthOk(sameType.length - ti, s.nth!);
        case 'not': return !s.sel!.some((x) => matches(el, x));
        case 'is': case 'where': return s.sel!.some((x) => matches(el, x));
      }
      return false;
    }
  }
}

function compoundMatch(el: XElement, compound: Simple[]): boolean {
  return compound.every((s) => simpleMatch(el, s));
}

/** Does `el` match this complex selector? Right to left, with backtracking for ' ' and '~'. */
export function matches(el: XElement, sel: Complex): boolean {
  const step = (node: XElement, k: number): boolean => {
    const part = sel.parts[k]!;
    if (!compoundMatch(node, part.compound)) return false;
    if (k === sel.parts.length - 1) return true;
    const next = sel.parts[k + 1]!;
    switch (part.combinator) {
      case '>': return node.parent ? step(node.parent, k + 1) : false;
      case ' ': {
        for (let p = node.parent; p; p = p.parent) if (step(p, k + 1)) return true;
        return false;
      }
      case '+': {
        const sib = siblings(node);
        const i = sib.indexOf(node);
        return i > 0 ? step(sib[i - 1]!, k + 1) : false;
      }
      case '~': {
        const sib = siblings(node);
        const i = sib.indexOf(node);
        for (let j = i - 1; j >= 0; j--) if (step(sib[j]!, k + 1)) return true;
        return false;
      }
      default:
        void next;
        return false;
    }
  };
  return step(el, 0);
}

/* ------------------------------ stylesheet -------------------------------- */

/** Read rules out of a style sheet, descending into @media/@supports blocks. */
export function parseStylesheet(cssText: string, sheet: Stylesheet = { rules: [], fontFaces: [], skipped: 0 }): Stylesheet {
  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--|-->/g, '');
  let i = 0;
  while (i < css.length) {
    // Prelude: up to '{' or ';' at depth 0.
    let j = i, quote = '';
    while (j < css.length) {
      const ch = css[j]!;
      if (quote) { if (ch === quote) quote = ''; } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '{' || ch === ';') break;
      j++;
    }
    const prelude = css.slice(i, j).trim();
    if (j >= css.length) break;
    if (css[j] === ';') { i = j + 1; continue; } // @import, @charset
    // Block: to the matching '}'.
    let depth = 0, k = j;
    quote = '';
    for (; k < css.length; k++) {
      const ch = css[k]!;
      if (quote) { if (ch === quote) quote = ''; continue; }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) break;
    }
    const block = css.slice(j + 1, k);
    i = k + 1;

    if (prelude.startsWith('@')) {
      const at = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase();
      if (at === 'media' || at === 'supports' || at === 'document' || at === 'layer') {
        // Treated as applying: a file viewed on a screen or printed from one.
        if (!/\bprint\b/i.test(prelude) || /\bscreen\b|\ball\b/i.test(prelude)) parseStylesheet(block, sheet);
      } else if (at === 'font-face') {
        const d = parseDeclarations(block);
        const get = (p: string) => d.find((x) => x.prop === p)?.value ?? '';
        const family = get('font-family').replace(/^['"]|['"]$/g, '');
        if (family) sheet.fontFaces.push({ family, src: get('src'), weight: get('font-weight'), style: get('font-style') });
      }
      continue;
    }

    const decls = parseDeclarations(block);
    for (const selText of splitTop(prelude, ',')) {
      if (!selText.trim()) continue;
      const sel = parseSelector(selText);
      if (!sel) { sheet.skipped++; continue; }
      sheet.rules.push({ selector: sel, order: sheet.rules.length, decls });
    }
  }
  return sheet;
}

/**
 * Presentation attributes that are also CSS properties.
 *
 * An attribute like fill="red" is styling at the LOWEST priority - any
 * stylesheet rule or inline style overrides it.
 */
const PRESENTATION = new Set([
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray',
  'stroke-dashoffset', 'opacity', 'display', 'visibility', 'color', 'clip-path',
  'clip-rule', 'mask', 'filter', 'font-family', 'font-size', 'font-weight',
  'font-style', 'letter-spacing', 'word-spacing', 'text-anchor', 'stop-color',
  'stop-opacity', 'overflow', 'dominant-baseline', 'alignment-baseline',
  'baseline-shift', 'vector-effect', 'paint-order', 'mask-type', 'marker-start',
  'marker-mid', 'marker-end', 'white-space', 'text-decoration', 'transform-origin',
]);

/**
 * The declared value of every property on one element, cascade applied:
 * presentation attribute < stylesheet (by specificity, then order) < inline
 * style, and !important inverting the last two.
 */
export function declared(el: XElement, sheet: Stylesheet): Map<string, string> {
  const ranked: { prop: string; value: string; rank: number }[] = [];
  for (const [k, v] of Object.entries(el.attrs)) {
    if (PRESENTATION.has(k)) ranked.push({ prop: k, value: v, rank: 0 });
  }
  for (const r of sheet.rules) {
    if (!matches(el, r.selector)) continue;
    // Rank: [important][specificity][order], packed so a plain sort orders the cascade.
    for (const d of r.decls) {
      ranked.push({
        prop: d.prop, value: d.value,
        rank: (d.important ? 3e12 : 1e12) + r.selector.specificity * 1e5 + r.order,
      });
    }
  }
  for (const d of parseDeclarations(el.attrs['style'])) {
    ranked.push({ prop: d.prop, value: d.value, rank: d.important ? 4e12 : 2e12 });
  }
  ranked.sort((x, y) => x.rank - y.rank);
  const out = new Map<string, string>();
  for (const r of ranked) out.set(r.prop, r.value);
  return out;
}
