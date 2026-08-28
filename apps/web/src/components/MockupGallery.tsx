'use client';

/**
 * The mockup tab: the cup in five settings, ready to send to a customer.
 *
 * Rendering is deferred and throttled. Five scenes, each a per-pixel pass over
 * the cup, is real work, and doing it synchronously on every keystroke would
 * make the editor feel broken while someone types a URL into a QR code.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MOCKUP_SCENES } from '@/lib/mockup-scenes';
import { renderMockup, mockupBlob, mockupFilename } from '@/lib/mockup';
import type { Design } from '@/lib/design';
import type { CupProfile, FrustumGeometry } from '@cupco/geometry';

/** On-screen card width. Downloads re-render far larger. */
const PREVIEW_W = 520;
/** Download width — big enough for a deck slide or an email at full width. */
const EXPORT_W = 1800;

export default function MockupGallery({
  design,
  profile,
  geom,
  proofCmyk,
  projectName,
  onStatus,
}: {
  design: Design;
  profile: CupProfile;
  geom: FrustumGeometry;
  proofCmyk: boolean;
  projectName: string;
  onStatus: (message: string) => void;
}) {
  const hosts = useRef(new Map<string, HTMLDivElement | null>());
  const [rendering, setRendering] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRendering(true);

    // Let the tab paint before starting: the first frame should be the layout,
    // not a frozen screen.
    const id = setTimeout(() => {
      for (const scene of MOCKUP_SCENES) {
        if (cancelled) return;
        const host = hosts.current.get(scene.id);
        if (!host) continue;
        try {
          const canvas = renderMockup(scene.id, design, profile, geom, {
            widthPx: PREVIEW_W,
            proofCmyk,
          });
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          canvas.style.display = 'block';
          host.replaceChildren(canvas);
        } catch (e) {
          host.replaceChildren(
            Object.assign(document.createElement('div'), {
              className: 'mock__fail',
              textContent: `Could not render: ${(e as Error).message}`,
            }),
          );
        }
      }
      if (!cancelled) setRendering(false);
    }, 40);

    return () => { cancelled = true; clearTimeout(id); };
  }, [design, profile, geom, proofCmyk]);

  const download = useCallback(async (sceneId: string) => {
    setBusy(sceneId);
    try {
      // Re-rendered at export size rather than upscaled from the card.
      const canvas = renderMockup(sceneId, design, profile, geom, {
        widthPx: EXPORT_W,
        proofCmyk,
      });
      const blob = await mockupBlob(canvas);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = mockupFilename(profile, sceneId, projectName);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
      onStatus(
        `${mockupFilename(profile, sceneId, projectName)} · ${canvas.width}×${canvas.height} · ` +
        `${(blob.size / 1024 / 1024).toFixed(2)} MB`,
      );
    } catch (e) {
      onStatus(`Mockup export failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, [design, profile, geom, proofCmyk, projectName, onStatus]);

  const downloadAll = useCallback(async () => {
    setBusy('all');
    try {
      for (const scene of MOCKUP_SCENES) {
        const canvas = renderMockup(scene.id, design, profile, geom, {
          widthPx: EXPORT_W, proofCmyk,
        });
        const blob = await mockupBlob(canvas);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = mockupFilename(profile, scene.id, projectName);
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 8000);
        // Browsers drop rapid-fire downloads; give each one room to land.
        await new Promise((r) => setTimeout(r, 350));
      }
      onStatus(`Downloaded ${MOCKUP_SCENES.length} mockups at ${EXPORT_W}px wide`);
    } catch (e) {
      onStatus(`Mockup export failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, [design, profile, geom, proofCmyk, projectName, onStatus]);

  const empty = design.elements.length === 0;

  return (
    <div className="mocks">
      <div className="mocks__head">
        <div>
          <strong>Mockups</strong>
          <span className="hint">
            {empty
              ? 'Add artwork and these will show it.'
              : proofCmyk
                ? 'Showing CMYK ink, so what a customer approves is what prints.'
                : 'Screen colour. Turn on CMYK proof to show how it will actually print.'}
          </span>
        </div>
        <button className="primary" onClick={() => void downloadAll()} disabled={busy !== null}>
          {busy === 'all' ? 'Working…' : `Download all ${MOCKUP_SCENES.length}`}
        </button>
      </div>

      <div className="mocks__grid">
        {MOCKUP_SCENES.map((scene) => (
          <figure className="mock" key={scene.id}>
            <div
              className="mock__canvas"
              ref={(el) => { hosts.current.set(scene.id, el); }}
            />
            <figcaption className="mock__cap">
              <span className="mock__name">{scene.name}</span>
              <span className="mock__desc">{scene.description}</span>
              <button onClick={() => void download(scene.id)} disabled={busy !== null}>
                {busy === scene.id ? 'Working…' : 'Download PNG'}
              </button>
            </figcaption>
          </figure>
        ))}
      </div>

      {rendering && <div className="mocks__busy">Rendering mockups…</div>}
    </div>
  );
}
