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
import { elementCorners, halfExtent, type DesignElement } from './design';
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
  | { kind: 'rotate'; startAngle: number; startRotation: number };

/** Cursor to show for a corner index, so the affordance reads correctly. */
export function cornerCursor(i: number): string {
  // Corners run top-left, top-right, bottom-right, bottom-left.
  return i === 0 || i === 2 ? 'nwse-resize' : 'nesw-resize';
}

export interface HandlePositions {
  corners: { x: number; y: number }[];
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

  const tl = corners[0], tr = corners[1], bl = corners[3];
  if (!tl || !tr || !bl) return { corners, rotate: null };

  const midTop = { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 };
  const midBottomish = { x: (bl.x + corners[2]!.x) / 2, y: (bl.y + corners[2]!.y) / 2 };
  // Direction from the element's body toward its top edge.
  let nx = midTop.x - midBottomish.x;
  let ny = midTop.y - midBottomish.y;
  const len = Math.hypot(nx, ny) || 1;
  nx /= len; ny /= len;

  return {
    corners,
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
): { kind: 'corner'; index: number } | { kind: 'rotate' } | null {
  const h = handlePositions(el, mapping, cw, ch, measure);
  if (h.rotate && Math.hypot(h.rotate.x - px, h.rotate.y - py) <= HANDLE_HIT_PX) {
    return { kind: 'rotate' };
  }
  for (let i = 0; i < h.corners.length; i++) {
    const c = h.corners[i]!;
    if (Math.hypot(c.x - px, c.y - py) <= HANDLE_HIT_PX) return { kind: 'corner', index: i };
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
    return { heightV: Math.max(0.01, Math.min(1, el.heightV * ratio)) } as Partial<DesignElement>;
  }
  return { sizeV: Math.max(0.015, Math.min(1.2, el.sizeV * ratio)) } as Partial<DesignElement>;
}

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
