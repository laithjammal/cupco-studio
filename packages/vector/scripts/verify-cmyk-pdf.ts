/**
 * Prove the exported PDF really carries CMYK ink, not RGB.
 *
 * Builds the same vector PDF the app builds, then decompresses its content
 * stream and looks for the PDF `k` operator (set CMYK fill). If the file were
 * RGB it would use `rg` instead.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { PDFDocument, cmyk, pushGraphicsState, popGraphicsState, clip, endPath, moveTo, lineTo, closePath } from 'pdf-lib';
import { deriveFrustum, buildFanOutline, fanBounds, warpShapeWrapped, CUP_8OZ } from '@cupco/geometry';
import { importSvg, normaliseArtwork, placeArtwork, extractPalette, rgbToCmyk } from '../src/index';

const PT_PER_MM = 72 / 25.4;
const g = deriveFrustum(CUP_8OZ.dimensions);
const res = importSvg(readFileSync('out/test-logo.svg', 'utf8'));
const art = normaliseArtwork(res.shapes);
const palette = extractPalette(res.shapes.map((s) => ({ fill: s.fill })));

const bleed = buildFanOutline(CUP_8OZ, g, 'bleed', 1024);
const b = fanBounds(bleed.points);
const pad = 3;
const minX = b.minX - pad, minY = b.minY - pad;
const W = b.widthMm + pad * 2, H = b.heightMm + pad * 2;

const pdf = await PDFDocument.create();
const page = pdf.addPage([W * PT_PER_MM, H * PT_PER_MM]);
const pageH = H * PT_PER_MM;

const toPath = (rings: { x: number; y: number }[][]) =>
  rings.filter((r) => r.length > 1).map((r) =>
    r.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(p.x - minX).toFixed(4)} ${(p.y - minY).toFixed(4)}`).join(' ') + ' Z',
  ).join(' ');

const ops = [pushGraphicsState()];
bleed.points.forEach((p, i) => {
  const x = (p.x - minX) * PT_PER_MM;
  const y = pageH - (p.y - minY) * PT_PER_MM;
  ops.push(i === 0 ? moveTo(x, y) : lineTo(x, y));
});
ops.push(closePath(), clip(), endPath());
page.pushOperators(...ops);

const bgCmyk = rgbToCmyk([28, 69, 50]);
page.drawSvgPath(toPath([bleed.points]), {
  x: 0, y: pageH, scale: PT_PER_MM, borderWidth: 0,
  color: cmyk(bgCmyk.c, bgCmyk.m, bgCmyk.y, bgCmyk.k),
});

const placed = placeArtwork(art, { u: 0.5, v: 0.55, widthU: 0.3, rotation: 0, canvasW: 2732, canvasH: 1069 });
let paths = 0, pts = 0;
for (const s of placed) {
  for (const w of warpShapeWrapped(s, g)) {
    const d = toPath(w.subpaths);
    if (!d) continue;
    const v = rgbToCmyk(w.fill);
    page.drawSvgPath(d, { x: 0, y: pageH, scale: PT_PER_MM, borderWidth: 0, color: cmyk(v.c, v.m, v.y, v.k) });
    paths++; pts += w.subpaths.reduce((n, r) => n + r.length, 0);
  }
}
page.pushOperators(popGraphicsState());

const bytes = await pdf.save();
writeFileSync('out/8oz-fan-vector-cmyk.pdf', bytes);

// --- inspect the content stream --------------------------------------------
const buf = Buffer.from(bytes);
let streams = '';
const re = /stream\r?\n/g;
let m: RegExpExecArray | null;
while ((m = re.exec(buf.toString('latin1'))) !== null) {
  const start = m.index + m[0].length;
  const end = buf.toString('latin1').indexOf('endstream', start);
  try { streams += inflateSync(buf.subarray(start, end)).toString('latin1'); } catch { /* not deflate */ }
}

const kOps = [...streams.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) k\b/g)];
const rgOps = [...streams.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) rg\b/g)];

console.log(`file        : out/8oz-fan-vector-cmyk.pdf  (${(bytes.byteLength / 1024).toFixed(0)} KB)`);
console.log(`page        : ${W.toFixed(2)} x ${H.toFixed(2)} mm`);
console.log(`vector      : ${paths} paths, ${pts} points`);
console.log(`clip present: ${/\bW\b\s+n\b/.test(streams) ? 'yes' : 'NO'}`);
console.log(`\nCMYK fill ops (k) : ${kOps.length}`);
console.log(`RGB  fill ops (rg): ${rgOps.length}`);
console.log('\nink values written to the file:');
for (const k of kOps.slice(0, 8)) {
  console.log(`  C${(+k[1]! * 100).toFixed(0).padStart(3)} M${(+k[2]! * 100).toFixed(0).padStart(3)} Y${(+k[3]! * 100).toFixed(0).padStart(3)} K${(+k[4]! * 100).toFixed(0).padStart(3)}`);
}
console.log(`\npalette derived: ${palette.map((p) => p.hex).join(' ')}`);
