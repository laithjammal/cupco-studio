/**
 * Seasonal motifs as VECTOR ARTWORK.
 *
 * Drawn in code rather than shipped as files, for the same reason shapes are:
 * a motif is then a PlacedArtwork like any imported logo, so it warps onto the
 * fan, exports as real CMYK paths and needs no new case anywhere downstream.
 * It also means a snowflake recolours to a café's palette instead of arriving
 * in whatever colour a stock file happened to be.
 *
 * Every motif is built in whatever coordinates suit it and normalised at the
 * end, with its real proportions carried by `aspect` - so a motif never has to
 * be authored inside a unit box, and none of them arrive stretched.
 *
 * COLOUR IS BY ROLE, not by name. A motif asks for `primary`, `ink`, `accent`
 * and so on; the concept supplies the palette. That is what lets one snowman
 * suit a navy winter cup and a warm cream one without being redrawn.
 */
import type { RGB } from './color';
import type { PlacedArtwork } from './place';

export type MotifId =
  | 'snowflake' | 'snowman' | 'heart' | 'leaf' | 'poppy' | 'egg' | 'bunny'
  | 'flower' | 'pumpkin' | 'ghost' | 'bat' | 'tree' | 'gift' | 'bauble'
  | 'holly' | 'cup' | 'steam' | 'bean' | 'star' | 'sparkle' | 'sun'
  | 'cloud' | 'drift' | 'moustache' | 'medal' | 'confetti';

/** The colours a motif draws with. Supplied by the concept, not chosen here. */
export interface MotifPalette {
  /** The motif's main body. */
  primary: RGB;
  /** Line work, eyes, outlines — whatever must read as "drawn". */
  ink: RGB;
  /** A contrasting highlight: a scarf, a ribbon, a berry. */
  accent: RGB;
  /** Secondary body colour, for a second tier or a shadow. */
  secondary: RGB;
}

type Pt = { x: number; y: number };
interface Part { rings: Pt[][]; role: keyof MotifPalette }

const TAU = Math.PI * 2;

/* -------------------------------------------------------------------------- */
/* Primitives                                                                  */
/* -------------------------------------------------------------------------- */

function ellipse(cx: number, cy: number, rx: number, ry: number, segs = 48): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * TAU;
    out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return out;
}
const circle = (cx: number, cy: number, r: number, segs = 48) => ellipse(cx, cy, r, r, segs);

function rect(x0: number, y0: number, x1: number, y1: number): Pt[] {
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }];
}

function roundRect(x0: number, y0: number, x1: number, y1: number, r: number): Pt[] {
  const rr = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  const out: Pt[] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= 10; i++) {
      const a = a0 + (i / 10) * (Math.PI / 2);
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

function starRing(cx: number, cy: number, R: number, inner: number, points: number, rot = -Math.PI / 2): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? R : R * inner;
    const a = rot + (i * Math.PI) / points;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  out.push({ ...out[0]! });
  return out;
}

/** A stroked polyline turned into a filled ring of the given width. */
function strokeToRing(pts: Pt[], width: number): Pt[] {
  const half = width / 2;
  const left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!;
    let dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    left.push({ x: pts[i]!.x - dy * half, y: pts[i]!.y + dx * half });
    right.push({ x: pts[i]!.x + dy * half, y: pts[i]!.y - dx * half });
  }
  const ring = [...left, ...right.reverse()];
  ring.push({ ...ring[0]! });
  return ring;
}

/**
 * A ROUNDED petal: an oval standing off the centre.
 *
 * Flowers and poppies have broad, blunt petals; the pointed teardrop below
 * suits a leaf but read as a spike when six were arranged in a ring.
 */
function ovalPetal(cx: number, cy: number, len: number, wide: number, angle: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * TAU;
    const x = wide * Math.cos(a);
    const y = -len / 2 + (len / 2) * Math.sin(a);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    out.push({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos });
  }
  return out;
}

/** A teardrop petal, pointing up from (cx, cy). */
function petal(cx: number, cy: number, len: number, wide: number, angle: number): Pt[] {
  const out: Pt[] = [];
  const N = 28;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    // Width swells then closes: a smooth leaf outline.
    const w = wide * Math.sin(Math.PI * t) ** 0.85;
    out.push({ x: w, y: -len * t });
  }
  for (let i = N; i >= 0; i--) {
    const t = i / N;
    const w = wide * Math.sin(Math.PI * t) ** 0.85;
    out.push({ x: -w, y: -len * t });
  }
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return out.map((p) => ({
    x: cx + p.x * cos - p.y * sin,
    y: cy + p.x * sin + p.y * cos,
  }));
}

/* -------------------------------------------------------------------------- */
/* The motifs                                                                  */
/* -------------------------------------------------------------------------- */

function build(id: MotifId): Part[] {
  switch (id) {
    case 'snowflake': {
      const arms: Pt[][] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        const tip = { x: Math.cos(a), y: Math.sin(a) };
        arms.push(strokeToRing([{ x: 0, y: 0 }, tip], 0.13));
        // Two side branches per arm, at the classic 60 degrees.
        for (const at of [0.45, 0.72]) {
          const base = { x: tip.x * at, y: tip.y * at };
          for (const off of [-1, 1]) {
            const b = a + off * (Math.PI / 3);
            const l = 0.3 * (1 - at) + 0.16;
            arms.push(strokeToRing([base, { x: base.x + Math.cos(b) * l, y: base.y + Math.sin(b) * l }], 0.09));
          }
        }
      }
      arms.push(circle(0, 0, 0.16));
      return [{ rings: arms, role: 'primary' }];
    }

    case 'snowman': {
      const body: Pt[][] = [circle(0, 1.55, 0.62), circle(0, 0.62, 0.46), circle(0, -0.14, 0.34)];
      const ink: Pt[][] = [
        circle(-0.13, -0.22, 0.055), circle(0.13, -0.22, 0.055),      // eyes
        circle(0, 0.5, 0.055), circle(0, 0.72, 0.055),                // buttons
        circle(0, 1.35, 0.06), circle(0, 1.62, 0.06),
        // arms
        strokeToRing([{ x: -0.42, y: 0.5 }, { x: -1.0, y: 0.16 }], 0.075),
        strokeToRing([{ x: -0.78, y: 0.33 }, { x: -0.92, y: 0.08 }], 0.06),
        strokeToRing([{ x: 0.42, y: 0.5 }, { x: 1.0, y: 0.16 }], 0.075),
        strokeToRing([{ x: 0.78, y: 0.33 }, { x: 0.92, y: 0.08 }], 0.06),
        // hat
        rect(-0.5, -0.52, 0.5, -0.44),
        rect(-0.3, -0.95, 0.3, -0.52),
      ];
      const accent: Pt[][] = [
        rect(-0.36, 0.08, 0.36, 0.2),                                  // scarf
        [{ x: 0.16, y: 0.18 }, { x: 0.34, y: 0.18 }, { x: 0.4, y: 0.62 }, { x: 0.2, y: 0.62 }, { x: 0.16, y: 0.18 }],
        rect(-0.3, -0.62, 0.3, -0.52),                                 // hat band
      ];
      const nose: Pt[][] = [[{ x: 0.02, y: -0.14 }, { x: 0.42, y: -0.06 }, { x: 0.02, y: -0.04 }, { x: 0.02, y: -0.14 }]];
      return [
        { rings: body, role: 'primary' },
        { rings: ink, role: 'ink' },
        { rings: accent, role: 'accent' },
        { rings: nose, role: 'secondary' },
      ];
    }

    case 'heart': {
      const pts: Pt[] = [];
      for (let i = 0; i <= 120; i++) {
        const t = (i / 120) * TAU;
        // The classic parametric heart, flipped so y points down.
        pts.push({
          x: 16 * Math.sin(t) ** 3,
          y: -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
        });
      }
      return [{ rings: [pts], role: 'primary' }];
    }

    case 'leaf': {
      const blade = petal(0, 0.5, 1.0, 0.34, 0);
      const vein = strokeToRing([{ x: 0, y: 0.5 }, { x: 0, y: -0.42 }], 0.05);
      const ribs: Pt[][] = [vein];
      for (const t of [0.25, 0.45, 0.65]) {
        const y = 0.5 - t;
        for (const s of [-1, 1]) {
          ribs.push(strokeToRing([{ x: 0, y }, { x: s * 0.22 * (1 - t * 0.6), y: y - 0.16 }], 0.04));
        }
      }
      const stem = strokeToRing([{ x: 0, y: 0.5 }, { x: 0, y: 0.72 }], 0.06);
      return [
        { rings: [blade], role: 'primary' },
        { rings: ribs, role: 'secondary' },
        { rings: [stem], role: 'secondary' },
      ];
    }

    case 'poppy': {
      const petals: Pt[][] = [];
      for (let i = 0; i < 4; i++) {
        petals.push(ovalPetal(0, 0, 1.05, 0.4, (i / 4) * TAU + Math.PI / 4));
      }
      return [
        { rings: petals, role: 'primary' },
        { rings: [circle(0, 0, 0.19)], role: 'ink' },
        { rings: [circle(0, 0, 0.1)], role: 'secondary' },
      ];
    }

    case 'egg': {
      // An egg is an ellipse that is fatter at the bottom.
      const shell: Pt[] = [];
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * TAU - Math.PI / 2;
        const t = (Math.sin(a) + 1) / 2;
        shell.push({ x: Math.cos(a) * (0.62 + 0.14 * t), y: Math.sin(a) * 0.86 });
      }
      const zig: Pt[] = [];
      for (let i = 0; i <= 12; i++) {
        zig.push({ x: -0.8 + (i / 12) * 1.6, y: i % 2 ? 0.04 : -0.12 });
      }
      return [
        { rings: [shell], role: 'primary' },
        { rings: [strokeToRing(zig, 0.1)], role: 'accent' },
        { rings: [rect(-0.66, 0.3, 0.66, 0.42), rect(-0.5, -0.5, 0.5, -0.38)], role: 'secondary' },
      ];
    }

    case 'bunny': {
      const head = ellipse(0, 0.34, 0.52, 0.46);
      const ears = [
        ellipse(-0.24, -0.42, 0.15, 0.46),
        ellipse(0.24, -0.42, 0.15, 0.46),
      ];
      const inner = [
        ellipse(-0.24, -0.4, 0.07, 0.3),
        ellipse(0.24, -0.4, 0.07, 0.3),
      ];
      const face = [
        circle(-0.18, 0.26, 0.06), circle(0.18, 0.26, 0.06),
        [{ x: -0.09, y: 0.44 }, { x: 0.09, y: 0.44 }, { x: 0, y: 0.55 }, { x: -0.09, y: 0.44 }],
        strokeToRing([{ x: -0.34, y: 0.5 }, { x: -0.1, y: 0.52 }], 0.03),
        strokeToRing([{ x: 0.34, y: 0.5 }, { x: 0.1, y: 0.52 }], 0.03),
      ];
      return [
        { rings: [head, ...ears], role: 'primary' },
        { rings: inner, role: 'accent' },
        { rings: face, role: 'ink' },
      ];
    }

    case 'flower': {
      const petals: Pt[][] = [];
      for (let i = 0; i < 6; i++) petals.push(ovalPetal(0, 0, 0.95, 0.27, (i / 6) * TAU));
      return [
        { rings: petals, role: 'primary' },
        { rings: [circle(0, 0, 0.23)], role: 'accent' },
      ];
    }

    case 'pumpkin': {
      const lobes: Pt[][] = [
        ellipse(0, 0.1, 0.86, 0.7),
        ellipse(-0.34, 0.1, 0.42, 0.68),
        ellipse(0.34, 0.1, 0.42, 0.68),
      ];
      const ribs = [
        strokeToRing([{ x: -0.3, y: -0.5 }, { x: -0.4, y: 0.1 }, { x: -0.3, y: 0.7 }], 0.05),
        strokeToRing([{ x: 0.3, y: -0.5 }, { x: 0.4, y: 0.1 }, { x: 0.3, y: 0.7 }], 0.05),
      ];
      const stem = [
        strokeToRing([{ x: 0, y: -0.58 }, { x: 0.02, y: -0.9 }, { x: 0.2, y: -1.0 }], 0.12),
      ];
      return [
        { rings: lobes, role: 'primary' },
        { rings: ribs, role: 'secondary' },
        { rings: stem, role: 'ink' },
      ];
    }

    case 'ghost': {
      const body: Pt[] = [];
      // Domed head, straight sides, scalloped hem.
      for (let i = 0; i <= 40; i++) {
        const a = Math.PI + (i / 40) * Math.PI;
        body.push({ x: 0.6 * Math.cos(a), y: -0.25 + 0.62 * Math.sin(a) });
      }
      body.push({ x: 0.6, y: 0.6 });
      for (let i = 0; i <= 3; i++) {
        const x = 0.6 - (i / 3) * 1.2;
        body.push({ x: x - 0.1, y: i % 2 ? 0.6 : 0.86 });
        body.push({ x: x - 0.2, y: i % 2 ? 0.86 : 0.6 });
      }
      body.push({ x: -0.6, y: 0.6 }, { x: -0.6, y: -0.25 });
      const face = [
        ellipse(-0.2, -0.3, 0.1, 0.14), ellipse(0.2, -0.3, 0.1, 0.14),
        ellipse(0, 0.06, 0.11, 0.16),
      ];
      return [
        { rings: [body], role: 'primary' },
        { rings: face, role: 'ink' },
      ];
    }

    case 'bat': {
      // Leading edge out to the tip, then a scalloped trailing edge back in.
      // Written out rather than looped, for the same reason as the holly leaf.
      const wing = (s2: number): Pt[] => ([
        { x: 0, y: -0.20 },
        { x: s2 * 0.36, y: -0.44 }, { x: s2 * 0.76, y: -0.40 }, { x: s2 * 1.16, y: -0.20 },
        { x: s2 * 0.94, y: 0.10 }, { x: s2 * 0.74, y: -0.04 },
        { x: s2 * 0.56, y: 0.24 }, { x: s2 * 0.36, y: 0.04 },
        { x: s2 * 0.20, y: 0.30 }, { x: 0, y: 0.18 },
        { x: 0, y: -0.20 },
      ]);
      const body = ellipse(0, 0.0, 0.19, 0.3);
      const ears = [
        [{ x: -0.16, y: -0.22 }, { x: -0.07, y: -0.5 }, { x: 0.0, y: -0.22 }, { x: -0.16, y: -0.22 }],
        [{ x: 0.16, y: -0.22 }, { x: 0.07, y: -0.5 }, { x: 0.0, y: -0.22 }, { x: 0.16, y: -0.22 }],
      ];
      return [{ rings: [wing(-1), wing(1), body, ...ears], role: 'primary' }];
    }

    case 'tree': {
      const tiers = [
        [{ x: 0, y: -1.0 }, { x: 0.46, y: -0.32 }, { x: -0.46, y: -0.32 }, { x: 0, y: -1.0 }],
        [{ x: 0, y: -0.66 }, { x: 0.64, y: 0.16 }, { x: -0.64, y: 0.16 }, { x: 0, y: -0.66 }],
        [{ x: 0, y: -0.24 }, { x: 0.82, y: 0.66 }, { x: -0.82, y: 0.66 }, { x: 0, y: -0.24 }],
      ];
      return [
        { rings: tiers, role: 'primary' },
        { rings: [rect(-0.13, 0.66, 0.13, 0.95)], role: 'ink' },
        { rings: [starRing(0, -1.06, 0.24, 0.42, 5)], role: 'accent' },
      ];
    }

    case 'gift': {
      const box = roundRect(-0.7, -0.2, 0.7, 0.8, 0.07);
      const lid = roundRect(-0.8, -0.42, 0.8, -0.2, 0.06);
      const ribbon = [rect(-0.11, -0.42, 0.11, 0.8)];
      const bow = [
        ellipse(-0.26, -0.56, 0.22, 0.15), ellipse(0.26, -0.56, 0.22, 0.15),
        circle(0, -0.54, 0.1),
      ];
      return [
        { rings: [box, lid], role: 'primary' },
        { rings: [...ribbon, ...bow], role: 'accent' },
      ];
    }

    case 'bauble': {
      return [
        { rings: [circle(0, 0.22, 0.66)], role: 'primary' },
        { rings: [rect(-0.16, -0.58, 0.16, -0.4), strokeToRing(
          [{ x: -0.11, y: -0.58 }, { x: 0, y: -0.8 }, { x: 0.11, y: -0.58 }], 0.06)], role: 'ink' },
        { rings: [strokeToRing([{ x: -0.6, y: 0.08 }, { x: 0, y: 0.3 }, { x: 0.6, y: 0.08 }], 0.11)], role: 'accent' },
      ];
    }

    case 'holly': {
      // Traced explicitly, down one side and back up the other. Generating the
      // lobes in a loop kept folding the outline back through itself.
      const OUTLINE: Pt[] = [
        { x: 0, y: -0.55 },
        { x: 0.16, y: -0.36 }, { x: 0.34, y: -0.42 },
        { x: 0.22, y: -0.16 }, { x: 0.42, y: -0.04 },
        { x: 0.22, y: 0.12 }, { x: 0.36, y: 0.30 },
        { x: 0.13, y: 0.36 }, { x: 0.05, y: 0.56 },
        { x: -0.05, y: 0.56 }, { x: -0.13, y: 0.36 },
        { x: -0.36, y: 0.30 }, { x: -0.22, y: 0.12 },
        { x: -0.42, y: -0.04 }, { x: -0.22, y: -0.16 },
        { x: -0.34, y: -0.42 }, { x: -0.16, y: -0.36 },
        { x: 0, y: -0.55 },
      ];
      const turned = (tilt: number, dx: number, dy: number): Pt[] => {
        const cos = Math.cos(tilt), sin = Math.sin(tilt);
        return OUTLINE.map((q) => ({
          x: dx + q.x * cos - q.y * sin, y: dy + q.x * sin + q.y * cos,
        }));
      };
      return [
        // Splayed well apart: overlapped, two spiked leaves read as one mass.
        { rings: [turned(-0.95, -0.46, -0.1), turned(0.95, 0.46, -0.1)], role: 'primary' },
        { rings: [circle(-0.14, 0.3, 0.14), circle(0.14, 0.3, 0.14), circle(0, 0.5, 0.14)], role: 'accent' },
      ];
    }

    case 'cup': {
      const body = [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.36, y: 0.62 }, { x: -0.36, y: 0.62 }, { x: -0.5, y: -0.5 }];
      const lid = roundRect(-0.58, -0.72, 0.58, -0.5, 0.06);
      const sleeve = [{ x: -0.46, y: -0.12 }, { x: 0.46, y: -0.12 }, { x: 0.41, y: 0.26 }, { x: -0.41, y: 0.26 }, { x: -0.46, y: -0.12 }];
      return [
        { rings: [body], role: 'primary' },
        { rings: [lid], role: 'ink' },
        { rings: [sleeve], role: 'accent' },
      ];
    }

    case 'steam': {
      const wisp = (dx: number, h: number): Pt[] => {
        const p: Pt[] = [];
        for (let i = 0; i <= 24; i++) {
          const t = i / 24;
          p.push({ x: dx + Math.sin(t * Math.PI * 2) * 0.16, y: 0.5 - t * h });
        }
        return strokeToRing(p, 0.1);
      };
      return [{ rings: [wisp(-0.3, 1.0), wisp(0, 1.2), wisp(0.3, 1.0)], role: 'primary' }];
    }

    case 'bean': {
      const outer = ellipse(0, 0, 0.5, 0.68);
      const crease: Pt[] = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        crease.push({ x: Math.sin(t * Math.PI) * 0.13 - 0.02, y: -0.56 + t * 1.12 });
      }
      return [
        { rings: [outer], role: 'primary' },
        { rings: [strokeToRing(crease, 0.1)], role: 'ink' },
      ];
    }

    case 'star':
      return [{ rings: [starRing(0, 0, 1, 0.42, 5)], role: 'primary' }];

    case 'sparkle': {
      const four = starRing(0, 0, 1, 0.26, 4);
      return [{ rings: [four], role: 'primary' }];
    }

    case 'sun': {
      const rays: Pt[][] = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        rays.push(strokeToRing([
          { x: Math.cos(a) * 0.66, y: Math.sin(a) * 0.66 },
          { x: Math.cos(a) * 1.0, y: Math.sin(a) * 1.0 },
        ], 0.13));
      }
      return [
        { rings: [circle(0, 0, 0.56)], role: 'primary' },
        { rings: rays, role: 'primary' },
      ];
    }

    case 'cloud':
      return [{
        rings: [
          circle(-0.42, 0.08, 0.32), circle(0, -0.1, 0.44),
          circle(0.42, 0.06, 0.34), rect(-0.42, 0.02, 0.42, 0.4),
        ],
        role: 'primary',
      }];

    case 'drift': {
      // A ground line with soft mounds — the base of a snowy scene.
      const p: Pt[] = [{ x: -1, y: 0.5 }];
      for (let i = 0; i <= 60; i++) {
        const t = i / 60;
        const x = -1 + t * 2;
        p.push({ x, y: -0.1 - 0.22 * Math.sin(t * Math.PI * 1.6) - 0.1 * Math.sin(t * Math.PI * 5) });
      }
      p.push({ x: 1, y: 0.5 }, { x: -1, y: 0.5 });
      return [{ rings: [p], role: 'primary' }];
    }

    case 'moustache': {
      // A handlebar: thick at the centre, tapering into an upturned tip.
      const half = (sgn: number): Pt[] => {
        const top: Pt[] = [], bot: Pt[] = [];
        const N = 40;
        for (let i = 0; i <= N; i++) {
          const t = i / N;
          const x = sgn * t;
          // The spine dips then curls back up at the tip.
          const y = -0.14 * Math.sin(t * Math.PI * 0.9) + 0.34 * t ** 2.6;
          const th = 0.3 * (1 - t ** 1.5) + 0.02;
          top.push({ x, y: y - th });
          bot.push({ x, y: y + th * 0.55 });
        }
        const ring = [...top, ...bot.reverse()];
        ring.push({ ...ring[0]! });
        return ring;
      };
      return [{ rings: [half(-1), half(1)], role: 'primary' }];
    }

    case 'medal': {
      const ribbons = [
        [{ x: -0.42, y: -0.95 }, { x: -0.08, y: -0.95 }, { x: -0.1, y: -0.18 }, { x: -0.4, y: -0.3 }, { x: -0.42, y: -0.95 }],
        [{ x: 0.42, y: -0.95 }, { x: 0.08, y: -0.95 }, { x: 0.1, y: -0.18 }, { x: 0.4, y: -0.3 }, { x: 0.42, y: -0.95 }],
      ];
      return [
        { rings: ribbons, role: 'accent' },
        { rings: [circle(0, 0.28, 0.6)], role: 'primary' },
        { rings: [starRing(0, 0.28, 0.32, 0.42, 5)], role: 'ink' },
      ];
    }

    case 'confetti':
      return [{ rings: [roundRect(-0.5, -0.16, 0.5, 0.16, 0.08)], role: 'primary' }];
  }
}

/* -------------------------------------------------------------------------- */

/** Everything a caller needs to lay a motif out before building it. */
export interface MotifDef { id: MotifId; aspect: number }

const cache = new Map<MotifId, { parts: Part[]; aspect: number; norm: Part[] }>();

function normalised(id: MotifId) {
  const hit = cache.get(id);
  if (hit) return hit;

  const parts = build(id);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of parts) {
    for (const r of p.rings) {
      for (const q of r) {
        if (q.x < minX) minX = q.x;
        if (q.y < minY) minY = q.y;
        if (q.x > maxX) maxX = q.x;
        if (q.y > maxY) maxY = q.y;
      }
    }
  }
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  // Normalised to 0..1 on BOTH axes with the proportions carried by `aspect` -
  // the same contract an imported SVG arrives under.
  const norm = parts.map((p) => ({
    role: p.role,
    rings: p.rings.map((r) => r.map((q) => ({ x: (q.x - minX) / w, y: (q.y - minY) / h }))),
  }));
  const entry = { parts, aspect: h / w, norm };
  cache.set(id, entry);
  return entry;
}

/** Height / width of a motif, before it is built. */
export function motifAspect(id: MotifId): number {
  return normalised(id).aspect;
}

/**
 * Build a motif as vector artwork.
 *
 * Parts are emitted in drawing order, back to front, each carrying its role's
 * colour. Nothing here knows what a "winter palette" is - that is the
 * concept's business, which is what lets the same snowman work on a navy cup
 * and a cream one.
 */
export function buildMotifArtwork(id: MotifId, palette: MotifPalette): PlacedArtwork {
  const { norm, aspect } = normalised(id);
  return {
    aspect,
    shapes: norm.map((p) => ({ subpaths: p.rings, fill: palette[p.role], opacity: 1 })),
  };
}
