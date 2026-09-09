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
import { QR_STYLES, buildQrArtwork, getQrStyle, normaliseUrl } from '@cupco/qr';

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
  onChange,
}: {
  url: string;
  styleId: string;
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
            <Swatch url={url} styleId={preset.id} />
            <span className="qrstyle__name">{preset.name}</span>
          </button>
        ))}
      </div>
      <div className="hint">{active.description}</div>
    </div>
  );
}

function Swatch({ url, styleId }: { url: string; styleId: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { art } = buildQrArtwork(
      normaliseUrl(url) ?? 'https://example.com',
      { style: getQrStyle(styleId), dark: [15, 23, 42] },
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
  }, [url, styleId]);

  return <canvas ref={ref} className="qrstyle__swatch" />;
}
