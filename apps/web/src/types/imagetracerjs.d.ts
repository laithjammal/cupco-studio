/**
 * imagetracerjs ships no types. Declaring only the one function we call keeps
 * the surface honest rather than blanket-`any`-ing the module.
 */
declare module 'imagetracerjs' {
  interface TracerOptions {
    numberofcolors?: number;
    ltres?: number;
    qtres?: number;
    pathomit?: number;
    blurradius?: number;
    strokewidth?: number;
    linefilter?: boolean;
    colorquantcycles?: number;
    [key: string]: number | boolean | undefined;
  }
  export function imagedataToSVG(
    imgd: { width: number; height: number; data: Uint8ClampedArray },
    options?: TracerOptions,
  ): string;
  const _default: { imagedataToSVG: typeof imagedataToSVG };
  export default _default;
}
