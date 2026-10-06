/**
 * Decoded pictures for the bitmaps embedded in vector artwork.
 *
 * Canvas drawing is synchronous and decoding is not. So pictures are decoded
 * AHEAD of drawing - when artwork arrives, from an upload or from storage -
 * and kept here, keyed by their data URL. A render that meets one still
 * decoding draws without it and is told when it is ready, so nothing blocks
 * and nothing stays missing.
 */

import { rgbToCmyk, simulateCmykPrint, type PlacedArtwork } from '@cupco/vector';
import { whenLoaded } from './image-load';

interface Entry {
  img: HTMLImageElement;
  ready: boolean;
  done: Promise<void>;
  /** The same picture as it will print, for the CMYK proof view. */
  proof?: HTMLCanvasElement;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

function entry(href: string): Entry {
  const hit = entries.get(href);
  if (hit) return hit;
  const img = new Image();
  img.decoding = 'async';
  const e: Entry = { img, ready: false, done: Promise.resolve() };
  // Listening before the source is set, so a cached image cannot load unseen.
  const loaded = whenLoaded(img);
  img.src = href;
  e.done = loaded.then(
    () => { e.ready = true; for (const fn of listeners) fn(); },
    // A picture that will not decode stays undrawn rather than breaking the
    // render; the import report has already said what the file contains.
    () => undefined,
  );
  entries.set(href, e);
  return e;
}

/** The decoded picture, or null while it is still on its way. */
export function decodedRaster(href: string): HTMLImageElement | null {
  const e = entry(href);
  return e.ready ? e.img : null;
}

/**
 * Decode every picture in some artwork. Resolves when all have settled - or
 * after `limitMs`, whichever is first: a picture that will not load must not
 * hold up opening a whole project. Anything still on its way is drawn when it
 * arrives, through onRasterReady.
 */
export async function preloadRasters(
  arts: readonly (PlacedArtwork | null | undefined)[],
  limitMs = 4000,
): Promise<void> {
  const pending: Promise<void>[] = [];
  for (const art of arts) for (const r of art?.rasters ?? []) pending.push(entry(r.href).done);
  if (!pending.length) return;
  await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, limitMs))]);
}

/** Be told when a picture finishes decoding. Returns the unsubscribe. */
export function onRasterReady(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * The picture as the press will print it, for the proof view.
 *
 * Every pixel goes through the same simulated ink conversion as the flat
 * colours around it - otherwise turning the proof on would dull the logo and
 * leave its photo glowing at screen gamut, which is the one comparison the
 * proof exists to make honestly.
 */
export function proofedRaster(href: string): HTMLCanvasElement | null {
  const e = entry(href);
  if (!e.ready) return null;
  if (e.proof) return e.proof;
  const c = document.createElement('canvas');
  c.width = e.img.naturalWidth;
  c.height = e.img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx || c.width === 0 || c.height === 0) return null;
  ctx.drawImage(e.img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  // Photos repeat colours constantly; converting each distinct one once is
  // most of the cost saved.
  const memo = new Map<number, number>();
  for (let i = 0; i < px.length; i += 4) {
    const key = (px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!;
    let out = memo.get(key);
    if (out === undefined) {
      const [r, g, b] = simulateCmykPrint(rgbToCmyk([px[i]!, px[i + 1]!, px[i + 2]!]));
      out = (r << 16) | (g << 8) | b;
      memo.set(key, out);
    }
    px[i] = (out >> 16) & 255;
    px[i + 1] = (out >> 8) & 255;
    px[i + 2] = out & 255;
  }
  ctx.putImageData(data, 0, 0);
  e.proof = c;
  return c;
}
