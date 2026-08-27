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
import type { DesignElement, ElementId, Design } from './design';
import { hitTest } from './design';
import {
  hitHandle, angleToPointer, resizeRatio, resizePatch, cornerCursor, elementBounds,
  type DragMode, type EditorMapping,
} from './editor';
import { halfExtent } from './design';
import { snapToGuides, type Guide } from './snapping';

export interface CanvasEditorArgs {
  design: Design;
  selectedId: ElementId | null;
  onSelect: (id: ElementId | null) => void;
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
  design, selectedId, onSelect, onChange, onBeginEdit, mapping, canvasRef, canvasW, canvasH, measure,
}: CanvasEditorArgs) {
  const dragRef = useRef<DragMode | null>(null);
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

  const selected = design.elements.find((el) => el.id === selectedId) ?? null;

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
    }

    const uv = mapping.toDesign(p.px, p.py);
    const hit = hitTest(design, uv, canvasW, canvasH, measure);
    onSelect(hit ? hit.id : null);
    if (hit) {
      onBeginEdit?.();
      dragRef.current = { kind: 'move', grabDu: uv.u - hit.u, grabDv: uv.v - hit.v };
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }, [toPixels, selected, mapping, canvasW, canvasH, measure, design, onSelect, onBeginEdit]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toPixels(e);
    if (!p) return;
    const drag = dragRef.current;

    if (!drag) {
      // Hover feedback: show the resize/rotate affordance before the click.
      let next = 'default';
      if (selected) {
        const h = hitHandle(selected, mapping, p.px, p.py, canvasW, canvasH, measure);
        if (h?.kind === 'rotate') next = 'grab';
        else if (h?.kind === 'corner') next = cornerCursor(h.index);
        else next = hitTest(design, mapping.toDesign(p.px, p.py), canvasW, canvasH, measure) ? 'move' : 'default';
      } else if (hitTest(design, mapping.toDesign(p.px, p.py), canvasW, canvasH, measure)) {
        next = 'move';
      }
      setCursor((c) => (c === next ? c : next));
      return;
    }

    if (!selected || !selectedId) return;
    const uv = mapping.toDesign(p.px, p.py);

    if (drag.kind === 'move') {
      // u wraps around the seam rather than clamping — design space is a
      // cylinder, so dragging past the edge should continue, not stop.
      let u = uv.u - drag.grabDu;
      u = ((u % 1) + 1) % 1;
      const v = Math.max(0, Math.min(1, uv.v - drag.grabDv));

      // Holding alt suspends snapping, for placement that deliberately sits
      // just off a guide.
      // Bounds of every OTHER element, so edges and centres can line up.
      const others = design.elements
        .filter((el) => el.id !== selectedId)
        .map((el) => elementBounds(el, canvasW, canvasH, measure));
      const half = halfExtent(selected, canvasW, canvasH, measure);

      const snap = snapToGuides({
        uv: { u, v },
        halfU: half.du,
        halfV: half.dv,
        others,
        toleranceU: SNAP_PX / Math.max(1, canvasW),
        toleranceV: SNAP_PX / Math.max(1, canvasH),
        // Holding alt suspends snapping, for placement that deliberately sits
        // just off a guide.
        enabled: !e.altKey,
      });
      setActiveGuides(snap.active);
      onChange(selectedId, snap.uv);
      return;
    }

    if (drag.kind === 'rotate') {
      const now = angleToPointer(selected, mapping, p.px, p.py);
      let deg = Math.round(drag.startRotation + (now - drag.startAngle));
      if (e.shiftKey) deg = Math.round(deg / 15) * 15; // snap
      while (deg > 180) deg -= 360;
      while (deg < -180) deg += 360;
      onChange(selectedId, { rotation: deg });
      return;
    }

    const ratio = resizeRatio(selected, uv, canvasW, canvasH, measure);
    if (ratio !== null) onChange(selectedId, resizePatch(selected, ratio));
  }, [toPixels, selected, selectedId, mapping, canvasW, canvasH, measure, design, onChange]);

  const endDrag = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null;
    setDragging(false);
    setActiveGuides([]);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  return {
    dragging,
    cursor,
    activeGuides,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onPointerLeave: () => setCursor('default'),
    },
  };
}
