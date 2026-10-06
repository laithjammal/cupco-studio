/**
 * Re-deriving imported artwork from its original file.
 *
 * A stored logo is the importer's output on the day it was uploaded, plus
 * whatever was done to it since. Keep the original and a record of what was
 * done, and the logo can be rebuilt from scratch whenever the importer gets
 * better - which is the difference between "fixed" and "fixed, once you find
 * every logo and upload it again".
 */

import { recolourArtwork, type PlacedArtwork } from '@cupco/vector';
import type { ArtworkEdit, VectorSource } from '@cupco/persistence';
import { treatArtwork } from './concepts-adapter';
import { readSvgText } from './upload';

/** Do the recorded edits again, in order, to freshly imported artwork. */
export function replayEdits(art: PlacedArtwork, edits: readonly ArtworkEdit[] = []): PlacedArtwork {
  let out = art;
  for (const e of edits) {
    if (e.kind === 'treatment') out = treatArtwork(out, e.treatment);
    else out = recolourArtwork(out, () => e.rgb);
  }
  return out;
}

/**
 * Add an edit to a source's record.
 *
 * A colour picker fires on every step of a drag, so consecutive recolours
 * collapse into the last one rather than piling up hundreds of entries that
 * each overwrite the one before.
 */
export function withEdit(source: VectorSource, edit: ArtworkEdit): VectorSource {
  const edits = [...(source.edits ?? [])];
  const last = edits[edits.length - 1];
  if (last && last.kind === 'fill' && edit.kind === 'fill') edits[edits.length - 1] = edit;
  else edits.push(edit);
  return { ...source, edits };
}

/**
 * Rebuild a logo from its original SVG: read it as an upload would, then
 * replay what was done to it. Null if the file no longer reads as vector
 * artwork, in which case the stored artwork stands.
 */
export async function reimportFromSource(svg: string, source: VectorSource): Promise<PlacedArtwork | null> {
  const reading = await readSvgText(svg);
  return reading.kind === 'vector' ? replayEdits(reading.art, source.edits) : null;
}
