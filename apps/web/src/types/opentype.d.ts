/**
 * opentype.js ships no types. Declaring only what we use keeps the surface
 * honest rather than blanket-`any`-ing the module.
 */
declare module 'opentype.js' {
  export interface PathCommand {
    type: string;
    x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number;
  }
  export interface Path {
    commands: PathCommand[];
    toPathData(decimalPlaces?: number): string;
    getBoundingBox(): { x1: number; y1: number; x2: number; y2: number };
  }
  export interface Glyph {
    advanceWidth?: number;
    /** Glyph id, which is what kerning tables are keyed on. */
    index?: number;
    getPath(x: number, y: number, fontSize: number): Path;
  }
  export interface Font {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    charToGlyph(ch: string): Glyph;
    getKerningValue(left: Glyph, right: Glyph): number;
    tables: { os2?: { sxHeight?: number } };
  }
  export function parse(buffer: ArrayBuffer): Font;
}
