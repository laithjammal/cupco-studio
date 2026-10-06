/**
 * Checking an imported SVG against the original, in the browser that is open.
 *
 * Every importer bug so far reached the operator the same way: a logo arrived
 * looking wrong, and nothing on screen said so. The fidelity suite now catches
 * a whole class of these before release - but only for the files in its
 * corpus. This runs the same comparison on every file actually uploaded:
 * the browser draws the original, the app draws its reading of it, and the
 * two pictures are scored with the suite's own metric.
 *
 * So the operator is told, per logo, whether what they are placing is what
 * the file shows - and if it is not, they see where, and can place the file
 * as a picture instead.
 */

import { compareRenders, type SvgImportResult } from '@cupco/vector';
import { documentArtwork, type SvgReading } from './upload';
import { drawArtwork } from './artwork-draw';
import { fontFile } from './fonts';
import { whenLoaded } from './image-load';

export interface ImportCheck {
  /**
   * Fraction of the artwork that differs, 0..1. Null when this browser would
   * not let the original's pixels be read, which some do for SVG images.
   */
  difference: number | null;
  /** PNG data URLs: the original as this browser draws it, and the import. */
  original: string;
  imported: string;
  /** The original, greyed, with every differing pixel in red. */
  diff: string | null;
  width: number;
  height: number;
  /** True when live text was set in a face the file did not name. */
  substitutedText: boolean;
  /** Anything the operator should know about how the comparison was made. */
  caveat?: string;
}

const GREY = 128;

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/**
 * The file, set up to be measured against: the faces the importer set its
 * text in lent to the browser, and text drawn as plain outlines.
 *
 * An SVG drawn as an image cannot use the page's fonts, so without the loan
 * every logo with live text would be scored against the browser's fallback
 * face - and "differs" would mean nothing more than "the browser had no
 * Montserrat". Giving it the importer's faces under the file's own family
 * names means the check measures the import. The substitution itself is
 * reported separately.
 *
 * Outlines, because by default a browser HINTS small text - nudging stems
 * onto the pixel grid - which the printed cup never sees. Measured on a
 * yellow-on-green wordmark whose glyph positions agreed with Chrome's to a
 * hundredth of a pixel, hinting alone scored 2.2% different; drawn as
 * outlines, 0.7%.
 */
function referenceFor(svg: string, result: SvgImportResult): string {
  const rules: string[] = result.fonts.length ? ['text,tspan{text-rendering:geometricPrecision!important}'] : [];
  const seen = new Set<string>();
  for (const use of result.fonts) {
    if (!use.face || !use.family) continue;
    const k = `${use.family}|${use.face}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const file = fontFile(use.face);
    if (!file) continue;
    rules.push(`@font-face{font-family:"${use.family.replace(/["\\]/g, '')}";font-weight:${file.weight};`
      + `src:url(data:font/ttf;base64,${base64(file.bytes)}) format("truetype")}`);
  }
  if (!rules.length) return svg;
  const open = /<svg\b[^>]*>/i.exec(svg);
  if (!open) return svg;
  const at = open.index + open[0].length;
  return `${svg.slice(0, at)}<style><![CDATA[${rules.join('')}]]></style>${svg.slice(at)}`;
}

/**
 * The file without its <foreignObject> elements.
 *
 * Chrome will not let a page read back pixels from any SVG that contains
 * one - even one that never renders, like the PGF wrapper every older
 * Illustrator export carries inside a <switch>. Neither does the importer
 * draw what is inside them (it says so), so the comparison loses nothing it
 * could have measured.
 */
function withoutForeignObjects(svg: string): string {
  return svg
    .replace(/<foreignObject\b[^>]*\/>/gi, '')
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '');
}

function readable(ctx: CanvasRenderingContext2D): boolean {
  try {
    ctx.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false;
  }
}

const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

async function decodeSvg(svg: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
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

function canvasOf(w: number, h: number, ground?: string): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D context unavailable');
  if (ground) {
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, w, h);
  }
  return [c, ctx];
}

/** Draw an SVG image, giving its fonts a moment to arrive. */
async function drawSvg(svg: string, ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, ground?: string) {
  const img = await decodeSvg(svg);
  // Fonts inside an SVG image can finish loading just after it decodes. A
  // second draw a beat later is cheap insurance against scoring the fallback.
  const paint = () => {
    if (ground) {
      ctx.fillStyle = ground;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    } else {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
    ctx.drawImage(img, x, y, w, h);
  };
  paint();
  await new Promise((r) => setTimeout(r, 60));
  paint();
}

/**
 * Score an import against the original.
 *
 * Both are drawn at the file's own proportions, on the same mid-grey ground
 * the fidelity suite uses - so white artwork and dark artwork are equally
 * visible to the comparison.
 */
export async function checkImport(svgText: string, reading: SvgReading, longSide = 480): Promise<ImportCheck> {
  const result = reading.result;
  const vp = result.viewport;
  const k = longSide / Math.max(1e-9, vp.width, vp.height);
  const W = Math.max(1, Math.round(vp.width * k));
  const H = Math.max(1, Math.round(vp.height * k));
  const ground = `rgb(${GREY},${GREY},${GREY})`;

  let reference = referenceFor(svgText, result);
  let [orig, octx] = canvasOf(W, H, ground);
  await drawSvg(reference, octx, 0, 0, W, H, ground);
  let caveat: string | undefined;
  if (!readable(octx)) {
    const stripped = withoutForeignObjects(reference);
    if (stripped !== reference) {
      reference = stripped;
      [orig, octx] = canvasOf(W, H, ground);
      await drawSvg(reference, octx, 0, 0, W, H, ground);
      caveat = 'Compared without the file\'s embedded web content (<foreignObject>), which browsers will not let a page measure';
    }
  }

  const [ours, ctx] = canvasOf(W, H, ground);
  const sx = W / vp.width, sy = H / vp.height;
  const m = vp.matrix;
  drawArtwork(ctx, documentArtwork(result), [m[0] * sx, m[1] * sy, m[2] * sx, m[3] * sy, m[4] * sx, m[5] * sy]);

  let difference: number | null = null;
  let diff: string | null = null;
  try {
    const a = octx.getImageData(0, 0, W, H);
    const b = ctx.getImageData(0, 0, W, H);
    const cmp = compareRenders(a, b, { background: [GREY, GREY, GREY] });
    difference = cmp.fraction;
    const [dc, dctx] = canvasOf(W, H);
    const out = dctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      if (cmp.mask[i]) {
        out.data.set([220, 30, 30, 255], o);
      } else {
        const g = Math.round(((a.data[o]! + a.data[o + 1]! + a.data[o + 2]!) / 3) * 0.3 + 178);
        out.data.set([g, g, g, 255], o);
      }
    }
    dctx.putImageData(out, 0, 0);
    diff = dc.toDataURL('image/png');
  } catch {
    // The browser treats the drawn SVG as cross-origin. The pictures are
    // still shown side by side; only the number is unavailable.
  }

  return {
    difference, diff, width: W, height: H,
    // A canvas the browser will not read back cannot be exported either, so
    // the original is then shown as itself.
    original: readable(octx) ? orig.toDataURL('image/png') : svgDataUrl(reference),
    imported: ours.toDataURL('image/png'),
    substitutedText: result.fonts.some((f) => !f.exact),
    ...(caveat ? { caveat } : {}),
  };
}

/**
 * The original file as a picture, exactly as this browser draws it.
 *
 * The way out when an import is not right: placed as a bitmap it looks like
 * the file, at the cost of printing as pixels. Cropped to the same box the
 * vector version was fitted to, so swapping one for the other leaves the
 * logo the same size in the same place.
 */
export async function pictureOfOriginal(
  svgText: string,
  reading: SvgReading,
  longSide = 3000,
): Promise<{ image: HTMLImageElement; bytes: Uint8Array }> {
  const vp = reading.result.viewport;
  const m = vp.matrix;
  const b = reading.box;
  const corner = (x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
  const p = corner(b.x, b.y), q = corner(b.x + b.w, b.y + b.h);
  const x0 = Math.min(p.x, q.x), y0 = Math.min(p.y, q.y);
  const bw = Math.max(1e-9, Math.abs(q.x - p.x)), bh = Math.max(1e-9, Math.abs(q.y - p.y));
  const k = longSide / Math.max(bw, bh);
  const size = [Math.max(1, Math.round(bw * k)), Math.max(1, Math.round(bh * k))] as const;
  // A destination rectangle rather than a transform: browsers rasterise an
  // SVG image at the size it is drawn, so this is sharp at any scale.
  const lent = referenceFor(svgText, reading.result);
  let [c, ctx] = canvasOf(...size);
  await drawSvg(lent, ctx, -x0 * k, -y0 * k, vp.width * k, vp.height * k);
  if (!readable(ctx)) {
    [c, ctx] = canvasOf(...size);
    await drawSvg(withoutForeignObjects(lent), ctx, -x0 * k, -y0 * k, vp.width * k, vp.height * k);
    if (!readable(ctx)) throw new Error('this browser will not turn this file into a picture');
  }
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  if (!blob) throw new Error('could not encode the picture');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const url = URL.createObjectURL(blob);
  const image = new Image();
  const loaded = whenLoaded(image);
  image.src = url;
  try {
    await loaded;
  } finally {
    URL.revokeObjectURL(url);
  }
  return { image, bytes };
}

/* -------------------------------------------------------------------------- */
/* Reports, per original file                                                  */
/* -------------------------------------------------------------------------- */

/** Everything the operator is shown about one uploaded file. */
export interface ImportReport {
  svgText: string;
  reading: SvgReading;
  /** Null when the comparison itself could not run. */
  check: ImportCheck | null;
}

const reports = new Map<string, Promise<ImportReport>>();

/**
 * The report for an original file, computed once and kept.
 *
 * Keyed by the file's asset id, which is its content hash - so the same
 * logo placed five times, or pasted, or carried into a concept, is checked
 * once. `seed` hands over a reading an upload already made.
 */
export function importReport(
  assetId: string,
  load: () => Promise<string | null>,
  read: (text: string) => Promise<SvgReading>,
  seed?: { text: string; reading: SvgReading },
): Promise<ImportReport> {
  const hit = reports.get(assetId);
  if (hit) return hit;
  const job = (async () => {
    const svgText = seed?.text ?? await load();
    if (svgText === null) throw new Error('the original file is missing from storage');
    const reading = seed?.reading ?? await read(svgText);
    let check: ImportCheck | null = null;
    try {
      check = await checkImport(svgText, reading);
    } catch {
      check = null;
    }
    return { svgText, reading, check };
  })();
  // A failure is not kept, so opening the panel again tries again.
  job.catch(() => reports.delete(assetId));
  reports.set(assetId, job);
  return job;
}

/** How the check reads, for the operator: a tone and a sentence. */
export function verdict(check: ImportCheck | null): { tone: 'ok' | 'warn' | 'err'; text: string } {
  if (!check) return { tone: 'warn', text: 'Could not compare with the original in this browser' };
  if (check.difference === null) {
    return { tone: 'warn', text: 'This browser will not let the two be measured — compare them by eye below' };
  }
  const pct = check.difference * 100;
  const shown = pct < 0.1 ? '<0.1' : pct < 10 ? pct.toFixed(1) : pct.toFixed(0);
  if (pct < 1) return { tone: 'ok', text: `Matches the original file (${shown}% differs)` };
  if (pct < 4) return { tone: 'warn', text: `Close to the original — ${shown}% of the artwork differs` };
  return { tone: 'err', text: `Differs from the original — ${shown}% of the artwork` };
}
