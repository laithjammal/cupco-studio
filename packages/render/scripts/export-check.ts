/** Verify the full-resolution export path: dimensions, coverage, timing. */
import { deriveFrustum, CUP_8OZ } from '@cupco/geometry';
import { rasteriseFan, createUVTestPattern } from '../src/index';

const g = deriveFrustum(CUP_8OZ.dimensions);
const design = createUVTestPattern({ width: 2732, height: 1069 });

const t0 = Date.now();
const { image, transform } = rasteriseFan(design, CUP_8OZ, g, { dpi: 300, supersample: 2 });
const ms = Date.now() - t0;

let opaque = 0;
for (let i = 3; i < image.data.length; i += 4) if (image.data[i]! > 0) opaque++;

console.log(`export @${transform.dpi}dpi : ${image.width} x ${image.height} px`);
console.log(`  physical       : ${transform.widthMm.toFixed(2)} x ${transform.heightMm.toFixed(2)} mm`);
console.log(`  expected px    : ${Math.ceil(transform.widthMm / (25.4 / 300))} x ${Math.ceil(transform.heightMm / (25.4 / 300))}`);
console.log(`  megapixels     : ${(image.width * image.height / 1e6).toFixed(2)} MP`);
console.log(`  sector coverage: ${(100 * opaque / (image.width * image.height)).toFixed(1)}%`);
console.log(`  time           : ${ms} ms (supersample 2 = 4 samples/px)`);
