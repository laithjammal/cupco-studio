/**
 * Garbage collection for orphaned assets.
 *
 * Assets are content-addressed and written before the design that references
 * them, so deleting a project leaves its bytes behind. Without a sweep, a
 * store grows forever - and image assets are the large ones.
 */

import type { AssetStore, ProjectStore } from './store';
import type { AssetId, StoredDesign } from './types';

/** Every asset a design refers to. */
export function assetIdsIn(design: StoredDesign): AssetId[] {
  const ids: AssetId[] = [];
  for (const el of design.elements) {
    if (el.type === 'image') ids.push(el.assetId);
    else if (el.type === 'vector') ids.push(el.artId);
  }
  return ids;
}

export interface SweepResult {
  deleted: AssetId[];
  bytesReclaimed: number;
  /** Skipped as too new to judge - see below. */
  spared: number;
}

/**
 * Delete assets no project or version refers to.
 *
 * THE GRACE PERIOD MATTERS
 * ------------------------
 * There is a window where an asset is legitimately unreferenced: the operator
 * has uploaded a logo, and the debounced autosave that would record the
 * reference has not fired yet. A sweep in that window would delete the bytes
 * out from under the element on screen, and the design would come back next
 * session with a hole in it.
 *
 * So assets younger than `minAgeMs` are never collected. The default is ten
 * minutes - comfortably longer than any autosave debounce, and short enough
 * that genuine orphans do not accumulate across a working day.
 */
export async function sweepOrphanedAssets(
  projects: ProjectStore,
  assets: AssetStore,
  options: { minAgeMs?: number; now?: number } = {},
): Promise<SweepResult> {
  const minAgeMs = options.minAgeMs ?? 10 * 60 * 1000;
  const now = options.now ?? Date.now();

  const referenced = new Set<AssetId>();
  for (const summary of await projects.listProjects()) {
    const project = await projects.getProject(summary.id);
    if (project) for (const id of assetIdsIn(project.design)) referenced.add(id);

    for (const v of await projects.listVersions(summary.id)) {
      const version = await projects.getVersion(v.id);
      if (version) for (const id of assetIdsIn(version.design)) referenced.add(id);
    }
  }

  const deleted: AssetId[] = [];
  let bytesReclaimed = 0;
  let spared = 0;

  for (const info of await assets.list()) {
    if (referenced.has(info.id)) continue;
    if (now - info.createdAt < minAgeMs) { spared += 1; continue; }
    await assets.delete(info.id);
    deleted.push(info.id);
    bytesReclaimed += info.byteLength;
  }

  return { deleted, bytesReclaimed, spared };
}
