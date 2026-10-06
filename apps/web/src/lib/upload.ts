/**
 * Upload handling: get every incoming file to vector where possible.
 *
 * Vector is not a nicety here - it is what makes a true CMYK PDF possible, and
 * what keeps logos crisp at any size. So:
 *
 *   SVG        -> parsed to paths directly, no quality loss
 *   PNG / JPG  -> offered to the tracer, which is excellent on flat-colour
 *                 logos and poor on photographs
 *
 * Tracing is OPT-IN and reports what it produced. Silently vectorising
 * someone's product photograph would wreck it, so the decision stays with the
 * operator, who can see the result and undo it.
 */

import {
  importSvg, normaliseArtwork, dropBackgroundPlate, hasBackgroundPlate, refitArtwork,
  artworkBounds,
  type PlacedArtwork, type SvgImportResult, type FontResolver,
} from '@cupco/vector';
import { loadSvgFonts } from './fonts';
import { preloadRasters } from './raster-cache';
import { drawArtwork } from './artwork-draw';
import { whenLoaded } from './image-load';

export interface LoadedAsset {
  name: string;
  /** Present when the file was vector, or was traced. */
  art?: PlacedArtwork;
  /** Present for bitmaps that were not traced. */
  image?: HTMLImageElement;
  /**
   * The bytes to store for `image`, when they are not simply the uploaded
   * file - an SVG that turned out to be a picture stores the picture.
   */
  imageBytes?: { bytes: Uint8Array; contentType: string };
  /** Vertical stretch the picture was shown at in its file, when not 1. */
  stretchV?: number;
  traced: boolean;
  warnings: string[];
  shapeCount: number;
  /** For SVG uploads: the file as read, for storing and for the import check. */
  svg?: { text: string; reading: SvgReading };
}

/* -------------------------------------------------------------------------- */
/* Reading an SVG                                                              */
/* -------------------------------------------------------------------------- */

/** What reading an SVG produced, before anything is added to the design. */
export interface SvgReading {
  /** The importer's result, in the file's own units. */
  result: SvgImportResult;
  /** The artwork as it will be placed: fitted to its content, plate removed. */
  art: PlacedArtwork;
  plateRemoved: boolean;
  /** Where `art` sits in the file, in the file's units. */
  box: { x: number; y: number; w: number; h: number };
  /**
   *   vector - shapes, perhaps with pictures among them
   *   bitmap - no shapes at all: a picture in an SVG wrapper
   *   empty  - nothing visible
   */
  kind: 'vector' | 'bitmap' | 'empty';
  /** Everything the operator should know, most important first. */
  notes: string[];
}

/**
 * The importer's result as artwork in the file's own units - not fitted to a
 * unit box. What the import check draws, so it lines up with the original.
 */
export function documentArtwork(result: SvgImportResult): PlacedArtwork {
  return {
    aspect: result.height / Math.max(1e-9, result.width),
    shapes: result.shapes.map((s) => ({
      fill: s.fill, opacity: s.opacity, fillRule: s.fillRule,
      subpaths: s.subpaths.map((sp) => sp.points),
    })),
    ...(result.rasters.length ? {
      rasters: result.rasters.map((r) => ({
        href: r.href, mime: r.mime, matrix: [...r.matrix] as typeof r.matrix,
        naturalWidth: r.naturalWidth, naturalHeight: r.naturalHeight,
        opacity: r.opacity, before: r.before,
        ...(r.clip ? { clip: r.clip.map((sp) => sp.points) } : {}),
      })),
    } : {}),
  };
}

/**
 * Read an SVG into placeable artwork.
 *
 * Pure: no DOM, no fonts loaded behind its back - the caller passes them. So
 * the whole decision about what a file becomes is testable in Node.
 */
export function readSvg(text: string, fonts?: FontResolver): SvgReading {
  const result = importSvg(text, fonts ? { fonts } : {});
  const raw = normaliseArtwork(result.shapes, result.rasters);
  const full = artworkBounds(documentArtwork(result));

  // Strip a background plate on the way in. On a coloured cup it prints as a
  // white box around the mark, which is never what anyone wants - and it also
  // inflates the artwork's bounding box, making the logo arrive too small.
  const plateRemoved = hasBackgroundPlate(raw);
  const kept = plateRemoved ? dropBackgroundPlate(raw) : raw;
  const art = plateRemoved ? refitArtwork(kept) : raw;

  // The kept content's box, in file units: unit-box bounds scaled back out
  // through the box the whole import was fitted to.
  let box = { x: 0, y: 0, w: result.width, h: result.height };
  if (full) {
    const fw = full.x1 - full.x0, fh = full.y1 - full.y0;
    const inner = artworkBounds(kept) ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
    box = {
      x: full.x0 + inner.x0 * fw, y: full.y0 + inner.y0 * fh,
      w: (inner.x1 - inner.x0) * fw, h: (inner.y1 - inner.y0) * fh,
    };
  }

  const kind = result.shapes.length > 0 ? 'vector' : result.rasters.length > 0 ? 'bitmap' : 'empty';
  const notes: string[] = [];
  if (kind === 'bitmap') {
    const r = result.rasters[0]!;
    notes.push(result.rasters.length === 1
      ? `this SVG holds no vector artwork — it is a ${r.naturalWidth}×${r.naturalHeight}px picture in an SVG wrapper, and prints as pixels. Ask for the original vector logo, or trace it (⟡)`
      : `this SVG holds no vector artwork — only ${result.rasters.length} embedded pictures, which print as pixels. Ask for the original vector logo, or trace it (⟡)`);
  } else if (kind === 'vector' && result.rasters.length) {
    notes.push(`${result.rasters.length === 1 ? 'an embedded picture' : `${result.rasters.length} embedded pictures`} — kept as ${result.rasters.length === 1 ? 'a picture' : 'pictures'}, so ${result.rasters.length === 1 ? 'it prints' : 'they print'} as pixels, not vector`);
  }
  for (const w of result.warnings) if (w !== 'No visible artwork found' || kind === 'empty') notes.push(w);
  if (plateRemoved) notes.push('background plate removed');

  return { result, art, plateRemoved, box, kind, notes };
}

export function isSvgFile(file: File): boolean {
  return file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
}

/**
 * PDF and Illustrator files.
 *
 * A modern .ai file IS a PDF with an Illustrator-private section, so the same
 * reader handles both. .eps is PostScript, a different format entirely, and is
 * NOT included — pdf.js cannot read it.
 */
export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.(pdf|ai)$/i.test(file.name);
}

/**
 * Bitmap formats a browser can actually decode.
 *
 * Matched on EXTENSION, not the MIME type: Photoshop files are reported as
 * `image/vnd.adobe.photoshop`, so trusting the `image/` prefix lets them
 * through to a loader that can only fail with a useless message.
 */
const DECODABLE = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

/** A short explanation of why a file cannot be used, or null if it can. */
export function unsupportedReason(file: File): string | null {
  if (isSvgFile(file) || isPdfFile(file)) return null;
  if (DECODABLE.test(file.name)) return null;
  if (/\.eps$/i.test(file.name)) {
    return 'EPS is PostScript, which browsers cannot read. Open it in Illustrator and ' +
      'save as SVG (best) or PDF.';
  }
  if (/\.(psd|psb|indd|sketch|fig|cdr|xd|afdesign|tiff?)$/i.test(file.name)) {
    return 'Design-tool files cannot be read directly. Export the artwork as SVG ' +
      '(best), PDF, or a high-resolution PNG.';
  }
  // No recognisable extension: fall back on the MIME type before giving up, so
  // a correctly-typed file with an odd name still works.
  if (/^image\/(png|jpeg|webp|gif|bmp|avif)$/.test(file.type)) return null;
  return 'Not an artwork file. Upload SVG (best), PDF, AI, PNG or JPG.';
}

/**
 * Fonts for the importer, or none if they cannot be had - in which case live
 * text is reported rather than drawn, and nothing else is affected.
 */
async function svgFonts(): Promise<FontResolver | undefined> {
  try {
    return await loadSvgFonts();
  } catch {
    return undefined;
  }
}

/** Read SVG text the way an upload does: fonts loaded, pictures decoded. */
export async function readSvgText(text: string): Promise<SvgReading> {
  const reading = readSvg(text, await svgFonts());
  await preloadRasters([reading.art]);
  return reading;
}

/** Read an SVG file and import it as vector paths. */
export async function loadSvgAsset(file: File): Promise<LoadedAsset> {
  const text = await file.text();
  const reading = await readSvgText(text);

  if (reading.kind === 'bitmap') {
    // A picture in an SVG wrapper. Placed as a bitmap - which is what it is -
    // so it is labelled honestly, checked for resolution, and can be traced.
    const pic = await pictureOf(reading);
    return {
      name: file.name, image: pic.image, imageBytes: pic.stored,
      ...(pic.stretchV ? { stretchV: pic.stretchV } : {}),
      traced: false, warnings: reading.notes, shapeCount: 0, svg: { text, reading },
    };
  }

  return {
    name: file.name,
    ...(reading.kind === 'vector' ? { art: reading.art } : {}),
    traced: false,
    warnings: reading.notes,
    shapeCount: reading.art.shapes.length,
    svg: { text, reading },
  };
}

async function decodeBytes(bytes: Uint8Array, type: string): Promise<HTMLImageElement> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy], { type }));
  const img = new Image();
  const loaded = whenLoaded(img);
  img.src = url;
  try {
    await loaded;
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The picture inside an SVG that is nothing but pictures.
 *
 * One picture, shown square to the page and unclipped, is stored as its own
 * original bytes - no re-encode, nothing lost. Anything more involved (two
 * pictures, a clip, a rotation) is flattened at the pictures' own resolution,
 * so what is placed is what the file showed.
 */
async function pictureOf(reading: SvgReading): Promise<{
  image: HTMLImageElement; stored: { bytes: Uint8Array; contentType: string }; stretchV?: number;
}> {
  const rasters = reading.result.rasters;
  const only = rasters.length === 1 ? rasters[0]! : null;
  if (only && !only.clip && only.opacity >= 0.999 &&
      Math.abs(only.matrix[1]) < 1e-9 && Math.abs(only.matrix[2]) < 1e-9 &&
      only.matrix[0] > 0 && only.matrix[3] > 0) {
    const bytes = new Uint8Array(await (await fetch(only.href)).arrayBuffer());
    const image = await decodeBytes(bytes, only.mime);
    // Shown at the file's proportions, which a stretched <image> need not share.
    const shown = only.matrix[3] / only.matrix[0];
    const natural = image.naturalHeight / Math.max(1, image.naturalWidth);
    const stretch = shown / natural;
    return {
      image, stored: { bytes, contentType: only.mime },
      ...(Math.abs(stretch - 1) > 0.005 ? { stretchV: stretch } : {}),
    };
  }

  // Pixels per file unit of the sharpest picture, so flattening loses nothing.
  let density = 1;
  for (const r of rasters) {
    const w = Math.hypot(r.matrix[0], r.matrix[1]);
    if (w > 0) density = Math.max(density, r.naturalWidth / w);
  }
  const b = reading.box;
  const scale = Math.min(density, 4096 / Math.max(b.w, b.h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(b.w * scale));
  canvas.height = Math.max(1, Math.round(b.h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  drawArtwork(ctx, documentArtwork(reading.result), [scale, 0, 0, scale, -b.x * scale, -b.y * scale]);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('could not encode the picture');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { image: await decodeBytes(bytes, 'image/png'), stored: { bytes, contentType: 'image/png' } };
}

/**
 * Read the first page of a PDF or Illustrator file.
 *
 * ---------------------------------------------------------------------------
 * AN HONEST LIMITATION
 * ---------------------------------------------------------------------------
 * This RASTERISES the page rather than extracting its vector paths. pdf.js
 * renders to a canvas; it does not expose path geometry in a form that can be
 * turned back into clean shapes. So a PDF logo arrives as a high-resolution
 * bitmap, and reaching vector from there means tracing — an approximation of
 * an approximation.
 *
 * It is rendered at a deliberately high pixel density so that tracing has good
 * edges to work from, but the honest advice is in the returned warning: if the
 * customer can send an SVG, that is lossless and this path is unnecessary.
 */
export async function loadPdfAsset(file: File): Promise<LoadedAsset> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const page = await doc.getPage(1);

  // Target roughly 2000px on the long edge: enough detail for tracing without
  // producing a canvas so large it stalls the browser.
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(6, Math.max(1, 2000 / Math.max(base.width, base.height)));
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');

  // PDFs have no background of their own; without this the page comes through
  // transparent and any dark artwork becomes invisible on a dark cup.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not decode the rendered page'));
    img.src = canvas.toDataURL('image/png');
  });

  const warnings = [
    `rendered page 1 of ${doc.numPages} at ${canvas.width}×${canvas.height}px`,
    'PDF and AI arrive as a bitmap — trace it for vector, or ask for an SVG instead',
  ];
  if (doc.numPages > 1) warnings.push(`${doc.numPages - 1} further page(s) ignored`);

  return { name: file.name, image, traced: false, warnings, shapeCount: 0 };
}

/** Load a bitmap as-is, without tracing. */
export function loadRasterAsset(file: File): Promise<LoadedAsset> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ name: file.name, image: img, traced: false, warnings: [], shapeCount: 0 });
    img.onerror = () => reject(new Error(`Could not read ${file.name}`));
    img.src = URL.createObjectURL(file);
  });
}

export interface TraceOptions {
  /** Number of colours to quantise to. Fewer = cleaner, more poster-like. */
  colors?: number;
  /** Higher = smoother, less faithful. */
  smoothing?: number;
}

/**
 * Trace a bitmap to vector paths.
 *
 * Implemented by producing an SVG and feeding it back through the SAME
 * importer used for uploaded SVGs. That is deliberate: it means traced and
 * uploaded vector artwork travel one code path, so anything proven about one
 * holds for the other.
 */
export async function traceRaster(
  image: HTMLImageElement,
  name: string,
  options: TraceOptions = {},
): Promise<LoadedAsset> {
  // Cap the working size: tracing cost grows with pixel count, and detail
  // beyond this adds noise rather than fidelity for logo artwork.
  const MAX = 900;
  const scale = Math.min(1, MAX / Math.max(image.naturalWidth, image.naturalHeight));
  const w = Math.max(1, Math.round(image.naturalWidth * scale));
  const h = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D context unavailable');
  ctx.drawImage(image, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);

  const mod = await import('imagetracerjs');
  const tracer = mod.default ?? mod;

  const svg: string = tracer.imagedataToSVG(
    { width: data.width, height: data.height, data: data.data },
    {
      numberofcolors: options.colors ?? 8,
      ltres: 1,
      qtres: 1,
      pathomit: 8,
      blurradius: options.smoothing ?? 0,
      strokewidth: 0,
      linefilter: true,
      colorquantcycles: 3,
    },
  );

  const res = importSvg(svg);
  const art = normaliseArtwork(res.shapes);
  return {
    name: `${name} (traced)`,
    art,
    traced: true,
    warnings: res.shapes.length === 0 ? ['Tracing produced no shapes — try more colours'] : [],
    shapeCount: res.shapes.length,
  };
}
