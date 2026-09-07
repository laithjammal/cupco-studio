/**
 * The stored form of a design, and the records that hold it.
 *
 * WHY THIS EXISTS
 * ---------------
 * The runtime `Design` in the editor holds LIVE objects: decoded
 * `HTMLImageElement`s, parsed vector path arrays, generated QR matrices.
 * `JSON.stringify` on that produces `{}` for the image and megabytes of
 * float noise for the paths. So persistence is not "serialise the state" -
 * it needs an explicit boundary between what is stored and what is rebuilt.
 *
 * The rule this file encodes:
 *
 *   stored  = what a human authored, plus references to heavy bytes
 *   runtime = stored, rehydrated through the same functions the editor uses
 *
 * Anything DERIVABLE is not stored. A QR code's modules are a pure function
 * of its URL, so only the URL is written; regenerating on load means a stored
 * design can never disagree with the code that draws it.
 *
 * Anything EXPENSIVE OR LOSSY to re-derive is stored as a content-addressed
 * asset: original image bytes (never re-encoded), and traced vector artwork
 * (tracing is slow and its output is not guaranteed stable across versions).
 */

import type { PlacedArtwork } from '@cupco/vector';

/**
 * Bumped whenever the stored shape changes in a way older documents do not
 * satisfy. Every document carries the version it was written at, and is run
 * through the migration chain on load - see migrate.ts.
 */
export const SCHEMA_VERSION = 2;

/* -------------------------------------------------------------------------- */
/* Assets                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * What an asset holds.
 *
 *   image - the ORIGINAL uploaded bytes, byte for byte. Deliberately not a
 *           re-encode of the decoded image: re-encoding a 200KB JPEG through a
 *           canvas produces a multi-megabyte PNG and throws away the original.
 *   art   - normalised vector artwork as JSON (a PlacedArtwork).
 */
export type AssetKind = 'image' | 'art';

export interface StoredAsset {
  id: AssetId;
  kind: AssetKind;
  bytes: Uint8Array;
  /** MIME type for images; absent for art. */
  contentType?: string;
  /** Original filename, kept so the UI can show where an asset came from. */
  name?: string;
  byteLength: number;
  createdAt: number;
}

/** Summary without the payload, for listings and garbage collection. */
export type AssetInfo = Omit<StoredAsset, 'bytes'>;

/**
 * An asset's identity IS the hash of its bytes (`sha256-<hex>`).
 *
 * Content addressing means storing the same logo in twenty design versions
 * costs one copy, with no refcounting on the write path. See hash.ts for the
 * case where a hash is unavailable.
 */
export type AssetId = string;

/* -------------------------------------------------------------------------- */
/* Stored elements                                                             */
/* -------------------------------------------------------------------------- */

interface StoredBase {
  id: string;
  u: number;
  v: number;
  rotation: number;
  name: string;
  opacity?: number;
  /**
   * Vertical stretch, as a multiple of the artwork's natural aspect.
   *
   * Optional, and absent means 1 - so every design saved before edge handles
   * existed loads back unchanged, with no migration.
   */
  stretchV?: number;
}

/**
 * A bitmap. `assetId` points at the original file bytes.
 *
 * Natural dimensions are stored alongside so geometry (hit-testing, extents,
 * fan placement) can be computed before - or entirely without - decoding the
 * image. That makes a stored design measurable in Node, and stops the editor
 * flashing at the wrong size while an image decodes.
 */
export interface StoredImageElement extends StoredBase {
  type: 'image';
  assetId: AssetId;
  widthU: number;
  naturalWidth: number;
  naturalHeight: number;
}

/** Vector artwork. `artId` points at a JSON PlacedArtwork asset. */
export interface StoredVectorElement extends StoredBase {
  type: 'vector';
  artId: AssetId;
  widthU: number;
  traced: boolean;
}

/**
 * A QR code, stored as its URL and style only.
 *
 * `art`, `live` and `moduleCount` are all pure functions of those two and are
 * regenerated on load, so a stored code cannot drift from the generator - and
 * a code saved before a style existed still opens, in the style it had.
 */
export interface StoredQrElement extends StoredBase {
  type: 'qr';
  url: string;
  widthU: number;
  /** A preset id from QR_STYLES. */
  styleId: string;
  /**
   * A preset id from QR_FRAMES: the shape the code sits in.
   *
   * Optional, and absent means the plain square - so every design saved before
   * frames existed loads back exactly as it was, with no migration.
   */
  frameId?: string;
}

/** Text and bands are plain data and are stored verbatim. */
export interface StoredTextElement extends StoredBase {
  type: 'text';
  content: string;
  sizeV: number;
  color: string;
  weight: number;
  fontFamily: string;
  italic: boolean;
  tracking: number;
  align: 'left' | 'center' | 'right';
}

export interface StoredBandElement extends StoredBase {
  type: 'band';
  heightV: number;
  color: string;
}

export type StoredElement =
  | StoredImageElement
  | StoredVectorElement
  | StoredQrElement
  | StoredTextElement
  | StoredBandElement;

export interface StoredDesign {
  schemaVersion: number;
  background: string;
  elements: StoredElement[];
}

/** The JSON payload of an `art` asset. */
export type StoredArt = PlacedArtwork;

/* -------------------------------------------------------------------------- */
/* Projects and versions                                                       */
/* -------------------------------------------------------------------------- */

export interface Project {
  id: string;
  name: string;
  /** Which CupProfile this design is for. */
  profileId: string;
  /** The live, autosaved working design. */
  design: StoredDesign;
  createdAt: number;
  updatedAt: number;
  /** Data URL of a small preview, for the project list. Optional. */
  thumbnail?: string;
}

/** A project without its design, for listing without loading everything. */
export type ProjectSummary = Omit<Project, 'design'> & { elementCount: number };

/**
 * An immutable snapshot.
 *
 * Snapshots are FULL copies, not diffs. Cup designs are small, and the
 * question these exist to answer - "which exact artwork was approved?" -
 * must never depend on replaying a diff chain correctly.
 */
export interface DesignVersion {
  id: string;
  projectId: string;
  /** Monotonic per project, starting at 1. */
  ordinal: number;
  label: string;
  profileId: string;
  design: StoredDesign;
  createdAt: number;
  thumbnail?: string;
}

export type DesignVersionSummary = Omit<DesignVersion, 'design'>;

/* -------------------------------------------------------------------------- */
/* Mockup plates                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A photograph of a BLANK cup, with the calibration that says where the cup is
 * in it and how it curves.
 *
 * Plates are a library, not project data: a good photograph of a cup in a hand
 * is worth using for every customer, so they live in their own store rather
 * than inside whichever project happened to be open when it was uploaded.
 *
 * The calibration is stored as plain numbers rather than the geometry engine's
 * type, so this package keeps its own shape and does not have to move whenever
 * the engine's does.
 */
export interface StoredPlate {
  id: string;
  name: string;
  /** Content hash of the photograph in the asset store. */
  assetId: AssetId;
  widthPx: number;
  heightPx: number;
  calibration: {
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
    bottomRight: { x: number; y: number };
    topBow: number;
    bottomBow: number;
    centreU: number;
    visibleSpan: number;
  };
  mask: {
    minBrightness: number;
    maxSaturation: number;
    edgeFade: number;
    opacity: number;
  };
  /**
   * Whether the cup has been located in this photograph yet.
   *
   * Set once, by the automatic fit or by the operator dragging a handle. It
   * exists so a plate is never re-fitted underneath someone who has adjusted
   * it by hand - an automatic fit that overwrites a manual one is worse than
   * no automatic fit at all.
   */
  fitted?: boolean;
  createdAt: number;
  updatedAt: number;
}
