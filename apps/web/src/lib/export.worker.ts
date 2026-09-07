/**
 * Off-main-thread fan export.
 *
 * A 300dpi 8oz fan is ~3.9 megapixels and takes several seconds to resample
 * with 4 samples per pixel. Doing that on the main thread freezes the tab -
 * including the "Rendering..." indicator meant to reassure the user - so the
 * work runs here instead.
 *
 * The rasteriser is pure and operates on plain typed arrays, so it moves to a
 * worker with no changes: the same function produces the same bytes, which is
 * the point of keeping @cupco/render dependency-free.
 */
import { deriveFrustum, type CupProfile } from '@cupco/geometry';
import { rasteriseFan, type FanRasterTransform } from '@cupco/render';

export interface ExportRequest {
  profile: CupProfile;
  width: number;
  height: number;
  buffer: ArrayBuffer;
  dpi: number;
  supersample: number;
  /**
   * Design-space v the artwork buffer's bottom and top rows carry.
   * Omitted means 0..1 - the buffer covers exactly the cup wall.
   */
  designVBottom?: number;
  designVTop?: number;
}

export interface ExportResponse {
  ok: true;
  buffer: ArrayBuffer;
  width: number;
  height: number;
  transform: FanRasterTransform;
  ms: number;
}

export interface ExportError {
  ok: false;
  message: string;
}

self.onmessage = (e: MessageEvent<ExportRequest>) => {
  const t0 = performance.now();
  try {
    const { profile, width, height, buffer, dpi, supersample,
            designVBottom, designVTop } = e.data;
    const geom = deriveFrustum(profile.dimensions);

    const { image, transform } = rasteriseFan(
      { width, height, data: new Uint8ClampedArray(buffer) },
      profile,
      geom,
      { dpi, boundary: 'bleed', supersample, designVBottom, designVTop },
    );

    const res: ExportResponse = {
      ok: true,
      buffer: image.data.buffer,
      width: image.width,
      height: image.height,
      transform,
      ms: Math.round(performance.now() - t0),
    };
    // Transfer rather than copy - a 3.9MP RGBA buffer is ~15MB.
    (self as unknown as Worker).postMessage(res, [res.buffer]);
  } catch (err) {
    const res: ExportError = { ok: false, message: (err as Error).message };
    (self as unknown as Worker).postMessage(res);
  }
};
