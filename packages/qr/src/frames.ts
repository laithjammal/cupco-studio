/**
 * Frames: the SHAPE a QR code sits in.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FRAME IS A PLATE AND NOT A MASK
 * ---------------------------------------------------------------------------
 * The obvious reading of "a round QR code" is a code clipped to a circle. That
 * cannot work. The module grid is fixed by the data - modules cannot be moved,
 * only restyled - and the three finder patterns sit in three CORNERS of the
 * square. A circle inscribed in the code clips exactly those corners, and a
 * code with no finders is not located at all, let alone read.
 *
 * So the shape is the LIGHT GROUND the code is printed on, sized to contain
 * the code and its quiet zone completely. The code stays a square grid,
 * untouched, and the artwork as a whole is a circle, a star, a cup. Nothing a
 * decoder cares about changes, which is why these are safe in a way that
 * masking never could be.
 *
 * ---------------------------------------------------------------------------
 * THE CONSTRAINT EVERY FRAME MUST MEET
 * ---------------------------------------------------------------------------
 * The 4-module quiet zone must be light on every side. On a dark cup, "light"
 * means "inside the plate" - so the whole code-plus-quiet-zone SQUARE has to
 * fall inside the frame outline, corners included. That is a real cost: a
 * circle containing a square has to be sqrt(2) times its width, so the code
 * ends up around 70% of the artwork width, and less for a star.
 *
 * `codeFraction` on the result reports it, because it changes how big the
 * artwork must be placed to keep the modules above the printable floor. A star
 * frame at the same placed width has modules roughly half the size.
 *
 * Containment is asserted per frame in the test suite by sampling the square's
 * outline against the frame polygon, not argued for here in trigonometry.
 *
 * Any DARK decoration - a ring, a lid, spiral arms - is emitted separately and
 * only ever outside the quiet zone.
 */

export type QrFrameId =
  | 'none' | 'circle' | 'ring' | 'star' | 'hexagon' | 'badge' | 'coffee-cup' | 'swirl';

export interface QrFramePreset {
  id: QrFrameId;
  name: string;
  description: string;
}

export const QR_FRAMES: readonly QrFramePreset[] = [
  { id: 'none', name: 'Square', description: 'The plain square ground. Smallest artwork for a given module size.' },
  { id: 'circle', name: 'Circle', description: 'A round plate. The classic alternative to the square.' },
  { id: 'ring', name: 'Ring', description: 'A round plate inside a bold outer ring.' },
  { id: 'star', name: 'Star', description: 'Five-pointed. The most decorative, and the smallest code for its size.' },
  { id: 'hexagon', name: 'Hexagon', description: 'Six-sided. Tighter than a circle for the same code.' },
  { id: 'badge', name: 'Badge', description: 'A shield, pointed at the base.' },
  { id: 'coffee-cup', name: 'Coffee cup', description: 'A takeaway cup, code on the body, lid on top.' },
  { id: 'swirl', name: 'Swirl', description: 'A round plate with spiral arms turning out of it.' },
];

export type Pt = { x: number; y: number };

export interface QrFrameGeometry {
  /** Frame bounding box, in units where the code + quiet zone square is 1 x 1. */
  boxW: number;
  boxH: number;
  /** Top-left of that square inside the box. */
  codeX: number;
  codeY: number;
  /** The light ground. Filled with the light colour, behind everything. */
  plate: Pt[][];
  /** Dark decoration, always outside the quiet zone. May be empty. */
  accent: Pt[][];
}

/* -------------------------------------------------------------------------- */

const TAU = Math.PI * 2;
const ARC_SEGMENTS = 96;

/**
 * Half-diagonal of the code square, with a little margin.
 *
 * Every rotationally symmetric frame is sized from this: it is the furthest
 * any part of the code+quiet square reaches from its own centre.
 */
const DIAG = Math.SQRT2 / 2;
const SAFE = DIAG * 1.02;

function ring(cx: number, cy: number, r: number, reverse = false): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const t = (i / ARC_SEGMENTS) * TAU;
    const a = reverse ? -t : t;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

/** A star polygon: `points` spikes, inner vertices at `inner` x the outer radius. */
function star(cx: number, cy: number, R: number, inner: number, points: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? R : R * inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  out.push({ ...out[0]! });
  return out;
}

function polygon(cx: number, cy: number, R: number, sides: number, rot: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= sides; i++) {
    const a = rot + (i / sides) * TAU;
    out.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  }
  return out;
}

/** Round-cornered rectangle, corners given as a radius. */
function roundRect(x0: number, y0: number, x1: number, y1: number, r: number): Pt[] {
  const seg = 12;
  const rr = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  const out: Pt[] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      out.push({ x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a) });
    }
  };
  corner(x1 - rr, y0 + rr, -Math.PI / 2);
  corner(x1 - rr, y1 - rr, 0);
  corner(x0 + rr, y1 - rr, Math.PI / 2);
  corner(x0 + rr, y0 + rr, Math.PI);
  out.push({ ...out[0]! });
  return out;
}

/** Translate rings so the whole frame's bounding box starts at (0,0). */
function normalise(rings: Pt[][][], codeHalf: number): QrFrameGeometry {
  const all = rings.flat().flat();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of all) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const shift = (rs: Pt[][]) => rs.map((r) => r.map((p) => ({ x: p.x - minX, y: p.y - minY })));
  return {
    boxW: maxX - minX,
    boxH: maxY - minY,
    codeX: -codeHalf - minX,
    codeY: -codeHalf - minY,
    plate: shift(rings[0]!),
    accent: shift(rings[1] ?? []),
  };
}

/**
 * Build a frame.
 *
 * The code + quiet zone square is 1 x 1 centred on the origin; everything is
 * sized against that and the result is shifted into a positive box.
 */
export function buildFrame(id: QrFrameId): QrFrameGeometry {
  const H = 0.5; // half the code square

  switch (id) {
    case 'none':
      return normalise([[roundRect(-H, -H, H, H, 0)], []], H);

    case 'circle':
      return normalise([[ring(0, 0, SAFE)], []], H);

    case 'ring': {
      const inner = SAFE * 1.10;
      const outer = SAFE * 1.30;
      return normalise([
        [ring(0, 0, SAFE)],
        [ring(0, 0, outer), ring(0, 0, inner, true)],
      ], H);
    }

    case 'star': {
      // Inner vertices are the closest the boundary comes to the centre, so
      // they are what has to clear the square's corners.
      const k = 0.68;
      return normalise([[star(0, 0, SAFE / k, k, 5)], []], H);
    }

    case 'hexagon': {
      // A hexagon's boundary is nearest the centre at its edge midpoints. The
      // square's corners sit at 45 degrees, between an edge midpoint and a
      // vertex, so the inradius alone would over-size it - hence the fit is
      // asserted in the tests rather than derived here.
      const inradius = SAFE * 1.01;
      return normalise([[polygon(0, 0, inradius / Math.cos(Math.PI / 6), 6, Math.PI / 6)], []], H);
    }

    case 'badge': {
      // Built explicitly rather than by trimming a rounded rectangle: filtering
      // points out of the middle of a ring leaves the remaining arcs joined in
      // the wrong order, and the polygon crosses itself.
      const w = SAFE * 0.95;
      const top = -SAFE * 1.02;
      const shoulder = SAFE * 0.86;   // clear of the square's bottom corners
      const tip = SAFE * 1.58;
      const r = w * 0.30;
      const pts: Pt[] = [{ x: -w + r, y: top }, { x: w - r, y: top }];
      for (let i = 0; i <= 12; i++) {            // top-right corner
        const a = -Math.PI / 2 + (i / 12) * (Math.PI / 2);
        pts.push({ x: w - r + r * Math.cos(a), y: top + r + r * Math.sin(a) });
      }
      pts.push({ x: w, y: shoulder }, { x: 0, y: tip }, { x: -w, y: shoulder });
      for (let i = 0; i <= 12; i++) {            // top-left corner
        const a = Math.PI + (i / 12) * (Math.PI / 2);
        pts.push({ x: -w + r + r * Math.cos(a), y: top + r + r * Math.sin(a) });
      }
      pts.push({ ...pts[0]! });
      return normalise([[pts], []], H);
    }

    case 'coffee-cup': {
      // A tapered body, wider at the rim. The code sits in the body, so the
      // body's NARROWEST point still has to clear the square.
      // The rim sits ABOVE the square, not through it - otherwise the code's
      // top row falls outside the body and under the lid.
      const topY = -SAFE * 1.06, botY = SAFE * 1.62;
      const topW = SAFE * 1.10, botW = SAFE * 0.86;
      const body: Pt[] = [
        { x: -topW, y: topY }, { x: topW, y: topY },
        { x: botW, y: botY }, { x: -botW, y: botY }, { x: -topW, y: topY },
      ];
      const lid = roundRect(-topW * 1.14, topY - SAFE * 0.40, topW * 1.14, topY, SAFE * 0.12);
      return normalise([[body], [lid]], H);
    }

    case 'swirl': {
      // Arms turn out of the plate, starting clear of the quiet zone.
      const r0 = SAFE * 1.06, r1 = SAFE * 1.62;
      const arms: Pt[][] = [];
      for (let a = 0; a < 3; a++) {
        const base = (a / 3) * TAU;
        const outer: Pt[] = [];
        const back: Pt[] = [];
        const STEPS = 28;
        for (let i = 0; i <= STEPS; i++) {
          const t = i / STEPS;
          const r = r0 + (r1 - r0) * t;
          const th = base + t * 1.15;                 // sweep of each arm
          const wid = SAFE * 0.26 * (1 - t) ** 0.85;  // tapers to a tip
          outer.push({ x: r * Math.cos(th) - wid * Math.sin(th), y: r * Math.sin(th) + wid * Math.cos(th) });
          back.push({ x: r * Math.cos(th) + wid * Math.sin(th), y: r * Math.sin(th) - wid * Math.cos(th) });
        }
        const ringPts = [...outer, ...back.reverse()];
        ringPts.push({ ...ringPts[0]! });
        arms.push(ringPts);
      }
      return normalise([[ring(0, 0, SAFE)], arms], H);
    }
  }
}
