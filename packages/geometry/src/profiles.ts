/**
 * Built-in cup profiles.
 *
 * PROVENANCE DISCIPLINE
 * ---------------------
 * Only the 8oz profile carries MEASURED dimensions. The 12oz and 16oz profiles
 * are PLACEHOLDER and are refused by production export until real measurements
 * replace them (see preflight rule `profile-provenance`).
 *
 * When adding a profile, supply top diameter, bottom diameter and height. All
 * fan geometry is derived - never copy another profile's fan and scale it.
 */

import type { CupProfile, Provenance } from './types';

/** Design canvas at 300dpi sized to comfortably cover the 8oz developed area. */
const DEFAULT_CANVAS = { widthPx: 2732, heightPx: 1069, dpi: 300 } as const;

/**
 * 8oz single wall.
 *
 * Authored from the manufacturer's fan blank drawing "Final 8 Oz dimensions
 * Lynn .pdf" (title block B55H90, in Drawings/), read by parsing the PDF's
 * vector content stream rather than by eye. The blank's two arcs are concentric about a fitted
 * apex to 0.012mm RMS, so the drawing is a true annular sector and these are
 * measurements, not readings off a picture.
 *
 * WHAT THE DRAWING STATES, AND WHAT WAS MEASURED FROM ITS GEOMETRY
 *
 *   labelled      measured    what it is
 *   R350.24       350.207     outer (top) arc of the blank - the die
 *   R242.24       242.220     inner (bottom) arc of the blank - the die
 *   108.01        107.988     radial extent of the blank
 *   38.88 deg     38.896      included angle of the two straight seam edges
 *   241.59        241.606     blank width across the seam edges at the top arc
 *   169.7         169.680     the same at the bottom arc
 *   9             9.007       no-print band inside the top arc
 *   7             6.980       no-print band inside the bottom arc
 *
 * Six independent figures agree to better than 0.03mm. The 9 and 7 are the
 * dashed arcs the drawing hatches, over the note "the hatched part is left
 * blank for printing".
 *
 * HEIGHT: 85.76mm, and this is a CORRECTION.
 *
 * The profile previously carried 90mm, taken from the B55H90 designation. That
 * is the FINISHED cup height - body plus rim curl plus base - not the body the
 * fan develops from. Read as the body height it is not consistent with the
 * manufacturer's own blank: it puts R_top at 357.74mm, which is 7.5mm OUTSIDE
 * the die's top arc, so the cup would not fit the blank it is cut from.
 *
 * Read as the finished height, and the body solved from the drawing instead,
 * everything closes:
 *
 *   body height  85.76mm  ->  sector 38.8323 deg   (drawing labels 38.88)
 *                            R_top  341.2523mm    (drawing: 350.24 - 9 = 341.24)
 *
 * R_top lands 0.012mm from the drawing's own figure, and the sector angle
 * within 0.05 deg. No other reading of the three numbers comes close.
 *
 * REBUILT AGAINST THE DIE: driving buildFanOutline from the values below and
 * comparing the result to the drawn blank puts all four corners within
 * 0.0005mm, and both seam edges within 0.0005mm over their full 108mm length.
 *
 * KNOWN GAPS - corner features the die has and this model does not:
 *   - bottom-right notch, 5.5 x 5.5mm
 *   - top-left chamfer, 2 x 8mm
 *   - bottom-left corner radius R2
 * All three fall inside the no-print bands, so they do not affect where
 * artwork lands; they would matter to a die maker reading our dieline.
 *
 * ONE FIGURE STILL DISAGREES: the drawing's own cross-section gives the base
 * as diameter 55.01, but its fan develops to about 52.6 at the base. The
 * drawing is internally inconsistent by ~2.4mm there. The fan is what the die
 * cuts, so the fan is what the cut line follows; the cross-section's 55.01 is
 * kept as the bottom diameter because it is also what Cupco quote. Worth
 * settling with the manufacturer.
 *
 * CAVEAT FROM SOURCE: the drawing states "this drawing for reference, final
 * drawing after mold finished and tested". Re-confirm before a production run.
 */
export const CUP_8OZ: CupProfile = {
  id: '8oz-single-wall',
  displayName: '8oz Single Wall',
  sizeOz: 8,
  wall: 'single',
  dimensionsProvenance: 'MEASURED',
  // Every margin that affects output is now either measured off the
  // manufacturer's drawing (the whole cut line, the rim and base allowances)
  // or supplied by Cupco for this press (bleed, safe area, seam).
  marginsProvenance: 'MEASURED',
  provenanceNote:
    'DIMENSIONS: top diameter 73.62 and bottom 55.01 from the manufacturer drawing B55H90 ' +
    '(also what Cupco quote). BODY height 85.76 solved from that drawing 2026-09-07 - the ' +
    '90mm previously held is the FINISHED height, and read as the body it put the cup 7.5mm ' +
    'outside the blank it is cut from. ' +
    'CUT LINE: read off the drawing vector geometry 2026-09-07; rebuilds to within 0.0005mm ' +
    'of the drawn blank at all four corners and along both seam edges. Supersedes the 9/7/9/3 ' +
    'figures inferred from written feedback, and the 5mm uniform bleed before that. ' +
    'SAFE AREA: seam clearance 4mm, top print limit 3mm, bottom 2mm supplied by Cupco ' +
    '2026-08-26. The drawing hatches its own no-print bands - 9 top, 7 bottom, 4.5 left, ' +
    '6.5 right, all measured from the CUT - which are close to but not the same as Cupco\'s; ' +
    'Cupco\'s are kept because they were given for this press. ' +
    'BLEED: 5mm quoted verbally by Cupco, now measured outward from the cut. ' +
    'Source drawing marked "for reference, final drawing after mold finished and tested".',
  dimensions: {
    // Body height, not the finished 90mm of the B55H90 designation. See above.
    topDiameterMm: 73.62,
    bottomDiameterMm: 55.01,
    heightMm: 85.76,
    heightIsSlant: false,
  },
  rimBase: {
    // The material above the cup's top rim, which rolls into the curl. Same
    // physical fact as margins.cut.topMm, and the drawing's 9mm hatched band.
    rimCurlAllowanceMm: 8.988,
    // The material below the cup's base, consumed forming the base seam. Same
    // physical fact as margins.cut.bottomMm.
    baseAllowanceMm: 12.749,
    // Over the curled rim, from the drawing. Reference only - nothing derives
    // from it; the wall's 73.62 is what wraps.
    finishedRimOuterDiameterMm: 79.69,
  },
  margins: {
    // Read off the manufacturer's drawing 2026-09-07. Not a uniform outset,
    // and the two seam edges each need TWO numbers because the die cuts a
    // straight line, not a curve at constant distance from a radial one.
    cut: {
      topMm: 8.988,     // outer arc R350.24, trim R_top 341.2523
      bottomMm: 12.749, // inner arc R242.24, trim R_bot 254.9890
      left: { atTopMm: 4.634, atBottomMm: 4.592 },
      right: { atTopMm: 4.664, atBottomMm: 4.585 },
    },
    // Cupco: "bleed of 5mm is good". Measured OUTWARD FROM THE CUT, so ink
    // runs 5mm past the real edge of the blank. Worth re-confirming: it was
    // quoted when bleed was being measured from trim, and 3mm is the more
    // usual allowance beyond a die line.
    bleedMm: 5.0,
    // Extended 4mm at each end on Laith's instruction 2026-09-07, from
    // Cupco's 3mm top / 2mm bottom. Both therefore now sit OUTSIDE the trim
    // line, which is what the negative sign means - see PrintMargins.
    //
    //   top    R342.25 - 1.00mm above trim,  7.99mm inside the cut
    //   bottom R252.99 - 2.00mm below trim, 10.75mm inside the cut
    //
    // Note the top is ~1mm past the manufacturer's own hatched no-print band
    // (the drawing puts that at R341.24, level with trim). The bottom is
    // 3.75mm the safe side of theirs, which sits at R249.24.
    safeTopMm: -1.0,
    safeBottomMm: -2.0,
    safeSeamMm: 4.0,   // Cupco: "print up to 4mm clear on the seam edge".
  },
  seam: {
    positionRad: Math.PI,
    // The drawing marks the lap 7.5mm, "right edge on top". Cupco said 6mm.
    // The drawing is the manufacturing document, so it wins.
    overlapMm: 7.5,
    visibleStartOffsetMm: 7.5, // Hidden strip equals the overlap width.
  },
  designSpaceMode: 'angular',
  designCanvas: DEFAULT_CANVAS,
  exportDpi: 300,
};

/**
 * 12oz single wall. PLACEHOLDER - every dimension is invented for development.
 * Replace with real measurements before any production use.
 */
export const CUP_12OZ: CupProfile = {
  id: '12oz-single-wall',
  displayName: '12oz Single Wall',
  sizeOz: 12,
  wall: 'single',
  dimensionsProvenance: 'PLACEHOLDER',
  marginsProvenance: 'PLACEHOLDER',
  provenanceNote:
    'PLACEHOLDER - every value invented for development. Deprioritised by Cupco 2026-08-26 ' +
    'in favour of 8oz. Export is blocked until real measurements are supplied.',
  dimensions: { topDiameterMm: 90.0, bottomDiameterMm: 60.0, heightMm: 110.0 },
  rimBase: { rimCurlAllowanceMm: 6.0, baseAllowanceMm: 5.0 },
  margins: {
    cut: {
      topMm: 3.0, bottomMm: 3.0,
      left: { atTopMm: 3.0, atBottomMm: 3.0 },
      right: { atTopMm: 3.0, atBottomMm: 3.0 },
    },
    bleedMm: 3.0,
    safeTopMm: 6.0, safeBottomMm: 6.0, safeSeamMm: 5.0,
  },
  seam: { positionRad: Math.PI, overlapMm: 5.0, visibleStartOffsetMm: 5.0 },
  designSpaceMode: 'angular',
  designCanvas: { widthPx: 3340, heightPx: 1311, dpi: 300 },
  exportDpi: 300,
};

/**
 * 16oz single wall. PLACEHOLDER - every dimension is invented for development.
 * Replace with real measurements before any production use.
 */
export const CUP_16OZ: CupProfile = {
  id: '16oz-single-wall',
  displayName: '16oz Single Wall',
  sizeOz: 16,
  wall: 'single',
  dimensionsProvenance: 'PLACEHOLDER',
  marginsProvenance: 'PLACEHOLDER',
  provenanceNote:
    'PLACEHOLDER - every value invented for development. Deprioritised by Cupco 2026-08-26 ' +
    'in favour of 8oz. Export is blocked until real measurements are supplied.',
  dimensions: { topDiameterMm: 90.0, bottomDiameterMm: 60.0, heightMm: 135.0 },
  rimBase: { rimCurlAllowanceMm: 6.0, baseAllowanceMm: 5.0 },
  margins: {
    cut: {
      topMm: 3.0, bottomMm: 3.0,
      left: { atTopMm: 3.0, atBottomMm: 3.0 },
      right: { atTopMm: 3.0, atBottomMm: 3.0 },
    },
    bleedMm: 3.0,
    safeTopMm: 6.0, safeBottomMm: 6.0, safeSeamMm: 5.0,
  },
  seam: { positionRad: Math.PI, overlapMm: 5.0, visibleStartOffsetMm: 5.0 },
  designSpaceMode: 'angular',
  designCanvas: { widthPx: 3340, heightPx: 1608, dpi: 300 },
  exportDpi: 300,
};

export const BUILT_IN_PROFILES: readonly CupProfile[] = [CUP_8OZ, CUP_12OZ, CUP_16OZ];

export function getProfile(id: string): CupProfile | undefined {
  return BUILT_IN_PROFILES.find((p) => p.id === id);
}

/** Severity of a provenance problem. */
export type ProvenanceIssueLevel = 'error' | 'warning';

export interface ProvenanceIssue {
  level: ProvenanceIssueLevel;
  field: 'dimensions' | 'margins';
  message: string;
}

/**
 * Report what is still unconfirmed about a profile.
 *
 * Dimensions and margins fail differently, so they are reported differently:
 *
 *   - invented DIMENSIONS  -> the cup is the wrong shape. Nothing about the
 *                             output is salvageable. ERROR, blocks export.
 *   - invented MARGINS     -> the cup is the right shape, but artwork may crop
 *                             at the rim or leave a white sliver at the glued
 *                             seam. WARNING - proofing and test prints are
 *                             still useful, so this must not block them.
 */
export function provenanceIssues(profile: CupProfile): ProvenanceIssue[] {
  const issues: ProvenanceIssue[] = [];
  if (profile.dimensionsProvenance === 'PLACEHOLDER') {
    issues.push({
      level: 'error',
      field: 'dimensions',
      message:
        `${profile.displayName}: cup dimensions are placeholder values and were invented for ` +
        `development. The manufactured cup would be the wrong shape. Supply real measurements ` +
        `before exporting.`,
    });
  }
  if (profile.marginsProvenance === 'PLACEHOLDER') {
    issues.push({
      level: 'warning',
      field: 'margins',
      message:
        `${profile.displayName}: one or more print margins are still assumed rather than ` +
        `confirmed by the printer, so artwork may crop at an edge or show a gap at the glued ` +
        `seam. Safe to proof; confirm before a production run.` +
        (profile.provenanceNote ? ` Detail: ${profile.provenanceNote}` : ''),
    });
  }
  return issues;
}

/**
 * True when this profile may be used for a production export.
 *
 * Only DIMENSIONS block. Assumed margins produce a warning via
 * provenanceIssues() but must not stop staff proofing a correctly-shaped cup.
 */
export function isProductionReady(profile: CupProfile): boolean {
  return profile.dimensionsProvenance !== 'PLACEHOLDER';
}

/**
 * Return a copy of `profile` with adjusted print margins.
 *
 * This is the supported way to answer "can we change the bleed later?": margins
 * are plain configuration read at call time, so overriding them re-derives
 * every outline, preview and export. No stored artwork needs migrating,
 * because no representation caches a warped copy of the design.
 *
 * Supplying real values also clears the margins provenance warning.
 */
export function withMargins(
  profile: CupProfile,
  overrides: {
    margins?: Partial<CupProfile['margins']>;
    rimBase?: Partial<CupProfile['rimBase']>;
    seam?: Partial<CupProfile['seam']>;
    provenance?: Provenance;
    note?: string;
  },
): CupProfile {
  return {
    ...profile,
    margins: { ...profile.margins, ...overrides.margins },
    rimBase: { ...profile.rimBase, ...overrides.rimBase },
    seam: { ...profile.seam, ...overrides.seam },
    marginsProvenance: overrides.provenance ?? profile.marginsProvenance,
    provenanceNote: overrides.note ?? profile.provenanceNote,
  };
}
