/** Emit the design-space artwork template for a profile. */
import { writeFileSync } from 'node:fs';
import { buildArtworkTemplateSvg, getProfile, deriveFrustum, BUILT_IN_PROFILES } from '../src/index';

const id = process.argv[2] ?? '8oz-single-wall';
const out = process.argv[3] ?? `${id}-artwork-template.svg`;
const p = getProfile(id);
if (!p) {
  console.error(`Unknown profile. Have: ${BUILT_IN_PROFILES.map((x) => x.id).join(', ')}`);
  process.exit(1);
}
const g = deriveFrustum(p.dimensions);
writeFileSync(out, buildArtworkTemplateSvg(p));
console.log(`Wrote ${out}`);
console.log(`  artwork area : ${g.topArcMm.toFixed(2)} x ${g.slantMm.toFixed(2)} mm  (trim)`);
console.log(`  with bleed   : ${(g.topArcMm + p.margins.bleedMm * 2).toFixed(2)} x ${(g.slantMm + p.margins.bleedMm * 2).toFixed(2)} mm`);
console.log(`  safe insets  : top ${p.margins.safeTopMm}  bottom ${p.margins.safeBottomMm}  seam ${p.margins.safeSeamMm} mm`);
console.log(`  seam overlap : ${p.seam.overlapMm} mm`);
console.log(`  base width   : ${g.bottomArcMm.toFixed(2)} mm (${(100 * g.bottomArcMm / g.topArcMm).toFixed(1)}% of rim - taper compression)`);
