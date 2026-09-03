import { describe, it, expect } from 'vitest';
import {
  rgbToCmyk, cmykToRgb, totalInkPct, extractPalette, matchPalette, hexToRgb, rgbToHex,
  parsePathCommands, flattenPathData, importSvg, normaliseArtwork, placeArtwork,
  dropBackgroundPlate, hasBackgroundPlate, recolourArtwork,
  type RGB,
} from '../src/index';

describe('RGB -> CMYK', () => {
  it('pure black becomes K only, never four-colour black', () => {
    // Four-colour black would show colour fringing on small text.
    const k = rgbToCmyk([0, 0, 0]);
    expect(k).toEqual({ c: 0, m: 0, y: 0, k: 1 });
  });

  it('white is no ink at all', () => {
    expect(rgbToCmyk([255, 255, 255])).toEqual({ c: 0, m: 0, y: 0, k: 0 });
  });

  it.each([
    ['red', [255, 0, 0], { c: 0, m: 1, y: 1, k: 0 }],
    ['green', [0, 255, 0], { c: 1, m: 0, y: 1, k: 0 }],
    ['blue', [0, 0, 255], { c: 1, m: 1, y: 0, k: 0 }],
    ['cyan', [0, 255, 255], { c: 1, m: 0, y: 0, k: 0 }],
  ] as const)('%s converts to the expected primaries', (_n, rgb, want) => {
    const got = rgbToCmyk(rgb as never);
    expect(got.c).toBeCloseTo(want.c, 6);
    expect(got.m).toBeCloseTo(want.m, 6);
    expect(got.y).toBeCloseTo(want.y, 6);
    expect(got.k).toBeCloseTo(want.k, 6);
  });

  it('neutral greys use K alone (full GCR)', () => {
    for (const g of [32, 96, 160, 224]) {
      const v = rgbToCmyk([g, g, g]);
      expect(v.c).toBeCloseTo(0, 6);
      expect(v.m).toBeCloseTo(0, 6);
      expect(v.y).toBeCloseTo(0, 6);
      expect(v.k).toBeCloseTo(1 - g / 255, 6);
    }
  });

  it('total ink never exceeds 300%, so it is inside any digital press limit', () => {
    for (let r = 0; r <= 255; r += 17) {
      for (let g = 0; g <= 255; g += 17) {
        for (let b = 0; b <= 255; b += 17) {
          expect(totalInkPct(rgbToCmyk([r, g, b]))).toBeLessThanOrEqual(300.0001);
        }
      }
    }
  });

  it('round-trips back to the original RGB', () => {
    for (const c of [[10, 20, 30], [200, 100, 50], [255, 128, 0], [77, 77, 77]] as const) {
      const back = cmykToRgb(rgbToCmyk(c as never));
      expect(back[0]).toBeCloseTo(c[0], 0);
      expect(back[1]).toBeCloseTo(c[1], 0);
      expect(back[2]).toBeCloseTo(c[2], 0);
    }
  });

  it('hex helpers round-trip, including shorthand', () => {
    expect(rgbToHex([255, 0, 128])).toBe('#ff0080');
    expect(hexToRgb('#ff0080')).toEqual([255, 0, 128]);
    expect(hexToRgb('#f08')).toEqual([255, 0, 136]);
  });
});

describe('palette extraction', () => {
  it('merges near-duplicate colours from antialiased edges', () => {
    const p = extractPalette([
      { fill: [255, 0, 0] }, { fill: [252, 3, 1] }, { fill: [0, 0, 255] },
    ]);
    expect(p).toHaveLength(2);
  });

  it('keeps genuinely distinct colours apart', () => {
    const p = extractPalette([{ fill: [255, 0, 0] }, { fill: [0, 255, 0] }, { fill: [0, 0, 255] }]);
    expect(p).toHaveLength(3);
  });

  it('orders by coverage, heaviest first', () => {
    const p = extractPalette([
      { fill: [255, 0, 0], weight: 1 },
      { fill: [0, 0, 255], weight: 9 },
    ]);
    expect(p[0]!.rgb).toEqual([0, 0, 255]);
    expect(p[0]!.coverage).toBeCloseTo(0.9, 6);
  });

  it('entries start un-overridden with converted ink values', () => {
    const [e] = extractPalette([{ fill: [0, 0, 0] }]);
    expect(e!.overridden).toBe(false);
    expect(e!.cmyk.k).toBe(1);
  });

  it('matches a colour to its nearest entry', () => {
    const p = extractPalette([{ fill: [255, 0, 0] }, { fill: [0, 0, 255] }]);
    expect(matchPalette(p, [250, 10, 10])!.rgb).toEqual([255, 0, 0]);
  });
});

describe('path data parsing', () => {
  it('handles numbers run together without separators', () => {
    // "1-2" is two numbers; ".5.5" is two numbers. Real exporters emit these.
    const cmds = parsePathCommands('M1-2L.5.5');
    expect(cmds[0]!.args).toEqual([1, -2]);
    expect(cmds[1]!.args).toEqual([0.5, 0.5]);
  });

  it('handles exponent notation', () => {
    expect(parsePathCommands('M 1e2 -1.5e-2')[0]!.args).toEqual([100, -0.015]);
  });

  it('expands implicit repeated commands', () => {
    // "L 1 1 2 2" is two linetos, not one with four arguments.
    const sp = flattenPathData('M 0 0 L 1 1 2 2');
    expect(sp[0]!.points).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }]);
  });

  it('treats extra coordinates after M as implicit linetos', () => {
    const sp = flattenPathData('M 0 0 5 5');
    expect(sp[0]!.points).toHaveLength(2);
  });

  it('supports relative commands', () => {
    const sp = flattenPathData('M 10 10 l 5 0 l 0 5 z');
    const pts = sp[0]!.points;
    expect(pts[1]).toEqual({ x: 15, y: 10 });
    expect(pts[2]).toEqual({ x: 15, y: 15 });
    expect(sp[0]!.closed).toBe(true);
  });

  it('closes a subpath back to its start', () => {
    const sp = flattenPathData('M 0 0 L 10 0 L 10 10 Z');
    const pts = sp[0]!.points;
    expect(pts[pts.length - 1]).toEqual({ x: 0, y: 0 });
  });

  it('flattens cubic and quadratic curves', () => {
    expect(flattenPathData('M 0 0 C 0 10 10 10 10 0')[0]!.points.length).toBeGreaterThan(10);
    expect(flattenPathData('M 0 0 Q 5 10 10 0')[0]!.points.length).toBeGreaterThan(10);
  });

  it('reflects control points for smooth curves', () => {
    const sp = flattenPathData('M 0 0 C 0 5 5 5 5 0 S 10 -5 10 0');
    expect(sp[0]!.points.length).toBeGreaterThan(20);
    expect(sp[0]!.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  it('flattens elliptical arcs', () => {
    const sp = flattenPathData('M 0 0 A 10 10 0 0 1 20 0');
    expect(sp[0]!.points.length).toBeGreaterThan(5);
    const last = sp[0]!.points[sp[0]!.points.length - 1]!;
    expect(last.x).toBeCloseTo(20, 3);
    expect(last.y).toBeCloseTo(0, 3);
  });

  it('handles H and V', () => {
    const sp = flattenPathData('M 0 0 H 10 V 10');
    expect(sp[0]!.points).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
  });

  it('survives malformed input without throwing', () => {
    expect(() => flattenPathData('')).not.toThrow();
    expect(() => flattenPathData('M')).not.toThrow();
    expect(() => flattenPathData('garbage')).not.toThrow();
    expect(() => flattenPathData('M 0 0 L')).not.toThrow();
  });
});

describe('SVG import', () => {
  const svg = (body: string, attrs = 'viewBox="0 0 100 50"') =>
    `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

  it('reads a filled path and its colour', () => {
    const r = importSvg(svg('<path d="M0 0 L10 0 L10 10 Z" fill="#ff0000"/>'));
    expect(r.shapes).toHaveLength(1);
    expect(r.shapes[0]!.fill).toEqual([255, 0, 0]);
    expect(r.width).toBe(100);
    expect(r.height).toBe(50);
  });

  it('reads fill from a style attribute', () => {
    const r = importSvg(svg('<path d="M0 0 L10 0 L10 10 Z" style="fill:#00ff00"/>'));
    expect(r.shapes[0]!.fill).toEqual([0, 255, 0]);
  });

  it('supports rect, circle, ellipse, polygon and line', () => {
    const r = importSvg(svg(
      '<rect x="0" y="0" width="10" height="10" fill="#111"/>' +
      '<circle cx="20" cy="20" r="5" fill="#222"/>' +
      '<ellipse cx="40" cy="20" rx="6" ry="3" fill="#333"/>' +
      '<polygon points="0,0 5,0 5,5" fill="#444"/>' +
      '<line x1="0" y1="0" x2="9" y2="9" fill="#555"/>',
    ));
    expect(r.shapes).toHaveLength(5);
  });

  it('applies transforms, including nested group transforms', () => {
    const r = importSvg(svg('<g transform="translate(10 20)"><rect x="0" y="0" width="5" height="5" fill="#000"/></g>'));
    expect(r.shapes[0]!.subpaths[0]!.points[0]).toEqual({ x: 10, y: 20 });
  });

  it('composes translate with scale in the right order', () => {
    const r = importSvg(svg('<g transform="translate(10 0) scale(2)"><rect x="1" y="0" width="1" height="1" fill="#000"/></g>'));
    expect(r.shapes[0]!.subpaths[0]!.points[0]!.x).toBeCloseTo(12, 6);
  });

  it('offsets by the viewBox origin', () => {
    const r = importSvg(svg('<rect x="10" y="10" width="5" height="5" fill="#000"/>', 'viewBox="10 10 100 50"'));
    expect(r.shapes[0]!.subpaths[0]!.points[0]).toEqual({ x: 0, y: 0 });
  });

  it('inherits fill from a parent group', () => {
    const r = importSvg(svg('<g fill="#0000ff"><path d="M0 0 L5 0 L5 5 Z"/></g>'));
    expect(r.shapes[0]!.fill).toEqual([0, 0, 255]);
  });

  it('skips fill="none" rather than painting it black', () => {
    const r = importSvg(svg('<path d="M0 0 L5 0 L5 5 Z" fill="none"/>'));
    expect(r.shapes).toHaveLength(0);
  });

  it('ignores <defs> and warns about clip paths and masks', () => {
    const r = importSvg(svg('<defs><rect width="9" height="9" fill="#f00"/></defs><clipPath id="c"><rect width="1" height="1"/></clipPath>'));
    expect(r.shapes).toHaveLength(0);
    expect(r.warnings.join(' ')).toMatch(/clippath/i);
  });

  it('warns rather than silently dropping text', () => {
    const r = importSvg(svg('<text x="0" y="0">hello</text>'));
    expect(r.warnings.join(' ')).toMatch(/text/i);
  });

  it('warns when a gradient is flattened', () => {
    const r = importSvg(svg('<path d="M0 0 L5 0 L5 5 Z" fill="url(#grad)"/>'));
    expect(r.warnings.join(' ')).toMatch(/gradient/i);
    expect(r.shapes).toHaveLength(1); // kept, not dropped
  });

  it('ignores XML comments containing markup', () => {
    const r = importSvg(svg('<!-- <rect width="9" height="9" fill="#f00"/> --><rect width="5" height="5" fill="#000"/>'));
    expect(r.shapes).toHaveLength(1);
  });

  it('reports a useful error for non-SVG input', () => {
    const r = importSvg('not svg at all');
    expect(r.shapes).toHaveLength(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('normalise and place', () => {
  const imported = importSvg(
    '<svg viewBox="0 0 100 50"><rect x="20" y="10" width="40" height="20" fill="#f00"/></svg>',
  );

  it('normalises to a unit box using the ARTWORK bounds, not the canvas', () => {
    // Fitting to the canvas would make a logo with whitespace arrive tiny.
    const a = normaliseArtwork(imported.shapes);
    expect(a.aspect).toBeCloseTo(0.5, 6);
    const xs = a.shapes[0]!.subpaths[0]!.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(1, 6);
  });

  it('places artwork centred at the requested design coordinate', () => {
    const a = normaliseArtwork(imported.shapes);
    const placed = placeArtwork(a, { u: 0.5, v: 0.5, widthU: 0.2, rotation: 0, canvasW: 1000, canvasH: 500 });
    const us = placed[0]!.subpaths[0]!.map((p) => p.u);
    expect((Math.min(...us) + Math.max(...us)) / 2).toBeCloseTo(0.5, 6);
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(0.2, 6);
  });

  it('flips y: SVG points down, design space points up', () => {
    const a = normaliseArtwork(imported.shapes);
    const placed = placeArtwork(a, { u: 0.5, v: 0.5, widthU: 0.2, rotation: 0, canvasW: 1000, canvasH: 500 });
    const vs = placed[0]!.subpaths[0]!.map((p) => p.v);
    expect((Math.min(...vs) + Math.max(...vs)) / 2).toBeCloseTo(0.5, 6);
  });

  it('rotation preserves the centre', () => {
    const a = normaliseArtwork(imported.shapes);
    const placed = placeArtwork(a, { u: 0.5, v: 0.5, widthU: 0.2, rotation: 37, canvasW: 1000, canvasH: 500 });
    const us = placed[0]!.subpaths[0]!.map((p) => p.u);
    expect((Math.min(...us) + Math.max(...us)) / 2).toBeCloseTo(0.5, 4);
  });
});

describe('artwork transforms', () => {
  const plate = { subpaths: [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }]], fill: [255, 255, 255] as RGB, opacity: 1 };
  const mark = { subpaths: [[{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.5, y: 0.8 }]], fill: [20, 30, 80] as RGB, opacity: 1 };

  it('drops a full-bleed background plate', () => {
    // A white box behind a logo shows as an ugly rectangle on a coloured cup.
    const out = dropBackgroundPlate({ aspect: 1, shapes: [plate, mark] });
    expect(out.shapes).toHaveLength(1);
    expect(out.shapes[0]!.fill).toEqual([20, 30, 80]);
  });

  it('keeps a shape that merely happens to be large', () => {
    const big = { ...mark, subpaths: [[{ x: 0.02, y: 0.02 }, { x: 0.98, y: 0.5 }, { x: 0.5, y: 0.98 }]] };
    expect(dropBackgroundPlate({ aspect: 1, shapes: [big, mark] }).shapes).toHaveLength(2);
  });

  it('never removes the only shape', () => {
    expect(dropBackgroundPlate({ aspect: 1, shapes: [plate] }).shapes).toHaveLength(1);
  });

  it('reports whether a plate is present', () => {
    expect(hasBackgroundPlate({ aspect: 1, shapes: [plate, mark] })).toBe(true);
    expect(hasBackgroundPlate({ aspect: 1, shapes: [mark] })).toBe(false);
  });

  it('recolours without touching the original', () => {
    const src = { aspect: 1, shapes: [mark] };
    const out = recolourArtwork(src, () => [255, 255, 255]);
    expect(out.shapes[0]!.fill).toEqual([255, 255, 255]);
    expect(src.shapes[0]!.fill).toEqual([20, 30, 80]);
  });
});
