'use client';

/**
 * Pick a QR style by looking at it.
 *
 * Each swatch is the operator's ACTUAL code drawn in that style, not a stock
 * sample - so what they pick is what they get, at the density their own URL
 * produces. A long address makes a denser code, and that changes how a style
 * reads more than the style choice itself does.
 */

import { useEffect, useRef } from 'react';
import {
  QR_STYLES, QR_FRAMES, buildQrArtwork, getQrStyle, normaliseUrl, type QrFrameId,
} from '@cupco/qr';

/**
 * Backing-store size for a swatch, in pixels.
 *
 * Fixed and generous, while the DISPLAYED size is left to CSS so the grid can
 * fit whatever width the sidebar has. Rendering at the displayed size instead
 * would make these mushy at three-to-a-row in a 320px panel, and a mushy QR
 * swatch is exactly the thing an operator cannot judge.
 */
const SWATCH_PX = 192;

export default function QrStylePicker({
  url,
  styleId,
  frameId,
  silhouetteId,
  onChange,
}: {
  url: string;
  styleId: string;
  frameId: QrFrameId;
  silhouetteId: QrFrameId;
  onChange: (styleId: string) => void;
}) {
  const active = getQrStyle(styleId);

  return (
    <div className="field">
      <label>QR style</label>
      <div className="qrstyles">
        {QR_STYLES.map((preset) => (
          <button
            key={preset.id}
            className="qrstyle"
            data-sel={preset.id === active.id}
            onClick={() => onChange(preset.id)}
            title={preset.description}
          >
            <Swatch url={url} styleId={preset.id} frameId={frameId} silhouetteId={silhouetteId} />
            <span className="qrstyle__name">{preset.name}</span>
          </button>
        ))}
      </div>
      <div className="hint">{active.description}</div>
    </div>
  );
}

/**
 * Pick the SHAPE the code sits in.
 *
 * A frame is the light ground, never a mask: the finder patterns live in three
 * corners of the square, so clipping a code to a shape removes them and it
 * stops being locatable. The swatches make the trade-off visible - the more
 * elaborate the frame, the smaller the code inside it, and the bigger the
 * artwork has to be placed to keep the modules printable.
 */
export function QrFramePicker({
  url, styleId, frameId, silhouetteId, onFrame, onSilhouette,
}: {
  url: string;
  styleId: string;
  frameId: QrFrameId;
  silhouetteId: QrFrameId;
  onFrame: (frameId: QrFrameId) => void;
  onSilhouette: (id: QrFrameId) => void;
}) {
  // The two are alternatives, not layers: a shape is either the ground the
  // code sits on, or the code itself.
  const asCode = silhouetteId !== 'none';
  const chosen = asCode ? silhouetteId : frameId;
  const apply = asCode ? onSilhouette : onFrame;
  const active = QR_FRAMES.find((f) => f.id === chosen) ?? QR_FRAMES[0]!;

  const { codeFraction, minModuleScale } = buildQrArtwork(
    normaliseUrl(url) ?? 'https://example.com',
    asCode
      ? { silhouette: silhouetteId, level: 'H' }
      : { frame: frameId },
  );

  return (
    <div className="field">
      <label>QR shape</label>
      <div className="btnrow" style={{ marginBottom: 8 }}>
        <button
          data-sel={!asCode}
          onClick={() => onFrame(chosen === 'none' ? 'circle' : chosen)}
          title="The shape is the light ground the code is printed on."
        >
          Shape around it
        </button>
        <button
          data-sel={asCode}
          onClick={() => onSilhouette(chosen === 'none' ? 'star' : chosen)}
          title="The code itself is drawn as the shape, with each module's centre kept true."
        >
          Shape IS the code
        </button>
      </div>
      <div className="qrstyles">
        {QR_FRAMES.map((preset) => (
          <button
            key={preset.id}
            className="qrstyle"
            data-sel={preset.id === chosen}
            onClick={() => apply(preset.id)}
            title={preset.description}
          >
            <Swatch
              url={url} styleId={styleId}
              frameId={asCode ? 'none' : preset.id}
              silhouetteId={asCode ? preset.id : 'none'}
            />
            <span className="qrstyle__name">{preset.name}</span>
          </button>
        ))}
      </div>
      <div className="hint">
        {asCode ? (
          <>
            The shape is painted over the code and every module&rsquo;s centre put back —
            that centre is the only part a scanner reads, and the eyes, timing and
            alignment patterns are never painted over. It costs size:
            the readable feature is a third of a module, so print this
            about {minModuleScale}× wider than a plain code. Preflight enforces it.
          </>
        ) : (
          <>
            {active.description}
            {codeFraction < 0.999 && (
              <> The code fills {Math.round(codeFraction * 100)}% of the artwork here,
              so place it about {(1 / codeFraction).toFixed(1)}× wider than a plain square
              to keep the modules the same size.</>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Swatch({ url, styleId, frameId, silhouetteId = 'none' }: {
  url: string; styleId: string; frameId: QrFrameId; silhouetteId?: QrFrameId;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { art } = buildQrArtwork(
      normaliseUrl(url) ?? 'https://example.com',
      {
        style: getQrStyle(styleId), frame: frameId, silhouette: silhouetteId,
        level: silhouetteId === 'none' ? 'M' : 'H', dark: [15, 23, 42],
      },
    );

    // Square backing store, with the artwork letterboxed inside it: a frame
    // can be taller than it is wide, and squashing it to a square swatch would
    // show a distorted code that nothing else in the app would ever produce.
    canvas.width = SWATCH_PX;
    canvas.height = SWATCH_PX;
    const scale = art.aspect > 1 ? SWATCH_PX / art.aspect : SWATCH_PX;
    const offX = (SWATCH_PX - scale) / 2;
    const offY = (SWATCH_PX - scale * art.aspect) / 2;

    // A grey ground, not white: the frame's own light plate is the thing being
    // chosen, and on white it would be invisible.
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const shape of art.shapes) {
      ctx.fillStyle = `rgb(${shape.fill[0]},${shape.fill[1]},${shape.fill[2]})`;
      ctx.beginPath();
      for (const sp of shape.subpaths) {
        sp.forEach((p, i) => {
          const x = offX + p.x * scale;
          const y = offY + p.y * scale;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
      }
      // Nonzero, matching every renderer this artwork passes through: the eyes'
      // light rings are holes cut by reverse winding, not white paint on top.
      ctx.fill();
    }
  }, [url, styleId, frameId, silhouetteId]);

  return <canvas ref={ref} className="qrstyle__swatch" />;
}
