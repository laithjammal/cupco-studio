/**
 * Run the automatic plate fit against a real photograph and print its error.
 *
 * The unit tests fit a cup drawn from known numbers, which is the right way to
 * pin the algorithm down - but a constructed cup has clean edges, one light and
 * no lens. This is the other half: the same code, on the photograph it will
 * actually meet, scored against a silhouette measured by hand.
 *
 * The reference numbers below were read off plates/mockup-3.png by profiling
 * saturation and luminance across the cup's edges at full resolution. They are
 * measurements, not outputs - taking them from a previous run would make this
 * a test that the code still does whatever it does.
 *
 *   npx tsx apps/web/scripts/check-plate-fit.ts [plates/mockup-3.png]
 */
import sharp from 'sharp';
import { fitCupInGrid, type PlateGrid } from '../src/lib/plate-autofit';
import { getProfile } from '@cupco/geometry';

/** Must match WORK_WIDTH in plate-autofit. */
const WORK_WIDTH = 420;

async function gridFrom(file: string): Promise<PlateGrid> {
  const meta = await sharp(file).metadata();
  const sw = meta.width ?? 0;
  const sh = meta.height ?? 0;
  if (!sw || !sh) throw new Error(`cannot read ${file}`);
  const w = Math.min(WORK_WIDTH, sw);
  const h = Math.max(1, Math.round((sh * w) / sw));
  const raw = await sharp(file).removeAlpha()
    .resize({ width: w, height: h, fit: 'fill' }).raw().toBuffer();
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    lum[i] = (0.2126 * raw[i * 3]! + 0.7152 * raw[i * 3 + 1]! + 0.0722 * raw[i * 3 + 2]!) / 255;
  }
  return { w, h, lum, scale: sw / w };
}

/** Hand-measured silhouette of the cup in plates/mockup-3.png. */
const trueLeft = (y: number) => 510.5 + 0.115 * (y - 620);
const trueRight = (y: number) => 828.5 - 0.155 * (y - 620);
/** Hand-measured underside of the lid, through three points across the cup. */
const trueTop = (x: number) => {
  const p: [number, number][] = [[505, 611], [665, 625], [825, 610]];
  let total = 0;
  for (let i = 0; i < 3; i++) {
    let term = p[i]![1];
    for (let j = 0; j < 3; j++) if (i !== j) term *= (x - p[j]![0]) / (p[i]![0] - p[j]![0]);
    total += term;
  }
  return total;
};

async function main(): Promise<void> {
  const file = process.argv[2] ?? 'plates/mockup-3.png';
  const profile = getProfile('8oz-single-wall');
  if (!profile) throw new Error('8oz profile missing');
  const cup = profile.dimensions;
  const fit = fitCupInGrid(await gridFrom(file), 0.5, cup);
  if (!fit) {
    console.error(`No cup found in ${file}.`);
    process.exit(1);
  }
  const c = fit.calibration;

  console.log(`\n${file}   confidence ${(fit.confidence * 100).toFixed(0)}%\n`);
  const row = (name: string, got: { x: number; y: number }, wx: number, wy: number) => {
    console.log(`  ${name.padEnd(13)} ${got.x.toFixed(1).padStart(7)},${got.y.toFixed(1).padStart(7)}`
      + `   ${wx.toFixed(1).padStart(7)},${wy.toFixed(1).padStart(7)}`
      + `   ${(got.x - wx).toFixed(1).padStart(6)},${(got.y - wy).toFixed(1).padStart(6)}`);
  };
  console.log('  corner              fitted             measured           error');
  row('top left', c.topLeft, trueLeft(c.topLeft.y), trueTop(c.topLeft.x));
  row('top right', c.topRight, trueRight(c.topRight.y), trueTop(c.topRight.x));
  row('bottom left', c.bottomLeft, trueLeft(c.bottomLeft.y), c.bottomLeft.y);
  row('bottom right', c.bottomRight, trueRight(c.bottomRight.y), c.bottomRight.y);

  const topCentre = (c.topLeft.y + c.topRight.y) / 2 + c.topBow;
  console.log(`\n  top edge at the centre of the cup: ${topCentre.toFixed(1)}, measured 625.0`);
  console.log(`  topBow ${c.topBow.toFixed(1)}   bottomBow ${c.bottomBow.toFixed(1)}`);

  // Does a patch that is square in millimetres come out square in pixels?
  const vTop = c.vTop ?? 1;
  const topW = c.topRight.x - c.topLeft.x;
  const botW = c.bottomRight.x - c.bottomLeft.x;
  const bandH = (c.bottomLeft.y + c.bottomRight.y) / 2 - (c.topLeft.y + c.topRight.y) / 2;
  console.log(`\n  the lid covers ${((1 - vTop) * cup.heightMm).toFixed(1)}mm of the `
    + `${cup.heightMm}mm wall, so the band shows design v 0 to ${vTop.toFixed(3)}`);
  console.log('\n  a square patch on the cup renders this tall for its width:');
  for (const v of [0.15, 0.35, 0.55, 0.75]) {
    if (v > vTop) continue;
    const t = (vTop - v) / vTop;
    const across = (topW + (botW - topW) * t)
      / (cup.bottomDiameterMm + (cup.topDiameterMm - cup.bottomDiameterMm) * v);
    const down = bandH / (cup.heightMm * vTop);
    const naive = bandH / cup.heightMm;
    console.log(`    v=${v.toFixed(2)}   ${(down / across * 100).toFixed(1)}%`
      + `   (taking the band for the whole wall: ${(naive / across * 100).toFixed(1)}%)`);
  }
}

main();
