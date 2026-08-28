'use client';

/**
 * Photo mockups: put the artwork on a cup in a real photograph.
 *
 * The operator's job is to say WHERE the cup is. Six handles do that - four
 * corners of the print area and two that set how far the top and bottom edges
 * bow. Everything else is derived, and the result updates as they drag.
 *
 * Calibration is per plate and saved with it, so a photograph is set up once
 * and then works for every customer's artwork thereafter.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { defaultCalibration, platePoint } from '@cupco/geometry';
import type { PlateCalibration } from '@cupco/geometry';
import type { StoredPlate } from '@cupco/persistence';
import { randomId } from '@cupco/persistence';
import { compositeOntoPlate, DEFAULT_MASK } from '@/lib/plate-composite';
import type { MaskOptions } from '@/lib/plate-composite';
import { getStorage } from '@/lib/idb';
import { renderDesignToCanvas } from '@/lib/design';
import type { Design } from '@/lib/design';
import type { CupProfile } from '@cupco/geometry';

type HandleId = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'topBow' | 'bottomBow';

const HANDLE_R = 9;

export default function PlateStudio({
  design, profile, proofCmyk, projectName, onStatus,
}: {
  design: Design;
  profile: CupProfile;
  proofCmyk: boolean;
  projectName: string;
  onStatus: (m: string) => void;
}) {
  const [plates, setPlates] = useState<StoredPlate[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [cal, setCal] = useState<PlateCalibration | null>(null);
  const [mask, setMask] = useState<MaskOptions>(DEFAULT_MASK);
  const [showHandles, setShowHandles] = useState(true);
  /**
   * Whether to print the design's background onto the cup.
   *
   * Decided from the design rather than left to the operator, because getting
   * it wrong is silent in both directions: a white background painted onto a
   * photographed cup lays a flat panel over its real shading and the artwork
   * reads as a sticker, while a coloured background SKIPPED leaves the cup bare
   * and the design looking like it has lost half of itself.
   *
   * Near-paper backgrounds are the cup's own board and are dropped; anything
   * else is a deliberate colour choice and is printed. `null` means follow the
   * design; true/false is an operator override.
   */
  const [cupColourOverride, setCupColourOverride] = useState<boolean | null>(null);
  const [coverage, setCoverage] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const viewRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<HandleId | null>(null);
  const current = plates.find((p) => p.id === currentId) ?? null;

  /* ---- load the plate library ------------------------------------------ */
  const refresh = useCallback(async () => {
    const list = await getStorage().projects.listPlates();
    setPlates(list);
    return list;
  }, []);

  useEffect(() => { void refresh().then((l) => { if (l[0]) setCurrentId(l[0].id); }); }, [refresh]);

  /* ---- decode the selected plate's photograph --------------------------- */
  useEffect(() => {
    let dead = false;
    if (!current) { setImage(null); setCal(null); return; }
    void (async () => {
      const asset = await getStorage().assets.get(current.assetId);
      if (!asset || dead) return;
      const blob = new Blob([new Uint8Array(asset.bytes)], { type: asset.contentType ?? 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.src = url;
      try { await img.decode(); } catch { /* fall through to the null state */ }
      URL.revokeObjectURL(url);
      if (dead) return;
      setImage(img);
      setCal(current.calibration as PlateCalibration);
      setMask(current.mask);
    })();
    return () => { dead = true; };
  }, [current]);

  /** Is the design's background just bare cup board? */
  const backgroundIsPaper = useMemo(() => {
    const hex = design.background.replace('#', '');
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    const n = parseInt(full, 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
    const sat = max <= 0 ? 0 : (max - min) / max;
    return max > 0.9 && sat < 0.06;
  }, [design.background]);

  const cupColour = cupColourOverride ?? !backgroundIsPaper;

  /* ---- the design, rendered once per change ----------------------------- */
  const designCanvas = useMemo(() => {
    const { widthPx, heightPx } = profile.designCanvas;
    // Oversampled: only half the circumference is visible, and the middle of
    // the face is magnified by the projection, so the source has to out-resolve
    // the cup in the photograph by a good margin.
    const w = 2600;
    return renderDesignToCanvas(design, w, Math.round((w * heightPx) / widthPx), undefined,
      { proofCmyk, transparentBackground: !cupColour });
  }, [design, profile, proofCmyk, cupColour]);

  /* ---- composite + handles --------------------------------------------- */
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !image || !cal) return;

    const result = compositeOntoPlate(image, designCanvas, cal, mask);
    setCoverage(result.cupCoverage);

    view.width = result.canvas.width;
    view.height = result.canvas.height;
    const ctx = view.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(result.canvas, 0, 0);

    if (!showHandles) return;
    // The calibration mesh, so it is obvious what the handles are doing.
    ctx.save();
    ctx.strokeStyle = 'rgba(15,118,110,0.85)';
    ctx.lineWidth = Math.max(1.5, view.width / 700);
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const p = platePoint(i / 24, 0, cal);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    for (let i = 24; i >= 0; i--) {
      const p = platePoint(i / 24, 1, cal);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.stroke();

    const r = Math.max(HANDLE_R, view.width / 110);
    const dot = (x: number, y: number, fill: string) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = r * 0.28;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    };
    dot(cal.topLeft.x, cal.topLeft.y, '#0f766e');
    dot(cal.topRight.x, cal.topRight.y, '#0f766e');
    dot(cal.bottomLeft.x, cal.bottomLeft.y, '#0f766e');
    dot(cal.bottomRight.x, cal.bottomRight.y, '#0f766e');
    const tb = platePoint(0.5, 0, cal);
    const bb = platePoint(0.5, 1, cal);
    dot(tb.x, tb.y, '#b45309');
    dot(bb.x, bb.y, '#b45309');
    ctx.restore();
  }, [image, cal, mask, designCanvas, showHandles]);

  /* ---- dragging --------------------------------------------------------- */
  const toImage = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const view = viewRef.current!;
    const rect = view.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * view.width,
      y: ((e.clientY - rect.top) / rect.height) * view.height,
    };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!cal) return;
    const p = toImage(e);
    const grab = Math.max(HANDLE_R * 2, (viewRef.current?.width ?? 800) / 45);
    const near = (q: { x: number; y: number }) => Math.hypot(q.x - p.x, q.y - p.y) < grab;

    const candidates: [HandleId, { x: number; y: number }][] = [
      ['topBow', platePoint(0.5, 0, cal)],
      ['bottomBow', platePoint(0.5, 1, cal)],
      ['topLeft', cal.topLeft], ['topRight', cal.topRight],
      ['bottomLeft', cal.bottomLeft], ['bottomRight', cal.bottomRight],
    ];
    const hit = candidates.find(([, q]) => near(q));
    if (!hit) return;
    dragRef.current = hit[0];
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const id = dragRef.current;
    if (!id || !cal) return;
    const p = toImage(e);
    setCal((c) => {
      if (!c) return c;
      if (id === 'topBow') {
        const flat = (c.topLeft.y + c.topRight.y) / 2;
        return { ...c, topBow: p.y - flat };
      }
      if (id === 'bottomBow') {
        const flat = (c.bottomLeft.y + c.bottomRight.y) / 2;
        return { ...c, bottomBow: p.y - flat };
      }
      return { ...c, [id]: { x: p.x, y: p.y } };
    });
  };

  const onUp = () => { dragRef.current = null; void persist(); };

  const persist = useCallback(async () => {
    if (!current || !cal) return;
    await getStorage().projects.savePlate({
      ...current, calibration: cal, mask, updatedAt: Date.now(),
    });
    await refresh();
  }, [current, cal, mask, refresh]);

  /* ---- adding a plate --------------------------------------------------- */
  const addPlate = useCallback(async (file: File) => {
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const storage = getStorage();
      const assetId = await storage.assets.put('image', bytes, {
        contentType: file.type || 'image/jpeg', name: file.name,
      });
      const url = URL.createObjectURL(new Blob([bytes], { type: file.type || 'image/jpeg' }));
      const img = new Image();
      img.src = url;
      await img.decode();
      URL.revokeObjectURL(url);

      const plate: StoredPlate = {
        id: randomId(),
        name: file.name.replace(/\.[^.]+$/, ''),
        assetId,
        widthPx: img.naturalWidth,
        heightPx: img.naturalHeight,
        calibration: defaultCalibration(img.naturalWidth, img.naturalHeight),
        mask: DEFAULT_MASK,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await storage.projects.savePlate(plate);
      await refresh();
      setCurrentId(plate.id);
      onStatus(`Added plate "${plate.name}" — drag the handles onto the cup`);
    } catch (e) {
      onStatus(`Could not add that plate: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [refresh, onStatus]);

  const download = useCallback(async () => {
    if (!image || !cal || !current) return;
    setBusy(true);
    try {
      const result = compositeOntoPlate(image, designCanvas, cal, mask);
      const blob = await new Promise<Blob | null>((r) => result.canvas.toBlob(r, 'image/jpeg', 0.92));
      if (!blob) throw new Error('could not encode');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safe = projectName.trim().replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'cupco';
      a.href = url;
      a.download = `${safe}-${profile.sizeOz}oz-${current.name}.jpg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
      onStatus(`${a.download} · ${result.canvas.width}×${result.canvas.height} · ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
    } catch (e) {
      onStatus(`Mockup export failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [image, cal, mask, designCanvas, current, profile, projectName, onStatus]);

  /* ---------------------------------------------------------------------- */

  return (
    <div className="plates">
      <div className="plates__bar">
        <label className="plates__add">
          <input type="file" accept="image/png,image/jpeg,image/webp"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void addPlate(f); e.target.value = ''; }} />
          <span>+ Add photo</span>
        </label>

        {plates.map((p) => (
          <button key={p.id} className="chip" data-on={p.id === currentId}
            onClick={() => setCurrentId(p.id)}>{p.name}</button>
        ))}

        {current && (
          <>
            <span className="stagebar__sep" />
            <button className={showHandles ? 'chip chip--on' : 'chip'}
              onClick={() => setShowHandles((v) => !v)}>Handles</button>
            <button className={cupColour ? 'chip chip--on' : 'chip'}
              onClick={() => setCupColourOverride(!cupColour)}
              title={backgroundIsPaper
                ? "The design's background is bare board, so the cup's own paper shows through. Turn on only if you want it printed white."
                : "The design has a coloured background, so it is printed onto the cup. Turn off to show the cup's own paper instead."}>
              Cup colour{cupColourOverride === null ? '' : ' ·'}
            </button>
            <button className="chip chip--primary" onClick={() => void download()} disabled={busy}>
              {busy ? 'Working…' : 'Download JPG'}
            </button>
          </>
        )}
      </div>

      {!current && (
        <div className="plates__empty">
          <strong>Photograph a blank cup and drop it here.</strong>
          <p>
            This is the only route to a genuinely photographic mockup: the table, the light,
            the shadows and the hand are all real, and the artwork is warped onto the cup that
            is already in the picture.
          </p>
          <ul>
            <li><strong>Use a plain white cup</strong>, unprinted. The artwork multiplies onto it, so anything already on it shows through.</li>
            <li><strong>Even light, no harsh shadow across the face.</strong> The cup&apos;s own shading is kept — that is what sells it — but a hard shadow line will cut across the artwork too.</li>
            <li><strong>Fingers, lids and straws in front are fine.</strong> They are detected and kept in front automatically.</li>
            <li>Shoot square-on to the cup where you can; a strong angle needs the visible-span control turned down.</li>
          </ul>
        </div>
      )}

      {current && (
        <div className="plates__work">
          <canvas
            ref={viewRef}
            className="plates__canvas"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />

          <aside className="plates__side">
            <div className="field">
              <label>Fit</label>
              <div className="hint">
                Drag the four <b style={{ color: '#0f766e' }}>green</b> handles to the corners of the
                printable area, and the two <b style={{ color: '#b45309' }}>amber</b> ones until the
                top and bottom edges follow the cup&apos;s curve.
              </div>
            </div>

            <Slider label="Turn the design" value={cal?.centreU ?? 0.5} min={0} max={1} step={0.005}
              onChange={(v) => setCal((c) => (c ? { ...c, centreU: v } : c))} onCommit={persist}
              format={(v) => `${Math.round(v * 360)}°`} />

            <Slider label="Visible wrap" value={cal?.visibleSpan ?? 0.5} min={0.2} max={0.5} step={0.005}
              onChange={(v) => setCal((c) => (c ? { ...c, visibleSpan: v } : c))} onCommit={persist}
              format={(v) => `${Math.round(v * 100)}% of the way round`}
              hint="How much of the circumference the photo shows edge to edge. Half for a square-on cup; less at an angle." />

            <Slider label="Ink strength" value={mask.opacity} min={0.2} max={1} step={0.01}
              onChange={(v) => setMask((m) => ({ ...m, opacity: v }))} onCommit={persist}
              format={(v) => `${Math.round(v * 100)}%`} />

            <Slider label="Keep off dark things" value={mask.minBrightness} min={0.1} max={0.8} step={0.01}
              onChange={(v) => setMask((m) => ({ ...m, minBrightness: v }))} onCommit={persist}
              format={(v) => v.toFixed(2)}
              hint="Raise until the artwork stops climbing onto a dark lid." />

            <Slider label="Keep off skin" value={mask.maxSaturation} min={0.05} max={0.6} step={0.01}
              onChange={(v) => setMask((m) => ({ ...m, maxSaturation: v }))} onCommit={persist}
              format={(v) => v.toFixed(2)}
              hint="Lower until artwork stops climbing onto fingers; raise if it is being eaten off the cup's shaded edge." />

            <Slider label="Reach to the edges" value={0.08 - mask.edgeFade} min={0} max={0.08} step={0.002}
              onChange={(v) => setMask((m) => ({ ...m, edgeFade: 0.08 - v }))} onCommit={persist}
              format={(v) => (v > 0.072 ? 'full' : `${Math.round((v / 0.08) * 100)}%`)}
              hint="How close a coloured design gets to the silhouette. Pull back only if artwork spills onto the background." />

            {coverage !== null && (
              <div className="hint">
                {Math.round(coverage * 100)}% of the calibrated area was judged to be cup.
                {coverage < 0.45 && ' That is low — check the two mask sliders.'}
              </div>
            )}

            <div className="btnrow" style={{ marginTop: 12 }}>
              <button onClick={() => {
                if (!image) return;
                setCal(defaultCalibration(image.naturalWidth, image.naturalHeight));
              }}>Reset fit</button>
              <button onClick={async () => {
                if (!current || !window.confirm(`Delete plate "${current.name}"?`)) return;
                await getStorage().projects.deletePlate(current.id);
                const list = await refresh();
                setCurrentId(list[0]?.id ?? null);
              }}>Delete plate</button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function Slider({
  label, value, min, max, step, onChange, onCommit, format, hint,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; onCommit: () => void;
  format: (v: number) => string; hint?: string;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="row">
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerUp={onCommit} />
        <span className="val">{format(value)}</span>
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
