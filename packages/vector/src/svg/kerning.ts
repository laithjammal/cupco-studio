/**
 * Pair kerning from a font's GPOS table.
 *
 * Browsers kern text by default, from the GPOS 'kern' feature. opentype.js
 * returns zero for every pair in fonts that keep their kerning inside GPOS
 * extension lookups - which includes Inter and Montserrat, two of the faces
 * this app bundles - so "AV" and "To" were set as if kerning did not exist,
 * and a wordmark came out spaced differently from how the file draws it.
 *
 * This reads PairPos (lookup type 2, formats 1 and 2), including when wrapped
 * in an Extension lookup (type 9), and answers one question: how much does
 * the advance after glyph L change when glyph R follows it? Only raw sfnt
 * (TTF/OTF) bytes are read; anything else returns null and text is set
 * unkerned, as before.
 */

export type KernFn = (left: number, right: number) => number;

class Reader {
  constructor(private b: Uint8Array) {}
  u16(o: number) { return (this.b[o]! << 8) | this.b[o + 1]!; }
  i16(o: number) { const v = this.u16(o); return v & 0x8000 ? v - 0x10000 : v; }
  u32(o: number) { return ((this.b[o]! << 24) >>> 0) + (this.b[o + 1]! << 16) + (this.b[o + 2]! << 8) + this.b[o + 3]!; }
  tag(o: number) { return String.fromCharCode(this.b[o]!, this.b[o + 1]!, this.b[o + 2]!, this.b[o + 3]!); }
}

function popcount(v: number): number {
  let n = 0;
  for (let x = v; x; x &= x - 1) n++;
  return n;
}

function coverageIndex(r: Reader, at: number, glyph: number): number {
  const format = r.u16(at);
  if (format === 1) {
    let lo = 0, hi = r.u16(at + 2) - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const g = r.u16(at + 4 + mid * 2);
      if (g === glyph) return mid;
      if (g < glyph) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
  }
  if (format === 2) {
    const n = r.u16(at + 2);
    for (let i = 0; i < n; i++) {
      const o = at + 4 + i * 6;
      const start = r.u16(o), end = r.u16(o + 2);
      if (glyph >= start && glyph <= end) return r.u16(o + 4) + glyph - start;
      if (glyph < start) break;
    }
  }
  return -1;
}

function classOf(r: Reader, at: number, glyph: number): number {
  const format = r.u16(at);
  if (format === 1) {
    const start = r.u16(at + 2), count = r.u16(at + 4);
    return glyph >= start && glyph < start + count ? r.u16(at + 6 + (glyph - start) * 2) : 0;
  }
  if (format === 2) {
    const n = r.u16(at + 2);
    for (let i = 0; i < n; i++) {
      const o = at + 4 + i * 6;
      if (glyph >= r.u16(o) && glyph <= r.u16(o + 2)) return r.u16(o + 4);
    }
  }
  return 0;
}

/** The kerning function for a font file, or null if it has no usable GPOS kerning. */
export function gposKerning(bytes: Uint8Array): KernFn | null {
  try {
    if (bytes.length < 12) return null;
    const r = new Reader(bytes);
    const version = r.u32(0);
    if (version !== 0x00010000 && r.tag(0) !== 'OTTO' && r.tag(0) !== 'true') return null;
    let gpos = -1;
    const numTables = r.u16(4);
    for (let i = 0; i < numTables; i++) {
      const o = 12 + i * 16;
      if (r.tag(o) === 'GPOS') { gpos = r.u32(o + 8); break; }
    }
    if (gpos < 0) return null;

    const featureList = gpos + r.u16(gpos + 6);
    const lookupList = gpos + r.u16(gpos + 8);
    const lookupIdx = new Set<number>();
    const featureCount = r.u16(featureList);
    for (let i = 0; i < featureCount; i++) {
      const rec = featureList + 2 + i * 6;
      if (r.tag(rec) !== 'kern') continue;
      const feat = featureList + r.u16(rec + 4);
      const n = r.u16(feat + 2);
      for (let k = 0; k < n; k++) lookupIdx.add(r.u16(feat + 4 + k * 2));
    }
    if (lookupIdx.size === 0) return null;

    // Every PairPos subtable of the kern lookups, extension wrappers unwrapped.
    const lookups: number[][] = [];
    for (const li of [...lookupIdx].sort((a, b) => a - b)) {
      const lookup = lookupList + r.u16(lookupList + 2 + li * 2);
      const type = r.u16(lookup);
      const count = r.u16(lookup + 4);
      const subs: number[] = [];
      for (let s = 0; s < count; s++) {
        let st = lookup + r.u16(lookup + 6 + s * 2);
        let stType = type;
        if (type === 9) { stType = r.u16(st + 2); st = st + r.u32(st + 4); }
        if (stType === 2) subs.push(st);
      }
      if (subs.length) lookups.push(subs);
    }
    if (lookups.length === 0) return null;

    const cache = new Map<number, number>();
    return (left: number, right: number) => {
      const key = left * 65536 + right;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      let total = 0;
      for (const subs of lookups) {
        for (const st of subs) {
          const cov = coverageIndex(r, st + r.u16(st + 2), left);
          if (cov < 0) continue;
          const vf1 = r.u16(st + 4), vf2 = r.u16(st + 6);
          const size1 = popcount(vf1) * 2, size2 = popcount(vf2) * 2;
          const xAdvAt = vf1 & 0x0004 ? popcount(vf1 & 0x0003) * 2 : -1;
          const format = r.u16(st);
          let value = 0, found = false;
          if (format === 1) {
            const set = st + r.u16(st + 10 + cov * 2);
            const n = r.u16(set);
            const rec = 2 + size1 + size2;
            let lo = 0, hi = n - 1;
            while (lo <= hi) {
              const mid = (lo + hi) >> 1;
              const o = set + 2 + mid * rec;
              const g = r.u16(o);
              if (g === right) { if (xAdvAt >= 0) value = r.i16(o + 2 + xAdvAt); found = true; break; }
              if (g < right) lo = mid + 1; else hi = mid - 1;
            }
            if (!found) continue; // a format-1 subtable that lacks the pair defers to the next
          } else if (format === 2) {
            const c1 = classOf(r, st + r.u16(st + 8), left);
            const c2 = classOf(r, st + r.u16(st + 10), right);
            const class2Count = r.u16(st + 14);
            const o = st + 16 + (c1 * class2Count + c2) * (size1 + size2);
            if (xAdvAt >= 0) value = r.i16(o + xAdvAt);
          } else continue;
          total += value;
          break; // the first subtable that covers the glyph is the one that applies
        }
      }
      cache.set(key, total);
      return total;
    };
  } catch {
    return null;
  }
}
