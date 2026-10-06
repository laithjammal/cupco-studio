/**
 * Import fidelity, measured against a real SVG renderer.
 *
 * Every importer bug so far was found the same way: a real file arrived
 * looking wrong, and the gap was guessed at from what survived the parse.
 * That only ever finds the gap you already suspect.
 *
 * This harness removes the guessing. Each corpus file is rendered twice by the
 * SAME engine (resvg): once from the original, and once from an SVG rebuilt
 * out of nothing but what our importer produced. Any difference between the
 * two pictures is, by construction, something the importer lost or changed -
 * whatever it was, and whether or not anyone thought to test for it.
 */

import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import opentype from 'opentype.js';
import { gposKerning, type KernFn } from '../../src/svg/kerning';

const here = dirname(fileURLToPath(import.meta.url));
export const CORPUS_DIR = join(here, 'corpus');
const FONT_DIR = join(here, 'fonts');

export const FONT_FILES = [
  'inter-400.ttf', 'inter-700.ttf', 'montserrat-400.ttf', 'montserrat-700.ttf',
].map((f) => join(FONT_DIR, f));

/* ------------------------------- PNG utils -------------------------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Encode straight (non-premultiplied) RGBA as a PNG. */
export function encodePng(w: number, h: number, rgba: Uint8Array): Uint8Array {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function makePng(w: number, h: number, fn: (x: number, y: number) => [number, number, number, number]): string {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fn(x, y);
      px.set(c, (y * w + x) * 4);
    }
  }
  return 'data:image/png;base64,' + Buffer.from(encodePng(w, h, px)).toString('base64');
}

/** A small "photograph": smooth colour field with a hard-edged disc in it. */
const PNG_PHOTO = makePng(64, 64, (x, y) => {
  const inDisc = (x - 40) ** 2 + (y - 24) ** 2 < 14 ** 2;
  if (inDisc) return [242, 169, 0, 255];
  return [Math.round(29 + (200 - 29) * (x / 63)), Math.round(63 + 60 * (y / 63)), 46 + Math.round(80 * ((x + y) / 126)), 255];
});

/** Wider than tall, so preserveAspectRatio actually matters. */
const PNG_WIDE = makePng(96, 48, (x, y) => (
  (Math.floor(x / 12) + Math.floor(y / 12)) % 2 === 0 ? [200, 16, 46, 255] : [29, 63, 43, 255]
));

const SVG_BADGE = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">'
  + '<circle cx="20" cy="20" r="19" fill="#1d3f2b"/>'
  + '<path d="M12 26 L20 10 L28 26 Z" fill="#f2a900"/></svg>',
).toString('base64');

/** Read a corpus file, with its generated images substituted in. */
export function loadFixture(name: string): string {
  return readFileSync(join(CORPUS_DIR, name), 'utf8')
    .replaceAll('__PNG_PHOTO__', PNG_PHOTO)
    .replaceAll('__PNG_WIDE__', PNG_WIDE)
    .replaceAll('__SVG_BADGE__', SVG_BADGE);
}

/* -------------------------------- fonts ----------------------------------- */

type OtFont = ReturnType<typeof opentype.parse>;
const faces: { family: string; weight: number; font: OtFont }[] = [
  ['Inter', 400, 'inter-400.ttf'], ['Inter', 700, 'inter-700.ttf'],
  ['Montserrat', 400, 'montserrat-400.ttf'], ['Montserrat', 700, 'montserrat-700.ttf'],
].map(([family, weight, file]) => {
  const buf = new Uint8Array(readFileSync(join(FONT_DIR, file as string)));
  const font = opentype.parse(buf.slice().buffer as ArrayBuffer) as OtFont & { kernPairs?: KernFn };
  // Browsers kern from GPOS; so must we, or wordmarks space differently.
  font.kernPairs = gposKerning(buf) ?? undefined;
  return { family: family as string, weight: weight as number, font };
});

/**
 * The same faces resvg is given, offered to the importer.
 *
 * Matching rules mirror a browser's closely enough for the corpus: the first
 * listed family that exists wins, then the nearest weight.
 */
export const testFonts = {
  resolve(families: readonly string[], weight: number) {
    for (const fam of families) {
      const want = fam.trim().replace(/^['"]|['"]$/g, '').toLowerCase();
      const hits = faces.filter((f) => f.family.toLowerCase() === want);
      if (hits.length) {
        const best = hits.reduce((a, b) => (Math.abs(b.weight - weight) < Math.abs(a.weight - weight) ? b : a));
        return { font: best.font, family: best.family, exact: true };
      }
    }
    const fallback = faces.filter((f) => f.family === 'Inter')
      .reduce((a, b) => (Math.abs(b.weight - weight) < Math.abs(a.weight - weight) ? b : a));
    return { font: fallback.font, family: fallback.family, exact: false };
  },
  parse(bytes: Uint8Array) {
    try {
      return opentype.parse(bytes.slice().buffer as ArrayBuffer);
    } catch {
      return null;
    }
  },
};

/* ------------------------------- rendering -------------------------------- */

export interface Raster { w: number; h: number; data: Uint8Array }

const BG = 128;

export function render(svg: string, width: number): Raster {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    background: `rgb(${BG},${BG},${BG})`,
    font: {
      fontFiles: FONT_FILES,
      loadSystemFonts: false,
      defaultFontFamily: 'Inter',
      sansSerifFamily: 'Inter',
    },
    languages: ['en'],
  });
  const img = r.render();
  return { w: img.width, h: img.height, data: new Uint8Array(img.pixels) };
}

/* ----------------------------- reconstruction ----------------------------- */

interface ResultLike {
  shapes: { subpaths: { points: { x: number; y: number }[]; closed: boolean }[]; fill: readonly number[]; opacity: number; fillRule?: string }[];
  rasters?: {
    href: string;
    matrix: readonly number[];
    opacity: number;
    clip: { points: { x: number; y: number }[] }[] | null;
    before: number;
  }[];
  width: number;
  height: number;
}

const f = (n: number) => (Math.round(n * 10000) / 10000).toString();

/**
 * An SVG built from NOTHING but the import result.
 *
 * Plain filled paths and positioned images, in document units. If the
 * importer dropped, moved or recoloured anything, it is missing from here.
 */
export function reconstruct(res: ResultLike): string {
  const defs: string[] = [];
  const body: string[] = [];
  const rasters = res.rasters ?? [];
  const drawRaster = (i: number) => {
    const r = rasters[i]!;
    const m = r.matrix;
    let img = `<image href="${r.href}" x="0" y="0" width="1" height="1" preserveAspectRatio="none"`
      + ` transform="matrix(${m.map(f).join(' ')})"${r.opacity < 1 ? ` opacity="${f(r.opacity)}"` : ''}/>`;
    if (r.clip && r.clip.length) {
      const id = `rc${i}`;
      const d = r.clip.map((sp) => 'M' + sp.points.map((p) => `${f(p.x)} ${f(p.y)}`).join('L') + 'Z').join('');
      defs.push(`<clipPath id="${id}"><path d="${d}"/></clipPath>`);
      img = `<g clip-path="url(#${id})">${img}</g>`;
    }
    body.push(img);
  };
  res.shapes.forEach((s, i) => {
    rasters.forEach((r, ri) => { if (r.before === i) drawRaster(ri); });
    const d = s.subpaths
      .map((sp) => 'M' + sp.points.map((p) => `${f(p.x)} ${f(p.y)}`).join('L') + 'Z')
      .join('');
    if (!d) return;
    body.push(`<path d="${d}" fill="rgb(${s.fill.join(',')})"`
      + `${s.opacity < 1 ? ` fill-opacity="${f(s.opacity)}"` : ''}`
      + ` fill-rule="${s.fillRule ?? 'evenodd'}"/>`);
  });
  rasters.forEach((r, ri) => { if (r.before >= res.shapes.length) drawRaster(ri); });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(res.width)} ${f(res.height)}">`
    + `<defs>${defs.join('')}</defs>${body.join('')}</svg>`;
}

/* ------------------------------- comparison ------------------------------- */

const T = 40;

const near = (a: Uint8Array, i: number, b: Uint8Array, j: number) =>
  Math.abs(a[i]! - b[j]!) <= T && Math.abs(a[i + 1]! - b[j + 1]!) <= T && Math.abs(a[i + 2]! - b[j + 2]!) <= T;

/**
 * Fraction of the ARTWORK that differs.
 *
 * Normalised by inked area rather than by canvas area, so a missing logo on a
 * big empty page still reads as a large failure. A pixel only counts as wrong
 * if no pixel within one step of it matches either - so curve flattening and
 * antialiasing, which shift an edge by a fraction of a pixel, do not register,
 * while anything genuinely missing, added or recoloured does.
 */
export function mismatch(a: Raster, b: Raster): { fraction: number; mask: Uint8Array } {
  const w = Math.min(a.w, b.w), h = Math.min(a.h, b.h);
  const mask = new Uint8Array(w * h);
  let inked = 0, bad = 0;
  const isInk = (r: Raster, i: number) =>
    Math.abs(r.data[i]! - BG) > 8 || Math.abs(r.data[i + 1]! - BG) > 8 || Math.abs(r.data[i + 2]! - BG) > 8;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ia = (y * a.w + x) * 4, ib = (y * b.w + x) * 4;
      if (isInk(a, ia) || isInk(b, ib)) inked++;
      if (near(a.data, ia, b.data, ib)) continue;
      let ok1 = false, ok2 = false;
      for (let dy = -1; dy <= 1 && !(ok1 && ok2); dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          if (!ok1 && near(a.data, (yy * a.w + xx) * 4, b.data, ib)) ok1 = true;
          if (!ok2 && near(b.data, (yy * b.w + xx) * 4, a.data, ia)) ok2 = true;
        }
      }
      if (ok1 && ok2) continue;
      bad++;
      mask[y * w + x] = 1;
    }
  }
  if (a.w !== b.w || a.h !== b.h) return { fraction: 1, mask };
  return { fraction: bad / Math.max(1, inked), mask };
}

/** Reference | ours | differences (red), for looking at rather than scoring. */
export function sideBySide(a: Raster, b: Raster, mask: Uint8Array): Uint8Array {
  const w = a.w, h = a.h, W = w * 3 + 8;
  const out = new Uint8Array(W * h * 4).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out.set(a.data.subarray(i, i + 4), (y * W + x) * 4);
      if (x < b.w && y < b.h) out.set(b.data.subarray((y * b.w + x) * 4, (y * b.w + x) * 4 + 4), (y * W + x + w + 4) * 4);
      const o = (y * W + x + 2 * w + 8) * 4;
      if (mask[y * w + x]) out.set([220, 0, 0, 255], o);
      else {
        const g = Math.round((a.data[i]! + a.data[i + 1]! + a.data[i + 2]!) / 3 * 0.3 + 178);
        out.set([g, g, g, 255], o);
      }
    }
  }
  return encodePng(W, h, out);
}
