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
import { QR_STYLES, buildQrArtwork, getQrStyle, normaliseUrl } from '@cupco/vector';

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

    canvas.width = SWATCH_PX;
    canvas.height = SWATCH_PX;

    const { art } = buildQrArtwork(
      normaliseUrl(url) ?? 'https://example.com',
      { style: getQrStyle(styleId) },
    );

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0f172a';
    for (const shape of art.shapes) {
      ctx.beginPath();
      for (const sp of shape.subpaths) {
        sp.forEach((p, i) => {
          const x = p.x * canvas.width;
          const y = p.y * canvas.height;
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
