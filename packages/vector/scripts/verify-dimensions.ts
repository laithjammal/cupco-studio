/**
 * Independent check that exported files carry the correct physical size.
 *
 * Re-derives the expected blank from the CupProfile, then measures what the
 * PDF page box and the raster actually claim — so a units bug (points vs mm,
 * or a dpi rounding slip) cannot pass unnoticed.
 */
import { PDFDocument } from 'pdf-lib';
import { deriveFrustum, buildFanOutline, fanBounds, CUP_8OZ } from '@cupco/geometry';
import { rasteriseFan, createUVTestPattern } from '@cupco/render';

const PT_PER_MM = 72 / 25.4;
const PAD = 3; // blank margin the exporters add around the bleed outline

const g = deriveFrustum(CUP_8OZ.dimensions);
const raw = fanBounds(buildFanOutline(CUP_8OZ, g, 'cut', 1024).points);
const expectW = raw.widthMm + PAD * 2;
const expectH = raw.heightMm + PAD * 2;

console.log('EXPECTED (derived from the 8oz CupProfile)');
console.log(`  bleed outline : ${raw.widthMm.toFixed(3)} x ${raw.heightMm.toFixed(3)} mm`);
console.log(`  + ${PAD}mm pad   : ${expectW.toFixed(3)} x ${expectH.toFixed(3)} mm`);
console.log(`  in points     : ${(expectW * PT_PER_MM).toFixed(2)} x ${(expectH * PT_PER_MM).toFixed(2)} pt\n`);

// --- vector PDF page box -----------------------------------------------
const pdf = await PDFDocument.create();
const page = pdf.addPage([expectW * PT_PER_MM, expectH * PT_PER_MM]);
const { width: pw, height: ph } = page.getSize();
const pdfWmm = pw / PT_PER_MM, pdfHmm = ph / PT_PER_MM;
const pdfOk = Math.abs(pdfWmm - expectW) < 0.01 && Math.abs(pdfHmm - expectH) < 0.01;
console.log('VECTOR PDF');
console.log(`  page box      : ${pw.toFixed(2)} x ${ph.toFixed(2)} pt`);
console.log(`                = ${pdfWmm.toFixed(3)} x ${pdfHmm.toFixed(3)} mm   ${pdfOk ? 'OK' : 'MISMATCH'}\n`);

// --- raster at each offered dpi ----------------------------------------
console.log('RASTER EXPORT');
let rasterOk = true;
for (const dpi of [300, 450, 600]) {
  const design = createUVTestPattern({ width: 512, height: 256 });
  const { image, transform } = rasteriseFan(design, CUP_8OZ, g, { dpi, supersample: 1 });
  const mmW = image.width * (25.4 / dpi);
  const mmH = image.height * (25.4 / dpi);
  // Ceil to whole pixels can add at most one pixel per axis.
  const tol = 25.4 / dpi + 0.001;
  const ok = Math.abs(mmW - transform.widthMm) < tol && Math.abs(mmH - transform.heightMm) < tol
    && Math.abs(transform.widthMm - expectW) < 0.01;
  if (!ok) rasterOk = false;
  console.log(`  ${String(dpi).padStart(3)} dpi : ${String(image.width).padStart(5)} x ${String(image.height).padStart(4)} px` +
    ` = ${mmW.toFixed(3)} x ${mmH.toFixed(3)} mm   ${ok ? 'OK' : 'MISMATCH'}`);
}

// --- physical sanity ----------------------------------------------------
console.log('\nPHYSICAL CROSS-CHECK');
console.log(`  top arc      : ${g.topArcMm.toFixed(4)} mm  (pi x ${CUP_8OZ.dimensions.topDiameterMm} = ${(Math.PI * CUP_8OZ.dimensions.topDiameterMm).toFixed(4)})`);
console.log(`  bottom arc   : ${g.bottomArcMm.toFixed(4)} mm  (pi x ${CUP_8OZ.dimensions.bottomDiameterMm} = ${(Math.PI * CUP_8OZ.dimensions.bottomDiameterMm).toFixed(4)})`);
console.log(`  slant        : ${g.slantMm.toFixed(4)} mm`);
const c = CUP_8OZ.margins.cut;
console.log(`  cut: ${c.topMm}mm top, ${c.bottomMm}mm base, left seam ${c.left.atTopMm}/${c.left.atBottomMm}mm, right seam ${c.right.atTopMm}/${c.right.atBottomMm}mm`);

console.log(`\n${pdfOk && rasterOk ? 'ALL DIMENSIONS CORRECT' : 'DIMENSION MISMATCH FOUND'}`);
process.exit(pdfOk && rasterOk ? 0 : 1);
