/** gifenc ships no types. Only the surface we actually use is declared. */
declare module 'gifenc' {
  export type Palette = number[][];
  export type PixelFormat = 'rgb565' | 'rgb444' | 'rgba4444';

  export function quantize(
    data: Uint8ClampedArray | Uint8Array,
    maxColors: number,
    options?: { format?: PixelFormat; oneBitAlpha?: boolean; clearAlpha?: boolean },
  ): Palette;

  export function applyPalette(
    data: Uint8ClampedArray | Uint8Array,
    palette: Palette,
    format?: PixelFormat,
  ): Uint8Array;

  export interface Encoder {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: { palette?: Palette; delay?: number; repeat?: number; transparent?: boolean },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  }
  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): Encoder;
}
