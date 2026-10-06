'use client';

/**
 * What became of an uploaded SVG, kept on screen for as long as the logo is
 * selected.
 *
 * Import notes used to go into a toast that vanished in a few seconds, so a
 * logo that arrived missing its wordmark said so once, briefly, and then
 * looked like every other logo. This puts the verdict, the evidence and the
 * way out next to the artwork itself.
 */

import { useEffect, useState } from 'react';
import { importReport, verdict, type ImportReport as Report } from '@/lib/import-check';
import { readSvgText } from '@/lib/upload';
import { getStorage } from '@/lib/idb';
import type { VectorElement } from '@/lib/design';

type State =
  | { status: 'loading' }
  | { status: 'ready'; report: Report }
  | { status: 'error'; message: string };

export default function ImportReport({
  el, onUseAsImage, busy,
}: {
  el: VectorElement;
  onUseAsImage: (report: Report) => void;
  busy?: boolean;
}) {
  const assetId = el.source?.assetId;
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    if (!assetId) return;
    let alive = true;
    setState({ status: 'loading' });
    importReport(
      assetId,
      async () => {
        const asset = await getStorage().assets.get(assetId);
        return asset ? new TextDecoder().decode(asset.bytes) : null;
      },
      readSvgText,
    ).then(
      (report) => { if (alive) setState({ status: 'ready', report }); },
      (e: unknown) => { if (alive) setState({ status: 'error', message: (e as Error).message }); },
    );
    return () => { alive = false; };
  }, [assetId]);

  if (!assetId) return null;
  if (state.status === 'loading') {
    return <div className="import"><div className="hint">Checking against the original file…</div></div>;
  }
  if (state.status === 'error') {
    return <div className="import"><div className="note note--warn">Could not check this logo: {state.message}</div></div>;
  }

  const { reading, check } = state.report;
  const v = verdict(check);
  const fonts = reading.result.fonts;
  return (
    <div className="import">
      <label className="txt__lbl">Import check</label>
      <div className={`note note--${v.tone}`}>
        <strong>{v.text}</strong>
        {check?.substitutedText && 'Live text is set in a substitute face; both sides below use it, so only the artwork is being compared.'}
        {check?.caveat && <div>{check.caveat}.</div>}
      </div>
      {check && (
        <div className="import__pics">
          <figure>
            <img src={check.original} alt="The original file, as this browser draws it" />
            <figcaption>Original</figcaption>
          </figure>
          <figure>
            <img src={check.imported} alt="The artwork as imported" />
            <figcaption>Imported</figcaption>
          </figure>
          {check.diff && (
            <figure>
              <img src={check.diff} alt="Where the two differ, in red" />
              <figcaption>Differences</figcaption>
            </figure>
          )}
        </div>
      )}
      {(reading.notes.length > 0 || fonts.length > 0) && (
        <ul className="import__notes">
          {fonts.map((f) => (
            <li key={`${f.requested}|${f.used}`}>
              Text: “{f.requested}” → {f.exact ? `set in ${f.used}` : <><strong>{f.used}</strong> (substitute)</>}
            </li>
          ))}
          {reading.notes.filter((n) => !n.startsWith('text set in')).map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
      <div className="btnrow" style={{ marginTop: 8 }}>
        <button onClick={() => onUseAsImage(state.report)} disabled={busy}
          title="Place the file exactly as this browser draws it. It then prints as pixels and cannot be recoloured.">
          Use as image instead
        </button>
      </div>
      <div className="hint">
        An image looks exactly like the file but prints as pixels; vector stays sharp
        at any size and exports as CMYK paths.
      </div>
    </div>
  );
}
