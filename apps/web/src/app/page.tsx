'use client';

/**
 * Cupco Studio.
 *
 * One design document feeds the 2D canvas, the interactive 3D cup and the
 * production fan, through the shared geometry engine. Nothing stores a second,
 * separately-warped copy of the artwork.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  deriveFrustum, getProfile, BUILT_IN_PROFILES, boundaryVRange,
} from '@cupco/geometry';
import {
  renderDesignToCanvas, EMPTY_DESIGN, createImageElement, createTextElement,
  createVectorElement, FONT_CHOICES, cssFamily, nextId, withQrUrl, withQrStyle,
  type Design, type DesignElement, type ElementId, type TextElement,
} from '@/lib/design';
import { useHistory } from '@/lib/useHistory';
import { useProjects } from '@/lib/useProjects';
import { captureImageBytes } from '@/lib/serialise';
import { getStorage } from '@/lib/idb';
import ProjectBar from '@/components/ProjectBar';
import { runPreflight } from '@cupco/preflight';
import { toPreflightDesign } from '@/lib/preflight-adapter';
import PreflightPanel from '@/components/PreflightPanel';
import QrStylePicker from '@/components/QrStylePicker';
import MockupGallery from '@/components/MockupGallery';
import PlateStudio from '@/components/PlateStudio';
import Section from '@/components/Section';
import StageToolbar from '@/components/StageToolbar';
import { sampleColor, fillToTemplate, type EyedropTarget, type FillMode } from '@/lib/tools';
import { preloadFonts, resolveWeight } from '@/lib/fonts';
import {
  pickVideoMime, VIDEO_PRESETS, type RecordTurntable, type VideoPresetId,
} from '@/lib/turntable';
import { exportFanPdf, exportFanSvg, buildArtworkTemplateSvg } from '@/lib/exporters';
import {
  exportFanPdfVector, exportFanSvgVector, checkVectorEligibility, collectFills,
} from '@/lib/vector-export';
import {
  isSvgFile, isPdfFile, unsupportedReason,
  loadSvgAsset, loadRasterAsset, loadPdfAsset, traceRaster,
} from '@/lib/upload';
import {
  extractPalette, simulateCmykPrint, totalInkPct, printShift, hexToRgb,
  SHAPES, buildShapeArtwork, rgbToHex, type PaletteEntry, type ShapeId,
} from '@cupco/vector';

/** Colour a new shape arrives in. Neutral, and clearly not final. */
const SHAPE_DEFAULT_FILL = '#334155';
import FanView from '@/components/FanView';
import DesignView from '@/components/DesignView';
import ConceptGallery from '@/components/ConceptGallery';
import type { ConceptSource } from '@/lib/concepts-adapter';

const CupViewer = dynamic(() => import('@/components/CupViewer'), {
  ssr: false,
  loading: () => (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: '#94a3b8' }}>Loading 3D…</div>
  ),
});

type Tab = 'concepts' | 'design' | '3d' | 'fan' | 'mockups';
const EXPORT_DPIS = [300, 450, 600] as const;

export default function Page() {
  const [profileId, setProfileId] = useState('8oz-single-wall');
  const [tab, setTab] = useState<Tab>('fan');
  // Start with background only, so the design is vector-eligible immediately.
  const history = useHistory<Design>({ ...EMPTY_DESIGN, elements: [] });
  const design = history.state;
  /** Discrete edit — one undo step. */
  const setDesign = history.commit;
  const [selectedId, setSelectedId] = useState<ElementId | null>(null);
  const [revision, setRevision] = useState(0);
  const [spin, setSpin] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const [showGuides, setShowGuides] = useState(true);
  const [exportDpi, setExportDpi] = useState<number>(600);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [inks, setInks] = useState<PaletteEntry[]>([]);
  const [showInks, setShowInks] = useState(false);
  const [proofCmyk, setProofCmyk] = useState(false);
  const [eyedrop, setEyedrop] = useState<EyedropTarget | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const [brandName, setBrandName] = useState('');
  const [mockupMode, setMockupMode] = useState<'photo' | 'rendered'>('photo');
  /**
   * Internal clipboard.
   *
   * Deliberately not the system clipboard: elements hold live objects — parsed
   * vector paths, decoded images, generated QR matrices — that cannot survive
   * a round trip through text, and serialising them would silently degrade the
   * artwork. Copying within the app keeps them intact.
   */
  const clipboardRef = useRef<DesignElement | null>(null);
  const [recordProgress, setRecordProgress] = useState<string | null>(null);
  const recordRef = useRef<RecordTurntable | null>(null);
  const [videoPreset, setVideoPreset] = useState<VideoPresetId>('standard');

  const designCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fanCanvasRef = useRef<HTMLCanvasElement | null>(null);

  /** Off-screen context used only to measure text, matching the editor's own. */
  const measureRef = useRef<CanvasRenderingContext2D | null>(null);
  if (typeof document !== 'undefined' && !measureRef.current) {
    measureRef.current = document.createElement('canvas').getContext('2d');
  }

  const profile = useMemo(() => getProfile(profileId)!, [profileId]);
  const geom = useMemo(() => deriveFrustum(profile.dimensions), [profile]);
  /**
   * Preflight, recomputed on every edit.
   *
   * Cheap enough to run live - the rules are arithmetic over a handful of
   * elements - and running it live is what makes it useful. A check the
   * operator has to remember to press is a check that gets skipped.
   *
   * `fontsReady` is a dependency because text extents change once the real
   * font metrics load, and with them the safe-area verdict.
   */
  const preflight = useMemo(() => {
    const { widthPx, heightPx } = profile.designCanvas;
    return runPreflight(
      toPreflightDesign(design, widthPx, heightPx, measureRef.current ?? undefined),
      profile,
      { geom },
    );
  }, [design, profile, geom, fontsReady]);
  const selected = design.elements.find((e) => e.id === selectedId) ?? null;

  /* ---- persistence ------------------------------------------------------- */

  /**
   * A small preview for the project list.
   *
   * Rendered at 200px wide - about 1/14 of the design canvas - and encoded as
   * JPEG, because this is written on every autosave and a full-size PNG would
   * cost more to store than most of the artwork on the cup.
   */
  const makeThumbnail = useCallback((d: Design): string | null => {
    try {
      const { widthPx, heightPx } = profile.designCanvas;
      const w = 200;
      const canvas = renderDesignToCanvas(d, w, Math.round((w * heightPx) / widthPx));
      return canvas.toDataURL('image/jpeg', 0.7);
    } catch {
      return null;
    }
  }, [profile]);

  const applyLoadedDesign = useCallback((next: Design) => {
    // reset, not commit: a design that has just been opened is not an edit to
    // the previous one, and undo must not walk backwards into another project.
    history.reset(next);
    setSelectedId(null);
  }, [history]);

  const projects = useProjects({
    design,
    profileId,
    applyDesign: applyLoadedDesign,
    applyProfileId: setProfileId,
    makeThumbnail,
    onNotice: setStatus,
  });

  /**
   * How much design space the FAN canvas covers.
   *
   * The cup wall is v=0..1, and that is all the 3D preview, the mockups and
   * the thumbnails ever want. The production fan is bigger than the cup at
   * both ends, so anything rendered only over 0..1 has nothing to show out
   * there and the warp falls back to smearing the edge row. Rendering the fan
   * from its own, taller canvas is what lets artwork pushed towards the die
   * actually print.
   */
  const fanVRange = useMemo(() => boundaryVRange(profile, geom, 'bleed'), [profile, geom]);

  useEffect(() => {
    const { widthPx, heightPx } = profile.designCanvas;
    designCanvasRef.current = renderDesignToCanvas(
      design, widthPx, heightPx, designCanvasRef.current ?? undefined, { proofCmyk },
    );
    // Same pixels per unit v, more of them - so the design is not squashed,
    // the canvas simply shows more than the cup.
    const span = fanVRange.vTop - fanVRange.vBottom;
    fanCanvasRef.current = renderDesignToCanvas(
      design, widthPx, Math.round(heightPx * span), fanCanvasRef.current ?? undefined,
      { proofCmyk, vRange: { bottom: fanVRange.vBottom, top: fanVRange.vTop } },
    );
    setRevision((r) => r + 1);
  }, [design, profile, proofCmyk, fontsReady, fanVRange]);

  /* ---- element operations ------------------------------------------------ */

  // Outlining text needs the font FILE, so load them all up front rather than
  // discovering a missing one at export time.
  useEffect(() => {
    let alive = true;
    preloadFonts().then(() => { if (alive) setFontsReady(true); });
    return () => { alive = false; };
  }, []);

  /**
   * Artwork the concept engine works from.
   *
   * Uses the most recent VECTOR asset: concepts reposition and rescale the
   * mark freely, which only stays sharp if it is resolution-independent. A
   * bitmap has to be traced first, and the empty state says so.
   */
  const conceptSource = useMemo<ConceptSource | null>(() => {
    for (let i = design.elements.length - 1; i >= 0; i--) {
      const el = design.elements[i]!;
      if (el.type === 'vector') return { art: el.art, name: el.name };
    }
    return null;
  }, [design.elements]);

  const applyConcept = useCallback((next: Design, label: string) => {
    // A discrete edit, so one undo returns to whatever was there before.
    setDesign(next);
    setSelectedId(null);
    setTab('design');
    setStatus(`Applied “${label}” — every element is editable`);
  }, [setDesign]);

  const vectorCheck = useMemo(
    () => checkVectorEligibility(design),
    // fontsReady participates because eligibility depends on loaded fonts.
    [design, fontsReady], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Rebuild the ink list when the artwork changes, but KEEP any values an
  // operator has typed in: a re-derived palette must never silently discard a
  // brand's exact ink specification.
  useEffect(() => {
    const fresh = extractPalette(collectFills(design));
    setInks((prev) => fresh.map((f) => {
      const kept = prev.find((p) => p.overridden && p.hex === f.hex);
      return kept ? { ...f, cmyk: kept.cmyk, overridden: true } : f;
    }));
  }, [design]);

  const setInkChannel = useCallback((hex: string, ch: 'c' | 'm' | 'y' | 'k', pct: number) => {
    setInks((prev) => prev.map((p) => p.hex === hex
      ? { ...p, overridden: true, cmyk: { ...p.cmyk, [ch]: Math.max(0, Math.min(100, pct)) / 100 } }
      : p));
  }, []);

  /** Continuous edit (drag frame) — no history entry; see beginEdit. */
  const patchElement = useCallback((id: ElementId, patch: Partial<DesignElement>) => {
    history.update((d) => ({
      ...d,
      elements: d.elements.map((el) => (el.id === id ? { ...el, ...patch } as DesignElement : el)),
    }));
  }, [history]);

  /** Discrete edit from a control — one history entry. */
  const commitElement = useCallback((id: ElementId, patch: Partial<DesignElement>) => {
    history.commit((d) => ({
      ...d,
      elements: d.elements.map((el) => (el.id === id ? { ...el, ...patch } as DesignElement : el)),
    }));
  }, [history]);

  /** Called once when a drag gesture starts, so it costs one undo. */
  const beginEdit = useCallback(() => history.begin(), [history]);

  const addFiles = useCallback(async (files: FileList) => {
    const list = Array.from(files);
    const notes: string[] = [];

    for (let i = 0; i < list.length; i++) {
      const file = list[i]!;
      // Stagger multiple uploads so they don't stack invisibly.
      const u = 0.5 + ((i % 3) - 1) * 0.18;
      const v = 0.55 - Math.floor(i / 3) * 0.2;
      const reason = unsupportedReason(file);
      if (reason) {
        notes.push(`${file.name}: ${reason}`);
        continue;
      }

      try {
        if (isSvgFile(file)) {
          const a = await loadSvgAsset(file);
          if (!a.art || a.shapeCount === 0) {
            notes.push(`${file.name}: no shapes found`);
            continue;
          }
          const el = { ...createVectorElement(a.art!, file.name, false), u, v };
          setDesign((d) => ({ ...d, elements: [...d.elements, el] }));
          setSelectedId(el.id);
          notes.push(`${file.name}: ${a.shapeCount} vector shapes — see the Concepts tab`);
          setTab('concepts');
          if (a.warnings.length) notes.push(...a.warnings.map((w) => `${file.name}: ${w}`));
        } else {
          // PDF and AI are rendered to a bitmap first; everything else is
          // already one.
          const rendered = isPdfFile(file);
          const a = rendered ? await loadPdfAsset(file) : await loadRasterAsset(file);
          // Capture the bytes now, while the file is still in hand. A decoded
          // HTMLImageElement cannot be turned back into the file it came from.
          const { bytes, contentType } = await captureImageBytes(file, a.image!, rendered);
          const assetId = await getStorage().assets
            .put('image', bytes, { contentType, name: file.name });
          const el = { ...createImageElement(a.image!, file.name, assetId), u, v };
          setDesign((d) => ({ ...d, elements: [...d.elements, el] }));
          setSelectedId(el.id);
          notes.push(
            a.warnings.length
              ? `${file.name}: ${a.warnings.join(' · ')}`
              : `${file.name}: bitmap — trace it for vector CMYK`,
          );
        }
      } catch (e) {
        notes.push(`${file.name}: could not be read — ${(e as Error).message}`);
      }
    }
    setStatus(notes.join(' · '));
  }, []);

  /** Replace a bitmap element with a traced vector version of itself. */
  const traceElement = useCallback(async (id: ElementId) => {
    const el = design.elements.find((e) => e.id === id);
    if (!el || el.type !== 'image') return;
    setBusy(true);
    setStatus(`Tracing ${el.name}…`);
    try {
      const a = await traceRaster(el.image, el.name);
      if (!a.art || a.shapeCount === 0) {
        setStatus(a.warnings[0] ?? 'Tracing produced no shapes');
        return;
      }
      setDesign((d) => ({
        ...d,
        elements: d.elements.map((x) => x.id === id
          // Keep the placement the operator already chose; only the
          // representation changes from bitmap to paths.
          ? {
              ...createVectorElement(a.art!, a.name, true),
              u: x.u, v: x.v, rotation: x.rotation,
              widthU: x.type === 'image' || x.type === 'vector' ? x.widthU : 0.25,
            }
          : x),
      }));
      setStatus(`Traced ${el.name} — ${a.shapeCount} shapes, now exports as vector CMYK`);
      setSelectedId(null);
      setTab('concepts');
    } catch (e) {
      setStatus(`Trace failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [design.elements]);

  const removeElement = useCallback((id: ElementId) => {
    setDesign((d) => ({ ...d, elements: d.elements.filter((e) => e.id !== id) }));
    setSelectedId((s) => (s === id ? null : s));
  }, [setDesign]);

  const reorder = useCallback((id: ElementId, dir: -1 | 1) => {
    setDesign((d) => {
      const i = d.elements.findIndex((e) => e.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.elements.length) return d;
      const els = [...d.elements];
      [els[i], els[j]] = [els[j]!, els[i]!];
      return { ...d, elements: els };
    });
  }, []);

  /* ---- exports ----------------------------------------------------------- */

  const copySelected = useCallback((cut: boolean) => {
    const el = design.elements.find((e) => e.id === selectedId);
    if (!el) return;
    clipboardRef.current = el;
    if (cut) {
      removeElement(el.id);
      setStatus(`Cut ${el.name}`);
    } else {
      setStatus(`Copied ${el.name}`);
    }
  }, [design.elements, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pasteElement = useCallback(() => {
    const src = clipboardRef.current;
    if (!src) return;
    // Offset the copy so it is visibly a second object rather than appearing
    // to have done nothing, and wrap u so it stays on the cup.
    const copy = {
      ...src,
      id: nextId(),
      u: ((src.u + 0.06) % 1 + 1) % 1,
      v: Math.max(0, Math.min(1, src.v - 0.05)),
      name: src.name.endsWith(' copy') ? src.name : `${src.name} copy`,
    } as DesignElement;
    setDesign((d) => ({ ...d, elements: [...d.elements, copy] }));
    setSelectedId(copy.id);
    setStatus(`Pasted ${copy.name}`);
  }, [setDesign]);

  /**
   * Keyboard shortcuts.
   *
   * Ignored while a text field has focus, otherwise typing "z" in the content
   * box would undo, and backspace would delete the element being edited.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        if (typing) return; // let the field handle its own undo
        e.preventDefault();
        if (e.shiftKey) history.redo(); else history.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        if (typing) return;
        e.preventDefault();
        history.redo();
        return;
      }
      if (mod && !typing && ['c', 'x', 'v'].includes(e.key.toLowerCase())) {
        const k = e.key.toLowerCase();
        // Only intercept when there is something to act on, so the browser's
        // own copy/paste still works for selected page text.
        if ((k === 'c' || k === 'x') && !selectedId) return;
        if (k === 'v' && !clipboardRef.current) return;
        e.preventDefault();
        if (k === 'c') copySelected(false);
        else if (k === 'x') copySelected(true);
        else pasteElement();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && selectedId) {
        e.preventDefault();
        removeElement(selectedId);
        return;
      }
      if (e.key === 'Escape') {
        setEyedrop(null);
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // removeElement is stable; selectedId and history change with state.
  }, [history, selectedId, copySelected, pasteElement]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Sample a colour from the visible canvas and apply it. */
  const onEyedrop = useCallback((canvas: HTMLCanvasElement, px: number, py: number) => {
    const hex = sampleColor(canvas, px, py);
    if (!hex) { setStatus('Nothing to sample there'); return; }
    if (eyedrop === 'background') {
      setDesign((d) => ({ ...d, background: hex }));
      setStatus(`Background set to ${hex}`);
    } else if (eyedrop === 'text' && selectedId) {
      commitElement(selectedId, { color: hex } as Partial<DesignElement>);
      setStatus(`Text colour set to ${hex}`);
    }
    setEyedrop(null);
  }, [eyedrop, selectedId, setDesign, commitElement]);

  const onFill = useCallback((mode: FillMode) => {
    if (!selectedId || !selected) return;
    commitElement(selectedId, fillToTemplate(selected, profile, geom, mode));
    setStatus(mode === 'bleed'
      ? 'Filled past the cut line — artwork runs off every edge'
      : 'Fitted inside the safe area');
  }, [selectedId, selected, profile, geom, commitElement]);

  /**
   * Add a basic shape.
   *
   * Built as a VECTOR element, not a new element type: a rectangle is then
   * the same kind of thing as an imported logo and needs no new case in the
   * renderer, the fan warp, the exporter or the document schema.
   */
  const addShape = useCallback((id: ShapeId) => {
    const el = createVectorElement(
      buildShapeArtwork(id, hexToRgb(SHAPE_DEFAULT_FILL)),
      SHAPES.find((s) => s.id === id)?.label ?? 'Shape',
      false,
    );
    setDesign((d) => ({ ...d, elements: [...d.elements, el] }));
    setSelectedId(el.id);
  }, []);

  /** Record a 360 turntable as a video file. */
  const exportVideo = useCallback(async () => {
    const record = recordRef.current;
    if (!record) { setStatus('Open the 3D Preview tab first'); return; }

    const preset = VIDEO_PRESETS.find((p) => p.id === videoPreset)!;
    const wasSpinning = spin;
    setSpin(false);
    setBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 80));
      const r = await record(preset.durationMs, preset.fps, (f) =>
        setRecordProgress(`Recording ${Math.round(f * 100)}%`));

      download(r.blob, `cupco-${profile.sizeOz}oz-turntable.${r.extension}`);
      setStatus(
        `Turntable ${r.extension.toUpperCase()} · ${r.width}×${r.height} · ` +
        `${(r.durationMs / 1000).toFixed(0)}s · ${(r.blob.size / 1024 / 1024).toFixed(2)} MB`,
      );
    } catch (e) {
      setStatus(`Video export failed: ${(e as Error).message}`);
    } finally {
      setRecordProgress(null);
      setBusy(false);
      setSpin(wasSpinning);
    }
  }, [videoPreset, spin, profile]);


  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
  };

  const runExport = useCallback(async (kind: 'pdf' | 'svg') => {
    // The FAN canvas: it carries the overscan the die needs.
    const canvas = fanCanvasRef.current;
    if (!canvas) return;
    setBusy(true);
    try {
      if (vectorCheck.eligible) {
        // True vector: resolution-independent, and carries real ink values.
        if (kind === 'pdf') {
          const r = await exportFanPdfVector(design, profile, geom, inks, undefined, setStatus);
          download(r.blob, `cupco-${profile.sizeOz}oz-fan-vector-cmyk.pdf`);
          setStatus(
            `Exported vector CMYK PDF · ${r.pathCount} paths, ${r.pointCount.toLocaleString()} points · ` +
            `${r.widthMm.toFixed(1)}×${r.heightMm.toFixed(1)}mm · ${(r.blob.size / 1024).toFixed(0)}KB · ${r.ms}ms`,
          );
        } else {
          const r = exportFanSvgVector(design, profile, geom, inks);
          download(r.blob, `cupco-${profile.sizeOz}oz-fan-vector.svg`);
          setStatus(`Exported vector SVG · ${r.pathCount} paths, ${r.pointCount.toLocaleString()} points · ${(r.blob.size / 1024).toFixed(0)}KB`);
        }
        return;
      }

      // Something in the design cannot be vector — say which, then rasterise.
      const why = vectorCheck.blockers.map((b) => b.name).join(', ');
      const fn = kind === 'pdf' ? exportFanPdf : exportFanSvg;
      const r = await fn(profile, geom, canvas, exportDpi, fanVRange, setStatus);
      download(r.blob, `cupco-${profile.sizeOz}oz-fan-${exportDpi}dpi.${kind}`);
      setStatus(
        `Exported RGB raster ${kind.toUpperCase()} @ ${exportDpi}dpi (${r.widthPx}×${r.heightPx}px) — ` +
        `not vector because of: ${why}`,
      );
    } catch (e) {
      setStatus(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [profile, geom, exportDpi, design, inks, vectorCheck]);

  const downloadTemplate = useCallback(() => {
    download(
      new Blob([buildArtworkTemplateSvg(profile)], { type: 'image/svg+xml' }),
      `cupco-${profile.sizeOz}oz-artwork-template.svg`,
    );
    setStatus('Downloaded artwork template (design space, 1:1 mm)');
  }, [profile]);

  /** The design's QR code, if it has one. Surfaced without needing selection. */
  const qrElement = design.elements.find(
    (e): e is Extract<DesignElement, { type: 'qr' }> => e.type === 'qr',
  );

  // Export is blocked by anything preflight calls an error, which subsumes the
  // placeholder-dimension check and adds the ones artwork can cause.
  const blocked = !preflight.passed;
  const videoExt = pickVideoMime()?.extension ?? 'video';

  return (
    <div className="app">
      <aside className="side">
        <div className="side__head">
          <h1>Cupco Studio</h1>
          <span className="sub">8oz</span>
          <div className="btnrow">
            <button onClick={history.undo} disabled={!history.canUndo}
              title="Undo (⌘Z / Ctrl+Z)">↶</button>
            <button onClick={history.redo} disabled={!history.canRedo}
              title="Redo (⇧⌘Z / Ctrl+Y)">↷</button>
          </div>
        </div>

        <ProjectBar api={projects} />

        <PreflightPanel
          report={preflight}
          onSelect={(id) => {
            setSelectedId(id);
            if (tab === 'concepts' || tab === '3d') setTab('design');
          }}
        />

        <Section title="Cup &amp; colour" summary={profile.displayName}
          tone={profile.dimensionsProvenance === 'PLACEHOLDER' ? 'warn' : undefined}>
  <div className="field">
          <label htmlFor="profile">Cup size</label>
          <select id="profile" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
            {BUILT_IN_PROFILES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}{p.dimensionsProvenance === 'PLACEHOLDER' ? ' — placeholder' : ''}
              </option>
            ))}
          </select>
  </div>
        <div className="field">
          <label htmlFor="bg">Background colour</label>
          <div className="row">
            <input id="bg" type="color" value={design.background}
              onChange={(e) => setDesign((d) => ({ ...d, background: e.target.value }))} />
            <span className="val">{design.background}</span>
            <button
              className={eyedrop === 'background' ? 'toggle toggle--on' : ''}
              style={{ padding: '4px 8px' }}
              title="Pick a colour from the artwork"
              onClick={() => setEyedrop((v) => (v === 'background' ? null : 'background'))}>
              ⌖
            </button>
          </div>
          {eyedrop && <div className="hint">Click anywhere on the artwork to sample a colour · Esc cancels</div>}
        </div>
        <table className="specs">
          <tbody>
            <tr><td>Top Ø</td><td>{profile.dimensions.topDiameterMm} mm</td></tr>
            <tr><td>Bottom Ø</td><td>{profile.dimensions.bottomDiameterMm} mm</td></tr>
            <tr><td>Height</td><td>{profile.dimensions.heightMm} mm</td></tr>
            <tr><td>Sector</td><td>{geom.sectorAngleDeg.toFixed(3)}°</td></tr>
            <tr><td>R bottom</td><td>{geom.rBottomMm.toFixed(3)} mm</td></tr>
            <tr><td>R top</td><td>{geom.rTopMm.toFixed(3)} mm</td></tr>
            <tr><td>Cut — top / base</td><td>{profile.margins.cut.topMm} / {profile.margins.cut.bottomMm} mm</td></tr>
            <tr><td>Cut — left seam</td><td>{profile.margins.cut.left.atTopMm} / {profile.margins.cut.left.atBottomMm} mm (top / base)</td></tr>
            <tr><td>Cut — right seam</td><td>{profile.margins.cut.right.atTopMm} / {profile.margins.cut.right.atBottomMm} mm (top / base)</td></tr>
            <tr><td>Bleed beyond the cut</td><td>{profile.margins.bleedMm} mm</td></tr>
          </tbody>
        </table>
        </Section>

        <Section title="Artwork" defaultOpen
          summary={design.elements.length === 0 ? 'nothing yet'
            : `${design.elements.length} layer${design.elements.length === 1 ? '' : 's'}`}>
        <div className="field">
          <label htmlFor="art">Add artwork</label>
          <input id="art" type="file" multiple
            accept="image/svg+xml,image/png,image/jpeg,image/webp,application/pdf,.ai,.svg,.pdf"
            onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ''; }} />
          <div className="hint">
            <strong>SVG is best</strong> — it stays vector to the printer. Bitmaps and
            PDFs arrive as pixels; trace one with ⟡ on its layer to get vector back.
          </div>
        </div>
        <div className="field">
          <label>Layers <span className="hint" style={{ float: 'right', fontWeight: 400 }}>top = front</span></label>
          <ul className="layers">
            {[...design.elements].reverse().map((el) => (
              <li key={el.id} data-sel={el.id === selectedId} onClick={() => setSelectedId(el.id)}>
                <span className="layers__name" title={el.name}>
                  {el.type === 'image' ? '▣' : el.type === 'vector' ? '◆'
                    : el.type === 'band' ? '▬' : el.type === 'qr' ? '▦' : 'T'} {el.name}
                  {el.type === 'vector' && <em className="badge badge--ok">vector</em>}
                  {el.type === 'image' && <em className="badge badge--warn">bitmap</em>}
                </span>
                <span className="layers__ops">
                  {el.type === 'image' && (
                    <button onClick={(e) => { e.stopPropagation(); traceElement(el.id); }}
                      title="Trace to vector — enables true CMYK export" disabled={busy}>⟡</button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); reorder(el.id, 1); }} title="Bring forward">↑</button>
                  <button onClick={(e) => { e.stopPropagation(); reorder(el.id, -1); }} title="Send back">↓</button>
                  <button onClick={(e) => { e.stopPropagation(); removeElement(el.id); }} title="Delete">×</button>
                </span>
              </li>
            ))}
            {design.elements.length === 0 && <li className="layers__empty">No artwork yet</li>}
          </ul>
          <div className="btnrow" style={{ marginTop: 8 }}>
            <button onClick={() => {
              const el = createTextElement('CUPCO');
              setDesign((d) => ({ ...d, elements: [...d.elements, el] }));
              setSelectedId(el.id);
            }}>
              + Text
            </button>
          </div>
          <label className="txt__lbl" style={{ marginTop: 10 }}>Add a shape</label>
          <div className="btnrow btnrow--wrap">
            {SHAPES.map((sh) => (
              <button key={sh.id} onClick={() => addShape(sh.id)}
                title={`Add a ${sh.label.toLowerCase()} as editable vector artwork`}>
                {sh.label}
              </button>
            ))}
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            Shapes are real vector artwork — they export as CMYK paths, not pixels.
          </div>
        </div>
        <div className="field">
          <label htmlFor="brand">Brand name <span className="hint" style={{ fontWeight: 400 }}>optional</span></label>
          <input id="brand" type="text" value={brandName} placeholder="e.g. Cupco"
            onChange={(e) => setBrandName(e.target.value)} />
          <div className="hint">Used by concepts that pair the mark with type.</div>
        </div>
        </Section>

        <Section
          title={selected ? `Selected — ${selected.name}` : 'Selected'}
          openOn={selectedId}
          summary={selected ? undefined : 'nothing selected'}>
        {selected && (
          <div className="field panel">
            <label>Selected — {selected.name}</label>
            {selected.type === 'qr' ? (
              <QrControls el={selected}
                onUrl={(url) => commitElement(selected.id, withQrUrl(selected, url))} />
            ) : selected.type === 'text' ? (
              <TextControls el={selected}
                onPatch={(p) => commitElement(selected.id, p)}
                onPickColour={() => setEyedrop((v) => (v === 'text' ? null : 'text'))}
                picking={eyedrop === 'text'} />
            ) : (
              <BlockControls el={selected} onPatch={(p) => commitElement(selected.id, p)} />
            )}
            <label className="txt__lbl" style={{ marginTop: 10 }}>Fill template</label>
            <div className="btnrow">
              <button onClick={() => onFill('bleed-h')} title="Run off the left and right edges, out to the bleed. Height and vertical position are left alone.">
                Bleed ↔ across
              </button>
              <button onClick={() => onFill('bleed-v')} title="Run off the top and bottom edges, out to the bleed. Width and horizontal position are left alone.">
                Bleed ↕ down
              </button>
            </div>
            <div className="btnrow" style={{ marginTop: 6 }}>
              <button onClick={() => onFill('bleed')} title="Cover the whole blank and the bleed beyond it, running off every edge. Scales to cover, so it overshoots on one axis.">
                Bleed all edges
              </button>
              <button onClick={() => onFill('safe')} title="Fit entirely inside the safe area">
                Fit to safe area
              </button>
            </div>
            <div className="hint" style={{ marginTop: 8 }}>
              Drag to move · corners resize · top handle rotates · ⌫ deletes
            </div>
          </div>
        )}
        {!selected && (
          <div className="hint">Click an element on the canvas, or a layer above.</div>
        )}
        </Section>

        {qrElement && (
          <Section title="QR code" defaultOpen
            summary={qrElement.live ? 'live' : 'placeholder'}
            tone={qrElement.live ? 'ok' : 'err'}>
        {qrElement && (
          <div className="field panel">
            <label htmlFor="qrurl">
              QR code address
              {qrElement.live
                ? <em className="badge badge--ok">live</em>
                : <em className="badge badge--warn">placeholder</em>}
            </label>
            <input id="qrurl" type="text" value={qrElement.url} placeholder="cupco.com.au"
              onChange={(e) => commitElement(qrElement.id, withQrUrl(qrElement, e.target.value))} />
            <div className="hint">
              {qrElement.live
                ? `Scans to ${qrElement.url.startsWith('http') ? qrElement.url : `https://${qrElement.url}`} · ${qrElement.moduleCount}×${qrElement.moduleCount} modules`
                : 'Type your website and the placeholder becomes a working code.'}
            </div>
            <QrStylePicker
              url={qrElement.url}
              styleId={qrElement.styleId}
              onChange={(id) => commitElement(qrElement.id, withQrStyle(qrElement, id))}
            />
            <div className="hint">
              Style changes the drawing, never the data. Each one is decoded by two
              independent scanners in the tests, at print size and blurred.
            </div>
          </div>
        )}
          </Section>
        )}

        <Section title="Print inks"
          summary={vectorCheck.eligible ? 'Vector CMYK ready' : 'RGB raster fallback'}
          tone={vectorCheck.eligible ? 'ok' : 'warn'}>
        <div className="field">
          <label>
            Print inks (CMYK)
            <button style={{ float: 'right', padding: '0 6px', fontSize: 11 }}
              onClick={() => setShowInks((v) => !v)}>{showInks ? 'hide' : 'show'}</button>
          </label>
          <div className={`note ${vectorCheck.eligible ? 'note--ok' : 'note--warn'}`} style={{ marginBottom: 8 }}>
            <strong>{vectorCheck.eligible ? 'Vector CMYK ready' : 'Will export as RGB raster'}</strong>
            {vectorCheck.eligible
              ? 'Exports as real paths with exact ink values.'
              : vectorCheck.blockers.map((b) => `${b.name}: ${b.reason}`).join(' · ')}
          </div>
          {showInks && (
            <ul className="inks">
              {inks.map((p) => {
                const preview = simulateCmykPrint(p.cmyk);
                return (
                  <li key={p.hex}>
                    <span className="inks__sw" style={{ background: `rgb(${preview.join(',')})` }} />
                    <span className="inks__hex">
                      {p.hex}
                      {p.overridden && <em className="badge badge--ok">exact</em>}
                      <small>
                        {totalInkPct(p.cmyk).toFixed(0)}% ink
                        {printShift(hexToRgb(p.hex)) > 60 && ' · shifts'}
                      </small>
                    </span>
                    <span className="inks__ch">
                      {(['c', 'm', 'y', 'k'] as const).map((ch) => (
                        <label key={ch}>
                          {ch.toUpperCase()}
                          <input type="number" min={0} max={100}
                            value={Math.round(p.cmyk[ch] * 100)}
                            onChange={(e) => setInkChannel(p.hex, ch, Number(e.target.value))} />
                        </label>
                      ))}
                    </span>
                  </li>
                );
              })}
              {inks.length === 0 && <li className="layers__empty">No colours yet</li>}
            </ul>
          )}
          <div className="hint">
            An unmanaged conversion — fine as a default. For critical brand colours,
            <strong> type the exact ink percentages</strong> and they go into the PDF verbatim.
          </div>
        </div>
        </Section>

        <Section title="Export" defaultOpen
          summary={blocked ? 'blocked' : vectorCheck.eligible ? 'vector CMYK' : 'raster'}
          tone={blocked ? 'err' : vectorCheck.eligible ? 'ok' : 'warn'}>
        <div className="field">
          <label htmlFor="dpi">Export resolution <span className="hint" style={{ fontWeight: 400 }}>(raster fallback only)</span></label>
          <select id="dpi" value={exportDpi} onChange={(e) => setExportDpi(Number(e.target.value))}>
            {EXPORT_DPIS.map((d) => (
              <option key={d} value={d}>{d} dpi{d === 600 ? ' — highest' : ''}</option>
            ))}
          </select>
          <div className="btnrow" style={{ marginTop: 8 }}>
            <button className="primary" onClick={() => runExport('pdf')} disabled={busy || blocked}>
              {busy ? 'Working…' : vectorCheck.eligible ? 'Fan PDF — vector CMYK' : 'Fan PDF — raster'}
            </button>
            <button onClick={() => runExport('svg')} disabled={busy || blocked}>
              {vectorCheck.eligible ? 'Fan SVG — vector' : 'Fan SVG — raster'}
            </button>
          </div>
          <div className="btnrow" style={{ marginTop: 8 }}>
            <button onClick={downloadTemplate}>Artwork template SVG</button>
          </div>
          <div className="hint">
            Genuine CMYK ink, but <strong>not PDF/X</strong> — no output intent or embedded
            ICC profile, so prepress cannot verify it against a press condition.
          </div>
        </div>
        </Section>














      </aside>

      <main className="main">
        <nav className="tabs">
          <button data-active={tab === 'concepts'} onClick={() => setTab('concepts')}>
            Concepts{conceptSource ? '' : ' ·'}
          </button>
          <button data-active={tab === 'design'} onClick={() => setTab('design')}>Design</button>
          <button data-active={tab === '3d'} onClick={() => setTab('3d')}>3D Preview</button>
          <button data-active={tab === 'fan'} onClick={() => setTab('fan')}>Production Fan</button>
          <button data-active={tab === 'mockups'} onClick={() => setTab('mockups')}>Mockups</button>

          <StageToolbar
            tab={tab}
            proofCmyk={proofCmyk} onProofCmyk={() => setProofCmyk((v) => !v)}
            showGuides={showGuides} onShowGuides={() => setShowGuides((g) => !g)}
            spin={spin} onSpin={() => setSpin((v) => !v)}
            onResetCamera={() => setResetToken((t) => t + 1)}
            videoPreset={videoPreset} onVideoPreset={setVideoPreset}
            mockupMode={mockupMode} onMockupMode={setMockupMode}
            onExportTurntable={exportVideo}
            busy={busy} progress={recordProgress} videoExt={videoExt}
          />
        </nav>

        <div className={`stage stage--${tab === '3d' ? '3d' : tab}`}>
          {tab === 'mockups' && (mockupMode === 'photo' ? (
            <PlateStudio
              design={design}
              profile={profile}
              proofCmyk={proofCmyk}
              projectName={projects.currentName}
              onStatus={setStatus}
            />
          ) : (
            <MockupGallery
              design={design}
              profile={profile}
              geom={geom}
              proofCmyk={proofCmyk}
              projectName={projects.currentName}
              onStatus={setStatus}
            />
          ))}
          {tab === 'concepts' && (
            <ConceptGallery source={conceptSource} profile={profile}
              brandName={brandName} onApply={applyConcept} />
          )}
          {tab === '3d' && (
            <CupViewer geom={geom} profile={profile} textureSource={designCanvasRef.current}
              revision={revision} spin={spin} resetToken={resetToken}
              recordRef={recordRef} />
          )}
          {tab === 'fan' && (
            <FanView profile={profile} geom={geom} design={design}
              designCanvas={fanCanvasRef.current} vRange={fanVRange} revision={revision}
              showGuides={showGuides} selectedId={selectedId}
              onSelect={setSelectedId} onChange={patchElement}
              onBeginEdit={beginEdit}
              eyedropActive={eyedrop !== null} onEyedrop={onEyedrop} />
          )}
          {tab === 'design' && (
            <DesignView profile={profile} geom={geom} design={design} revision={revision}
              showGuides={showGuides} selectedId={selectedId}
              onSelect={setSelectedId} onChange={patchElement}
              onBeginEdit={beginEdit}
              eyedropActive={eyedrop !== null} onEyedrop={onEyedrop}
              proofCmyk={proofCmyk} />
          )}

          {status && (
            <div className="toast" role="status">
              <span>{status}</span>
              <button onClick={() => setStatus(null)} title="Dismiss">×</button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/**
 * QR properties.
 *
 * The code regenerates on every keystroke, so the operator sees it become
 * scannable as they finish typing the address rather than having to guess
 * whether it took.
 */
function QrControls({
  el, onUrl,
}: {
  el: Extract<DesignElement, { type: 'qr' }>;
  onUrl: (url: string) => void;
}) {
  return (
    <div className="txt">
      <label className="txt__lbl">Website address</label>
      <input type="text" value={el.url} placeholder="cupco.com.au"
        onChange={(e) => onUrl(e.target.value)} />
      <div className={`note ${el.live ? 'note--ok' : 'note--warn'}`} style={{ marginTop: 8 }}>
        <strong>{el.live ? 'Live QR code' : 'Placeholder QR code'}</strong>
        {el.live
          ? `Scans to ${el.url.startsWith('http') ? el.url : `https://${el.url}`}`
          : 'Type a web address to make this scannable. It prints as a working code either way, but the placeholder points nowhere useful.'}
      </div>
      <div className="hint">
        {el.moduleCount}×{el.moduleCount} modules · exports as vector, so it stays
        sharp and scannable at any size. Keep it above roughly 20mm on the cup.
      </div>
    </div>
  );
}

/** Properties for artwork and colour bands. */
function BlockControls({
  el, onPatch,
}: {
  el: Exclude<DesignElement, { type: 'text' } | { type: 'qr' }>;
  onPatch: (patch: Partial<DesignElement>) => void;
}) {
  if (el.type === 'band') {
    return (
      <div className="txt">
        <label className="txt__lbl">Band colour</label>
        <input type="color" value={el.color}
          onChange={(e) => onPatch({ color: e.target.value } as Partial<DesignElement>)} />
        <label className="txt__lbl">Height</label>
        <div className="row">
          <input type="range" min={1} max={100} value={Math.round(el.heightV * 100)}
            onChange={(e) => onPatch({ heightV: Number(e.target.value) / 100 } as Partial<DesignElement>)} />
          <span className="val">{Math.round(el.heightV * 100)}%</span>
        </div>
        <div className="hint">Wraps the whole cup, so it has no seam to align.</div>
      </div>
    );
  }
  // Single-colour vector artwork can be recoloured. That is every basic
  // shape, and also a one-colour logo, where it is genuinely useful. Artwork
  // with more than one fill is left alone: flattening a multicolour mark to a
  // single ink would be destructive and silent.
  if (el.type === 'vector' && el.art.shapes.length === 1) {
    const cur = rgbToHex(el.art.shapes[0]!.fill);
    return (
      <div className="txt">
        <label className="txt__lbl">Fill colour</label>
        <input type="color" value={cur}
          onChange={(e) => onPatch({
            art: {
              ...el.art,
              shapes: el.art.shapes.map((sh) => ({ ...sh, fill: hexToRgb(e.target.value) })),
            },
          } as Partial<DesignElement>)} />
        <div className="hint">
          {(el.widthU * 100).toFixed(0)}% of circumference · {el.rotation}° ·
          exports as a vector path
        </div>
      </div>
    );
  }
  return (
    <div className="hint">
      {el.type === 'vector' ? 'Vector artwork' : 'Bitmap artwork'} ·{' '}
      {(el.widthU * 100).toFixed(0)}% of circumference · {el.rotation}°
      {el.type === 'vector' && el.art.shapes.length > 1
        ? ` · ${el.art.shapes.length} colours, so not recolourable here`
        : ''}
    </div>
  );
}

/**
 * Text properties.
 *
 * Everything stays editable after the text is created — the content, the
 * typeface, weight, slant, colour, size and letter spacing. Size is offered
 * numerically as well as by corner drag, because typographers think in points
 * and dragging cannot hit an exact value.
 */
function TextControls({
  el, onPatch, onPickColour, picking,
}: {
  el: TextElement;
  onPatch: (patch: Partial<DesignElement>) => void;
  onPickColour?: () => void;
  picking?: boolean;
}) {
  const patch = (p: Partial<TextElement>) => onPatch(p as Partial<DesignElement>);

  return (
    <div className="txt">
      <textarea
        className="txt__content"
        value={el.content}
        rows={2}
        placeholder="Type here…"
        onChange={(e) => patch({ content: e.target.value, name: e.target.value.trim() || 'Text' })}
      />

      <label className="txt__lbl">Font</label>
      <select value={el.fontFamily}
        style={{ fontFamily: cssFamily(el.fontFamily) }}
        onChange={(e) => patch({ fontFamily: e.target.value })}>
        {FONT_CHOICES.map((f) => (
          <option key={f.id} value={f.id} style={{ fontFamily: `"${f.css}", sans-serif` }}>{f.label}</option>
        ))}
      </select>

      <div className="txt__row">
        <div className="txt__col">
          <label className="txt__lbl">Weight</label>
          <select value={resolveWeight(el.fontFamily, el.weight)}
            onChange={(e) => patch({ weight: Number(e.target.value) })}>
            {(FONT_CHOICES.find((f) => f.id === el.fontFamily)?.weights ?? [400]).map((w) => (
              <option key={w} value={w}>{w === 400 ? 'Regular' : 'Bold'}</option>
            ))}
          </select>
        </div>
        <div className="txt__col">
          <label className="txt__lbl">Style</label>
          <button className={el.italic ? 'toggle toggle--on' : 'toggle'}
            onClick={() => patch({ italic: !el.italic })}>
            <em>Italic</em>
          </button>
        </div>
      </div>

      <div className="txt__row">
        <div className="txt__col">
          <label className="txt__lbl">Size</label>
          <div className="row">
            <input type="number" min={1} max={100} step={0.5}
              value={Number((el.sizeV * 100).toFixed(1))}
              onChange={(e) => patch({ sizeV: Math.max(0.01, Math.min(1.2, Number(e.target.value) / 100)) })} />
            <span className="val">% of height</span>
          </div>
        </div>
        <div className="txt__col">
          <label className="txt__lbl">Colour</label>
          <div className="row">
            <input type="color" value={el.color}
              onChange={(e) => patch({ color: e.target.value })} />
            {onPickColour && (
              <button className={picking ? 'toggle toggle--on' : ''}
                style={{ padding: '4px 8px' }} title="Pick a colour from the artwork"
                onClick={onPickColour}>⌖</button>
            )}
          </div>
        </div>
      </div>

      <label className="txt__lbl">Letter spacing</label>
      <div className="row">
        <input type="range" min={-10} max={60} value={Math.round(el.tracking * 100)}
          onChange={(e) => patch({ tracking: Number(e.target.value) / 100 })} />
        <span className="val">{(el.tracking * 100).toFixed(0)}</span>
      </div>

      <div className="hint">
        Outlined from the bundled font on export, so text prints as true vector CMYK.
      </div>
    </div>
  );
}
