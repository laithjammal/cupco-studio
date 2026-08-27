/**
 * Turntable video: the cup rotating a full 360 with the design on it.
 *
 * Recorded with MediaRecorder straight off the live canvas stream, so motion
 * is smooth and the browser's own H.264 encoder does the compression.
 *
 * There was a GIF path here too. It was removed: GIF is capped at 256 colours,
 * which banded the studio backdrop badly, and macOS Preview lists its frames
 * rather than playing them - so the format that was meant to be the
 * "plays anywhere" option was the one that looked broken. Video plays in
 * QuickTime, Keynote, Slack and every browser.
 */

export interface VideoResult {
  blob: Blob;
  mimeType: string;
  extension: string;
  width: number;
  height: number;
  durationMs: number;
}

export type RecordTurntable = (
  durationMs: number,
  fps: number,
  onProgress?: (fraction: number) => void,
) => Promise<VideoResult>;

/**
 * Pick the best container the browser can actually produce.
 *
 * MP4/H.264 is strongly preferred: it plays in QuickTime, Preview, Keynote,
 * PowerPoint and every messaging app without a plugin. WebM is the fallback —
 * fine in browsers, but macOS will not open it natively, which would recreate
 * exactly the "it won't play" problem this export exists to solve.
 */
export function pickVideoMime(): { mimeType: string; extension: string } | null {
  const candidates: { mimeType: string; extension: string }[] = [
    { mimeType: 'video/mp4;codecs=avc1.42E01E', extension: 'mp4' },
    { mimeType: 'video/mp4;codecs=avc1', extension: 'mp4' },
    { mimeType: 'video/mp4', extension: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c.mimeType)) return c;
  }
  return null;
}

export const VIDEO_PRESETS = [
  { id: 'quick', label: 'Quick — 3s, 30fps', durationMs: 3000, fps: 30 },
  { id: 'standard', label: 'Standard — 5s, 30fps', durationMs: 5000, fps: 30 },
  { id: 'smooth', label: 'Smooth — 7s, 60fps', durationMs: 7000, fps: 60 },
] as const;

export type VideoPresetId = (typeof VIDEO_PRESETS)[number]['id'];
