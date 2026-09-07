'use client';

/**
 * Design view — the unrolled cup, edited directly.
 *
 * The same document and the same interaction logic as the Production Fan view;
 * only the coordinate mapping differs. Here design space maps linearly to
 * canvas pixels, so there is no warp and no expensive resample: edits are
 * immediate at full quality.
 *
 * Editing here rather than on the fan is often easier — the artwork is
 * undistorted — while the fan view shows what actually prints.
 */

import { useEffect, useRef, useMemo, useCallback } from 'react';
import type { CupProfile, FrustumGeometry } from '@cupco/geometry';
import { renderDesign, type Design, type DesignElement, type ElementId } from '@/lib/design';
import { drawSelection, drawGuides, type EditorMapping } from '@/lib/editor';
import { useCanvasEditor } from '@/lib/useCanvasEditor';

export interface DesignViewProps {
  profile: CupProfile;
  geom: FrustumGeometry;
  design: Design;
  revision: number;
  showGuides: boolean;
  selectedId: ElementId | null;
  onSelect: (id: ElementId | null) => void;
  onChange: (id: ElementId, patch: Partial<DesignElement>) => void;
  /** Called once at the start of a gesture, so a drag costs one undo step. */
  onBeginEdit: () => void;
  eyedropActive: boolean;
  onEyedrop: (canvas: HTMLCanvasElement, px: number, py: number) => void;
  /** Render colours as simulated CMYK ink. */
  proofCmyk: boolean;
}

/** On-screen width. The document itself stays at the profile's full size. */
const VIEW_W = 1100;

export default function DesignView({
  profile, geom, design, revision, showGuides, selectedId, onSelect, onChange,
  onBeginEdit, eyedropActive, onEyedrop, proofCmyk,
}: DesignViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const measureRef = useRef<CanvasRenderingContext2D | null>(null);

  const cw = profile.designCanvas.widthPx;
  const ch = profile.designCanvas.heightPx;
  const viewH = Math.round((VIEW_W * ch) / cw);

  useEffect(() => {
    if (!measureRef.current) {
      measureRef.current = document.createElement('canvas').getContext('2d');
    }
  }, []);

  // Linear mapping: design space <-> view pixels. v is flipped because design
  // space counts upward from the cup base while canvas y counts downward.
  const mapping = useMemo<EditorMapping>(() => ({
    toDesign: (px, py) => ({ u: px / VIEW_W, v: 1 - py / viewH }),
    toCanvas: (uv) => ({ x: uv.u * VIEW_W, y: (1 - uv.v) * viewH }),
  }), [viewH]);

  const { cursor, activeGuides, handlers } = useCanvasEditor({
    design, selectedId, onSelect, onChange, onBeginEdit, mapping,
    canvasRef, canvasW: cw, canvasH: ch,
    measure: measureRef.current ?? undefined,
  });

  const paint = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    if (c.width !== VIEW_W) c.width = VIEW_W;
    if (c.height !== viewH) c.height = viewH;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    // Render the document at view scale. Element geometry is normalised, so
    // this is the same drawing code the export-resolution canvas uses.
    renderDesign(ctx, design, VIEW_W, viewH, { proofCmyk });

    if (showGuides) drawDesignGuides(ctx, profile, geom, VIEW_W, viewH);

    const sel = design.elements.find((e) => e.id === selectedId);
    if (sel) drawSelection(ctx, sel, mapping, cw, ch, measureRef.current ?? undefined, 2);
    drawGuides(ctx, activeGuides, mapping, 2);
  }, [design, viewH, showGuides, profile, geom, selectedId, mapping, cw, ch, activeGuides, proofCmyk]);

  useEffect(() => { paint(); }, [paint, revision]);

  return (
    <div className="designview">
      <div className="designview__canvas">
        <canvas
          ref={canvasRef}
          {...handlers}
          onPointerDownCapture={(e) => {
            if (!eyedropActive) return;
            e.stopPropagation();
            const c = canvasRef.current;
            if (!c) return;
            const r = c.getBoundingClientRect();
            onEyedrop(c, ((e.clientX - r.left) / r.width) * c.width,
                          ((e.clientY - r.top) / r.height) * c.height);
          }}
          style={{ cursor: eyedropActive ? 'crosshair' : cursor, touchAction: 'none' }}
        />
      </div>
      <div className="fanview__meta">
        <span><strong>Design space</strong> — the cup unrolled</span>
        <span>{cw}×{ch}px document</span>
        <span>left &amp; right edges are the same seam</span>
      </div>
      <div className="legend">
        {showGuides && (
          <>
            <span className="legend__item"><i style={{ background: '#0284c7' }} />Safe area</span>
            <span className="legend__item"><i style={{ background: '#7c3aed' }} />Seam overlap</span>
          </>
        )}
        <span className="legend__item" style={{ marginLeft: 'auto' }}>
          Click to select · drag to move · corners resize · top handle rotates
        </span>
      </div>
    </div>
  );
}

/**
 * Safe area and seam strips, in design space.
 *
 * Margins are physical millimetres, so they are converted through the derived
 * geometry rather than guessed as a fraction of the canvas: the top inset is a
 * share of the SLANT height, and the seam inset a share of the circumference.
 */
function drawDesignGuides(
  ctx: CanvasRenderingContext2D,
  profile: CupProfile,
  geom: FrustumGeometry,
  w: number,
  h: number,
): void {
  const topFrac = profile.margins.safeTopMm / geom.slantMm;
  const botFrac = profile.margins.safeBottomMm / geom.slantMm;
  const seamFrac = profile.margins.safeSeamMm / geom.topArcMm;
  const overlapFrac = profile.seam.overlapMm / geom.bottomArcMm;

  ctx.save();

  ctx.fillStyle = 'rgba(22,163,74,0.18)';
  ctx.fillRect(0, 0, overlapFrac * w, h);
  ctx.fillRect(w - overlapFrac * w, 0, overlapFrac * w, h);
  ctx.strokeStyle = '#7c3aed';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeRect(0.5, 0.5, overlapFrac * w, h - 1);
  ctx.strokeRect(w - overlapFrac * w - 0.5, 0.5, overlapFrac * w, h - 1);

  ctx.strokeStyle = '#0284c7';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(seamFrac * w, topFrac * h, w - seamFrac * 2 * w, h - (topFrac + botFrac) * h);

  ctx.restore();
}
