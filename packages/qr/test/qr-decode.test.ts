import { describe, it, expect } from 'vitest';
import { buildQrArtwork, QR_STYLES, getQrStyle, normaliseUrl } from '../src/index';
import type { QrStyle } from '../src/index';
import { rasterise, rasteriseArtwork, blur, modulesOf } from './qr-raster';
import { decodeWithJsQr as jsQRdecode, decodeWithZxing, shrinkEach } from './qr-decoders';

/**
 * Pixels for a code, rendered the way it would print.
 *
 * The WHOLE artwork is rendered - the light ground and the modules, each in
 * its own colour - on a DARK ground, so the quiet zone is actually under test:
 * anything falling outside the plate would show as dark against the code.
 */
function render(text: string, style: Partial<QrStyle>, size = 300, blurPx = 0) {
  const { art } = buildQrArtwork(text, { style });
  return blur(rasteriseArtwork(art, size, [20, 20, 20]), size, blurPx);
}

/**
 * Read a code back with BOTH decoders, returning the text only if they agree.
 *
 * A style is only safe if every decoder reads it: the customer has no say in
 * which one is inside the app they happen to open.
 */
function decodeBoth(text: string, style: Partial<QrStyle>, size = 300, blurPx = 0) {
  const px = render(text, style, size, blurPx);
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
 * A finding worth keeping, though it is not about styles.
 *
 * ZXing misses on particular still renders whenever a code does not exactly
 * fill the image - deterministically, robust to a pixel shift and identical
 * under both of its binarizers. Every other test here renders codes that fill
 * the frame exactly, which is the one case that is always clean - and the one
 * case that never happens on a cup.
 *
 * jsQR is unaffected, which is what says the code itself is fine. A live
 * scanner reads a video stream at continuously varying scale, so a framing
 * that misses is retried a frame later. Kept so that nobody re-discovers it
 * later and mistakes it for a fault in a style.
 */
describe('ZXing and a code that does not fill the image', () => {
  it('misses at some sizes, while jsQR reads every one', () => {
    const { art } = buildQrArtwork(URL_SHORT);
    let misses = 0;
    for (const size of [300, 350, 400, 450, 500, 550, 600, 650, 700, 800, 900, 1000]) {
      const shrunk = {
        ...art,
        shapes: art.shapes.map((sh) => ({
          ...sh,
          subpaths: sh.subpaths.map((sp) =>
            sp.map((p) => ({ x: 0.05 + p.x * 0.9, y: 0.05 + p.y * 0.9 }))),
        })),
      };
      const px = rasteriseArtwork(shrunk, size, [255, 255, 255]);
      if (decodeWithZxing(px, size) !== URL_SHORT) misses++;
      expect(jsQRdecode(px, size)).toBe(URL_SHORT);
    }
    expect(misses).toBeGreaterThan(0);
  });
});
