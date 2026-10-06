import { describe, it, expect } from 'vitest';
import {
  normaliseArtwork, refitArtwork, rasterPlacement, placeArtwork, artworkBounds,
  type PlacedArtwork,
} from '../src/place';
import { dropBackgroundPlate } from '../src/transform';
import { importSvg, type ImportedRaster, type ImportedShape } from '../src/svg-import';
import { compareRenders } from '../src/fidelity';

const PX = 'data:image/png;base64,iVBORw0KGgo=';

const square = (x: number, y: number, w: number, h: number, fill: [number, number, number] = [0, 0, 0]): ImportedShape => ({
  subpaths: [{ closed: true, points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] }],
  fill, opacity: 1, fillRule: 'nonzero',
});

const raster = (matrix: ImportedRaster['matrix'], before: number, clip: ImportedRaster['clip'] = null): ImportedRaster => ({
  href: PX, mime: 'image/png', matrix, naturalWidth: 40, naturalHeight: 20, opacity: 1, clip, before,
});

const at = (m: readonly number[], x: number, y: number) => ({ x: m[0]! * x + m[2]! * y + m[4]!, y: m[1]! * x + m[3]! * y + m[5]! });

describe('normaliseArtwork with embedded images', () => {
  it('fits the box to the image as well as the shapes', () => {
    // A 10x10 mark at the origin, and a 40x20 photo to its right. Fitting to
    // the shapes alone would crop the photo out of the logo entirely.
    const art = normaliseArtwork([square(0, 0, 10, 10)], [raster([40, 0, 0, 20, 20, 0], 1)]);
    expect(art.aspect).toBeCloseTo(20 / 60, 9);
    const r = art.rasters![0]!;
    // The photo's corners land where they were, in unit-box terms.
    expect(at(r.matrix, 0, 0)).toEqual({ x: 20 / 60, y: 0 });
    const far = at(r.matrix, 1, 1);
    expect(far.x).toBeCloseTo(1, 12);
    expect(far.y).toBeCloseTo(1, 12);
  });

  it('measures a clipped image by what shows, not by the whole picture', () => {
    // A 100x100 photo clipped to its top-left 10x10.
    const clip = [{ closed: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }];
    const art = normaliseArtwork([], [raster([100, 0, 0, 100, 0, 0], 0, clip)]);
    expect(art.aspect).toBeCloseTo(1, 9);
    expect(artworkBounds(art)).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
    // The clip comes through in unit-box units too.
    expect(art.rasters![0]!.clip![0]![2]).toEqual({ x: 1, y: 1 });
  });

  it('leaves artwork without images exactly as it was', () => {
    const art = normaliseArtwork([square(0, 0, 10, 5)]);
    expect('rasters' in art).toBe(false);
  });
});

describe('dropping a plate keeps images in their place', () => {
  it('moves each image down one in the painting order', () => {
    // A white plate, a photo over it, and a mark over the photo.
    const art = normaliseArtwork(
      [square(0, 0, 100, 100, [255, 255, 255]), square(40, 40, 20, 20)],
      [raster([80, 0, 0, 80, 10, 10], 1)],
    );
    const dropped = dropBackgroundPlate(art);
    expect(dropped.shapes).toHaveLength(1);
    // Still painted before the mark, which is now shapes[0].
    expect(dropped.rasters![0]!.before).toBe(0);
  });

  it('counts an image as content, so the plate behind a lone photo comes off', () => {
    const art = normaliseArtwork(
      [square(0, 0, 100, 100, [255, 255, 255])],
      [raster([80, 0, 0, 80, 10, 10], 1)],
    );
    expect(dropBackgroundPlate(art).shapes).toHaveLength(0);
  });

  it('refits to the content that is left, at its real proportions', () => {
    const art = normaliseArtwork(
      [square(0, 0, 100, 100, [255, 255, 255]), square(10, 40, 80, 20)],
    );
    const fitted = refitArtwork(dropBackgroundPlate(art));
    expect(fitted.aspect).toBeCloseTo(20 / 80, 9);
    expect(artworkBounds(fitted)).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
  });
});

describe('rasterPlacement', () => {
  it('lands an image exactly where the same placement puts the shapes', () => {
    // The image covers the same square as a shape: placed with the same
    // transform, the two must agree corner for corner - rotation included -
    // or the photo in an exported badge drifts off its frame.
    const art: PlacedArtwork = {
      aspect: 0.5,
      shapes: [{ subpaths: [[{ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }, { x: 0.75, y: 1 }, { x: 0.25, y: 1 }]], fill: [0, 0, 0], opacity: 1 }],
      rasters: [{ href: PX, mime: 'image/png', matrix: [0.5, 0, 0, 0.5, 0.25, 0.5], naturalWidth: 4, naturalHeight: 4, opacity: 1, before: 0 }],
    };
    const t = { u: 0.3, v: 0.6, widthU: 0.2, rotation: 33, canvasW: 2000, canvasH: 900, stretchV: 1.4 };
    const shape = placeArtwork(art, t)[0]!.subpaths[0]!;
    const m = rasterPlacement(art.rasters![0]!, art, t);
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => at(m, x!, y!));
    corners.forEach((c, i) => {
      expect(c.x).toBeCloseTo(shape[i]!.u, 12);
      expect(c.y).toBeCloseTo(shape[i]!.v, 12);
    });
  });
});

describe('the intrinsic viewport', () => {
  it('maps the viewBox into the width and height a browser would use', () => {
    const r = importSvg('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="10 10 50 50"><rect x="10" y="10" width="5" height="5"/></svg>');
    expect(r.viewport.width).toBe(200);
    expect(r.viewport.height).toBe(100);
    // Document units start at the viewBox corner; meet scaling centres it.
    const o = at(r.viewport.matrix, 0, 0);
    expect(o.x).toBeCloseTo(50, 9);
    expect(o.y).toBeCloseTo(0, 9);
  });

  it('derives the missing dimension from the viewBox', () => {
    const r = importSvg('<svg xmlns="http://www.w3.org/2000/svg" width="300" viewBox="0 0 100 50"><rect width="5" height="5"/></svg>');
    expect(r.viewport.width).toBe(300);
    expect(r.viewport.height).toBe(150);
  });

  it('is the viewBox itself when no size is given', () => {
    const r = importSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32"><rect width="5" height="5"/></svg>');
    expect(r.viewport).toEqual({ width: 64, height: 32, matrix: [1, 0, 0, 1, 0, 0] });
  });
});

describe('fonts as the operator reads them', () => {
  // A resolver with a single upright face, recording what it was asked for.
  const glyph = {
    advanceWidth: 600, index: 1,
    getPath: (x: number, y: number) => ({ commands: [
      { type: 'M', x, y }, { type: 'L', x: x + 6, y }, { type: 'L', x: x + 6, y: y - 10 }, { type: 'L', x, y: y - 10 }, { type: 'Z' },
    ] }),
  };
  const font = { unitsPerEm: 1000, ascender: 800, descender: -200, charToGlyph: () => glyph };
  const asked: { families: readonly string[]; weight: number; italic: boolean }[] = [];
  const fonts = {
    resolve(families: readonly string[], weight: number, italic: boolean) {
      asked.push({ families, weight, italic });
      return { font, family: 'Inter Bold', exact: false, ...(italic ? { skewX: 0.25 } : {}) };
    },
  };

  it('names a PostScript face the way a designer would', () => {
    const r = importSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text x="5" y="30" font-family="Montserrat-BoldItalic" font-size="20">A</text></svg>', { fonts });
    expect(r.fonts[0]!.requested).toBe('Montserrat Bold Italic');
    expect(asked.at(-1)).toMatchObject({ weight: 700, italic: true });
    expect(asked.at(-1)!.families).toContain('Montserrat');
    expect(r.warnings.join(' ')).toMatch(/"Inter Bold" — "Montserrat Bold Italic" is not available/);
  });

  it('does not read a style into a family that merely ends in one', () => {
    importSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text x="5" y="30" font-family="Facebook" font-size="20">A</text></svg>', { fonts });
    expect(asked.at(-1)).toMatchObject({ families: ['Facebook'], weight: 400, italic: false });
  });

  it('slants an upright face when italic was asked for', () => {
    const upright = importSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text x="5" y="30" font-size="20">A</text></svg>', { fonts });
    const slanted = importSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text x="5" y="30" font-size="20" font-style="italic">A</text></svg>', { fonts });
    const top = (r: typeof upright) => r.shapes[0]!.subpaths[0]!.points.filter((p) => p.y < 25).map((p) => p.x);
    // The baseline stays put; the top of the glyph leans right by height x 0.25.
    expect(Math.min(...top(slanted)) - Math.min(...top(upright))).toBeCloseTo(0.25 * (20 * 10 / 20), 6);
  });
});

describe('compareRenders', () => {
  const img = (w: number, h: number, paint: (x: number, y: number) => [number, number, number]) => {
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      data.set([r, g, b, 255], (y * w + x) * 4);
    }
    return { width: w, height: h, data };
  };
  const grey = (): [number, number, number] => [128, 128, 128];

  it('scores identical renders as identical', () => {
    const a = img(20, 20, (x) => (x < 10 ? [0, 0, 0] : grey()));
    expect(compareRenders(a, a).fraction).toBe(0);
  });

  it('forgives an edge moved by a pixel', () => {
    const a = img(20, 20, (x) => (x < 10 ? [0, 0, 0] : grey()));
    const b = img(20, 20, (x) => (x < 11 ? [0, 0, 0] : grey()));
    expect(compareRenders(a, b).fraction).toBe(0);
  });

  it('counts a missing half of the artwork against the artwork, not the page', () => {
    const a = img(40, 40, (x, y) => (x < 4 && y < 4 ? [0, 0, 0] : grey()));
    const b = img(40, 40, (x, y) => (x < 2 && y < 4 ? [0, 0, 0] : grey()));
    // 8 of 16 inked pixels are gone. A canvas-wide ratio would say 0.5%.
    const r = compareRenders(a, b);
    expect(r.fraction).toBeGreaterThan(0.2);
    expect(r.inked).toBe(16);
  });
});
