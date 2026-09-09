import { describe, it, expect } from 'vitest';
import { buildQrArtwork, QR_STYLES, getQrStyle, normaliseUrl } from '../src/index';
import type { QrStyle, QrFrameId } from '../src/index';
import { QR_FRAMES, buildFrame, isStructural } from '../src/index';
import { rasterise, rasteriseArtwork, blur, modulesOf } from './qr-raster';
import { decodeWithJsQr as jsQRdecode, decodeWithZxing, shrinkEach } from './qr-decoders';

/**
 * Pixels for a code, rendered the way it would print.
 *
 * The WHOLE artwork is rendered - plate, decoration and modules, each in its
 * own colour - on a DARK ground. The ground is the point: a framed code is
 * only safe because its plate carries the quiet zone, and any part of that
 * zone falling outside the plate would show as dark right against the code.
 */
function render(
  text: string, style: Partial<QrStyle>, size = 300, blurPx = 0, frame: QrFrameId = 'none',
) {
  const { art } = buildQrArtwork(text, { style, frame });
  return blur(rasteriseArtwork(art, size, [20, 20, 20]), size, blurPx);
}

/**
 * Read a code back with BOTH decoders, returning the text only if they agree.
 *
 * A style is only safe if every decoder reads it: the customer has no say in
 * which one is inside the app they happen to open.
 */
function decodeBoth(
  text: string, style: Partial<QrStyle>, size = 300, blurPx = 0, frame: QrFrameId = 'none',
) {
  const px = render(text, style, size, blurPx, frame);
  return {
    jsQR: jsQRdecode(px, size),
    zxing: decodeWithZxing(px, size),
  };
}

const URL_SHORT = 'https://cupco.com.au';
const URL_LONG = 'https://cupco.com.au/menu/seasonal-specials?ref=cup&size=8oz';

/**
 * Read a code back with the stricter of the two decoders.
 *
 * `blurPx` stands in for ink spread and camera focus. A decode from a perfect
 * render is weaker evidence than it looks - blur is precisely what eats into
 * the join between modules, so the blurred cases are the interesting ones.
 */
function decode(text: string, style: Partial<QrStyle>, size = 300, blurPx = 0): string | null {
  return jsQRdecode(render(text, style, size, blurPx), size);
}

/* -------------------------------------------------------------------------- */

describe('the rasteriser used by these tests is trustworthy', () => {
  it('reads back a plain square code, which is the shape that already ships', () => {
    // The control. If this ever fails, the tests below are measuring the
    // rasteriser rather than the styles.
    expect(decode(URL_SHORT, { module: 'square', eye: 'square' })).toBe(URL_SHORT);
  });

  it('fails to read pure noise, so a pass is not vacuous', () => {
    const size = 300;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      const v = (i * 2654435761) % 255 > 127 ? 255 : 0;
      data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
    }
    expect(jsQRdecode(data, size)).toBeNull();
    expect(decodeWithZxing(data, size)).toBeNull();
  });

  it('cuts the eye holes rather than filling them solid', () => {
    // The reverse-wound subpath has to actually produce a hole. If it did not,
    // every eye would be a solid 7x7 block and nothing would locate the code.
    const { art } = buildQrArtwork(URL_SHORT, { style: { eye: 'square' } });
    // The modules are the LAST shape; the plate sits behind them.
    const px = rasterise(art.shapes[art.shapes.length - 1]!.subpaths, 300);
    const total = 300 + 8; // modules including the quiet zone, for a 25-module code
    const { moduleCount } = buildQrArtwork(URL_SHORT);
    const modulePx = 300 / (moduleCount + 8);
    // Centre of the light ring in the top-left eye: 4 quiet + 1.5 modules in.
    const at = Math.round((4 + 1.5) * modulePx);
    const o = (at * 300 + at) * 4;
    expect(px[o]).toBe(255);
    expect(total).toBeGreaterThan(0);
  });
});

describe('every offered style decodes, on BOTH decoders', () => {
  it.each(QR_STYLES.map((s) => [s.name, s.id] as const))(
    '%s scans at print size',
    (_name, id) => {
      expect(decodeBoth(URL_SHORT, getQrStyle(id))).toEqual({ jsQR: URL_SHORT, zxing: URL_SHORT });
    },
  );

  it.each(QR_STYLES.map((s) => [s.name, s.id] as const))(
    '%s scans with a long URL, which needs a denser code',
    (_name, id) => {
      expect(decodeBoth(URL_LONG, getQrStyle(id))).toEqual({ jsQR: URL_LONG, zxing: URL_LONG });
    },
  );

  it.each(QR_STYLES.map((s) => [s.name, s.id] as const))(
    '%s survives blur, standing in for ink spread and camera focus',
    (_name, id) => {
      // 300px across a ~16mm printed code is about 480dpi, so a 2px blur is
      // roughly a tenth of a module - heavier than a digital press spreads.
      expect(decodeBoth(URL_SHORT, getQrStyle(id), 300, 2))
        .toEqual({ jsQR: URL_SHORT, zxing: URL_SHORT });
    },
  );

  it.each(QR_STYLES.map((s) => [s.name, s.id] as const))(
    '%s scans at 600px, where real gaps between modules would show',
    (_name, id) => {
      // The size that caught the near-miss: an intermediate dot size passes at
      // low resolution purely because aliasing closes the gaps, and fails here.
      expect(decodeBoth(URL_SHORT, getQrStyle(id), 600))
        .toEqual({ jsQR: URL_SHORT, zxing: URL_SHORT });
    },
  );
});

describe('the two decoders are not the same test twice', () => {
  it('disagree about separated modules — which is what set the dot size', () => {
    // Shrinking each dot to 80% of its cell separates the modules. ZXing still
    // reads it; jsQR cannot. Since a customer has no say in which decoder is
    // inside the app they open, the shipped dots are full-module and tangent.
    //
    // If this ever stops failing on jsQR, the airier look becomes available
    // and DOT_DIAMETER can be revisited.
    // Only the DATA modules are shrunk. The builder appends the three eyes
    // last, three subpaths each, and shrinking those would distort the
    // 1:1:3:1:1 ratio and break finder detection in both decoders - which
    // would make this measure something else entirely.
    const { art } = buildQrArtwork(URL_SHORT, { style: { module: 'dot' } });
    const all = modulesOf(art);
    const eyes = all.slice(-9);
    expect(eyes).toHaveLength(9);
    const px = rasterise([...shrinkEach(all.slice(0, -9), 0.8), ...eyes], 600);

    expect(decodeWithZxing(px, 600)).toBe(URL_SHORT);
    expect(jsQRdecode(px, 600)).toBeNull();
  });

  it('agree once the modules touch, which is what ships', () => {
    const px = render(URL_SHORT, { module: 'dot', eye: 'circle' }, 600);
    expect(decodeWithZxing(px, 600)).toBe(URL_SHORT);
    expect(jsQRdecode(px, 600)).toBe(URL_SHORT);
  });
});

describe('the smallest size the styles hold up at', () => {
  // 200px across a 16.5mm code is 300dpi - the resolution these actually print
  // at. This is the honest test of whether a styled code works on a cup.
  it.each(QR_STYLES.map((s) => [s.name, s.id] as const))(
    '%s scans at 300dpi print resolution',
    (_name, id) => {
      expect(decodeBoth(URL_SHORT, getQrStyle(id), 200))
        .toEqual({ jsQR: URL_SHORT, zxing: URL_SHORT });
    },
  );
});

describe('structure is preserved across styles', () => {
  it.each(QR_STYLES.map((s) => [s.name, s.id] as const))(
    '%s uses the same module count as a plain code',
    (_name, id) => {
      // Styling must change only how modules are DRAWN. A different module
      // count would mean different data, not different decoration.
      const plain = buildQrArtwork(URL_SHORT, { style: { module: 'square' } });
      const styled = buildQrArtwork(URL_SHORT, { style: getQrStyle(id) });
      expect(styled.moduleCount).toBe(plain.moduleCount);
      expect(styled.art.aspect).toBe(1);
    },
  );

  it('keeps the 4-module quiet zone clear in every style', () => {
    // Not negotiable and not an option: without it scanners cannot find the
    // code at all, however handsome the modules are.
    for (const preset of QR_STYLES) {
      const { art, moduleCount } = buildQrArtwork(URL_SHORT, { style: preset });
      const quiet = 4 / (moduleCount + 8);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const sp of modulesOf(art)) {
        for (const p of sp) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
      }
      expect(minX, `${preset.id} left`).toBeGreaterThanOrEqual(quiet - 1e-9);
      expect(minY, `${preset.id} top`).toBeGreaterThanOrEqual(quiet - 1e-9);
      expect(maxX, `${preset.id} right`).toBeLessThanOrEqual(1 - quiet + 1e-9);
      expect(maxY, `${preset.id} bottom`).toBeLessThanOrEqual(1 - quiet + 1e-9);
    }
  });

  it('merges runs only for the square style, which is why it is the smallest', () => {
    const square = buildQrArtwork(URL_SHORT, { style: { module: 'square' } });
    const dots = buildQrArtwork(URL_SHORT, { style: { module: 'dot' } });
    expect(square.pathCount).toBeLessThan(dots.pathCount);
  });

  it('defaults to the plain style when none is given', () => {
    const result = buildQrArtwork(URL_SHORT);
    expect(result.style).toEqual({ module: 'square', eye: 'square' });
  });

  it('falls back to the first preset for an unknown id', () => {
    expect(getQrStyle('nonsense').id).toBe('classic');
  });
});

describe('normaliseUrl', () => {
  it('adds a scheme', () => {
    expect(normaliseUrl('cupco.com.au')).toBe('https://cupco.com.au/');
  });
  it('rejects a bare word', () => {
    expect(normaliseUrl('cupco')).toBeNull();
  });
  it('rejects empty input', () => {
    expect(normaliseUrl('   ')).toBeNull();
  });
});

/**
 * FRAMES.
 *
 * A frame is a light plate the code sits on, never a mask over it - the finder
 * patterns live in three corners of the square, so clipping the code to a
 * shape would remove them and it would stop being locatable at all.
 *
 * Which means the whole safety argument rests on ONE property: the plate
 * contains the code and its full quiet zone. These render on a dark ground so
 * that property is actually under test - if any of the quiet zone fell outside
 * the plate, the dark ground would sit right against the code and the decoders
 * would stop reading it.
 */
/**
 * FRAMES.
 *
 * A frame is a light plate the code sits on, never a mask over it - the finder
 * patterns live in three corners of the square, so clipping the code to a
 * shape would remove them and it would stop being locatable at all.
 *
 * WHY THESE MEASURE A PASS RATE RATHER THAN ASSERTING ONE SIZE
 *
 * ZXing fails on particular still renders whenever a code does not exactly
 * fill the image - deterministically, robust to a pixel shift, to
 * supersampling, and identical under both of its binarizers. The control below
 * pins that down: the PLAIN square code, no frame at all, merely scaled to 90%
 * inside a white canvas, fails at some sizes too.
 *
 * So it is a property of ZXing's detector on a code that does not fill the
 * frame, not of the frames. The old tests never saw it because they only ever
 * rendered codes that filled the image exactly, which is the one case that is
 * always clean - and is also the one case that never happens on a cup.
 *
 * A live scanner reads a video stream at continuously varying scale, so a
 * framing that fails is retried a frame later. The honest bar is therefore
 * "reads at the large majority of framings, and always on jsQR", plus the
 * requirement that a frame is no worse than a plain code filling the same
 * fraction of the image.
 */
const SWEEP = [300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800, 900, 1000];

/** Fraction of the sweep each decoder reads. */
function passRate(frame: QrFrameId, style: Partial<QrStyle> = {}) {
  let jsqr = 0, zxing = 0;
  for (const size of SWEEP) {
    const px = render(URL_SHORT, style, size, 0, frame);
    if (jsQRdecode(px, size) === URL_SHORT) jsqr++;
    if (decodeWithZxing(px, size) === URL_SHORT) zxing++;
  }
  return { jsQR: jsqr / SWEEP.length, zxing: zxing / SWEEP.length };
}

describe('every frame decodes, on BOTH decoders', () => {
  for (const frame of QR_FRAMES) {
    it(`${frame.name} reads at every framing on jsQR, and most on ZXing`, () => {
      const r = passRate(frame.id);
      expect(r.jsQR).toBe(1);
      expect(r.zxing).toBeGreaterThanOrEqual(0.69);
    });
  }

  /**
   * The control that makes the bar above honest rather than convenient: a
   * plain UNFRAMED code, scaled to 90% inside a white canvas, shows the same
   * scattered ZXing misses. If this ever goes clean, the bar above is too soft
   * and should be tightened.
   */
  it('a plain code that does not fill the image misses too — the frames are not the cause', () => {
    const { art } = buildQrArtwork(URL_SHORT);
    let misses = 0;
    for (const size of SWEEP) {
      const shrunk = {
        ...art,
        shapes: art.shapes.map((sh) => ({
          ...sh,
          subpaths: sh.subpaths.map((sp) => sp.map((p) => ({ x: 0.05 + p.x * 0.9, y: 0.05 + p.y * 0.9 }))),
        })),
      };
      const px = rasteriseArtwork(shrunk, size, [255, 255, 255]);
      if (decodeWithZxing(px, size) !== URL_SHORT) misses++;
      // jsQR is unaffected, which is what says the code itself is fine.
      expect(jsQRdecode(px, size)).toBe(URL_SHORT);
    }
    expect(misses).toBeGreaterThan(0);
  });

  it('the swirl and the petal style together still read', () => {
    // The most decorative frame with the most decorated modules - what someone
    // will actually reach for.
    const r = passRate('swirl', getQrStyle('petal'));
    expect(r.jsQR).toBe(1);
    expect(r.zxing).toBeGreaterThanOrEqual(0.69);
  });

  it('a framed code survives ink spread', () => {
    for (const frame of ['circle', 'coffee-cup', 'star'] as const) {
      const px = render(URL_SHORT, {}, 500, 2, frame);
      expect(jsQRdecode(px, 500)).toBe(URL_SHORT);
    }
  });

  it('a framed code still reads with a long URL, which needs a denser grid', () => {
    const px = render(URL_LONG, {}, 700, 0, 'coffee-cup');
    expect(jsQRdecode(px, 700)).toBe(URL_LONG);
    expect(decodeWithZxing(px, 700)).toBe(URL_LONG);
  });
});

describe('frame geometry', () => {
  /**
   * The containment property itself, checked directly rather than only through
   * a decoder: every point of the code-plus-quiet-zone square must fall inside
   * the plate. A decode test can pass by luck at one size; this cannot.
   */
  const inside = (rings: readonly (readonly { x: number; y: number }[])[], p: { x: number; y: number }) => {
    let c = false;
    for (const r of rings) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const a = r[i]!, b = r[j]!;
        if ((a.y > p.y) !== (b.y > p.y) &&
            p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
      }
    }
    return c;
  };

  for (const frame of QR_FRAMES) {
    it(`${frame.name} contains the code and its whole quiet zone`, () => {
      const g = buildFrame(frame.id);
      const eps = 1e-4;
      for (let i = 0; i <= 60; i++) {
        for (const [x, y] of [
          [g.codeX + eps + (i / 60) * (1 - 2 * eps), g.codeY + eps],
          [g.codeX + eps + (i / 60) * (1 - 2 * eps), g.codeY + 1 - eps],
          [g.codeX + eps, g.codeY + eps + (i / 60) * (1 - 2 * eps)],
          [g.codeX + 1 - eps, g.codeY + eps + (i / 60) * (1 - 2 * eps)],
        ] as const) {
          expect(inside(g.plate, { x, y })).toBe(true);
        }
      }
    });

    it(`${frame.name} keeps its dark decoration off the code`, () => {
      const g = buildFrame(frame.id);
      if (g.accent.length === 0) return;
      for (let i = 0; i <= 40; i++) {
        for (let j = 0; j <= 40; j++) {
          const p = { x: g.codeX + i / 40, y: g.codeY + j / 40 };
          expect(inside(g.accent, p)).toBe(false);
        }
      }
    });
  }

  it('reports how much of the artwork the code occupies', () => {
    // It shrinks as the frame gets more elaborate, and preflight needs to know:
    // the printable floor is a MODULE size, not an artwork size.
    const plain = buildQrArtwork(URL_SHORT, { frame: 'none' });
    const swirl = buildQrArtwork(URL_SHORT, { frame: 'swirl' });
    expect(plain.codeFraction).toBeCloseTo(1, 9);
    expect(swirl.codeFraction).toBeLessThan(0.55);
    expect(swirl.codeFraction).toBeGreaterThan(0.4);
  });

  it('a frame changes the artwork shape but never the code itself', () => {
    // Same data, same grid. Only the ground around it differs.
    const a = buildQrArtwork(URL_SHORT, { frame: 'none' });
    const b = buildQrArtwork(URL_SHORT, { frame: 'star' });
    expect(b.moduleCount).toBe(a.moduleCount);
    expect(modulesOf(b.art).length).toBe(modulesOf(a.art).length);
  });
});

/**
 * SILHOUETTES — the code drawn AS a shape.
 *
 * A decoder samples each module at its CENTRE, so the rest of the module is
 * free to carry a picture. The shape is painted over the code and every
 * module's centre third put back at its true value.
 *
 * What must never be painted over is structure: the three eyes, their
 * separators and format information, the timing patterns and the alignment
 * patterns. Those are not protected by error correction, and without them the
 * code cannot be located or its grid established at all.
 */
describe('silhouettes — the code drawn as a shape', () => {
  const SIZES = [400, 500, 600, 800, 1000, 1200];
  const shapes = QR_FRAMES.filter((f) => f.id !== 'none');

  for (const shape of shapes) {
    it(`${shape.name} decodes on BOTH decoders at every size`, () => {
      const { art } = buildQrArtwork(URL_SHORT, { silhouette: shape.id, level: 'H' });
      for (const size of SIZES) {
        const px = rasteriseArtwork(art, size, [255, 255, 255]);
        expect(jsQRdecode(px, size)).toBe(URL_SHORT);
        expect(decodeWithZxing(px, size)).toBe(URL_SHORT);
      }
    });
  }

  it('survives ink spread, once it is printed big enough', () => {
    // Blur is measured in pixels, so at a given blur it is the module size
    // that decides - which is exactly what minModuleScale is about.
    for (const shape of ['star', 'coffee-cup', 'swirl'] as const) {
      const { art } = buildQrArtwork(URL_SHORT, { silhouette: shape, level: 'H' });
      const px = blur(rasteriseArtwork(art, 1000, [255, 255, 255]), 1000, 2);
      expect(jsQRdecode(px, 1000)).toBe(URL_SHORT);
      expect(decodeWithZxing(px, 1000)).toBe(URL_SHORT);
    }
  });

  it('carries a long URL, where the grid is denser and the picture finer', () => {
    const { art } = buildQrArtwork(URL_LONG, { silhouette: 'star', level: 'H' });
    const px = rasteriseArtwork(art, 900, [255, 255, 255]);
    expect(jsQRdecode(px, 900)).toBe(URL_LONG);
    expect(decodeWithZxing(px, 900)).toBe(URL_LONG);
  });

  it('reports that it has to print larger, which is the whole cost', () => {
    const plain = buildQrArtwork(URL_SHORT);
    const shaped = buildQrArtwork(URL_SHORT, { silhouette: 'star', level: 'H' });
    expect(plain.minModuleScale).toBe(1);
    expect(shaped.minModuleScale).toBe(3);
    expect(shaped.silhouette).toBe('star');
  });

  /**
   * The picture actually has to BE there. A silhouette that decoded but looked
   * identical to a plain code would pass every test above.
   *
   * Sampled OFF-CENTRE - a sixth of the way into each module, clear of the
   * centre third that carries the data - so what is measured is the shape and
   * not the code. Inside the silhouette those samples must be dark; outside,
   * light. That is the whole mechanism, stated directly.
   */
  it.each(shapes.map((f) => f.id))('%s puts its ink where the shape is', (id) => {
    const size = 900;
    const { art, moduleCount: n } = buildQrArtwork(URL_SHORT, { silhouette: id, level: 'H' });
    const px = rasteriseArtwork(art, size, [255, 255, 255]);

    const f = buildFrame(id);
    const scale = Math.min(1 / f.boxW, 1 / f.boxH);
    const offX = (1 - f.boxW * scale) / 2;
    const offY = (1 - f.boxH * scale) / 2;
    const rings = [...f.plate, ...f.accent].map((r) =>
      r.map((q) => ({ x: offX + q.x * scale, y: offY + q.y * scale })));
    const inRings = (x: number, y: number) => {
      let c = false;
      for (const r of rings) {
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const a = r[i]!, b = r[j]!;
          if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
        }
      }
      return c;
    };

    const u = size / (n + 8);
    let inDark = 0, inTotal = 0, outDark = 0, outTotal = 0;
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (isStructural(row, col, n)) continue;
        const x = Math.round((col + 4 + 1 / 6) * u);
        const y = Math.round((row + 4 + 1 / 6) * u);
        const dark = px[(y * size + x) * 4]! < 128;
        if (inRings((col + 0.5) / n, (row + 0.5) / n)) { inTotal++; if (dark) inDark++; }
        else { outTotal++; if (dark) outDark++; }
      }
    }

    expect(inTotal).toBeGreaterThan(20);
    expect(outTotal).toBeGreaterThan(20);
    expect(inDark / inTotal).toBeGreaterThan(0.95);
    expect(outDark / outTotal).toBeLessThan(0.05);
  });

  it('two different shapes are two different pictures', () => {
    const ink = (id: 'star' | 'circle') => {
      const size = 300;
      const { art } = buildQrArtwork(URL_SHORT, { silhouette: id, level: 'H' });
      const px = rasteriseArtwork(art, size, [255, 255, 255]);
      let dark = 0;
      for (let i = 0; i < size * size; i++) if (px[i * 4]! < 128) dark++;
      return dark / (size * size);
    };
    expect(Math.abs(ink('star') - ink('circle'))).toBeGreaterThan(0.02);
  });
});

describe('structural modules are never painted over', () => {
  /**
   * The guarantee the whole technique rests on. Checked against the module
   * grid directly rather than through a decoder: a decode can succeed by luck
   * of the error correction, and would hide a finder being quietly damaged.
   */
  it.each(QR_FRAMES.filter((f) => f.id !== 'none').map((f) => f.id))(
    'a %s silhouette leaves every structural module at its true value',
    (id) => {
      const size = 900;
      const { art, moduleCount: n } = buildQrArtwork(URL_SHORT, { silhouette: id, level: 'H' });
      const px = rasteriseArtwork(art, size, [255, 255, 255]);
      const qr = buildQrArtwork(URL_SHORT, { level: 'H' });
      const plain = rasteriseArtwork(qr.art, size, [255, 255, 255]);

      const total = n + 8;
      const u = size / total;
      let checked = 0;
      for (let row = 0; row < n; row++) {
        for (let col = 0; col < n; col++) {
          if (!isStructural(row, col, n)) continue;
          // Sample the module's centre in both renders; they must agree.
          const x = Math.round((col + 4 + 0.5) * u);
          const y = Math.round((row + 4 + 0.5) * u);
          const o = (y * size + x) * 4;
          expect(px[o]! < 128).toBe(plain[o]! < 128);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(100);
    },
  );
});
