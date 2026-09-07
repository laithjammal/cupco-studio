/**
 * Basic shapes as VECTOR ARTWORK.
 *
 * A shape is not a new kind of element. It is a PlacedArtwork - the same thing
 * an imported SVG becomes - so a rectangle travels the identical path as a
 * logo: it warps onto the fan, exports as real vector CMYK, is checked by
 * preflight, and needs no new case in the renderer, the exporter or the
 * document schema.
 *
 * CURVES ARE FLATTENED HERE, and that is deliberate. PlacedArtwork carries
 * polylines, not beziers, because the fan warp is non-affine: a bezier control
 * point does not survive it, so every curve has to be subdivided sooner or
 * later. Doing it at construction keeps one representation in the system.
 *
 * The segment count is chosen so the error is invisible in print rather than
 * by eye: 128 segments on a circle 60mm across leaves a sagitta of 0.009mm,
 * an order of magnitude under the 0.1mm the fan export flattens to.
 */
import type { RGB } from './color';
import type { PlacedArtwork } from './place';

export type ShapeId =
  | 'rectangle' | 'rounded-rectangle' | 'circle'
  | 'triangle' | 'diamond' | 'star' | 'line';

export interface ShapeDef {
  id: ShapeId;
  label: string;
  /** Height / width of the shape's natural box. */
  aspect: number;
}

export const SHAPES: readonly ShapeDef[] = [
  { id: 'rectangle', label: 'Rectangle', aspect: 0.618 },
  { id: 'rounded-rectangle', label: 'Rounded', aspect: 0.618 },
  { id: 'circle', label: 'Circle', aspect: 1 },
  { id: 'triangle', label: 'Triangle', aspect: 0.866 },
  { id: 'diamond', label: 'Diamond', aspect: 1 },
  { id: 'star', label: 'Star', aspect: 0.951057 },
  { id: 'line', label: 'Line', aspect: 0.06 },
];

/** Segments per full circle. See the note above on why this number. */
const CIRCLE_SEGMENTS = 128;

type Pt = { x: number; y: number };

/** A closed ring: first point repeated at the end, as the rest of the system expects. */
function close(pts: Pt[]): Pt[] {
  const first = pts[0];
  if (!first) return pts;
  const last = pts[pts.length - 1]!;
  return (last.x === first.x && last.y === first.y) ? pts : [...pts, { x: first.x, y: first.y }];
}

/** Arc in the unit box, angles in radians, y DOWN (the SVG convention). */
function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, segs: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = a0 + ((a1 - a0) * i) / segs;
    out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return out;
}

function ring(id: ShapeId): Pt[] {
  switch (id) {
    case 'rectangle':
    case 'line':
      return close([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]);

    case 'rounded-rectangle': {
      // Radius as a fraction of the SHORT side, so the corners stay circular
      // in the unit box whatever the aspect - a radius in unit-box units would
      // come out as ellipses once the box is non-square.
      const a = SHAPES.find((s) => s.id === 'rounded-rectangle')!.aspect;
      const rx = 0.16, ry = rx / a;      // equal in real proportions
      const seg = Math.max(4, Math.round(CIRCLE_SEGMENTS / 4));
      const H = Math.PI / 2;
      return close([
        ...arc(1 - rx, ry, rx, ry, -H, 0, seg),          // top-right
        ...arc(1 - rx, 1 - ry, rx, ry, 0, H, seg),       // bottom-right
        ...arc(rx, 1 - ry, rx, ry, H, Math.PI, seg),     // bottom-left
        ...arc(rx, ry, rx, ry, Math.PI, 1.5 * Math.PI, seg), // top-left
      ]);
    }

    case 'circle':
      return close(arc(0.5, 0.5, 0.5, 0.5, 0, Math.PI * 2, CIRCLE_SEGMENTS).slice(0, -1));

    case 'triangle':
      return close([{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]);

    case 'diamond':
      return close([{ x: 0.5, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }]);

    case 'star': {
      // Five points. The inner radius is the one that makes a regular
      // pentagram: any other value is a five-armed blob.
      const outer = 0.5;
      const inner = outer * Math.sin(Math.PI / 10) / Math.sin((7 * Math.PI) / 10);
      const pts: Pt[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outer : Math.abs(inner);
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        pts.push({ x: 0.5 + r * Math.cos(a), y: 0.5 + r * Math.sin(a) });
      }
      return close(pts);
    }
  }
}

/**
 * Build a shape as vector artwork in a unit box, y pointing down.
 *
 * The box is normalised to 0..1 on BOTH axes and the proportions are carried
 * by `aspect`, which is exactly the contract an imported SVG arrives under -
 * so nothing downstream can tell a shape from a logo.
 */
export function buildShapeArtwork(id: ShapeId, fill: RGB): PlacedArtwork {
  const def = SHAPES.find((s) => s.id === id);
  if (!def) throw new Error(`unknown shape "${id}"`);

  // NORMALISED to fill the unit box on both axes, with the true proportions
  // carried by `aspect`. Without this a star - which is only 95% as wide as
  // its circumscribed circle - would arrive visibly smaller than a rectangle
  // set to the same width, and no two shapes would size alike.
  const pts = ring(id);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const sx = maxX - minX || 1;
  const sy = maxY - minY || 1;
  const unit = pts.map((p) => ({ x: (p.x - minX) / sx, y: (p.y - minY) / sy }));

  return {
    shapes: [{ subpaths: [unit], fill, opacity: 1 }],
    aspect: def.aspect,
  };
}
