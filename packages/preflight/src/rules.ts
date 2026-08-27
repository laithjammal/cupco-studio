/**
 * The rules.
 *
 * Each takes the measured design and returns issues. Every issue carries a
 * REMEDY, because "artwork is outside the safe area" tells an operator nothing
 * they cannot already see - what they need is which way to move it and by how
 * many millimetres.
 *
 * Every measurement goes through @cupco/geometry. None of these functions does
 * its own trigonometry.
 */

import {
  designWidthToMm, designHeightToMm, distanceToSeamMm,
} from '@cupco/geometry';
import type { CupProfile, FrustumGeometry } from '@cupco/geometry';
import { totalInkPct } from '@cupco/vector';
import type {
  PreflightDesign, PreflightElement, PreflightIssue, PreflightOptions,
} from './types';

export interface RuleContext {
  design: PreflightDesign;
  profile: CupProfile;
  geom: FrustumGeometry;
  options: Required<PreflightOptions>;
}

export type Rule = (ctx: RuleContext) => PreflightIssue[];

const mm = (n: number) => `${n.toFixed(1)}mm`;

/** Bounds of an element's rotated outline, in design space. */
function extent(el: PreflightElement) {
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const c of el.corners) {
    if (c.u < minU) minU = c.u;
    if (c.u > maxU) maxU = c.u;
    if (c.v < minV) minV = c.v;
    if (c.v > maxV) maxV = c.v;
  }
  return { minU, maxU, minV, maxV };
}

const named = (el: PreflightElement) => ({ elementId: el.id, elementName: el.name });

/* -------------------------------------------------------------------------- */

/**
 * Placeholder cup dimensions.
 *
 * The only rule that can be true of a design with nothing wrong in it: the
 * artwork may be perfect and the CUP still be the wrong shape.
 */
export const profileProvenance: Rule = ({ profile }) => {
  const issues: PreflightIssue[] = [];
  if (profile.dimensionsProvenance === 'PLACEHOLDER') {
    issues.push({
      rule: 'profile-provenance',
      severity: 'error',
      message: `${profile.displayName} has placeholder dimensions — they were invented for development.`,
      remedy: 'Supply the real top diameter, bottom diameter and height before exporting.',
    });
  }
  if (profile.marginsProvenance === 'PLACEHOLDER') {
    issues.push({
      rule: 'profile-provenance',
      severity: 'warning',
      message: `${profile.displayName} has unconfirmed print margins, so artwork may crop at an edge or leave a gap at the seam.`,
      remedy: 'Safe to proof. Confirm bleed, seam overlap and rim margins before a production run.',
    });
  }
  return issues;
};

/**
 * Nothing but a background.
 *
 * A warning, not a block. Almost always a mistake - but a plain coloured cup
 * is a real product, and by the rule above only UNSALVAGEABLE output blocks.
 * An empty design is not wrong, just empty.
 */
export const emptyDesign: Rule = ({ design }) => (
  design.elements.length === 0
    ? [{
        rule: 'empty-design',
        severity: 'warning',
        message: 'This design has no artwork — the cup would print as a plain colour.',
        remedy: 'Add a logo or some text, unless a plain cup is what was ordered.',
      }]
    : []
);

/**
 * Artwork outside the printable band.
 *
 * Bands are exempt: one spans the full circumference and is normally MEANT to
 * run off the rim or the base. Flagging every deliberate bleed would bury the
 * cases that matter.
 */
export const safeArea: Rule = ({ design, profile, geom }) => {
  const issues: PreflightIssue[] = [];
  const { safeTopMm, safeBottomMm, safeSeamMm } = profile.margins;
  const vSafeTop = 1 - safeTopMm / geom.slantMm;
  const vSafeBottom = safeBottomMm / geom.slantMm;

  for (const el of design.elements) {
    if (el.kind === 'band') continue;
    const { minU, maxU, minV, maxV } = extent(el);

    const overTop = maxV - vSafeTop;
    if (overTop > 0) {
      issues.push({
        rule: 'safe-area', severity: 'warning', ...named(el),
        message: `"${el.name}" reaches into the rim curl and will be distorted or cropped.`,
        remedy: `Move it down at least ${mm(designHeightToMm(overTop, geom))}.`,
        measurement: `${mm(designHeightToMm(overTop, geom))} past the ${mm(safeTopMm)} top limit`,
      });
    }

    const underBottom = vSafeBottom - minV;
    if (underBottom > 0) {
      issues.push({
        rule: 'safe-area', severity: 'warning', ...named(el),
        message: `"${el.name}" runs into the base curl and will be cropped.`,
        remedy: `Move it up at least ${mm(designHeightToMm(underBottom, geom))}.`,
        measurement: `${mm(designHeightToMm(underBottom, geom))} past the ${mm(safeBottomMm)} bottom limit`,
      });
    }

    // The seam edge, checked at every corner: the element is closest to it at
    // whichever corner sits lowest, because the same angular gap is physically
    // narrower down the taper.
    let nearestSeam = Infinity;
    for (const c of el.corners) nearestSeam = Math.min(nearestSeam, distanceToSeamMm(c, geom));
    const crosses = minU < 0 || maxU > 1;

    if (!crosses && nearestSeam < safeSeamMm) {
      issues.push({
        rule: 'safe-area', severity: 'warning', ...named(el),
        message: `"${el.name}" sits inside the glue seam margin and may be obscured by the joint.`,
        remedy: `Move it ${mm(safeSeamMm - nearestSeam)} further from the seam.`,
        measurement: `${mm(nearestSeam)} from the seam, limit is ${mm(safeSeamMm)}`,
      });
    }
  }
  return issues;
};

/**
 * Artwork split by the glued seam.
 *
 * Separate from the safe-area rule because it is a different failure: not
 * "close to the edge" but "in two pieces, on either side of a joint, with one
 * lapped over the other". Bands are exempt - they wrap continuously and have
 * no edge to split.
 */
export const seamCrossing: Rule = ({ design }) => {
  const issues: PreflightIssue[] = [];
  for (const el of design.elements) {
    if (el.kind === 'band') continue;
    const { minU, maxU } = extent(el);
    if (minU >= 0 && maxU <= 1) continue;

    // A split QR cannot be read at all, so it is unsalvageable rather than
    // merely risky. Anything else is a judgement the operator may own.
    const fatal = el.kind === 'qr';
    issues.push({
      rule: 'seam-crossing',
      severity: fatal ? 'error' : 'warning',
      ...named(el),
      message: fatal
        ? `The QR code is split across the glued seam and will not scan.`
        : `"${el.name}" is split across the glued seam and will not line up on the finished cup.`,
      remedy: 'Move it away from u = 0, or accept that the join runs through it.',
    });
  }
  return issues;
};

/**
 * Bitmap resolution at printed size.
 *
 * Effective dpi is the honest measure: a 4000px logo is not "high resolution"
 * if it is printed 200mm wide. Width is measured at the element's own height on
 * the cup, since the same angular width is physically narrower further down.
 */
export const rasterResolution: Rule = ({ design, geom, options }) => {
  const issues: PreflightIssue[] = [];
  for (const el of design.elements) {
    if (!el.image) continue;
    const widthMm = designWidthToMm(el.widthU, el.v, geom);
    if (widthMm <= 0) continue;
    const dpi = el.image.naturalWidth / (widthMm / 25.4);
    if (dpi >= options.targetDpi) continue;

    const unusable = dpi < options.minDpi;
    issues.push({
      rule: 'raster-resolution',
      severity: 'warning',
      ...named(el),
      message: unusable
        ? `"${el.name}" is far too low resolution and will print visibly blocky.`
        : `"${el.name}" is below ${options.targetDpi}dpi and will print softer than the vector artwork around it.`,
      remedy: unusable
        ? `Supply it at least ${Math.ceil((options.targetDpi * widthMm) / 25.4)}px wide, or ask for an SVG.`
        : `Scale it down, or supply it at ${Math.ceil((options.targetDpi * widthMm) / 25.4)}px wide.`,
      measurement: `${Math.round(dpi)}dpi at ${mm(widthMm)} wide (${el.image.naturalWidth}px)`,
    });
  }
  return issues;
};

/**
 * Total ink coverage.
 *
 * Only checks flat fills. A bitmap's coverage is per-pixel and cannot be
 * summarised without reading it, so images are not measured here - which is
 * worth knowing rather than assuming this rule covers everything.
 */
export const inkLimit: Rule = ({ design, options }) => {
  const issues: PreflightIssue[] = [];
  const limit = options.maxTotalInkPct;

  const check = (ink: Parameters<typeof totalInkPct>[0], label: string, el?: PreflightElement) => {
    const total = totalInkPct(ink);
    if (total <= limit) return;
    issues.push({
      rule: 'ink-limit',
      severity: 'warning',
      ...(el ? named(el) : {}),
      message: `${label} lays down more ink than the press accepts, which can cause set-off and slow drying.`,
      remedy: `Reduce it to ${limit}% or below — usually by taking cyan out of a rich black.`,
      measurement: `${Math.round(total)}% total ink, limit is ${limit}%`,
    });
  };

  check(design.background, 'The background colour');
  for (const el of design.elements) {
    // Report an element once, at its heaviest ink.
    let worst: { ink: (typeof el.inks)[number]; total: number } | null = null;
    for (const ink of el.inks) {
      const total = totalInkPct(ink);
      if (!worst || total > worst.total) worst = { ink, total };
    }
    if (worst) check(worst.ink, `"${el.name}"`, el);
  }
  return issues;
};

/* -------------------------------------------------------------------------- */
/* QR codes                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Smallest module that scans reliably off a printed cup, in mm.
 *
 * Corroborated rather than assumed: @cupco/vector decodes every QR style at
 * 200px across a 33-module code, which is this exact module size at 300dpi,
 * using two independent decoders and with blur applied. So this floor is the
 * size the styles were actually proven at, not a number picked for feel.
 *
 * It applies equally to every style. The decorative ones use full-module
 * geometry precisely so that they do not need a larger code than a plain one.
 */
export const MIN_QR_MODULE_MM = 0.5;

/**
 * A QR code that still holds its placeholder.
 *
 * An error, and the one most worth having: nothing on screen looks wrong, the
 * code scans perfectly in the proof, and it points at example.com on every cup
 * in the run.
 */
export const qrPlaceholder: Rule = ({ design }) => (
  design.elements
    .filter((el) => el.qr && !el.qr.live)
    .map((el) => ({
      rule: 'qr-placeholder',
      severity: 'error' as const,
      ...named(el),
      message: 'The QR code still holds its placeholder address and would print pointing at example.com.',
      remedy: 'Enter the real web address in the QR properties, or delete the code.',
    }))
);

/**
 * A QR code too small to scan.
 *
 * Module size is width divided by moduleCount PLUS the eight quiet-zone
 * modules, four each side. Dividing by moduleCount alone overstates the module
 * by around a fifth on a small code, which is exactly the range where the
 * answer matters.
 */
export const qrSize: Rule = ({ design, geom }) => {
  const issues: PreflightIssue[] = [];
  for (const el of design.elements) {
    if (!el.qr) continue;
    const widthMm = designWidthToMm(el.widthU, el.v, geom);
    const modulesAcross = el.qr.moduleCount + 8;
    const moduleMm = widthMm / modulesAcross;
    if (moduleMm >= MIN_QR_MODULE_MM) continue;

    const neededMm = MIN_QR_MODULE_MM * modulesAcross;
    issues.push({
      rule: 'qr-size',
      severity: 'warning',
      ...named(el),
      message: 'The QR code is too small to scan reliably off a curved cup.',
      remedy: `Make it at least ${mm(neededMm)} wide, or shorten the address so the code needs fewer modules.`,
      measurement: `${moduleMm.toFixed(2)}mm per module at ${mm(widthMm)} wide; ${MIN_QR_MODULE_MM}mm is the practical floor`,
    });
  }
  return issues;
};

/* -------------------------------------------------------------------------- */

/** Smallest text that reproduces on cup board, as cap height in mm. */
export const MIN_TEXT_MM = 1.5;

export const tinyText: Rule = ({ design, geom }) => {
  const issues: PreflightIssue[] = [];
  for (const el of design.elements) {
    if (!el.text || el.text.content.trim() === '') continue;
    const heightMm = designHeightToMm(el.text.sizeV, geom);
    if (heightMm >= MIN_TEXT_MM) continue;
    issues.push({
      rule: 'tiny-text',
      severity: 'warning',
      ...named(el),
      message: `"${el.name}" is too small to reproduce cleanly on cup board.`,
      remedy: `Set it at least ${mm(MIN_TEXT_MM)} tall.`,
      measurement: `${mm(heightMm)} cap height`,
    });
  }
  return issues;
};

/**
 * A band that stops just short of the edge.
 *
 * The bleed region is filled by extending the design's edge row outward, so a
 * band ending at v = 0.99 does not bleed - it leaves a hairline of background
 * between it and the rim, and THAT is what gets extended. Far enough from the
 * edge it is obviously deliberate, so only the near-miss range is reported.
 */
export const bleedGap: Rule = ({ design, geom }) => {
  const issues: PreflightIssue[] = [];
  const gapLimitV = 1.5 / geom.slantMm;

  for (const el of design.elements) {
    if (el.kind !== 'band') continue;
    const { minV, maxV } = extent(el);

    for (const [edge, gap] of [['rim', 1 - maxV], ['base', minV]] as const) {
      if (gap <= 0 || gap > gapLimitV) continue;
      issues.push({
        rule: 'bleed-gap',
        severity: 'warning',
        ...named(el),
        message: `"${el.name}" stops just short of the ${edge} and will leave a hairline of background there.`,
        remedy: `Extend it past the ${edge} edge so it bleeds.`,
        measurement: `${mm(designHeightToMm(gap, geom))} short`,
      });
    }
  }
  return issues;
};

/** Elements dragged off the printable area entirely. */
export const offCanvas: Rule = ({ design }) => {
  const issues: PreflightIssue[] = [];
  for (const el of design.elements) {
    const { minV, maxV } = extent(el);
    if (minV < 1 && maxV > 0) continue;
    issues.push({
      rule: 'off-canvas',
      severity: 'warning',
      ...named(el),
      message: `"${el.name}" sits entirely outside the cup and will not print at all.`,
      remedy: 'Move it back onto the design, or delete it.',
    });
  }
  return issues;
};

/** Elements that are invisible but still in the document. */
export const invisibleElement: Rule = ({ design }) => (
  design.elements
    .filter((el) => el.opacity <= 0.01)
    .map((el) => ({
      rule: 'invisible-element',
      severity: 'info' as const,
      ...named(el),
      message: `"${el.name}" is fully transparent and will not appear on the cup.`,
      remedy: 'Raise its opacity, or delete it.',
    }))
);

export const ALL_RULES: Rule[] = [
  profileProvenance,
  emptyDesign,
  offCanvas,
  seamCrossing,
  safeArea,
  qrPlaceholder,
  qrSize,
  rasterResolution,
  inkLimit,
  tinyText,
  bleedGap,
  invisibleElement,
];
