/** End-to-end check: SVG -> shapes -> palette -> placed -> warped fan paths. */
import { readFileSync } from 'node:fs';
import { deriveFrustum, warpShapeWrapped, CUP_8OZ } from '@cupco/geometry';
import { importSvg, normaliseArtwork, extractPalette, totalInkPct, placeArtwork } from '../src/index';

const svg = readFileSync(process.argv[2] ?? 'out/test-logo.svg', 'utf8');
const res = importSvg(svg);
console.log(`shapes   : ${res.shapes.length}`);
console.log(`canvas   : ${res.width} x ${res.height}`);
console.log(`warnings : ${res.warnings.length ? res.warnings.join('; ') : 'none'}`);

const art = normaliseArtwork(res.shapes);
console.log(`aspect   : ${art.aspect.toFixed(4)}`);

const pal = extractPalette(res.shapes.map((s) => ({ fill: s.fill })));
console.log('\ninks:');
for (const p of pal) {
  const c = p.cmyk;
  console.log(
    `  ${p.hex}  C${(c.c * 100).toFixed(0).padStart(3)} M${(c.m * 100).toFixed(0).padStart(3)}` +
    ` Y${(c.y * 100).toFixed(0).padStart(3)} K${(c.k * 100).toFixed(0).padStart(3)}   ` +
    `${totalInkPct(c).toFixed(0)}% ink`,
  );
}

const g = deriveFrustum(CUP_8OZ.dimensions);
const placed = placeArtwork(art, { u: 0.5, v: 0.55, widthU: 0.3, rotation: 0, canvasW: 2732, canvasH: 1069 });
let paths = 0, pts = 0;
for (const s of placed) {
  for (const w of warpShapeWrapped(s, g)) {
    paths++;
    pts += w.subpaths.reduce((n, r) => n + r.length, 0);
  }
}
console.log(`\nwarped   : ${paths} paths, ${pts} points after adaptive subdivision`);
