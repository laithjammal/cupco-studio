/**
 * Direct-manipulation editing, shared by the Design and Production Fan views.
 *
 * Both views edit the SAME design document; they differ only in how design
 * coordinates map to screen pixels — the Design view is a plain linear scale,
 * the Fan view goes through the geometry engine's warp. Passing that mapping
 * in as two functions means the selection, dragging, resizing and rotation
 * logic exists once, and the two views cannot drift apart in behaviour.
 */

import type { DesignUV } from '@cupco/geometry';
import {
  elementCorners, halfExtent,
  type Design, type DesignElement, type ElementId,
} from './design';
import type { Guide } from './snapping';

export interface EditorMapping {
  /** Canvas pixel -> design space. */
  toDesign(px: number, py: number): DesignUV;
  /** Design space -> canvas pixel. */
  toCanvas(uv: DesignUV): { x: number; y: number };
}

export const HANDLE_PX = 9;
export const HANDLE_HIT_PX = 13;
/** How far above the top edge the rotation handle floats, in pixels. */
export const ROTATE_OFFSET_PX = 26;

export type DragMode =
  | { kind: 'move'; grabDu: number; grabDv: number }
  | { kind: 'resize'; corner: number }
  | { kind: 'resize-edge'; edge: EdgeIndex }
  | { kind: 'rotate'; startAngle: number; startRotation: number };

/** Edges, in the same order as the corners they sit between. */
export type EdgeIndex = 0 | 1 | 2 | 3;   // top, right, bottom, left

/** Cursor to show for a corner index, so the affordance reads correctly. */
export function cornerCursor(i: number): string {
  // Corners run top-left, top-right, bottom-right, bottom-left.
  return i === 0 || i === 2 ? 'nwse-resize' : 'nesw-resize';
}

/** Cursor for an edge handle. Top and bottom resize height, sides width. */
export function edgeCursor(i: EdgeIndex): string {
  return i === 0 || i === 2 ? 'ns-resize' : 'ew-resize';
}

export interface HandlePositions {
  corners: { x: number; y: number }[];
  /** Midpoints of the four edges: top, right, bottom, left. */
  edges: { x: number; y: number }[];
  rotate: { x: number; y: number } | null;
}

/**
 * Screen positions of an element's handles.
 *
 * The rotation handle sits outward from the midpoint of the top edge, along
 * the edge's own normal, so it stays sensibly placed even on the Fan view
 * where the "top edge" is a curve.
 */
export function handlePositions(
  el: DesignElement,
  mapping: EditorMapping,
  cw: number,
  ch: number,
  measure?: CanvasRenderingContext2D,
): HandlePositions {
  const uv = elementCorners(el, cw, ch, measure);
  const corners = uv.map((c) => mapping.toCanvas(c));

  // Edge midpoints, taken from the mapped corners so they sit on the drawn
  // box even on the fan, where every edge is a curve.
  const edges = corners.map((c, i) => {
    const n = corners[(i + 1) % corners.length]!;
    return { x: (c.x + n.x) / 2, y: (c.y + n.y) / 2 };
  });

  const tl = corners[0], tr = corners[1], bl = corners[3];
  if (!tl || !tr || !bl) return { corners, edges, rotate: null };

  const midTop = { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 };
  const midBottomish = { x: (bl.x + corners[2]!.x) / 2, y: (bl.y + corners[2]!.y) / 2 };
  // Direction from the element's body toward its top edge.
  let nx = midTop.x - midBottomish.x;
  let ny = midTop.y - midBottomish.y;
  const len = Math.hypot(nx, ny) || 1;
  nx /= len; ny /= len;

  return {
    corners,
    edges,
    rotate: { x: midTop.x + nx * ROTATE_OFFSET_PX, y: midTop.y + ny * ROTATE_OFFSET_PX },
  };
}

/** Which handle, if any, is under a screen point. */
export function hitHandle(
  el: DesignElement,
  mapping: EditorMapping,
  px: number,
  py: number,
  cw: number,
  ch: number,
  measure?: CanvasRenderingContext2D,
): { kind: 'corner'; index: number } | { kind: 'edge'; index: EdgeIndex } | { kind: 'rotate' } | null {
  const h = handlePositions(el, mapping, cw, ch, measure);
  if (h.rotate && Math.hypot(h.rotate.x - px, h.rotate.y - py) <= HANDLE_HIT_PX) {
    return { kind: 'rotate' };
  }
  // Corners are tested FIRST. They overlap the edge handles on a small
  // element, and a corner drag is the less surprising of the two to get.
  for (let i = 0; i < h.corners.length; i++) {
    const c = h.corners[i]!;
    if (Math.hypot(c.x - px, c.y - py) <= HANDLE_HIT_PX) return { kind: 'corner', index: i };
  }
  for (let i = 0; i < h.edges.length; i++) {
    const e = h.edges[i]!;
    if (Math.hypot(e.x - px, e.y - py) <= HANDLE_HIT_PX) {
      return { kind: 'edge', index: i as EdgeIndex };
    }
  }
  return null;
}

/** Angle from an element's centre to a screen point, in degrees. */
export function angleToPointer(
  el: DesignElement,
  mapping: EditorMapping,
  px: number,
  py: number,
): number {
  const c = mapping.toCanvas({ u: el.u, v: el.v });
  return (Math.atan2(py - c.y, px - c.x) * 180) / Math.PI;
}

/**
 * New size for a resize drag, as a multiplier on the current half-extent.
 *
 * Scaling is anchored on the element's CENTRE rather than the opposite corner.
 * On the warped fan an opposite-corner anchor would slide the element sideways
 * as it grew, because the two corners live at different radii; centre-anchored
 * scaling keeps it where the user put it.
 */
export function resizeRatio(
  el: DesignElement,
  pointer: DesignUV,
  cw: number,
  ch: number,
  measure?: CanvasRenderingContext2D,
): number | null {
  const cur = halfExtent(el, cw, ch, measure);
  const dU = Math.abs(pointer.u - el.u);
  const dV = Math.abs(pointer.v - el.v);
  const ratio = Math.max(dU / Math.max(cur.du, 1e-6), dV / Math.max(cur.dv, 1e-6));
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

/** Apply a resize ratio to whichever size field the element type uses. */
export function resizePatch(el: DesignElement, ratio: number): Partial<DesignElement> {
  if (el.type === 'image' || el.type === 'vector' || el.type === 'qr') {
    return { widthU: Math.max(0.02, Math.min(3, el.widthU * ratio)) } as Partial<DesignElement>;
  }
  if (el.type === 'band') {
    // A band always spans the circumference, so only its height is adjustable.
    // The ceiling is 3, not 1: the blank is taller than the cup, and a band
    // asked to reach the bleed needs about 1.37.
    return { heightV: Math.max(0.01, Math.min(3, el.heightV * ratio)) } as Partial<DesignElement>;
  }
  return { sizeV: Math.max(0.015, Math.min(1.2, el.sizeV * ratio)) } as Partial<DesignElement>;
}

/**
 * Ratio for an EDGE drag: one axis only.
 *
 * Unlike a corner, an edge answers a single question - how wide, or how tall -
 * so only the matching component of the pointer offset is used. Still anchored
 * on the centre, for the same reason corners are: on the warped fan an
 * opposite-edge anchor slides the element sideways as it grows.
 */
export function edgeResizeRatio(
  el: DesignElement,
  edge: EdgeIndex,
  pointer: DesignUV,
  cw: number,
  ch: number,
  measure?: CanvasRenderingContext2D,
): number | null {
  const cur = halfExtent(el, cw, ch, measure);
  const horizontal = edge === 1 || edge === 3;
  const d = horizontal ? Math.abs(pointer.u - el.u) : Math.abs(pointer.v - el.v);
  const ref = horizontal ? cur.du : cur.dv;
  const ratio = d / Math.max(ref, 1e-6);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

/**
 * Apply an edge drag.
 *
 * Sideways changes the width. Vertical changes `stretchV`, the multiplier on
 * the artwork's natural aspect - which is the only way to make artwork taller
 * without making it wider, since everything else is sized by width alone.
 *
 * Text and bands have a real height of their own and use it directly; a band
 * ignores horizontal drags, because it always spans the circumference.
 */
export function edgeResizePatch(
  el: DesignElement,
  edge: EdgeIndex,
  ratio: number,
): Partial<DesignElement> {
  const horizontal = edge === 1 || edge === 3;

  if (el.type === 'image' || el.type === 'vector' || el.type === 'qr') {
    if (horizontal) {
      // Widening alone must not make it taller, so the stretch is corrected
      // by the inverse: the drawn height is widthU * aspect * stretchV.
      const widthU = Math.max(0.02, Math.min(3, el.widthU * ratio));
      const applied = widthU / el.widthU;
      const stretchV = clampStretch((el.stretchV ?? 1) / applied);
      return { widthU, stretchV } as Partial<DesignElement>;
    }
    return { stretchV: clampStretch((el.stretchV ?? 1) * ratio) } as Partial<DesignElement>;
  }

  if (el.type === 'band') {
    if (horizontal) return {};        // always full circumference
    return { heightV: Math.max(0.01, Math.min(3, el.heightV * ratio)) } as Partial<DesignElement>;
  }

  // Text: only a single size, so an edge drag behaves like a corner drag.
  return { sizeV: Math.max(0.015, Math.min(1.2, el.sizeV * ratio)) } as Partial<DesignElement>;
}

const clampStretch = (v: number) => Math.max(0.05, Math.min(20, v));

/* -------------------------------------------------------------------------- */
/* Drawing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Draw the selection box and handles.
 *
 * Each edge is subdivided before mapping, because a straight line in design
 * space is a CURVE on the fan. Joining only the four corners would draw a box
 * that visibly floats off the artwork it is selecting.
 */
export function drawSelection(
  ctx: CanvasRenderingContext2D,
  el: DesignElement,
  mapping: EditorMapping,
  cw: number,
  ch: number,
  measure?: CanvasRenderingContext2D,
  subdivisions = 10,
): void {
  const uv = elementCorners(el, cw, ch, measure);
  ctx.save();

  ctx.beginPath();
  for (let i = 0; i < uv.length; i++) {
    const a = uv[i]!, b = uv[(i + 1) % uv.length]!;
    for (let s = 0; s < subdivisions; s++) {
      const k = s / subdivisions;
      const p = mapping.toCanvas({ u: a.u + (b.u - a.u) * k, v: a.v + (b.v - a.v) * k });
      if (i === 0 && s === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
  }
  ctx.closePath();
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 1.75;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  const h = handlePositions(el, mapping, cw, ch, measure);

  if (h.rotate && h.corners[0] && h.corners[1]) {
    const midTop = {
      x: (h.corners[0].x + h.corners[1].x) / 2,
      y: (h.corners[0].y + h.corners[1].y) / 2,
    };
    ctx.beginPath();
    ctx.moveTo(midTop.x, midTop.y);
    ctx.lineTo(h.rotate.x, h.rotate.y);
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(h.rotate.x, h.rotate.y, HANDLE_PX / 2 + 1, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Edge handles first, so a corner drawn over one reads as being on top -
  // which matches the hit test, where corners win.
  //
  // Drawn as short bars lying along their edge rather than squares: it says
  // which axis the handle moves, and stops them being mistaken for corners on
  // a small element.
  for (let i = 0; i < h.edges.length; i++) {
    const e = h.edges[i]!;
    const a = h.corners[i]!, b = h.corners[(i + 1) % h.corners.length]!;
    let dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const half = HANDLE_PX * 0.75;
    ctx.beginPath();
    ctx.moveTo(e.x - dx * half, e.y - dy * half);
    ctx.lineTo(e.x + dx * half, e.y + dy * half);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  ctx.lineCap = 'butt';

  for (const c of h.corners) {
    ctx.beginPath();
    ctx.rect(c.x - HANDLE_PX / 2, c.y - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Axis-aligned bounds of an element in design space.
 *
 * Taken from the ROTATED corners, so a tilted element aligns by the box a
 * person actually sees rather than by its unrotated dimensions.
 */
export function elementBounds(
  el: DesignElement,
  cw: number,
  ch: number,
  measure?: CanvasRenderingContext2D,
): { id: string; u0: number; u1: number; uC: number; v0: number; v1: number; vC: number } {
  const corners = elementCorners(el, cw, ch, measure);
  const us = corners.map((c) => c.u);
  const vs = corners.map((c) => c.v);
  const u0 = Math.min(...us), u1 = Math.max(...us);
  const v0 = Math.min(...vs), v1 = Math.max(...vs);
  return { id: el.id, u0, u1, uC: (u0 + u1) / 2, v0, v1, vC: (v0 + v1) / 2 };
}

/**
 * Draw active alignment guides.
 *
 * Each guide is a straight line in DESIGN space, which on the fan becomes a
 * curve — a constant-u line is radial (straight) but a constant-v line is an
 * arc. Both are therefore subdivided and mapped point by point, so the guide
 * sits on the artwork rather than floating across it.
 */
export function drawGuides(
  ctx: CanvasRenderingContext2D,
  guides: readonly Guide[],
  mapping: EditorMapping,
  subdivisions = 48,
): void {
  if (guides.length === 0) return;
  ctx.save();
  ctx.strokeStyle = '#ec4899';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([7, 5]);

  for (const g of guides) {
    // Object guides span only the two elements they relate, so it is obvious
    // which one is being aligned to. Canvas guides run the full height/width.
    const from = g.from ?? 0;
    const to = g.to ?? 1;
    ctx.strokeStyle = g.kind === 'object' ? '#8b5cf6' : '#ec4899';
    ctx.beginPath();
    for (let i = 0; i <= subdivisions; i++) {
      const t = from + ((to - from) * i) / subdivisions;
      const p = mapping.toCanvas(
        g.axis === 'u' ? { u: g.at, v: t } : { u: t, v: g.at },
      );
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  // Label the guide once, at its midpoint, so the user knows what they hit.
  ctx.setLineDash([]);
  ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (const g of guides) {
    const mid = g.axis === 'u'
      ? mapping.toCanvas({ u: g.at, v: ((g.from ?? 0) + (g.to ?? 1)) / 2 })
      : mapping.toCanvas({ u: ((g.from ?? 0) + (g.to ?? 1)) / 2, v: g.at });
    const w = ctx.measureText(g.label).width + 12;
    ctx.fillStyle = g.kind === 'object' ? '#8b5cf6' : '#ec4899';
    ctx.beginPath();
    ctx.roundRect(mid.x - w / 2, mid.y - 10, w, 20, 4);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(g.label, mid.x, mid.y);
  }
  ctx.restore();
}

/* ----------------------------- multi-select ------------------------------ */

/** A marquee in design space, normalised so u0<u1 and v0<v1. */
export interface Marquee { u0: number; u1: number; v0: number; v1: number }

export function normaliseMarquee(a: DesignUV, b: DesignUV): Marquee {
  return {
    u0: Math.min(a.u, b.u), u1: Math.max(a.u, b.u),
    v0: Math.min(a.v, b.v), v1: Math.max(a.v, b.v),
  };
}

/**
 * Elements the marquee catches.
 *
 * INTERSECTION, not containment. A marquee that only selected what it fully
 * enclosed would refuse to pick up the full-bleed background - the very thing
 * a person is most likely to be trying to grab - because it is larger than the
 * canvas and can never be enclosed by anything.
 */
export function elementsInMarquee(
  design: Design,
  m: Marquee,
  cw: number,
  ch: number,
  measure?: CanvasRenderingContext2D,
): ElementId[] {
  const out: ElementId[] = [];
  for (const el of design.elements) {
    const b = elementBounds(el, cw, ch, measure);
    // u wraps, so an element straddling the seam is tested at three offsets -
    // the same reason hitTest does.
    const hitsU = [-1, 0, 1].some((du) => b.u0 + du <= m.u1 && b.u1 + du >= m.u0);
    if (hitsU && b.v0 <= m.v1 && b.v1 >= m.v0) out.push(el.id);
  }
  return out;
}

/** The marquee itself, while it is being dragged. */
export function drawMarquee(
  ctx: CanvasRenderingContext2D,
  m: Marquee,
  mapping: EditorMapping,
): void {
  const a = mapping.toCanvas({ u: m.u0, v: m.v1 });
  const b = mapping.toCanvas({ u: m.u1, v: m.v0 });
  ctx.save();
  ctx.fillStyle = 'rgba(37, 99, 235, 0.12)';
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
  ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  ctx.restore();
}

/**
 * The outline for an element that is selected but is not the primary one.
 *
 * Deliberately quieter than drawSelection and carrying no handles: resize and
 * rotate act on one element, so offering their grips on four at once would
 * promise something the gesture does not do.
 */
export function drawSecondarySelection(
  ctx: CanvasRenderingContext2D,
  el: DesignElement,
  mapping: EditorMapping,
  cw: number,
  ch: number,
  measure?: CanvasRenderingContext2D,
  subdivisions = 10,
): void {
  const uv = elementCorners(el, cw, ch, measure);
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < uv.length; i++) {
    const a = uv[i]!, b = uv[(i + 1) % uv.length]!;
    for (let s = 0; s < subdivisions; s++) {
      const k = s / subdivisions;
      const p = mapping.toCanvas({ u: a.u + (b.u - a.u) * k, v: a.v + (b.v - a.v) * k });
      if (i === 0 && s === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
  }
  ctx.closePath();
  ctx.strokeStyle = '#2563eb';
  ctx.globalAlpha = 0.65;
  ctx.lineWidth = 1.25;
  ctx.setLineDash([5, 3]);
  ctx.stroke();
  ctx.restore();
}

/* -------------------------------- nudging -------------------------------- */

/** Arrow key -> a step in design-document pixels, y counted UPWARD. */
export const ARROW_STEPS: Record<string, readonly [number, number] | undefined> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};

/** How much bigger a shift-held nudge is. */
export const NUDGE_COARSE = 10;

/**
 * Where an element lands after an arrow-key nudge.
 *
 * The step is ONE PIXEL OF THE DESIGN DOCUMENT, not of the screen. A step
 * measured in screen pixels would mean something different on each view and
 * different again at another zoom, so the same keypress would move artwork by
 * a different physical amount depending on how the operator happened to be
 * looking at it.
 */
export function nudge(
  el: { u: number; v: number },
  key: string,
  canvasW: number,
  canvasH: number,
  coarse = false,
): { u: number; v: number } | null {
  const step = ARROW_STEPS[key];
  if (!step) return null;
  const scale = coarse ? NUDGE_COARSE : 1;
  const u = el.u + (step[0] * scale) / canvasW;
  const v = el.v + (step[1] * scale) / canvasH;
  return {
    // u wraps at the seam; v is a finite height and clamps.
    u: ((u % 1) + 1) % 1,
    v: Math.max(0, Math.min(1, v)),
  };
}
