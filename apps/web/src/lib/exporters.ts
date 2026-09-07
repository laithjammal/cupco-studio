/**
 * Export pipeline: fan PDF, fan SVG, and the artwork template.
 *
 * All three are driven from the SAME rasteriser and the SAME CupProfile as the
 * on-screen preview, so artwork lands exactly where the user placed it. The
 * only difference between preview and export is sampling density.
 */

import { PDFDocument } from 'pdf-lib';
import {
  buildFanOutline,
  type CupProfile, type FrustumGeometry,
} from '@cupco/geometry';

export { buildArtworkTemplateSvg } from '@cupco/geometry';
import type { FanRasterTransform } from '@cupco/render';
import type { ExportRequest, ExportResponse, ExportError } from './export.worker';

const MM_PER_INCH = 25.4;
const PT_PER_MM = 72 / MM_PER_INCH;

export interface RasterResult {
  blob: Blob;
  dataUrl: string;
  transform: FanRasterTransform;
  widthPx: number;
  heightPx: number;
  ms: number;
}

/**
 * Rasterise the fan at a given dpi, off the main thread.
 *
 * 600dpi on an 8oz fan is ~15 megapixels; doing that synchronously would lock
 * the tab for several seconds, so it always goes through the worker.
 */
/**
 * How much design space an artwork canvas covers vertically.
 *
 * The production fan is bigger than the cup at both ends, so its canvas is
 * rendered with overscan - see boundaryVRange in @cupco/geometry.
 */
export interface DesignVRange { vBottom: number; vTop: number }

export async function rasteriseFanOffThread(
  profile: CupProfile,
  designCanvas: HTMLCanvasElement,
  dpi: number,
  vRange?: DesignVRange,
  onProgress?: (msg: string) => void,
): Promise<RasterResult> {
  const dctx = designCanvas.getContext('2d', { willReadFrequently: true });
  if (!dctx) throw new Error('2D context unavailable');
  const src = dctx.getImageData(0, 0, designCanvas.width, designCanvas.height);

  onProgress?.(`Rendering fan at ${dpi} dpi…`);

  const worker = new Worker(new URL('./export.worker.ts', import.meta.url));
  try {
    const result = await new Promise<ExportResponse>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<ExportResponse | ExportError>) => {
        if (e.data.ok) resolve(e.data); else reject(new Error(e.data.message));
      };
      worker.onerror = (e) => reject(new Error(e.message || 'export worker failed'));
      // Copy before transferring: the design canvas is still live in the UI
      // and must not have its backing store detached.
      const copy = src.data.slice().buffer;
      const req: ExportRequest = {
        profile, width: src.width, height: src.height,
        buffer: copy, dpi, supersample: 2,
        designVBottom: vRange?.vBottom, designVTop: vRange?.vTop,
      };
      worker.postMessage(req, [copy]);
    });

    const canvas = document.createElement('canvas');
    canvas.width = result.width;
    canvas.height = result.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');
    // Flatten onto white: the fan raster is transparent outside the sector,
    // and a PDF or print proof should not carry an alpha channel.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(result.buffer), result.width, result.height), 0, 0,
    );

    onProgress?.('Encoding…');
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('PNG encoding failed');
    const dataUrl = await blobToDataUrl(blob);

    return {
      blob, dataUrl, transform: result.transform,
      widthPx: result.width, heightPx: result.height, ms: result.ms,
    };
  } finally {
    worker.terminate();
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error('could not read blob'));
    fr.readAsDataURL(blob);
  });
}

/* -------------------------------------------------------------------------- */
/* PDF                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Fan PDF at the requested dpi, page sized to the blank in true millimetres.
 *
 * HONEST LIMITS: this is an RGB PDF carrying a high-resolution raster. It is
 * NOT PDF/X - there is no CMYK conversion, no output intent and no embedded
 * ICC profile, because a browser cannot produce those. It is suitable as a
 * proof and for printers who accept high-res RGB; a true PDF/X-1a needs the
 * server-side Ghostscript pipeline (M8).
 */
export async function exportFanPdf(
  profile: CupProfile,
  geom: FrustumGeometry,
  designCanvas: HTMLCanvasElement,
  dpi: number,
  vRange?: DesignVRange,
  onProgress?: (msg: string) => void,
): Promise<{ blob: Blob; widthPx: number; heightPx: number; dpi: number; ms: number }> {
  const r = await rasteriseFanOffThread(profile, designCanvas, dpi, vRange, onProgress);

  onProgress?.('Building PDF…');
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Cupco ${profile.displayName} production fan`);
  pdf.setSubject(
    `Fan blank ${r.transform.widthMm.toFixed(2)} x ${r.transform.heightMm.toFixed(2)} mm ` +
    `(to the bleed). Sector ${geom.sectorAngleDeg.toFixed(4)} deg, ` +
    `R_bottom ${geom.rBottomMm.toFixed(4)} mm, R_top ${geom.rTopMm.toFixed(4)} mm.`,
  );
  pdf.setProducer('Cupco Studio');
  pdf.setKeywords(['RGB', 'not PDF/X', `${dpi}dpi`]);

  const pageW = r.transform.widthMm * PT_PER_MM;
  const pageH = r.transform.heightMm * PT_PER_MM;
  const page = pdf.addPage([pageW, pageH]);

  const png = await pdf.embedPng(await r.blob.arrayBuffer());
  page.drawImage(png, { x: 0, y: 0, width: pageW, height: pageH });

  const bytes = await pdf.save();
  // Copy into a fresh ArrayBuffer so the Blob is not backed by a typed-array
  // view that TypeScript treats as possibly-shared.
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return {
    blob: new Blob([buf], { type: 'application/pdf' }),
    widthPx: r.widthPx, heightPx: r.heightPx, dpi, ms: r.ms,
  };
}

/* -------------------------------------------------------------------------- */
/* SVG                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Fan SVG at true millimetre scale.
 *
 * The dieline is real vector geometry. The artwork is an embedded raster,
 * because warping arbitrary uploaded images onto a cone cannot be expressed as
 * SVG path data - the honest options are an embedded raster now, or per-path
 * adaptive subdivision later (planned, and only possible for vector sources).
 */
export async function exportFanSvg(
  profile: CupProfile,
  geom: FrustumGeometry,
  designCanvas: HTMLCanvasElement,
  dpi: number,
  vRange?: DesignVRange,
  onProgress?: (msg: string) => void,
): Promise<{ blob: Blob; widthPx: number; heightPx: number; ms: number }> {
  const r = await rasteriseFanOffThread(profile, designCanvas, dpi, vRange, onProgress);
  onProgress?.('Building SVG…');

  const t = r.transform;
  const W = t.widthMm, H = t.heightMm;
  // Fan-space mm -> SVG user units (also mm), offset so the artwork aligns
  // with the embedded raster exactly.
  const tx = -t.originXMm, ty = -t.originYMm;

  const path = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(4)} ${p.y.toFixed(4)}`).join(' ') + ' Z';

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Cupco Studio production fan - ${profile.displayName}
     1:1 millimetres. Artwork raster ${r.widthPx}x${r.heightPx}px at ${dpi}dpi.
     sector ${geom.sectorAngleDeg.toFixed(4)}deg  R_bot ${geom.rBottomMm.toFixed(4)}mm  R_top ${geom.rTopMm.toFixed(4)}mm
     RGB - not PDF/X, no CMYK conversion or output intent. -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${W.toFixed(3)}mm" height="${H.toFixed(3)}mm"
     viewBox="0 0 ${W.toFixed(4)} ${H.toFixed(4)}">
  <g id="artwork">
    <image x="0" y="0" width="${W.toFixed(4)}" height="${H.toFixed(4)}"
           xlink:href="${r.dataUrl}" />
  </g>
  <g id="dieline" transform="translate(${tx.toFixed(4)} ${ty.toFixed(4)})" fill="none">
    <path id="bleed" d="${path(buildFanOutline(profile, geom, 'bleed', 512).points)}" stroke="#f472b6" stroke-width="0.25" stroke-dasharray="2 1"/>
    <path id="cut" d="${path(buildFanOutline(profile, geom, 'cut', 512).points)}" stroke="#db2777" stroke-width="0.4"/>
    <path id="safe" d="${path(buildFanOutline(profile, geom, 'safe', 512).points)}" stroke="#0284c7" stroke-width="0.25" stroke-dasharray="1 1"/>
  </g>
</svg>`;

  return {
    blob: new Blob([svg], { type: 'image/svg+xml' }),
    widthPx: r.widthPx, heightPx: r.heightPx, ms: r.ms,
  };
}
