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
  importSvg, normaliseArtwork, dropBackgroundPlate, hasBackgroundPlate,
  type PlacedArtwork,
} from '@cupco/vector';

export interface LoadedAsset {
  name: string;
  /** Present when the file was vector, or was traced. */
  art?: PlacedArtwork;
  /** Present for bitmaps that were not traced. */
  image?: HTMLImageElement;
  traced: boolean;
  warnings: string[];
  shapeCount: number;
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

/** Read an SVG file and import it as vector paths. */
export async function loadSvgAsset(file: File): Promise<LoadedAsset> {
  const text = await file.text();
  const res = importSvg(text);
  const raw = normaliseArtwork(res.shapes);

  // Strip a background plate on the way in. On a coloured cup it prints as a
  // white box around the mark, which is never what anyone wants — and it also
  // inflates the artwork's bounding box, making the logo arrive too small.
  const hadPlate = hasBackgroundPlate(raw);
  const art = hadPlate ? normaliseArtwork(dropBackgroundPlate(raw).shapes.map((s) => ({
    subpaths: s.subpaths.map((sp) => ({ points: sp.map((p) => ({ x: p.x, y: p.y })), closed: true })),
    fill: s.fill,
    opacity: s.opacity,
    // Carried, not defaulted: re-normalising must not quietly change how a
    // path decides what is inside it.
    fillRule: s.fillRule ?? 'nonzero',
  }))) : raw;

  const warnings = [...res.warnings];
  if (hadPlate) warnings.push('background plate removed');

  return {
    name: file.name,
    art,
    traced: false,
    warnings,
    shapeCount: art.shapes.length,
  };
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
