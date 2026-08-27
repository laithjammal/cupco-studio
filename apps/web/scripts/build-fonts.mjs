/**
 * WOFF -> TTF, so the SAME font file can drive both rendering and outlining.
 *
 * @fontsource ships only woff/woff2. The browser renders happily from those,
 * but opentype.js needs a raw sfnt to extract glyph outlines — and outlines
 * are what make text exportable as vector.
 *
 * WOFF is not a different font format: it is an sfnt whose tables have been
 * zlib-compressed, wrapped in a small header. Converting is therefore lossless
 * — inflate each table and rebuild the sfnt directory around them. That
 * guarantees the outlines we export are from the exact file the browser drew,
 * so the preview and the print file cannot disagree.
 *
 * Run: node apps/web/scripts/build-fonts.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const outDir = join(here, '..', 'public', 'fonts');

/** Fonts to bundle: [family id, npm package, file basename, weights]. */
const FONTS = [
  ['inter', '@fontsource/inter', 'inter-latin', [400, 700]],
  ['montserrat', '@fontsource/montserrat', 'montserrat-latin', [400, 700]],
  ['oswald', '@fontsource/oswald', 'oswald-latin', [400, 700]],
  ['bebas', '@fontsource/bebas-neue', 'bebas-neue-latin', [400]],
  ['playfair', '@fontsource/playfair-display', 'playfair-display-latin', [400, 700]],
  ['slab', '@fontsource/roboto-slab', 'roboto-slab-latin', [400, 700]],
];

function woffToTtf(buf) {
  if (buf.toString('latin1', 0, 4) !== 'wOFF') throw new Error('not a WOFF file');

  const flavor = buf.readUInt32BE(4);
  const numTables = buf.readUInt16BE(12);

  // WOFF table directory: tag, offset, compLength, origLength, origChecksum.
  const entries = [];
  for (let i = 0; i < numTables; i++) {
    const p = 44 + i * 20;
    entries.push({
      tag: buf.toString('latin1', p, p + 4),
      offset: buf.readUInt32BE(p + 4),
      compLength: buf.readUInt32BE(p + 8),
      origLength: buf.readUInt32BE(p + 12),
      checksum: buf.readUInt32BE(p + 16),
    });
  }

  // A table is stored compressed only when compLength < origLength.
  for (const e of entries) {
    const raw = buf.subarray(e.offset, e.offset + e.compLength);
    e.data = e.compLength < e.origLength ? inflateSync(raw) : raw;
    if (e.data.length !== e.origLength) {
      throw new Error(`table ${e.tag}: expected ${e.origLength} bytes, got ${e.data.length}`);
    }
  }

  // sfnt requires the directory sorted by tag.
  entries.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  const pad4 = (n) => (n + 3) & ~3;
  const dirSize = 12 + numTables * 16;
  const total = entries.reduce((n, e) => n + pad4(e.origLength), dirSize);
  const out = Buffer.alloc(total);

  // sfnt header. searchRange/entrySelector/rangeShift are the usual
  // binary-search hints derived from the table count.
  const maxPow2 = Math.floor(Math.log2(numTables));
  out.writeUInt32BE(flavor, 0);
  out.writeUInt16BE(numTables, 4);
  out.writeUInt16BE(2 ** maxPow2 * 16, 6);
  out.writeUInt16BE(maxPow2, 8);
  out.writeUInt16BE(numTables * 16 - 2 ** maxPow2 * 16, 10);

  let dirPos = 12;
  let dataPos = dirSize;
  for (const e of entries) {
    out.write(e.tag, dirPos, 4, 'latin1');
    out.writeUInt32BE(e.checksum, dirPos + 4);
    out.writeUInt32BE(dataPos, dirPos + 8);
    out.writeUInt32BE(e.origLength, dirPos + 12);
    dirPos += 16;

    e.data.copy(out, dataPos);
    dataPos += pad4(e.origLength); // padding bytes are already zero
  }
  return out;
}

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

let ok = 0, failed = 0;
for (const [id, pkg, base, weights] of FONTS) {
  for (const w of weights) {
    const src = join(root, 'node_modules', pkg, 'files', `${base}-${w}-normal.woff`);
    const dst = join(outDir, `${id}-${w}.ttf`);
    try {
      const ttf = woffToTtf(readFileSync(src));
      writeFileSync(dst, ttf);
      console.log(`  ${id}-${w}.ttf  ${(ttf.length / 1024).toFixed(0)} KB`);
      ok++;
    } catch (err) {
      console.error(`  FAILED ${id}-${w}: ${err.message}`);
      failed++;
    }
  }
}
console.log(`\n${ok} converted, ${failed} failed`);
process.exit(failed ? 1 : 0);
