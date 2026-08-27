/**
 * Turntable GIF: the cup rotating a full 360 with the design on it.
 *
 * ---------------------------------------------------------------------------
 * WHY A SHARED PALETTE
 * ---------------------------------------------------------------------------
 * GIF allows only 256 colours. Quantising each frame independently is the
 * obvious approach and looks terrible on a turntable: every frame picks a
 * slightly different palette, so flat areas shimmer as the cup turns.
 *
 * Instead one palette is built from a sample spanning the whole rotation and
 * applied to every frame. Colours then stay put, and the only visible cost is
 * banding on the studio gradient — which is inherent to the format, not to
 * this implementation.
 */

import { GIFEncoder, quantize, applyPalette } from 'gifenc';

export interface TurntableFrame {
  /** Pinned to a plain ArrayBuffer so it can be handed to `new ImageData`. */
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

export interface EncodeOptions {
  /** Milliseconds per frame. */
  delayMs?: number;
  /** Maximum palette size, 2-256. */
  maxColors?: number;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Encode frames into an animated GIF.
 *
 * Runs synchronously per frame but yields to the event loop between frames, so
 * a long encode does not freeze the UI or block the progress indicator.
 */
export async function encodeGif(
  frames: readonly TurntableFrame[],
  options: EncodeOptions = {},
): Promise<Blob> {
  if (frames.length === 0) throw new Error('no frames to encode');

  const delay = options.delayMs ?? 55;
  const maxColors = Math.max(2, Math.min(256, options.maxColors ?? 256));
  const { width, height } = frames[0]!;

  // Build one palette from pixels sampled across the whole rotation.
  //
  // The sample must span the ENTIRE frame. An earlier version capped the
  // number of samples per frame while stepping by a pixel stride, which meant
  // it only ever read the first few percent of each image - the empty backdrop
  // above the cup. The resulting palette was almost entirely pale grey, so
  // every green pixel quantised to the nearest available colour and the cup
  // came out as a washed-out ghost.
  const pixelsPerFrame = width * height;

  // Sampling a handful of frames spread across the turn is enough: the cup is
  // the same object at every angle, so more frames add cost, not colours.
  const SAMPLE_FRAMES = Math.min(frames.length, 8);
  const frameStep = Math.max(1, Math.floor(frames.length / SAMPLE_FRAMES));
  const chosen: TurntableFrame[] = [];
  for (let i = 0; i < frames.length && chosen.length < SAMPLE_FRAMES; i += frameStep) {
    chosen.push(frames[i]!);
  }

  const TARGET_SAMPLES = 48_000;
  const perFrame = Math.max(1, Math.ceil(TARGET_SAMPLES / chosen.length));
  const pixelStride = Math.max(1, Math.floor(pixelsPerFrame / perFrame));

  const sample = new Uint8ClampedArray(
    Math.ceil(pixelsPerFrame / pixelStride) * chosen.length * 4,
  );
  let w = 0;
  for (const f of chosen) {
    for (let px = 0; px < pixelsPerFrame; px += pixelStride) {
      const i = px * 4;
      sample[w++] = f.data[i]!;
      sample[w++] = f.data[i + 1]!;
      sample[w++] = f.data[i + 2]!;
      sample[w++] = 255;
    }
  }
  const palette = quantize(sample.subarray(0, w), maxColors, { format: 'rgb565' });

  const gif = GIFEncoder();
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!;
    const index = applyPalette(f.data, palette, 'rgb565');
    gif.writeFrame(index, f.width, f.height, {
      // The palette is supplied on EVERY frame. Passing it only on the first
      // and relying on the global colour table produced a file that decoders
      // rendered as a single static frame; being explicit costs a little size
      // and removes the ambiguity entirely.
      palette,
      delay,
      // Netscape looping extension — written with the first frame.
      ...(i === 0 ? { repeat: 0 } : {}),
    });
    options.onProgress?.(i + 1, frames.length);
    // Yield so the browser can paint progress.
    if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
  }
  gif.finish();

  const bytes = gif.bytes();
  const buf = new ArrayBuffer(bytes.length);
  new Uint8Array(buf).set(bytes);
  return new Blob([buf], { type: 'image/gif' });
}

/** Signature the 3D view exposes so the page can drive a capture. */
export type CaptureTurntable = (
  frames: number,
  maxWidth: number,
  onProgress?: (done: number, total: number) => void,
) => Promise<TurntableFrame[]>;

/* -------------------------------------------------------------------------- */
/* Video                                                                       */
/* -------------------------------------------------------------------------- */

export interface VideoResult {
  blob: Blob;
  mimeType: string;
  extension: string;
  width: number;
  height: number;
  durationMs: number;
}

export type RecordTurntable = (
  durationMs: number,
  fps: number,
  onProgress?: (fraction: number) => void,
) => Promise<VideoResult>;

/**
 * Pick the best container the browser can actually produce.
 *
 * MP4/H.264 is strongly preferred: it plays in QuickTime, Preview, Keynote,
 * PowerPoint and every messaging app without a plugin. WebM is the fallback —
 * fine in browsers, but macOS will not open it natively, which would recreate
 * exactly the "it won't play" problem this export exists to solve.
 */
export function pickVideoMime(): { mimeType: string; extension: string } | null {
  const candidates: { mimeType: string; extension: string }[] = [
    { mimeType: 'video/mp4;codecs=avc1.42E01E', extension: 'mp4' },
    { mimeType: 'video/mp4;codecs=avc1', extension: 'mp4' },
    { mimeType: 'video/mp4', extension: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c.mimeType)) return c;
  }
  return null;
}

export const VIDEO_PRESETS = [
  { id: 'quick', label: 'Quick — 3s, 30fps', durationMs: 3000, fps: 30 },
  { id: 'standard', label: 'Standard — 5s, 30fps', durationMs: 5000, fps: 30 },
  { id: 'smooth', label: 'Smooth — 7s, 60fps', durationMs: 7000, fps: 60 },
] as const;

export type VideoPresetId = (typeof VIDEO_PRESETS)[number]['id'];

export const TURNTABLE_PRESETS = [
  { id: 'small', label: 'Small — 360px, 24 frames', width: 360, frames: 24, delayMs: 70 },
  { id: 'medium', label: 'Medium — 480px, 36 frames', width: 480, frames: 36, delayMs: 55 },
  { id: 'large', label: 'Large — 640px, 48 frames', width: 640, frames: 48, delayMs: 45 },
] as const;

export type TurntablePresetId = (typeof TURNTABLE_PRESETS)[number]['id'];
