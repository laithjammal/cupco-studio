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
 * Dimensions supplied by Cupco from the manufacturer's fan blank drawing
 * ("Final 8 Oz dimensions Lynn .pdf", title block ref B55H90 = bottom 55mm,
 * height 90mm).
 *
 * Independently corroborated: parsing that drawing's vector content stream
 * yields dimension lines of 208.56pt (73.57mm) and 156.0pt (55.03mm), matching
 * the supplied 73.62mm / 55.00mm to within 0.05mm, and confirming the drawing
 * is 1:1 in millimetres.
 *
 * Derived fan geometry (verified to machine precision in the test suite):
 *   slant L    =  90.4803 mm
 *   sector     =  37.0423 deg
 *   R_bottom   = 267.2618 mm
 *   R_top      = 357.7420 mm
 *   top arc    = 231.2840 mm  (= pi * 73.62)
 *   bottom arc = 172.7876 mm  (= pi * 55.00)
 *
 * HEIGHT INTERPRETATION: CONFIRMED VERTICAL by Cupco 2026-08-26. The slant
 * reading (which would give sector 37.2400 deg and shift R_bottom by 1.42mm)
 * is therefore ruled out. `heightIsSlant: false` is deliberate, not a default.
 *
 * CAVEAT FROM SOURCE: the drawing states "this drawing for reference, final
 * drawing after mold finished and tested". Re-confirm with the manufacturer
 * before a production run.
 */
export const CUP_8OZ: CupProfile = {
  id: '8oz-single-wall',
  displayName: '8oz Single Wall',
  sizeOz: 8,
  wall: 'single',
  dimensionsProvenance: 'MEASURED',
  // Every value that AFFECTS OUTPUT is now confirmed: bleed, seam overlap,
  // seam clearance, and the top and bottom print limits. baseAllowanceMm is
  // still an estimate but drives nothing (see rimBase below), so it does not
  // hold this at PLACEHOLDER.
  marginsProvenance: 'MEASURED',
  provenanceNote:
    'DIMENSIONS: supplied by Cupco 2026-08-25 from manufacturer drawing B55H90; corroborated ' +
    'against the drawing vector geometry to within 0.05mm. Height confirmed VERTICAL by Cupco ' +
    '2026-08-26. Source drawing marked "for reference, final drawing after mold finished and ' +
    'tested" - re-confirm before a production run. ' +
    'MARGINS: bleed 5mm, seam overlap 6mm, seam clearance 4mm, rim curl 7mm, top print limit ' +
    '3mm and bottom print limit 2mm all supplied by Cupco 2026-08-26. baseAllowanceMm remains ' +
    'an estimate but is informational only and affects no output.',
  dimensions: {
    topDiameterMm: 73.62,
    bottomDiameterMm: 55.0,
    heightMm: 90.0,
    heightIsSlant: false,
  },
  // All print limits supplied by Cupco 2026-08-26.
  //
  // Both figures here are PHYSICAL FACTS about how the cup is formed, not
  // print limits: safe insets are absolute (see fan.ts offsetsFor), so neither
  // value feeds any outline, preview or export. They are recorded for
  // reference and for future preflight rules.
  rimBase: {
    // ~7mm rolls into the rim curl. Print deliberately runs 4mm into this
    // zone - the printable limit is margins.safeTopMm.
    rimCurlAllowanceMm: 7.0,
    baseAllowanceMm: 5.0, // Estimate. Informational only - affects no output.
  },
  margins: {
    bleedMm: 5.0,      // Cupco: "bleed of 5mm is good".
    safeTopMm: 3.0,    // Cupco: "print up to 3mm of the top edge".
    safeBottomMm: 2.0, // Cupco: "can print to 2mm from the bottom".
    safeSeamMm: 4.0,   // Cupco: "print up to 4mm clear on the seam edge".
  },
  seam: {
    positionRad: Math.PI,
    overlapMm: 6.0,            // Cupco: "seam overlap is 6mm".
    visibleStartOffsetMm: 6.0, // Hidden strip equals the overlap width.
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
  margins: { bleedMm: 3.0, safeTopMm: 6.0, safeBottomMm: 6.0, safeSeamMm: 5.0 },
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
  margins: { bleedMm: 3.0, safeTopMm: 6.0, safeBottomMm: 6.0, safeSeamMm: 5.0 },
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
