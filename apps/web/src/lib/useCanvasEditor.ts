'use client';

/**
 * Pointer handling for direct manipulation, shared by both editing views.
 *
 * Reports `dragging` so the host view can render cheaply while the pointer is
 * down. That matters on the Fan view, where a full-quality warp costs ~150ms —
 * far too slow to run per pointer-move.
 */

import { useCallback, useRef, useState, type RefObject } from 'react';

/**
 * How close, in screen pixels, an element must be before a guide appears.
 *
 * Large enough to catch a deliberate move, small enough that ordinary
 * positioning is not hijacked.
 */
const SNAP_PX = 90;

/** Pointer travel, in screen pixels, before a press counts as a drag. */
const DRAG_SLOP_PX = 3;
import type { DesignElement, ElementId, Design } from './design';
import { hitTest } from './design';
import {
  hitHandle, angleToPointer, resizeRatio, resizePatch, cornerCursor, elementBounds,
  edgeCursor, edgeResizeRatio, edgeResizePatch,
  normaliseMarquee, elementsInMarquee,
  type DragMode, type EditorMapping, type Marquee,
} from './editor';
import { halfExtent } from './design';
import { snapToGuides, type Guide } from './snapping';

/**
 * How much a drag is slowed while the precision key is held.
 *
 * A fifth of normal: enough that a pixel-level adjustment is comfortable,
 * not so slow that crossing the canvas becomes a chore.
 */
export const PRECISION_FACTOR = 0.2;

export interface CanvasEditorArgs {
  design: Design;
  /** Every selected element. The LAST is primary: handles attach to it. */
  selectedIds: readonly ElementId[];
  onSelect: (ids: ElementId[]) => void;
  onChange: (id: ElementId, patch: Partial<DesignElement>) => void;
  /** Called once when a gesture begins, so history records one entry. */
  onBeginEdit?: () => void;
  mapping: EditorMapping;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  canvasW: number;
  canvasH: number;
  measure?: CanvasRenderingContext2D;
}

export function useCanvasEditor({
  design, selectedIds, onSelect, onChange, onBeginEdit, mapping, canvasRef, canvasW, canvasH, measure,
}: CanvasEditorArgs) {
  const dragRef = useRef<DragMode | null>(null);
  /**
   * The marquee in progress.
   *
   * `toggle` is the element the gesture pressed on while holding shift. A
   * shift-press cannot know yet whether it is a click (toggle that element)
   * or the start of a box, so it commits to neither until the pointer either
   * moves or is released.
   */
  const marqueeRef = useRef<{
    from: { u: number; v: number };
    origin: { x: number; y: number };
    moved: boolean;
    toggle: ElementId | null;
    add: boolean;
  } | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  /** Every selected element's position when the move began. */
  const groupStartRef = useRef<Map<ElementId, { u: number; v: number }>>(new Map());
  /**
   * A press on an element that was already part of a multi-selection.
   *
   * The group is kept on press so a drag moves all of it, but a press that
   * turns out to be a plain CLICK should narrow to the one element - which
   * cannot be decided until the pointer is released.
   */
  const collapseToRef = useRef<{ id: ElementId; origin: { x: number; y: number }; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [cursor, setCursor] = useState('default');
  /** Guides to draw right now. Empty unless a drag is near one. */
  const [activeGuides, setActiveGuides] = useState<Guide[]>([]);

  /** Pointer event -> canvas pixels, accounting for CSS scaling. */
  const toPixels = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current;
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return {
      px: ((e.clientX - r.left) / r.width) * c.width,
      py: ((e.clientY - r.top) / r.height) * c.height,
    };
  }, [canvasRef]);

  // Handles attach to the PRIMARY selection - the last one added. With more
  // than one selected there are no handles: resize and rotate act on a single
  // element, and offering their grips on a group would promise a gesture that
  // does not exist.
  const selectedId = selectedIds.length === 1 ? selectedIds[0]! : null;
  const selected = selectedId
    ? design.elements.find((el) => el.id === selectedId) ?? null
    : null;
  const isSelected = useCallback(
    (id: ElementId) => selectedIds.includes(id), [selectedIds]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toPixels(e);
    if (!p) return;

    // Handles take priority over whatever sits beneath them, otherwise a
    // handle overlapping another element would select that element instead.
    if (selected) {
      const h = hitHandle(selected, mapping, p.px, p.py, canvasW, canvasH, measure);
      if (h?.kind === 'rotate') {
        onBeginEdit?.();
        dragRef.current = {
          kind: 'rotate',
          startAngle: angleToPointer(selected, mapping, p.px, p.py),
          startRotation: selected.rotation,
        };
        setDragging(true);
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      if (h?.kind === 'corner') {
        onBeginEdit?.();
        dragRef.current = { kind: 'resize', corner: h.index };
        setDragging(true);
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      if (h?.kind === 'edge') {
        onBeginEdit?.();
        dragRef.current = { kind: 'resize-edge', edge: h.index };
        setDragging(true);
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
    }

    const uv = mapping.toDesign(p.px, p.py);
    const hit = hitTest(design, uv, canvasW, canvasH, measure);
    // Shift extends the selection. Ctrl/Cmd is NOT an extend modifier here -
    // it is the precision modifier for dragging, and one key cannot be both
    // without the two gestures fighting.
    const extend = e.shiftKey;

    // A marquee begins on empty space - or on ANYTHING while shift is held.
    //
    // The second half matters more than it looks. A full-bleed design covers
    // the whole canvas, so there is no empty space left to start a box from,
    // and a marquee that only worked over blank areas would be unavailable on
    // exactly the layouts that most need it.
    if (!hit || extend) {
      if (!hit && !extend) onSelect([]);
      marqueeRef.current = {
        from: uv,
        origin: { x: e.clientX, y: e.clientY },
        moved: false,
        toggle: extend ? hit?.id ?? null : null,
        add: extend,
      };
      setMarquee(normaliseMarquee(uv, uv));
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    // Pressing on something already in a multi-selection keeps the whole
    // group, so a group can be dragged without it collapsing to one.
    const keepGroup = isSelected(hit.id) && selectedIds.length > 1;
    const next = keepGroup ? [...selectedIds] : [hit.id];
    collapseToRef.current = keepGroup
      ? { id: hit.id, origin: { x: e.clientX, y: e.clientY }, moved: false }
      : null;
    onSelect(next);
    if (next.length === 0) return;

    onBeginEdit?.();
    groupStartRef.current = new Map(
      design.elements.filter((el) => next.includes(el.id)).map((el) => [el.id, { u: el.u, v: el.v }]),
    );
    dragRef.current = { kind: 'move', grabDu: uv.u - hit.u, grabDv: uv.v - hit.v };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [toPixels, selected, mapping, canvasW, canvasH, measure, design, onSelect,
      onBeginEdit, selectedIds, isSelected]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toPixels(e);
    if (!p) return;
    const drag = dragRef.current;

    // A marquee grabs nothing, so it sets no drag mode. It has to be handled
    // before the hover branch, which would otherwise return first.
    const mq = marqueeRef.current;
    if (mq) {
      // A few pixels of slop, so a shift-CLICK with an unsteady hand still
      // reads as a click rather than as a one-pixel box that selects nothing.
      if (Math.abs(e.clientX - mq.origin.x) > DRAG_SLOP_PX
        || Math.abs(e.clientY - mq.origin.y) > DRAG_SLOP_PX) mq.moved = true;
      setMarquee(normaliseMarquee(mq.from, mapping.toDesign(p.px, p.py)));
      return;
    }

    if (!drag) {
      // Hover feedback: show the resize/rotate affordance before the click.
      let next = 'default';
      if (selected) {
        const h = hitHandle(selected, mapping, p.px, p.py, canvasW, canvasH, measure);
        if (h?.kind === 'rotate') next = 'grab';
        else if (h?.kind === 'corner') next = cornerCursor(h.index);
        else if (h?.kind === 'edge') next = edgeCursor(h.index);
        else next = hitTest(design, mapping.toDesign(p.px, p.py), canvasW, canvasH, measure) ? 'move' : 'default';
      } else if (hitTest(design, mapping.toDesign(p.px, p.py), canvasW, canvasH, measure)) {
        next = 'move';
      }
      setCursor((c) => (c === next ? c : next));
      return;
    }

    const uv = mapping.toDesign(p.px, p.py);

    if (drag.kind === 'move') {
      const starts = groupStartRef.current;
      if (starts.size === 0) return;
      const collapse = collapseToRef.current;
      if (collapse && (Math.abs(e.clientX - collapse.origin.x) > DRAG_SLOP_PX
        || Math.abs(e.clientY - collapse.origin.y) > DRAG_SLOP_PX)) collapse.moved = true;

      // Ctrl/Cmd slows the drag for fine placement. Measured from where the
      // gesture began rather than from the last frame, so the slowing cannot
      // accumulate rounding as the pointer moves.
      const fine = e.ctrlKey || e.metaKey;
      const anchorId = selectedIds[selectedIds.length - 1]!;
      const anchorStart = starts.get(anchorId);
      if (!anchorStart) return;

      const rawU = uv.u - drag.grabDu;
      const rawV = uv.v - drag.grabDv;
      const targetU = fine ? anchorStart.u + (rawU - anchorStart.u) * PRECISION_FACTOR : rawU;
      const targetV = fine ? anchorStart.v + (rawV - anchorStart.v) * PRECISION_FACTOR : rawV;

      // A single element still snaps to guides. A group does not: snapping one
      // member would shear the group apart, and snapping the whole bounding
      // box is a different feature from the one being asked for here.
      if (starts.size === 1 && selected && selectedId) {
        const others = design.elements
          .filter((el) => el.id !== selectedId)
          .map((el) => elementBounds(el, canvasW, canvasH, measure));
        const half = halfExtent(selected, canvasW, canvasH, measure);
        const snap = snapToGuides({
          uv: { u: ((targetU % 1) + 1) % 1, v: Math.max(0, Math.min(1, targetV)) },
          halfU: half.du,
          halfV: half.dv,
          others,
          toleranceU: SNAP_PX / Math.max(1, canvasW),
          toleranceV: SNAP_PX / Math.max(1, canvasH),
          // Alt suspends snapping outright; so does the precision modifier,
          // since the whole point of it is to sit just off a guide.
          enabled: !e.altKey && !fine,
        });
        setActiveGuides(snap.active);
        onChange(selectedId, snap.uv);
        return;
      }

      setActiveGuides([]);
      const du = targetU - anchorStart.u;
      const dv = targetV - anchorStart.v;
      for (const [id, from] of starts) {
        // u wraps around the seam rather than clamping - design space is a
        // cylinder, so dragging past the edge should continue, not stop.
        const u = (((from.u + du) % 1) + 1) % 1;
        const v = Math.max(0, Math.min(1, from.v + dv));
        onChange(id, { u, v });
      }
      return;
    }

    if (!selected || !selectedId) return;

    if (drag.kind === 'rotate') {
      const now = angleToPointer(selected, mapping, p.px, p.py);
      let deg = Math.round(drag.startRotation + (now - drag.startAngle));
      if (e.shiftKey) deg = Math.round(deg / 15) * 15; // snap
      while (deg > 180) deg -= 360;
      while (deg < -180) deg += 360;
      onChange(selectedId, { rotation: deg });
      return;
    }

    if (drag.kind === 'resize-edge') {
      const r = edgeResizeRatio(selected, drag.edge, uv, canvasW, canvasH, measure);
      if (r !== null) onChange(selectedId, edgeResizePatch(selected, drag.edge, r));
      return;
    }

    const ratio = resizeRatio(selected, uv, canvasW, canvasH, measure);
    if (ratio !== null) onChange(selectedId, resizePatch(selected, ratio));
  }, [toPixels, selected, selectedId, selectedIds, mapping, canvasW, canvasH, measure, design, onChange]);

  const endDrag = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const mq = marqueeRef.current;
    if (mq) {
      if (!mq.moved) {
        // It was a click after all. Shift on an element toggles it; shift on
        // empty space leaves the selection alone.
        if (mq.toggle) {
          onSelect(selectedIds.includes(mq.toggle)
            ? selectedIds.filter((id) => id !== mq.toggle)
            : [...selectedIds, mq.toggle]);
        }
      } else if (marquee) {
        const caught = elementsInMarquee(design, marquee, canvasW, canvasH, measure);
        onSelect(mq.add ? [...new Set([...selectedIds, ...caught])] : caught);
      }
    }
    const collapse = collapseToRef.current;
    if (collapse && !collapse.moved) onSelect([collapse.id]);
    collapseToRef.current = null;
    marqueeRef.current = null;
    setMarquee(null);
    groupStartRef.current = new Map();
    dragRef.current = null;
    setDragging(false);
    setActiveGuides([]);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, [marquee, design, canvasW, canvasH, measure, onSelect, selectedIds]);

  return {
    dragging,
    cursor,
    activeGuides,
    marquee,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onPointerLeave: () => setCursor('default'),
    },
  };
}
