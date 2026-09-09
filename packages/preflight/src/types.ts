/**
 * Preflight: what would go wrong if this design were printed.
 *
 * SEVERITY IS A PROMISE, NOT A MOOD
 * ---------------------------------
 * The split follows the rule the profile provenance model already established:
 *
 *   error   - the printed cup would be UNSALVAGEABLE. Not "risky", not "ugly":
 *             wrong. Blocks export.
 *   warning - the operator may well be right. A background deliberately bled
 *             off the rim, a texture knowingly printed soft. Never blocks.
 *   info    - worth knowing, nothing to fix.
 *
 * Blocking is a strong claim, so the error list is deliberately short. A tool
 * that blocks on judgement calls trains its operators to override everything,
 * and then the one real error goes through with the rest.
 *
 * WHAT THIS MODULE DOES NOT MEASURE
 * ---------------------------------
 * Nothing here measures geometry itself. Element outlines arrive already
 * measured, from the same function that draws the selection box on screen, and
 * all mm conversions go through @cupco/geometry. A preflight rule that did its
 * own trigonometry would eventually disagree with the canvas the operator is
 * looking at, and then the warnings would be about a cup that does not exist.
 */

import type { CMYK } from '@cupco/vector';

export type Severity = 'error' | 'warning' | 'info';

export type ElementKind = 'image' | 'vector' | 'text' | 'band' | 'qr';

/** A point in design space: u around the circumference, v bottom to top. */
export interface DesignPoint { u: number; v: number }

/**
 * One element, measured.
 *
 * `corners` come from the editor's own `elementCorners`, rotation already
 * applied, so preflight and the on-screen selection box can never disagree
 * about where something is.
 */
export interface PreflightElement {
  id: string;
  kind: ElementKind;
  name: string;
  /** Centre in design space. */
  u: number;
  v: number;
  /** Full extents in design space, BEFORE rotation. */
  widthU: number;
  heightV: number;
  /** Degrees. */
  rotation: number;
  /** Polygon in design space, rotation applied. */
  corners: readonly DesignPoint[];
  /** 0-1. */
  opacity: number;
  /** Every ink this element lays down, for the coverage check. */
  inks: readonly CMYK[];

  image?: { naturalWidth: number; naturalHeight: number };
  text?: { content: string; sizeV: number };
  qr?: { url: string; live: boolean; moduleCount: number };
}

/** The design as preflight sees it. */
export interface PreflightDesign {
  background: CMYK;
  elements: readonly PreflightElement[];
}

export interface PreflightIssue {
  /** Stable identifier for the rule, e.g. 'safe-area'. */
  rule: string;
  severity: Severity;
  /** One sentence naming what is wrong. */
  message: string;
  /** What to do about it. Every issue has one - see the note in rules.ts. */
  remedy?: string;
  /** The element at fault, when there is one. */
  elementId?: string;
  elementName?: string;
  /** The measurement behind the claim, so the operator can judge it. */
  measurement?: string;
}

export interface PreflightReport {
  issues: PreflightIssue[];
  /** False when any issue is an error. */
  passed: boolean;
  errors: number;
  warnings: number;
  infos: number;
}

export interface PreflightOptions {
  /**
   * Highest total ink coverage the press accepts, as a percentage.
   *
   * 300% is the working figure for Cupco's digital press. rgbToCmyk already
   * caps converted colours below this, so the rule exists for inks the
   * operator typed in by hand, which are written to the PDF verbatim.
   */
  maxTotalInkPct?: number;
  /** Below this, a bitmap is reported as soft. */
  targetDpi?: number;
  /** Below this, a bitmap is reported as unusable rather than merely soft. */
  minDpi?: number;
}

export const PREFLIGHT_DEFAULTS: Required<PreflightOptions> = {
  maxTotalInkPct: 300,
  targetDpi: 300,
  minDpi: 150,
};
