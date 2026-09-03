/**
 * QR codes as vector artwork.
 *
 * Produced as PlacedArtwork so a QR travels the exact same path as an uploaded
 * logo: it warps onto the fan, exports as vector CMYK, and prints as crisp
 * geometry at any size. Rasterising a QR would be the one thing guaranteed to
 * make it unscannable in print.
 *
 * ---------------------------------------------------------------------------
 * WHAT CAN BE STYLISED, AND WHY
 * ---------------------------------------------------------------------------
 * A decoder does two things, and they tolerate very different amounts of
 * decoration:
 *
 * 1. LOCATE the code, using the three finder patterns. It scans lines across
 *    the image looking for the run-length ratio 1:1:3:1:1 - dark, light, dark,
 *    light, dark. This is the fragile part.
 *
 * 2. READ the data, by projecting a grid onto the located code and sampling
 *    each module at its CENTRE. This is the forgiving part: what happens at a
 *    module's edges barely matters, only that its middle is the right shade.
 *
 * So data modules can become dots, rounded squares or connected blobs almost
 * freely, while the finder patterns need care. The circular eye works because
 * a line through the centre of concentric circles of radius 3.5, 2.5 and 1.5
 * modules gives runs of exactly 1, 1, 3, 1, 1 - the ratio is preserved
 * exactly, not approximately.
 *
 * Three things are NOT negotiable and are not exposed as options:
 *   - the 4-module quiet zone
 *   - a light ground behind the code
 *   - dark modules genuinely dark (enforced by the preflight contrast rule)
 *
 * Every style here is decoded in the test suite, at print size, by a real
 * decoder. "It looks like a QR code" is not evidence that it scans.
 */

import qrcode from 'qrcode-generator';
// Type-only: the artwork format is defined by @cupco/vector, and importing it
// rather than restating it is what stops the two drifting. Nothing from that
// package survives compilation, so a build of this one pulls in
// qrcode-generator and nothing else.
import type { PlacedArtwork, RGB } from '@cupco/vector';

/** How each data module is drawn. */
export type QrModuleStyle = 'square' | 'dot' | 'rounded' | 'fluid';

/** How the three finder patterns ("eyes") are drawn. */
export type QrEyeStyle = 'square' | 'rounded' | 'circle' | 'leaf';

export interface QrStyle {
  module: QrModuleStyle;
  eye: QrEyeStyle;
}

export interface QrStylePreset extends QrStyle {
  id: string;
  name: string;
  description: string;
}

/**
 * The presets offered in the editor.
 *
 * Ordered by how much they depart from a plain code, so the first is always
 * the safest choice and the operator can see what they are trading.
 */
export const QR_STYLES: readonly QrStylePreset[] = [
  {
    id: 'classic', name: 'Classic', module: 'square', eye: 'square',
    description: 'Sharp squares. The most robust, and the smallest file.',
  },
  {
    id: 'dots', name: 'Dots', module: 'dot', eye: 'circle',
    description: 'Round modules and circular eyes. Soft and friendly.',
  },
  {
    id: 'rounded', name: 'Rounded', module: 'rounded', eye: 'rounded',
    description: 'Squares with softened corners. Subtle, still very legible.',
  },
  {
    id: 'fluid', name: 'Fluid', module: 'fluid', eye: 'rounded',
    description: 'Neighbouring modules join into flowing shapes.',
  },
  {
    id: 'petal', name: 'Petal', module: 'dot', eye: 'leaf',
    description: 'Round modules with leaf-shaped eyes. The most decorative.',
  },
  {
    id: 'pebble', name: 'Pebble', module: 'fluid', eye: 'circle',
    description: 'Flowing modules against circular eyes.',
  },
];

export function getQrStyle(id: string): QrStylePreset {
  return QR_STYLES.find((s) => s.id === id) ?? QR_STYLES[0]!;
}

export interface QrOptions {
  /**
   * Error correction. 'M' (~15% recoverable) is the sensible default for a
   * printed cup: 'L' is fragile once a cup is handled, 'H' inflates the module
   * count and makes each module smaller.
   */
  level?: 'L' | 'M' | 'Q' | 'H';
  /** Quiet zone in modules. The spec requires 4; less and scanners fail. */
  quietZone?: number;
  dark?: RGB;
  style?: Partial<QrStyle>;
}

export interface QrResult {
  art: PlacedArtwork;
  /** Modules per side, excluding the quiet zone. */
  moduleCount: number;
  /** Number of vector subpaths emitted. */
  pathCount: number;
  style: QrStyle;
}

/* -------------------------------------------------------------------------- */
/* Geometry helpers                                                            */
/* -------------------------------------------------------------------------- */

type Pt = { x: number; y: number };

/**
 * Segments used to approximate a circle.
 *
 * A 24-gon of radius r deviates from the true circle by r*(1-cos(pi/24)),
 * which is r/115. On a 0.5mm module the dot radius is about 0.21mm, so the
 * error is under 2 microns - three orders of magnitude below the 0.02mm
 * flatness tolerance the fan warper already works to.
 */
const CIRCLE_SEGMENTS = 24;

/**
 * A circle, wound in the SAME direction as `rect` below.
 *
 * Winding matters: holes are cut by reversing it. With opposite windings a
 * hole renders correctly under BOTH the nonzero and even-odd fill rules, and
 * this artwork passes through three renderers that do not all agree on which
 * they use.
 */
function circle(cx: number, cy: number, r: number, reverse = false): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
    const t = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
    const a = reverse ? -t : t;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

function rect(x0: number, y0: number, x1: number, y1: number, reverse = false): Pt[] {
  const pts = [
    { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 },
  ];
  return reverse ? pts.slice().reverse() : pts;
}

/** Which corners of a rounded rectangle are actually rounded. */
interface Corners { tl: boolean; tr: boolean; br: boolean; bl: boolean }

const ALL_CORNERS: Corners = { tl: true, tr: true, br: true, bl: true };

const ARC_SEGMENTS = 6;

/**
 * A rectangle with a chosen subset of corners rounded.
 *
 * The subset is what makes the 'fluid' style work: a corner is only rounded
 * where the module has no neighbour in either direction, so adjacent modules
 * run together into one continuous shape.
 */
function roundedRect(
  x0: number, y0: number, x1: number, y1: number,
  r: number,
  corners: Corners = ALL_CORNERS,
  reverse = false,
): Pt[] {
  const maxR = Math.min(x1 - x0, y1 - y0) / 2;
  const rr = Math.min(r, maxR);
  if (rr <= 0) return rect(x0, y0, x1, y1, reverse);

  const pts: Pt[] = [];
  const arc = (cx: number, cy: number, from: number, to: number) => {
    for (let i = 0; i <= ARC_SEGMENTS; i++) {
      const a = from + ((to - from) * i) / ARC_SEGMENTS;
      pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
    }
  };

  // Clockwise on screen (y points down): top edge, right, bottom, left.
  if (corners.tl) arc(x0 + rr, y0 + rr, Math.PI, Math.PI * 1.5);
  else pts.push({ x: x0, y: y0 });

  if (corners.tr) arc(x1 - rr, y0 + rr, Math.PI * 1.5, Math.PI * 2);
  else pts.push({ x: x1, y: y0 });

  if (corners.br) arc(x1 - rr, y1 - rr, 0, Math.PI * 0.5);
  else pts.push({ x: x1, y: y1 });

  if (corners.bl) arc(x0 + rr, y1 - rr, Math.PI * 0.5, Math.PI);
  else pts.push({ x: x0, y: y1 });

  pts.push({ ...pts[0]! });
  return reverse ? pts.slice().reverse() : pts;
}

/* -------------------------------------------------------------------------- */
/* Module rendering                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Dot diameter as a fraction of the module.
 *
 * MEASURED, NOT CHOSEN. The airier 0.86 that this started as looks better and
 * was rejected: the two decoders disagree about it sharply.
 *
 *   ZXing (the algorithm behind most phone scanners) reads separated dots all
 *   the way down to 0.70, at every size tested, even blurred.
 *   jsQR (what browser-based scanners typically use) reads NOTHING below 1.00.
 *
 * A gap between modules is what breaks jsQR, and a customer holding a cup has
 * no idea which decoder is inside the app they happened to open. So the dots
 * are full-module circles, tangent to their neighbours rather than separated.
 * Still unmistakably round; readable by both.
 *
 * The sweep behind this is in the decode test suite. Note that an intermediate
 * 0.95 appears to pass jsQR at low resolution and fails at high - the low-res
 * "pass" is aliasing closing the gaps, not scannability. Which is exactly why
 * this number was not settled by looking at one render.
 */
const DOT_DIAMETER = 1.0;

/** Corner radius of a 'rounded' module, as a fraction of the module. */
const ROUNDED_RADIUS = 0.3;

/**
 * Inset of a 'rounded' module.
 *
 * Zero, for the reason above: an inset separates neighbouring modules and jsQR
 * then cannot read the code. Rounded modules therefore still meet along the
 * flat middle of each edge, and the rounding shows only at the corners.
 */
const ROUNDED_INSET = 0;

/* -------------------------------------------------------------------------- */

/** Is (row, col) inside one of the three 7x7 finder patterns? */
function isFinder(row: number, col: number, n: number): boolean {
  const inBox = (r0: number, c0: number) =>
    row >= r0 && row < r0 + 7 && col >= c0 && col < c0 + 7;
  return inBox(0, 0) || inBox(0, n - 7) || inBox(n - 7, 0);
}

/**
 * Build a QR code as vector artwork.
 *
 * Everything is emitted into a single shape with one fill. Holes (the light
 * ring inside each eye) are cut by reversing the subpath winding rather than
 * by painting white on top, so the light ground shows through cleanly instead
 * of relying on two inks registering perfectly against each other.
 */
export function buildQrArtwork(text: string, options: QrOptions = {}): QrResult {
  const level = options.level ?? 'M';
  const quiet = options.quietZone ?? 4;
  const dark = options.dark ?? ([0, 0, 0] as RGB);
  const style: QrStyle = {
    module: options.style?.module ?? 'square',
    eye: options.style?.eye ?? 'square',
  };

  const qr = qrcode(0, level); // 0 = choose the smallest version that fits
  qr.addData(text);
  qr.make();

  const n = qr.getModuleCount();
  const total = n + quiet * 2;
  const u = 1 / total; // one module, normalised

  const subpaths: Pt[][] = [];
  const at = (i: number) => (i + quiet) * u;
  const isDark = (row: number, col: number) =>
    row >= 0 && row < n && col >= 0 && col < n && qr.isDark(row, col);

  /* ---- data modules ---------------------------------------------------- */

  if (style.module === 'square') {
    // Horizontal runs merged into single rectangles. A 25x25 code has ~300
    // dark modules but only ~90 runs, which keeps the PDF small and the warp
    // fast. Only possible because plain squares abut exactly.
    for (let row = 0; row < n; row++) {
      let runStart = -1;
      for (let col = 0; col <= n; col++) {
        const dark_ = col < n && isDark(row, col) && !isFinder(row, col, n);
        if (dark_ && runStart < 0) runStart = col;
        if (!dark_ && runStart >= 0) {
          subpaths.push(rect(at(runStart), at(row), at(col), at(row + 1)));
          runStart = -1;
        }
      }
    }
  } else {
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (!isDark(row, col) || isFinder(row, col, n)) continue;
        const x0 = at(col), y0 = at(row), x1 = at(col + 1), y1 = at(row + 1);

        if (style.module === 'dot') {
          subpaths.push(circle((x0 + x1) / 2, (y0 + y1) / 2, (u * DOT_DIAMETER) / 2));
        } else if (style.module === 'rounded') {
          const inset = u * ROUNDED_INSET;
          subpaths.push(roundedRect(
            x0 + inset, y0 + inset, x1 - inset, y1 - inset, u * ROUNDED_RADIUS,
          ));
        } else {
          // Fluid: round a corner only where BOTH of its neighbours are light,
          // so a module with a neighbour stays square on that side and the two
          // read as one continuous shape.
          const up = isDark(row - 1, col), down = isDark(row + 1, col);
          const left = isDark(row, col - 1), right = isDark(row, col + 1);
          subpaths.push(roundedRect(x0, y0, x1, y1, u * 0.5, {
            tl: !up && !left,
            tr: !up && !right,
            br: !down && !right,
            bl: !down && !left,
          }));
        }
      }
    }
  }

  /* ---- finder patterns ------------------------------------------------- */

  for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]] as const) {
    subpaths.push(...buildEye(style.eye, at(c0), at(r0), u));
  }

  return {
    art: { aspect: 1, shapes: [{ subpaths, fill: dark, opacity: 1 }] },
    moduleCount: n,
    pathCount: subpaths.length,
    style,
  };
}

/**
 * One finder pattern: a ring 7 modules across with a 3-module centre.
 *
 * The ring is a hole cut by reverse winding, not a light square painted over
 * a dark one. The proportions - outer 7, hole 5, centre 3 - are what produce
 * the 1:1:3:1:1 run-length ratio a decoder hunts for, and they are identical
 * in every style here. Only the corner treatment changes.
 */
function buildEye(style: QrEyeStyle, x: number, y: number, u: number): Pt[][] {
  const cx = x + 3.5 * u, cy = y + 3.5 * u;

  if (style === 'circle') {
    // A line through the centre crosses 1, 1, 3, 1, 1 modules exactly, so the
    // ratio the decoder looks for survives intact.
    return [
      circle(cx, cy, 3.5 * u),
      circle(cx, cy, 2.5 * u, true),
      circle(cx, cy, 1.5 * u),
    ];
  }

  const box = (half: number, r: number, corners: Corners, reverse = false) =>
    roundedRect(cx - half * u, cy - half * u, cx + half * u, cy + half * u, r * u, corners, reverse);

  if (style === 'rounded') {
    return [
      box(3.5, 1.6, ALL_CORNERS),
      box(2.5, 1.1, ALL_CORNERS, true),
      box(1.5, 0.7, ALL_CORNERS),
    ];
  }

  if (style === 'leaf') {
    // Two opposite corners fully rounded, two left sharp.
    const outer: Corners = { tl: true, tr: false, br: true, bl: false };
    return [
      box(3.5, 3.5, outer),
      box(2.5, 2.5, outer, true),
      box(1.5, 1.5, outer),
    ];
  }

  return [
    box(3.5, 0, ALL_CORNERS),
    box(2.5, 0, ALL_CORNERS, true),
    box(1.5, 0, ALL_CORNERS),
  ];
}

/** A URL that will actually resolve, or null. */
export function normaliseUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    // A bare word parses as a URL but is not a reachable host.
    if (!u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}
