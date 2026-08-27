'use client';

/**
 * View controls, sitting with the view they control.
 *
 * Guides, the CMYK proof and the camera used to live in the sidebar among the
 * cup profile and the export settings. They are not configuration - they change
 * what you are looking at right now, and they belong beside it. Moving them
 * here also takes five blocks out of the sidebar.
 *
 * Only the controls that mean something on the current tab are rendered: a
 * "reset camera" button on the flat fan is just noise to read past.
 */

import type { VideoPresetId } from '@/lib/turntable';
import { VIDEO_PRESETS } from '@/lib/turntable';

export interface StageToolbarProps {
  tab: 'concepts' | 'design' | '3d' | 'fan';
  proofCmyk: boolean;
  onProofCmyk: () => void;
  showGuides: boolean;
  onShowGuides: () => void;
  spin: boolean;
  onSpin: () => void;
  onResetCamera: () => void;
  videoPreset: VideoPresetId;
  onVideoPreset: (p: VideoPresetId) => void;
  onExportTurntable: () => void;
  busy: boolean;
  progress: string | null;
  videoExt: string;
}

export default function StageToolbar(p: StageToolbarProps) {
  if (p.tab === 'concepts') return null;
  const flat = p.tab === 'design' || p.tab === 'fan';

  return (
    <div className="stagebar">
      {flat && (
        <>
          <button className={p.showGuides ? 'chip chip--on' : 'chip'} onClick={p.onShowGuides}
            title="Trim, bleed, safe area and seam overlap">
            Guides
          </button>
          <button className={p.proofCmyk ? 'chip chip--on' : 'chip'} onClick={p.onProofCmyk}
            title="Preview the design as CMYK ink on cup board — an approximation, not a colour-managed proof">
            CMYK proof
          </button>
        </>
      )}

      {p.tab === '3d' && (
        <>
          <button className={p.spin ? 'chip chip--on' : 'chip'} onClick={p.onSpin}>
            {p.spin ? 'Spinning' : 'Spin'}
          </button>
          <button className="chip" onClick={p.onResetCamera} title="Reset the camera">Reset</button>

          <span className="stagebar__sep" />

          <select className="chip chip--select" value={p.videoPreset}
            onChange={(e) => p.onVideoPreset(e.target.value as VideoPresetId)}
            title="Length and frame rate of the recording">
            {VIDEO_PRESETS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>

          <button className="chip chip--primary" onClick={p.onExportTurntable} disabled={p.busy}
            title="Record a full 360° from the current camera angle">
            {p.progress ?? (p.busy ? 'Working…' : `Record ${p.videoExt.toUpperCase()}`)}
          </button>
        </>
      )}
    </div>
  );
}
