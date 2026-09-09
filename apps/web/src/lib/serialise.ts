/**
 * Runtime Design  <->  StoredDesign.
 *
 * This is the boundary the whole persistence layer turns on. Above it,
 * elements hold live objects the editor draws with. Below it, everything is
 * JSON plus content-addressed bytes.
 *
 * The direction of travel matters: rehydration goes through the SAME
 * constructors the editor uses (`createQrElement`, `createVectorElement`), so
 * a reopened design cannot be built differently from one that was never
 * saved. Anywhere a loader duplicates construction logic is somewhere the two
 * eventually disagree.
 */

import {
  quantiseArt, encodeJson, decodeJson, migrateDesign, SCHEMA_VERSION,
} from '@cupco/persistence';
import type { AssetStore, StoredArt, StoredDesign, StoredElement } from '@cupco/persistence';
import { buildQrArtwork, getQrStyle, normaliseUrl, type QrFrameId } from '@cupco/qr';
import type { PlacedArtwork } from '@cupco/vector';
import type { Design, DesignElement } from './design';
import { reserveIds } from './design';

/* -------------------------------------------------------------------------- */
/* Capturing image bytes at upload time                                        */
/* -------------------------------------------------------------------------- */

/**
 * The bytes to store for an uploaded bitmap.
 *
 * For a real image file this is the ORIGINAL, untouched - a JPEG stays a JPEG
 * at its original size and quality.
 *
 * A PDF or AI is different: what the editor holds is a RENDER of the first
 * page, not the file. Storing the source and decoding it later through an
 * `<img>` would simply fail, because browsers cannot decode PDF that way. So
 * for those the render is encoded to PNG and that is what is stored - which is
 * also what the operator actually saw and placed.
 */
export async function captureImageBytes(
  file: File,
  rendered: HTMLImageElement,
  wasRendered: boolean,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (!wasRendered) {
    const buf = await file.arrayBuffer();
    return {
      bytes: new Uint8Array(buf),
      contentType: file.type || 'application/octet-stream',
    };
  }
  return { bytes: await encodePng(rendered), contentType: 'image/png' };
}

async function encodePng(image: HTMLImageElement): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.drawImage(image, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode the rendered page');
  return new Uint8Array(await blob.arrayBuffer());
}

/* -------------------------------------------------------------------------- */
/* Serialise                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Write a design to its stored form, putting any assets it needs.
 *
 * Vector artwork is hashed and stored as JSON, so twenty versions sharing one
 * logo cost one copy. Image bytes are already in the store from upload; only
 * the reference is written here.
 */
export async function serialiseDesign(
  design: Design,
  assets: AssetStore,
): Promise<StoredDesign> {
  const elements: StoredElement[] = [];

  for (const el of design.elements) {
    const base = {
      id: el.id, u: el.u, v: el.v, rotation: el.rotation, name: el.name,
      ...(el.opacity !== undefined ? { opacity: el.opacity } : {}),
      // Omitted when untouched, so old documents round-trip byte-identical.
      ...(el.stretchV !== undefined && el.stretchV !== 1 ? { stretchV: el.stretchV } : {}),
    };

    if (el.type === 'image') {
      elements.push({
        ...base, type: 'image',
        assetId: el.assetId,
        widthU: el.widthU,
        naturalWidth: el.image.naturalWidth,
        naturalHeight: el.image.naturalHeight,
      });
    } else if (el.type === 'vector') {
      const artId = await assets.put('art', encodeJson(quantiseArt(el.art)), {
        contentType: 'application/json',
        name: el.name,
      });
      elements.push({ ...base, type: 'vector', artId, widthU: el.widthU, traced: el.traced });
    } else if (el.type === 'qr') {
      // Only the URL and the style. `art`, `live` and `moduleCount` are all
      // regenerated on load from those two.
      elements.push({
        ...base, type: 'qr', url: el.url, widthU: el.widthU, styleId: el.styleId,
        // Omitted when square, so older documents round-trip unchanged.
        ...(el.frameId !== 'none' ? { frameId: el.frameId } : {}),
        ...(el.silhouetteId !== 'none' ? { silhouetteId: el.silhouetteId } : {}),
      });
    } else if (el.type === 'text') {
      elements.push({
        ...base, type: 'text',
        content: el.content, sizeV: el.sizeV, color: el.color, weight: el.weight,
        fontFamily: el.fontFamily, italic: el.italic, tracking: el.tracking, align: el.align,
      });
    } else {
      elements.push({ ...base, type: 'band', heightV: el.heightV, color: el.color });
    }
  }

  return { schemaVersion: SCHEMA_VERSION, background: design.background, elements };
}

/* -------------------------------------------------------------------------- */
/* Deserialise                                                                 */
/* -------------------------------------------------------------------------- */

export interface LoadResult {
  design: Design;
  /**
   * Elements that could not be rebuilt, described for the operator.
   *
   * Reported rather than swallowed: a design silently missing its logo looks
   * like the design was saved wrong, and the operator would have no way to
   * know which is which.
   */
  warnings: string[];
}

/** Rebuild a runtime design from its stored form. */
export async function deserialiseDesign(
  raw: unknown,
  assets: AssetStore,
): Promise<LoadResult> {
  const stored = migrateDesign(raw);
  const elements: DesignElement[] = [];
  const warnings: string[] = [];

  for (const el of stored.elements) {
    const base = {
      id: el.id, u: el.u, v: el.v, rotation: el.rotation, name: el.name,
      ...(el.opacity !== undefined ? { opacity: el.opacity } : {}),
      // Omitted when untouched, so old documents round-trip byte-identical.
      ...(el.stretchV !== undefined && el.stretchV !== 1 ? { stretchV: el.stretchV } : {}),
    };

    if (el.type === 'image') {
      const asset = await assets.get(el.assetId);
      if (!asset) {
        warnings.push(`"${el.name}" is missing its image file and was not restored`);
        continue;
      }
      try {
        const image = await decodeImage(asset.bytes, asset.contentType ?? 'image/png');
        elements.push({ ...base, type: 'image', image, assetId: el.assetId, widthU: el.widthU });
      } catch {
        warnings.push(`"${el.name}" could not be decoded and was not restored`);
      }
    } else if (el.type === 'vector') {
      const asset = await assets.get(el.artId);
      if (!asset) {
        warnings.push(`"${el.name}" is missing its artwork and was not restored`);
        continue;
      }
      const art = decodeJson<StoredArt>(asset.bytes) as PlacedArtwork;
      elements.push({ ...base, type: 'vector', art, widthU: el.widthU, traced: el.traced });
    } else if (el.type === 'qr') {
      // Regenerated from the URL, style and frame, by the same code that built
      // it. An older document has no frameId and comes back square.
      const normalised = normaliseUrl(el.url);
      const frameId = (el.frameId ?? 'none') as QrFrameId;
      const silhouetteId = (el.silhouetteId ?? 'none') as QrFrameId;
      const { art, moduleCount, codeFraction, minModuleScale } = buildQrArtwork(
        normalised ?? 'https://example.com',
        {
          style: getQrStyle(el.styleId), frame: frameId, silhouette: silhouetteId,
          level: silhouetteId === 'none' ? 'M' : 'H',
        },
      );
      elements.push({
        ...base, type: 'qr',
        url: el.url, live: normalised !== null, art, widthU: el.widthU, moduleCount,
        styleId: el.styleId, frameId, silhouetteId, codeFraction, minModuleScale,
      });
    } else if (el.type === 'text') {
      elements.push({
        ...base, type: 'text',
        content: el.content, sizeV: el.sizeV, color: el.color, weight: el.weight,
        fontFamily: el.fontFamily, italic: el.italic, tracking: el.tracking, align: el.align,
      });
    } else {
      elements.push({ ...base, type: 'band', heightV: el.heightV, color: el.color });
    }
  }

  // Before anything new can be created, or a fresh element will collide with a
  // loaded one.
  reserveIds(elements);
  return { design: { background: stored.background, elements }, warnings };
}

/**
 * Decode stored bytes into an image the canvas can draw.
 *
 * The object URL is revoked once `decode()` resolves. That is safe - the
 * decoded frame is retained by the element - and skipping it would leak the
 * full byte buffer for the lifetime of the page, which for a handful of
 * multi-megabyte uploads is quickly noticeable.
 */
function decodeImage(bytes: Uint8Array, contentType: string): Promise<HTMLImageElement> {
  // Copy into a fresh buffer so the Blob cannot be affected by a view onto a
  // larger, reused pool.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy], { type: contentType }));
  const image = new Image();
  image.src = url;
  return image.decode()
    .then(() => { URL.revokeObjectURL(url); return image; })
    .catch((err: unknown) => { URL.revokeObjectURL(url); throw err; });
}
