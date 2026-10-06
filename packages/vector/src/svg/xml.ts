/**
 * A small, tolerant XML reader for SVG.
 *
 * DOM-free on purpose, so the import runs identically in the browser, in a
 * worker and under the test runner. The previous reader kept no text at all,
 * which made <text> and <style> unreachable, decoded no entities (so
 * `font-family="&apos;Inter&apos;"` never matched anything), and did not know
 * that `svg:rect` in an `xmlns:svg` document is a rect.
 */

export interface XElement {
  kind: 'element';
  /** Lower-cased local name for SVG elements; `prefix:name` for foreign ones. */
  tag: string;
  /** Attribute names lower-cased, values entity-decoded. */
  attrs: Record<string, string>;
  children: XNode[];
  parent: XElement | null;
}

export interface XText {
  kind: 'text';
  text: string;
  parent: XElement;
}

export type XNode = XElement | XText;

const SVG_NS = 'http://www.w3.org/2000/svg';

const BUILTIN: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };

function decode(s: string, entities: Record<string, string>): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z_][\w.-]*);/g, (all, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : all;
    }
    return entities[ref] ?? BUILTIN[ref] ?? all;
  });
}

function parseAttrs(s: string, entities: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out[m[1]!.toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '', entities);
  }
  return out;
}

/** The <!DOCTYPE ...> declaration, internal subset included, and its entities. */
function readDoctype(src: string, at: number, entities: Record<string, string>): number {
  let i = at + 9;
  let depth = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '[') depth++;
    else if (c === ']') depth--;
    else if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      i = end < 0 ? src.length : end;
    } else if (c === '>' && depth <= 0) break;
    i++;
  }
  // Internal entity declarations: <!ENTITY name "value">
  const subset = src.slice(at, i);
  const re = /<!ENTITY\s+([A-Za-z_][\w.-]*)\s+(?:"([^"]*)"|'([^']*)')\s*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(subset)) !== null) entities[m[1]!] = m[2] ?? m[3] ?? '';
  return i + 1;
}

/**
 * Parse a document and return its root <svg> element, or null.
 *
 * Tolerant rather than strict: a mismatched end tag closes back to the nearest
 * matching open element instead of abandoning the parse, because a slightly
 * malformed file from a real tool should still import.
 */
export function parseXml(src: string): XElement | null {
  const entities: Record<string, string> = {};
  const doc: XElement = { kind: 'element', tag: '#document', attrs: {}, children: [], parent: null };
  const stack: XElement[] = [doc];
  // Prefixes bound to the SVG namespace, per open element.
  const nsStack: Set<string>[] = [new Set()];
  let i = 0;

  const top = () => stack[stack.length - 1]!;
  const pushText = (raw: string, decodeIt: boolean) => {
    if (!raw) return;
    const parent = top();
    if (parent === doc) return;
    parent.children.push({ kind: 'text', text: decodeIt ? decode(raw, entities) : raw, parent });
  };

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { pushText(src.slice(i), true); break; }
    if (lt > i) pushText(src.slice(i, lt), true);

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      pushText(src.slice(lt + 9, end < 0 ? src.length : end), false);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<!DOCTYPE', lt) || src.startsWith('<!doctype', lt)) {
      i = readDoctype(src, lt, entities);
      continue;
    }
    if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (src.startsWith('<!', lt)) {
      const end = src.indexOf('>', lt + 2);
      i = end < 0 ? src.length : end + 1;
      continue;
    }

    // A tag. Find its end, skipping '>' inside quoted attribute values.
    let j = lt + 1;
    let quote = '';
    while (j < src.length) {
      const c = src[j]!;
      if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
      j++;
    }
    const inner = src.slice(lt + 1, j);
    i = j + 1;

    if (inner.startsWith('/')) {
      const name = inner.slice(1).trim().toLowerCase();
      // Close back to the matching element; ignore a stray end tag entirely.
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k]!.attrs['\u0000raw'] === name) {
          stack.length = k;
          nsStack.length = k;
          break;
        }
      }
      continue;
    }

    const selfClose = inner.endsWith('/');
    const body = selfClose ? inner.slice(0, -1) : inner;
    const nameMatch = /^([^\s/>]+)/.exec(body);
    if (!nameMatch) continue;
    const rawName = nameMatch[1]!;
    const attrs = parseAttrs(body.slice(rawName.length), entities);

    // Namespace bookkeeping: which prefixes mean "this is SVG".
    const ns = new Set(nsStack[nsStack.length - 1]);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('xmlns:') && v === SVG_NS) ns.add(k.slice(6));
    }
    const colon = rawName.indexOf(':');
    const prefix = colon > 0 ? rawName.slice(0, colon) : '';
    const local = colon > 0 ? rawName.slice(colon + 1) : rawName;
    const tag = !prefix || ns.has(prefix) ? local.toLowerCase() : rawName.toLowerCase();

    const el: XElement = { kind: 'element', tag, attrs, children: [], parent: top() === doc ? null : top() };
    // Remember the raw name for matching the end tag, outside the attribute
    // namespace real files can use.
    Object.defineProperty(el.attrs, '\u0000raw', { value: rawName.toLowerCase(), enumerable: false });
    top().children.push(el);
    if (!selfClose) {
      stack.push(el);
      nsStack.push(ns);
    }
  }

  const find = (n: XElement): XElement | null => {
    for (const c of n.children) {
      if (c.kind === 'element') {
        if (c.tag === 'svg') return c;
        const deeper = find(c);
        if (deeper) return deeper;
      }
    }
    return null;
  };
  return find(doc);
}

/** Element children only. */
export function elements(el: XElement): XElement[] {
  return el.children.filter((c): c is XElement => c.kind === 'element');
}

/** All text beneath an element, in document order. */
export function textContent(el: XElement): string {
  let out = '';
  for (const c of el.children) out += c.kind === 'text' ? c.text : textContent(c);
  return out;
}
