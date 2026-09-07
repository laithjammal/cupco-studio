/** Print a profile's derived geometry and any provenance issues. */
import {
  deriveFrustum, getProfile, provenanceIssues, isProductionReady, BUILT_IN_PROFILES,
} from '../src/index';

const id = process.argv[2] ?? '8oz-single-wall';
const p = getProfile(id);
if (!p) { console.error(`Unknown profile. Have: ${BUILT_IN_PROFILES.map(x=>x.id).join(', ')}`); process.exit(1); }
const g = deriveFrustum(p.dimensions);

console.log(`\n${p.displayName}`);
console.log(`  dimensions  ${p.dimensionsProvenance}   margins  ${p.marginsProvenance}`);
console.log(`  production ready: ${isProductionReady(p) ? 'YES' : 'NO (export blocked)'}`);
console.log(`\n  Dt ${p.dimensions.topDiameterMm}  Db ${p.dimensions.bottomDiameterMm}  h ${p.dimensions.heightMm} (${p.dimensions.heightIsSlant ? 'slant' : 'vertical'})`);
console.log(`  sector ${g.sectorAngleDeg.toFixed(4)}deg   R_bot ${g.rBottomMm.toFixed(4)}   R_top ${g.rTopMm.toFixed(4)}`);
console.log(`\n  cut: top ${p.margins.cut.topMm}  bottom ${p.margins.cut.bottomMm}  left ${p.margins.cut.leftMm}  right ${p.margins.cut.rightMm}`);
console.log(`  safe: top ${p.margins.safeTopMm}  bottom ${p.margins.safeBottomMm}  seam ${p.margins.safeSeamMm}`);
console.log(`  seam overlap ${p.seam.overlapMm}   rim curl ${p.rimBase.rimCurlAllowanceMm}   base allowance ${p.rimBase.baseAllowanceMm}`);
console.log(`  print extends ${(p.rimBase.rimCurlAllowanceMm - p.margins.safeTopMm).toFixed(1)}mm into the curl zone`);

const issues = provenanceIssues(p);
console.log(`\n  issues: ${issues.length === 0 ? 'none' : ''}`);
for (const i of issues) console.log(`   [${i.level.toUpperCase()}] ${i.field}: ${i.message}\n`);
