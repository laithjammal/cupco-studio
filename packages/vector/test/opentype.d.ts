/** Test-only: opentype.js ships no types. Only what the fidelity harness uses. */
declare module 'opentype.js' {
  export interface PathCommand {
    type: string;
    x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number;
  }
  export interface Glyph {
    advanceWidth?: number;
    getPath(x: number, y: number, fontSize: number): { commands: PathCommand[] };
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
  const opentype: { parse(buffer: ArrayBuffer): Font };
  export default opentype;
}
