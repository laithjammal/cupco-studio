/**
 * SVG path data parsing and flattening.
 *
 * Curves are flattened to polylines HERE, in the artwork's own coordinate
 * space, before the fan warp is applied. That ordering matters: the fan warp
 * subdivides again with a tolerance measured in printed millimetres, so a
 * curve ends up accurate on the press regardless of how it was authored.
 *
 * Written without any DOM dependency so it runs in the browser, in the export
 * worker, and under the test runner unchanged.
 */

export interface Pt { x: number; y: number }

/** One flattened subpath. `closed` distinguishes strokes from fills. */
export interface SubPath {
  points: Pt[];
  closed: boolean;
}

/** Segments per curve at unit scale, when no tolerance is given. */
const CURVE_STEPS = 24;

interface Cmd { op: string; args: number[] }

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
const COMMANDS = 'MmLlHhVvCcSsQqTtAaZz';

/**
 * Tokenise a `d` attribute.
 *
 * Handles the awkward parts of the real grammar: implicit repeated commands
 * (`L 1 2 3 4` means two lineto), numbers run together without separators
 * (`1-2` and `.5.5`), exponents, explicit `+` signs - and arc FLAGS written
 * without separators. A flag is a single 0 or 1, so `a25 25 0 1150 50` is
 * radii 25 25, rotation 0, flags 1 and 1, then the point (50, 50). A number
 * scanner reads that as the single number 1150 and garbles the arc; SVGO
 * writes arcs exactly that way.
 */
export function parsePathCommands(d: string): Cmd[] {
  const cmds: Cmd[] = [];
  let op = '';
  let args: number[] = [];
  const flush = () => { if (op) cmds.push({ op, args }); };

  let i = 0;
  while (i < d.length) {
    const c = d[i]!;
    if (COMMANDS.includes(c)) {
      flush();
      op = c;
      args = [];
      i++;
      continue;
    }
    if (c === ',' || c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f') { i++; continue; }
    if ((op === 'A' || op === 'a') && (args.length % 7 === 3 || args.length % 7 === 4) && (c === '0' || c === '1')) {
      args.push(c === '1' ? 1 : 0);
      i++;
      continue;
    }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(d);
    if (m) {
      args.push(parseFloat(m[0]));
      i += m[0].length;
      continue;
    }
    i++; // stray character: skip it rather than abandon the path
  }
  flush();
  return cmds;
}

const ARG_COUNT: Record<string, number> = {
  M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0,
};

export interface FlattenOptions {
  /**
   * Maximum distance, in the path's own units, between a curve and the
   * polyline standing in for it. Omitted: a fixed 24 segments per curve,
   * which is what everything used before tolerances existed.
   */
  tolerance?: number;
}

const polyLen = (pts: Pt[]) => {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return l;
};

/** Segments for a curve whose control polygon has length `len`. */
function stepsFor(len: number, tol: number | undefined): number {
  if (!tol) return CURVE_STEPS;
  return Math.max(2, Math.min(96, Math.ceil(Math.sqrt(len / tol) / 2)));
}

/** Parse and flatten a `d` attribute into polyline subpaths. */
export function flattenPathData(d: string, opts: FlattenOptions = {}): SubPath[] {
  const cmds = parsePathCommands(d);
  const out: SubPath[] = [];
  const tol = opts.tolerance;

  let cur: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };
  let points: Pt[] = [];
  let lastCtrl: Pt | null = null;
  let lastOp = '';

  // A lone moveto draws nothing, and is dropped. (Canva ends clip paths with
  // a stray `M 15 15`.) A ZERO-LENGTH subpath - `M x y L x y` or `M x y z` -
  // is different: it has no area, but a round or square line cap still draws
  // a dot or a square there, which is how dotted lines are made.
  const begin = () => {
    if (points.length > 1) out.push({ points, closed: false });
    points = [];
  };
  // A drawing command straight after Z continues from the subpath's start.
  const seed = () => { if (points.length === 0) points.push({ ...cur }); };
  const push = (p: Pt) => { seed(); points.push(p); cur = p; };

  for (const cmd of cmds) {
    const upper = cmd.op.toUpperCase();
    const rel = cmd.op !== upper;
    const n = ARG_COUNT[upper] ?? 0;

    if (upper === 'Z') {
      if (points.length > 1) {
        points.push({ ...start });
        out.push({ points, closed: true });
      } else if (points.length === 1) {
        out.push({ points: [points[0]!, { ...points[0]! }], closed: false });
      }
      points = [];
      cur = { ...start };
      lastOp = upper;
      continue;
    }

    // Implicit repetition: consume the argument list in chunks.
    const chunks = n > 0 ? Math.max(1, Math.floor(cmd.args.length / n)) : 1;
    for (let ci = 0; ci < chunks; ci++) {
      const a = cmd.args.slice(ci * n, ci * n + n);
      if (a.length < n) break;
      const ox = rel ? cur.x : 0;
      const oy = rel ? cur.y : 0;

      switch (upper) {
        case 'M': {
          // A second coordinate pair after M is an implicit lineto.
          const p = { x: a[0]! + ox, y: a[1]! + oy };
          if (ci === 0) { begin(); start = { ...p }; points = [p]; cur = p; }
          else push(p);
          lastCtrl = null;
          break;
        }
        case 'L': push({ x: a[0]! + ox, y: a[1]! + oy }); lastCtrl = null; break;
        case 'H': push({ x: a[0]! + ox, y: cur.y }); lastCtrl = null; break;
        case 'V': push({ x: cur.x, y: a[0]! + oy }); lastCtrl = null; break;

        case 'C': {
          seed();
          const c1 = { x: a[0]! + ox, y: a[1]! + oy };
          const c2 = { x: a[2]! + ox, y: a[3]! + oy };
          const p = { x: a[4]! + ox, y: a[5]! + oy };
          cubic(cur, c1, c2, p, points, stepsFor(polyLen([cur, c1, c2, p]), tol));
          cur = p; lastCtrl = c2;
          break;
        }
        case 'S': {
          seed();
          // Smooth cubic: reflect the previous control point.
          const c1: Pt = (lastOp === 'C' || lastOp === 'S') && lastCtrl
            ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : { ...cur };
          const c2 = { x: a[0]! + ox, y: a[1]! + oy };
          const p = { x: a[2]! + ox, y: a[3]! + oy };
          cubic(cur, c1, c2, p, points, stepsFor(polyLen([cur, c1, c2, p]), tol));
          cur = p; lastCtrl = c2;
          break;
        }
        case 'Q': {
          seed();
          const c = { x: a[0]! + ox, y: a[1]! + oy };
          const p = { x: a[2]! + ox, y: a[3]! + oy };
          quad(cur, c, p, points, stepsFor(polyLen([cur, c, p]), tol));
          cur = p; lastCtrl = c;
          break;
        }
        case 'T': {
          seed();
          const c: Pt = (lastOp === 'Q' || lastOp === 'T') && lastCtrl
            ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : { ...cur };
          const p = { x: a[0]! + ox, y: a[1]! + oy };
          quad(cur, c, p, points, stepsFor(polyLen([cur, c, p]), tol));
          cur = p; lastCtrl = c;
          break;
        }
        case 'A': {
          seed();
          const p = { x: a[5]! + ox, y: a[6]! + oy };
          arc(cur, a[0]!, a[1]!, a[2]!, a[3]! !== 0, a[4]! !== 0, p, points, tol);
          cur = p; lastCtrl = null;
          break;
        }
      }
      lastOp = upper;
    }
  }
  begin();
  return out;
}

function cubic(p0: Pt, c1: Pt, c2: Pt, p1: Pt, out: Pt[], steps: number): void {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, mt = 1 - t;
    out.push({
      x: mt * mt * mt * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p1.x,
      y: mt * mt * mt * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p1.y,
    });
  }
}

function quad(p0: Pt, c: Pt, p1: Pt, out: Pt[], steps: number): void {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, mt = 1 - t;
    out.push({
      x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x,
      y: mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y,
    });
  }
}

/**
 * Endpoint-parameterisation elliptical arc, per the SVG spec's implementation
 * notes (F.6.5). Illustrator rarely emits these, but hand-written and
 * Figma-exported SVGs do, and silently dropping them would lose artwork.
 */
function arc(
  p0: Pt, rxIn: number, ryIn: number, xRotDeg: number,
  largeArc: boolean, sweep: boolean, p1: Pt, out: Pt[], tol?: number,
): void {
  let rx = Math.abs(rxIn), ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) { out.push(p1); return; }
  if (p0.x === p1.x && p0.y === p1.y) return;

  const phi = (xRotDeg * Math.PI) / 180;
  const cosP = Math.cos(phi), sinP = Math.sin(phi);
  const dx2 = (p0.x - p1.x) / 2, dy2 = (p0.y - p1.y) / 2;
  const x1 = cosP * dx2 + sinP * dy2;
  const y1 = -sinP * dx2 + cosP * dy2;

  // Scale up radii that are too small to span the endpoints.
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }

  const sign = largeArc === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cx1 = (co * rx * y1) / ry;
  const cy1 = (-co * ry * x1) / rx;
  const cx = cosP * cx1 - sinP * cy1 + (p0.x + p1.x) / 2;
  const cy = sinP * cx1 + cosP * cy1 + (p0.y + p1.y) / 2;

  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const d = (Math.hypot(ux, uy) * Math.hypot(vx, vy)) || 1;
    let a = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / d)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };

  const theta1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dTheta = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  else if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

  let steps: number;
  if (tol) {
    const r = Math.max(rx, ry);
    const step = tol < r ? 2 * Math.acos(1 - tol / r) : Math.PI / 2;
    steps = Math.max(4, Math.min(256, Math.ceil(Math.abs(dTheta) / step)));
  } else {
    steps = Math.max(6, Math.ceil((Math.abs(dTheta) / (Math.PI / 2)) * CURVE_STEPS));
  }
  for (let i = 1; i <= steps; i++) {
    const t = theta1 + (dTheta * i) / steps;
    const ct = Math.cos(t), st = Math.sin(t);
    out.push({
      x: cosP * rx * ct - sinP * ry * st + cx,
      y: sinP * rx * ct + cosP * ry * st + cy,
    });
  }
}
