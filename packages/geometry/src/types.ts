/**
 * Cupco Studio — cup profile contract.
 *
 * A CupProfile is the SINGLE SOURCE OF TRUTH for the relationship between a
 * logical piece of artwork and a physical manufactured cup. Every downstream
 * representation (2D editor canvas, 3D preview texture, production fan, print
 * export) is a deterministic function of (DesignDocument, CupProfile).
 *
 * Nothing in this package has runtime dependencies. It must run identically in
 * the browser (3D preview), in Node (export worker), and in a test runner.
 */

/**
 * Where a number came from. This is not decoration: preflight REFUSES to export
 * any profile still carrying PLACEHOLDER values, so invented dimensions can
 * never silently reach a printer.
 */
export type Provenance =
  /** Measured from a physical cup or supplied by the manufacturer. */
  | 'MEASURED'
  /** Computed from MEASURED values by this engine. */
  | 'DERIVED'
  /** Invented for development. MUST be replaced before production use. */
  | 'PLACEHOLDER';

export interface CupDimensions {
  /**
   * Outer diameter at the top of the printable body, in mm.
   *
   * NOTE: this is the diameter of the BLANK's top arc, i.e. measured at the
   * body below the rolled rim - NOT the finished rim outside diameter. Spec
   * sheets usually quote the latter; see `rimCurlAllowanceMm`.
   */
  topDiameterMm: number;

  /** Outer diameter at the bottom of the printable body, in mm. */
  bottomDiameterMm: number;

  /**
   * Height of the cup body in mm.
   *
   * Interpreted as VERTICAL height unless `heightIsSlant` is true. The
   * distinction matters: for the 8oz profile the two readings differ by
   * ~1.42mm in R_bottom.
   */
  heightMm: number;

  /** If true, `heightMm` is the slant length, not the vertical height. */
  heightIsSlant?: boolean;
}

/**
 * Bridges FINISHED cup dimensions and FLAT BLANK dimensions.
 *
 * The blank's top edge is curled outward to form the rim, so the finished rim
 * OD is larger than the blank's top arc. Material is also consumed at the base.
 * Conflating these shifts artwork vertically on every cup produced.
 */
export interface RimAndBase {
  /**
   * Material rolled into the rim curl, mm. Recorded as a physical fact.
   *
   * NOTE: this is NOT automatically unprintable. Cupco prints into the curl
   * zone; the printable limit is `margins.safeTopMm`, set independently.
   */
  rimCurlAllowanceMm: number;
  /** Material consumed by the bottom seam / knurl, mm. */
  baseAllowanceMm: number;
  /** Finished outside diameter across the curled rim, mm. Reference only. */
  finishedRimOuterDiameterMm?: number;
}

/**
 * Print margins. These are DESIGNED TO BE ADJUSTED once the printer confirms
 * them: they are plain configuration, consumed by the fan builder at call
 * time, so changing them re-derives every outline, preview and export with no
 * code change and no stored artwork to migrate.
 */
/**
 * Where the blank is die-cut, as distances OUTSIDE the trim line, mm.
 *
 * Per-edge, because a real fan blank is not a uniform outset of the finished
 * cup. The bottom runs well past the cup's base — that material is consumed
 * forming the base seam — and the two seam edges differ, because one laps over
 * the other. A single `bleedMm` could describe none of that, and the fan it
 * drew was measurably the wrong shape.
 *
 * `left` and `right` are the fan as it is DRAWN: left is design u=0, right is
 * u=1. They are not left and right on the finished cup, which has no such
 * thing. Each carries its own offset at the top and bottom arcs - see SeamCut.
 *
 * A negative value is legal and means the cut falls inside the trim line.
 */
export interface CutMargins {
  topMm: number;
  bottomMm: number;
  left: SeamCut;
  right: SeamCut;
}

/**
 * One seam edge of the blank, as distances OUTSIDE the trim line, mm.
 *
 * TWO numbers, not one, because a die cuts a STRAIGHT edge, and a straight
 * line is not a constant distance from a radial one. Holding the offset
 * constant and letting the angle follow (which is what a single number does)
 * bows the edge: fitted at the top arc it missed the real blank's bottom
 * corner by 1.8mm, and fitted at the bottom it missed the top by the same.
 *
 * Given both, `buildFanOutline` places the two corners and the straight
 * segment between them falls where the die actually cuts - to within 0.0005mm
 * of the drawn blank, over its full 108mm length.
 */
export interface SeamCut {
  /** Distance outside trim, measured at the TOP (outer) arc. */
  atTopMm: number;
  /** Distance outside trim, measured at the BOTTOM (inner) arc. */
  atBottomMm: number;
}

export interface PrintMargins {
  /**
   * Where the blank is cut, per edge — the real fan's own outline.
   *
   * This is a MEASUREMENT of the blank, not a printing allowance. It is what
   * the die does.
   */
  cut: CutMargins;
  /**
   * How far artwork runs OUTSIDE the cut line, mm.
   *
   * Note the reference: bleed is measured from the CUT, not from trim. The
   * blank is cut at the cut line, so that is the edge a white sliver can
   * appear at, and ink has to carry past it. Measuring bleed from trim - which
   * is what this did - put the bleed line INSIDE the blank on any edge where
   * the cut ran further out, which is the opposite of a bleed.
   *
   * Uniform on all four edges, because unlike the cut this is a printing
   * tolerance rather than a property of the blank.
   */
  bleedMm: number;
  /**
   * ABSOLUTE inset from the top trim edge to the safe area, mm.
   *
   * Not additive with `rimCurlAllowanceMm`: print may deliberately extend into
   * the curl zone, since the curl rolls outward and stays visible.
   */
  safeTopMm: number;
  /** ABSOLUTE inset from the bottom trim edge to the safe area, mm. */
  safeBottomMm: number;
  /** ABSOLUTE inset from each seam edge to the safe area, mm. */
  safeSeamMm: number;
}

export interface SeamConfig {
  /**
   * Angular position of the seam on the finished cup, radians.
   * 0 = directly at the back of the default 3D camera view.
   */
  positionRad: number;
  /** Width of the glue overlap strip, mm. */
  overlapMm: number;
  /**
   * Width of artwork hidden beneath the overlapping edge on the finished cup,
   * mm. The visible circumference is slightly less than the developed one.
   */
  visibleStartOffsetMm: number;
}

/**
 * How horizontal position in design space is interpreted.
 *
 * - 'angular'    u is a fraction of the circumference at ANY height. A logo
 *                keeps its angular width, so it is physically narrower lower
 *                down the tapered cup. This is what actually happens when
 *                artwork wraps a cone; it is the V1 default.
 * - 'arc-length' u is normalised against arc length at a reference height, so
 *                elements hold their physical mm width. Reserved for V2.
 */
export type DesignSpaceMode = 'angular' | 'arc-length';

export interface DesignCanvasSpec {
  /** Design canvas width in px. Maps to u in [0,1). */
  widthPx: number;
  /** Design canvas height in px. Maps to v in [0,1]. */
  heightPx: number;
  /** Nominal resolution the canvas represents. */
  dpi: number;
}

export interface CupProfile {
  /** Stable machine id, e.g. "8oz-single-wall". */
  id: string;
  /** Human label, e.g. "8oz Single Wall". */
  displayName: string;
  /** Nominal capacity in fluid ounces. */
  sizeOz: number;
  wall: 'single';

  /**
   * Provenance of the physical DIMENSIONS. Gates production export: a
   * PLACEHOLDER here is a hard block, because a wrong diameter makes an
   * unusable cup.
   */
  dimensionsProvenance: Provenance;

  /**
   * Provenance of the PRINT MARGINS (bleed, seam, rim, base). Tracked
   * separately because these are routinely still assumed while the dimensions
   * are already confirmed - which is exactly the 8oz situation today.
   *
   * A PLACEHOLDER here is a WARNING rather than a block: the cup will be the
   * right shape, but the artwork may crop or show a white sliver at the seam.
   */
  marginsProvenance: Provenance;

  /** Free text explaining provenance, shown in the admin UI. */
  provenanceNote?: string;

  dimensions: CupDimensions;
  rimBase: RimAndBase;
  margins: PrintMargins;
  seam: SeamConfig;
  designSpaceMode: DesignSpaceMode;
  designCanvas: DesignCanvasSpec;

  /** Default raster resolution for production export. */
  exportDpi: number;
}

/** A point on the 3D cup surface, mm, Y up, origin at cup base centre. */
export interface Point3 { x: number; y: number; z: number }

/** A 2D point, mm. */
export interface Point2 { x: number; y: number }

/** Normalised design-space coordinate. u around, v bottom->top. */
export interface DesignUV { u: number; v: number }
