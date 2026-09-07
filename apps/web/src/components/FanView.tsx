'use client';

/**
 * Production fan view, with direct manipulation of artwork ON the warped fan.
 *
 * Pointer events are converted from canvas pixels into fan millimetres, then
 * through the geometry engine's INVERSE map into design space. Hit-testing and
 * dragging therefore happen in the flat coordinates the document is stored in,
 * while the user manipulates the curved fan.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  buildFanOutline, designToFan, fanToDesign, GUIDE_BOUNDARIES,
  type CupProfile, type FrustumGeometry, type FanBoundary,
} from '@cupco/geometry';
import { rasteriseFan, fanMmToPixel, type FanRasterTransform } from '@cupco/render';
import type { Design, DesignElement, ElementId } from '@/lib/design';
import {
  drawSelection, drawGuides as drawAlignmentGuides, type EditorMapping,
} from '@/lib/editor';
import { useCanvasEditor } from '@/lib/useCanvasEditor';

export interface FanViewProps {
  profile: CupProfile;
  geom: FrustumGeometry;
  design: Design;
  designCanvas: HTMLCanvasElement | null;
  /** Design-space v the canvas covers. Must match how it was rendered. */
  vRange: { vBottom: number; vTop: number };
  revision: number;
  showGuides: boolean;
  selectedId: ElementId | null;
  onSelect: (id: ElementId | null) => void;
  onChange: (id: ElementId, patch: Partial<DesignElement>) => void;
  /** Called once at the start of a gesture, so a drag costs one undo step. */
  onBeginEdit: () => void;
  eyedropActive: boolean;
  onEyedrop: (canvas: HTMLCanvasElement, px: number, py: number) => void;
  previewDpi?: number;
}

const GUIDE_STYLE: Record<FanBoundary, { stroke: string; dash: number[]; label: string }> = {
  bleed: { stroke: '#f472b6', dash: [8, 5], label: 'Bleed' },
  cut:   { stroke: '#db2777', dash: [],     label: 'Cut' },
  trim:  { stroke: '#0f172a', dash: [],     label: 'Trim' },
  safe:  { stroke: '#0284c7', dash: [4, 4], label: 'Safe area' },
};

/**
 * Resolution used while a drag is in progress.
 *
 * A full-quality warp costs ~150ms, which is far too slow to run per
 * pointer-move: the artwork would lag behind the cursor. Dropping the sampling
 * density (and switching supersampling off) makes it roughly 15x cheaper, so
 * the real artwork tracks the pointer live. Full quality is restored the
 * instant the pointer is released.
 */
const DRAG_DPI = 40;

export default function FanView({
  profile, geom, design, designCanvas, vRange, revision, showGuides,
  selectedId, onSelect, onChange, onBeginEdit, eyedropActive, onEyedrop, previewDpi = 96,
}: FanViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rasterRef = useRef<ImageData | null>(null);
  /**
   * CSS display size, pinned to the FULL-quality dimensions.
   *
   * Dragging renders into a smaller backing store for speed. Without an
   * explicit display size the element would shrink on screen for the duration
   * of the gesture, which reads as the window resizing under the cursor.
   */
  const [displaySize, setDisplaySize] = useState<{ w: number; h: number } | null>(null);
  const [transform, setTransform] = useState<FanRasterTransform | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  const measureRef = useRef<CanvasRenderingContext2D | null>(null);

  const cw = profile.designCanvas.widthPx;
  const ch = profile.designCanvas.heightPx;

  useEffect(() => {
    if (!measureRef.current) {
      measureRef.current = document.createElement('canvas').getContext('2d');
    }
  }, []);

  /** Fan pixel <-> design space, for the shared editor. */
  const mapping = useMemo<EditorMapping>(() => ({
    toDesign: (px, py) => {
      const t = transform;
      if (!t) return { u: 0.5, v: 0.5 };
      return fanToDesign(
        { x: t.originXMm + px * t.mmPerPixel, y: t.originYMm + py * t.mmPerPixel },
        geom,
      );
    },
    toCanvas: (uv) => {
      const t = transform;
      if (!t) return { x: 0, y: 0 };
      const mm = designToFan(uv, geom);
      return fanMmToPixel(mm.x, mm.y, t);
    },
  }), [transform, geom]);

  const { dragging, cursor, activeGuides, handlers } = useCanvasEditor({
    design, selectedId, onSelect, onChange, onBeginEdit, mapping,
    canvasRef, canvasW: cw, canvasH: ch,
    measure: measureRef.current ?? undefined,
  });

  /** Warp the design canvas into the fan raster. */
  const rasterise = useCallback((fast: boolean) => {
    const out = canvasRef.current;
    if (!out || !designCanvas) return;
    const dctx = designCanvas.getContext('2d', { willReadFrequently: true });
    if (!dctx) return;

    const t0 = performance.now();
    const src = dctx.getImageData(0, 0, designCanvas.width, designCanvas.height);
    const { image, transform: tf } = rasteriseFan(
      { width: src.width, height: src.height, data: src.data },
      profile, geom,
      {
        dpi: fast ? DRAG_DPI : previewDpi, boundary: 'bleed',
        supersample: fast ? 1 : 2,
        // Same overscan the export uses. If these two disagreed, the
        // preview would stop being what gets printed.
        designVBottom: vRange.vBottom, designVTop: vRange.vTop,
      },
    );

    // Assigning canvas.width CLEARS the canvas even when the value is
    // unchanged — that was the blank flash on every drag frame. Only resize
    // when the dimensions actually differ.
    if (out.width !== image.width) out.width = image.width;
    if (out.height !== image.height) out.height = image.height;

    rasterRef.current = new ImageData(image.data, image.width, image.height);
    setTransform(tf);
    // Only full-quality renders define the on-screen size.
    if (!fast) {
      setDisplaySize({ w: image.width, h: image.height });
      setMs(Math.round(performance.now() - t0));
    }
  }, [designCanvas, profile, geom, previewDpi, vRange]);

  // Re-warp on any design change. Cheap mode while the pointer is down.
  useEffect(() => {
    const id = requestAnimationFrame(() => rasterise(dragging));
    return () => cancelAnimationFrame(id);
  }, [rasterise, revision, dragging]);

  /** Composite raster + guides + selection. Cheap; runs on selection change. */
  useEffect(() => {
    const out = canvasRef.current;
    const raster = rasterRef.current;
    if (!out || !raster || !transform) return;
    const ctx = out.getContext('2d');
    if (!ctx) return;

    ctx.putImageData(raster, 0, 0);
    if (showGuides) drawGuides(ctx, profile, geom, transform);

    const sel = design.elements.find((e) => e.id === selectedId);
    if (sel) {
      drawSelection(ctx, sel, mapping, cw, ch, measureRef.current ?? undefined);
    }
    drawAlignmentGuides(ctx, activeGuides, mapping);
  }, [transform, showGuides, profile, geom, design.elements, selectedId, mapping, cw, ch, revision, activeGuides]);

  return (
    <div className="fanview">
      <div className="fanview__canvas">
        <canvas
          ref={canvasRef}
          {...handlers}
          onPointerDownCapture={(e) => {
            if (!eyedropActive) return;
            // Sampling must pre-empt selection, or the click would just pick
            // an element instead of a colour.
            e.stopPropagation();
            const c = canvasRef.current;
            if (!c) return;
            const r = c.getBoundingClientRect();
            onEyedrop(c, ((e.clientX - r.left) / r.width) * c.width,
                          ((e.clientY - r.top) / r.height) * c.height);
          }}
          style={{
            cursor: eyedropActive ? 'crosshair' : cursor,
            touchAction: 'none',
            ...(displaySize
              ? { width: `${displaySize.w}px`, height: `${displaySize.h}px`, maxWidth: '100%' }
              : {}),
          }}
        />
      </div>
      <div className="fanview__meta">
        {transform && (
          <>
            <span><strong>{profile.displayName}</strong></span>
            <span>{(transform.widthMm - 6).toFixed(2)} × {(transform.heightMm - 6).toFixed(2)} mm to the bleed</span>
            <span>{dragging ? `live ${DRAG_DPI} dpi` : `preview ${transform.dpi} dpi`}</span>
            {ms !== null && !dragging && <span>{ms} ms</span>}
            <span>{design.elements.length} element{design.elements.length === 1 ? '' : 's'}</span>
          </>
        )}
      </div>
      <div className="legend">
        {showGuides && GUIDE_BOUNDARIES.map((k) => (
          <span key={k} className="legend__item">
            <i style={{ background: GUIDE_STYLE[k].stroke }} />{GUIDE_STYLE[k].label}
          </span>
        ))}
        <span className="legend__item" style={{ marginLeft: 'auto' }}>
          Click to select · drag to move · corners resize · top handle rotates (hold shift to snap)
        </span>
      </div>
    </div>
  );
}

function traceMm(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  t: FanRasterTransform,
): void {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const q = fanMmToPixel(p.x, p.y, t);
    if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
  });
  ctx.closePath();
}

function drawGuides(
  ctx: CanvasRenderingContext2D,
  profile: CupProfile,
  geom: FrustumGeometry,
  t: FanRasterTransform,
): void {
  const scale = 1 / t.mmPerPixel;
  ctx.save();
  ctx.lineJoin = 'round';

  for (const b of GUIDE_BOUNDARIES) {
    const s = GUIDE_STYLE[b];
    traceMm(ctx, buildFanOutline(profile, geom, b, 512).points, t);
    ctx.strokeStyle = s.stroke;
    // The cut is the die, so it is the one drawn heavy.
    ctx.lineWidth = Math.max(1, (b === 'cut' ? 0.5 : 0.25) * scale);
    ctx.setLineDash(s.dash.map((d) => d * scale * 0.5));
    ctx.stroke();
  }
  ctx.restore();
}
