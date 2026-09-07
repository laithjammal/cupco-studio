/**
 * Emit a 1:1 SVG of a derived production fan, in millimetres.
 *
 * Print at 100% scale and lay it over the manufacturer's drawing to confirm
 * the derived outline by eye. This is the cheap physical check that closes the
 * loop between the maths and a real cup.
 *
 *   npx tsx packages/geometry/scripts/emit-fan-svg.ts 8oz-single-wall out.svg
 */
import { writeFileSync } from 'node:fs';
import {
  deriveFrustum, buildFanOutline, fanBounds,
  outlineToSvgPath, getProfile, BUILT_IN_PROFILES,
} from '../src/index';

const id = process.argv[2] ?? '8oz-single-wall';
const out = process.argv[3] ?? `${id}-fan.svg`;

const profile = getProfile(id);
if (!profile) {
  console.error(`Unknown profile "${id}". Available: ${BUILT_IN_PROFILES.map(p => p.id).join(', ')}`);
  process.exit(1);
}

const g = deriveFrustum(profile.dimensions);
const cut = buildFanOutline(profile, g, 'cut', 512);
const trim = buildFanOutline(profile, g, 'trim', 512);
const safe = buildFanOutline(profile, g, 'safe', 512);

const b = fanBounds(cut.points);
const pad = 10;
const W = b.widthMm + pad * 2;
const H = b.heightMm + pad * 2;
const tx = -b.minX + pad;
const ty = -b.minY + pad;

const poly = (pts: { x: number; y: number }[]) =>
  pts.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' ');

const warn = profile.provenance === 'PLACEHOLDER'
  ? `<text x="${pad}" y="${H - 3}" font-family="monospace" font-size="4" fill="#c00">` +
    `PLACEHOLDER DIMENSIONS - NOT FOR PRODUCTION</text>`
  : '';

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Cupco Studio derived production fan. 1:1 in millimetres.
     Profile: ${profile.displayName} (${profile.provenance})
     Dt=${profile.dimensions.topDiameterMm}  Db=${profile.dimensions.bottomDiameterMm}  h=${profile.dimensions.heightMm}
     slant=${g.slantMm.toFixed(4)}  sector=${g.sectorAngleDeg.toFixed(4)}deg
     R_bot=${g.rBottomMm.toFixed(4)}  R_top=${g.rTopMm.toFixed(4)}
     top arc=${g.topArcMm.toFixed(4)}  bottom arc=${g.bottomArcMm.toFixed(4)} -->
<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(3)}mm" height="${H.toFixed(3)}mm"
     viewBox="0 0 ${W.toFixed(4)} ${H.toFixed(4)}">
  <g transform="translate(${tx.toFixed(4)} ${ty.toFixed(4)})">
    <path d="${outlineToSvgPath(cut)}" fill="none" stroke="#e08" stroke-width="0.25" stroke-dasharray="2 1"/>
    <path d="${outlineToSvgPath(trim)}"  fill="none" stroke="#000" stroke-width="0.4"/>
    <path d="${outlineToSvgPath(safe)}"  fill="none" stroke="#09c" stroke-width="0.25" stroke-dasharray="1 1"/>
  </g>
  <text x="${pad}" y="${pad - 3}" font-family="monospace" font-size="3.5" fill="#333">
    ${profile.displayName} fan - sector ${g.sectorAngleDeg.toFixed(3)}deg, R_bot ${g.rBottomMm.toFixed(2)}mm, R_top ${g.rTopMm.toFixed(2)}mm - 1:1
  </text>
  ${warn}
</svg>
`;

writeFileSync(out, svg);
console.log(`Wrote ${out}`);
console.log(`  sector      ${g.sectorAngleDeg.toFixed(4)} deg`);
console.log(`  R_bottom    ${g.rBottomMm.toFixed(4)} mm`);
console.log(`  R_top       ${g.rTopMm.toFixed(4)} mm`);
console.log(`  top arc     ${g.topArcMm.toFixed(4)} mm  (pi*Dt = ${(Math.PI * profile.dimensions.topDiameterMm).toFixed(4)})`);
console.log(`  bottom arc  ${g.bottomArcMm.toFixed(4)} mm  (pi*Db = ${(Math.PI * profile.dimensions.bottomDiameterMm).toFixed(4)})`);
console.log(`  blank bbox  ${b.widthMm.toFixed(2)} x ${b.heightMm.toFixed(2)} mm (to the cut line)`);
