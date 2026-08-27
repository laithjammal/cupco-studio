'use client';

/**
 * Projects, autosave and version snapshots.
 *
 * This is the layer that turns "a design in React state" into "work that
 * survives a refresh". It owns three things the editor should not have to
 * think about: which project is open, when to write, and how a stored document
 * becomes live elements again.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  randomId, sweepOrphanedAssets, StorageQuotaError,
} from '@cupco/persistence';
import type { DesignVersionSummary, ProjectSummary, StoredDesign } from '@cupco/persistence';
import { getStorage, storageEstimate } from './idb';
import { deserialiseDesign, serialiseDesign } from './serialise';
import type { Design } from './design';

/** How long to wait after the last edit before writing. */
const AUTOSAVE_MS = 800;

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface ProjectsApi {
  /** False until the first load finishes; the editor should not save before then. */
  ready: boolean;
  projects: ProjectSummary[];
  currentId: string | null;
  currentName: string;
  saveState: SaveState;
  saveError: string | null;
  lastSavedAt: number | null;
  versions: DesignVersionSummary[];
  storageInfo: { usedMb: number; quotaMb: number } | null;

  newProject: (name?: string) => Promise<void>;
  openProject: (id: string) => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  duplicateProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;

  saveVersion: (label: string) => Promise<void>;
  restoreVersion: (id: string) => Promise<void>;
  deleteVersion: (id: string) => Promise<void>;

  /** Force a write now, ignoring the debounce. */
  flush: () => Promise<void>;
}

export interface UseProjectsOptions {
  design: Design;
  profileId: string;
  /** Replace the editor's design and clear its undo history. */
  applyDesign: (design: Design) => void;
  applyProfileId: (id: string) => void;
  /** Small preview for the project list, or null if one cannot be made. */
  makeThumbnail?: (design: Design) => string | null;
  /** Surfaced to the operator - missing assets, quota problems. */
  onNotice?: (message: string) => void;
}

export function useProjects(options: UseProjectsOptions): ProjectsApi {
  const {
    design, profileId, applyDesign, applyProfileId, makeThumbnail, onNotice,
  } = options;

  const [ready, setReady] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [versions, setVersions] = useState<DesignVersionSummary[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [currentName, setCurrentName] = useState('Untitled cup');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [storageInfo, setStorageInfo] = useState<{ usedMb: number; quotaMb: number } | null>(null);

  /**
   * The exact design object last written or loaded.
   *
   * Autosave compares by IDENTITY against this, which closes a race that would
   * otherwise lose work: switching projects changes `currentId` and `design` in
   * separate renders, so a debounced save firing in between would write the
   * OUTGOING project's design into the INCOMING project's record. Because a
   * load assigns the very object it just read, the comparison is false and no
   * such save is ever queued.
   */
  const syncedRef = useRef<Design | null>(null);
  const currentIdRef = useRef<string | null>(null);
  const profileIdRef = useRef(profileId);
  const createdAtRef = useRef<number>(Date.now());
  const nameRef = useRef(currentName);

  currentIdRef.current = currentId;
  profileIdRef.current = profileId;
  nameRef.current = currentName;

  // Keep options callable from effects without re-subscribing on every render.
  const latest = useRef({ design, makeThumbnail, onNotice, applyDesign, applyProfileId });
  latest.current = { design, makeThumbnail, onNotice, applyDesign, applyProfileId };

  const refreshProjects = useCallback(async () => {
    setProjects(await getStorage().projects.listProjects());
    setStorageInfo(await storageEstimate());
  }, []);

  const refreshVersions = useCallback(async (projectId: string | null) => {
    setVersions(projectId ? await getStorage().projects.listVersions(projectId) : []);
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Writing                                                                 */
  /* ---------------------------------------------------------------------- */

  const writeNow = useCallback(async (toWrite: Design): Promise<void> => {
    const id = currentIdRef.current;
    if (!id) return;
    setSaveState('saving');
    try {
      const storage = getStorage();
      const stored = await serialiseDesign(toWrite, storage.assets);
      await storage.projects.saveProject({
        id,
        name: nameRef.current,
        profileId: profileIdRef.current,
        design: stored,
        createdAt: createdAtRef.current,
        updatedAt: Date.now(),
        ...(thumbnailFor(toWrite, latest.current.makeThumbnail) ?? {}),
      });
      syncedRef.current = toWrite;
      setSaveState('saved');
      setSaveError(null);
      setLastSavedAt(Date.now());
      void refreshProjects();
    } catch (e) {
      setSaveState('error');
      const message = e instanceof StorageQuotaError
        ? e.message
        : `Could not save: ${(e as Error).message}`;
      setSaveError(message);
      latest.current.onNotice?.(message);
    }
  }, [refreshProjects]);

  /* ---------------------------------------------------------------------- */
  /* Boot                                                                    */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const storage = getStorage();
        const list = await storage.projects.listProjects();
        if (cancelled) return;

        if (list.length === 0) {
          // Nothing stored yet: adopt whatever is on screen as project one,
          // rather than discarding it behind a "create a project" gate.
          const id = randomId();
          createdAtRef.current = Date.now();
          setCurrentId(id);
          currentIdRef.current = id;
          setCurrentName('Untitled cup');
          nameRef.current = 'Untitled cup';
          setReady(true);
          await writeNow(latest.current.design);
          return;
        }

        // Most recently updated, which is what the operator was last working on.
        const summary = list[0]!;
        await openInto(summary.id);
      } catch (e) {
        latest.current.onNotice?.(
          `Saved work is unavailable: ${(e as Error).message}`,
        );
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    // Reclaim space from projects deleted in earlier sessions. Assets younger
    // than the sweep's grace period are never touched, so this cannot race an
    // upload that has not been autosaved yet.
    void (async () => {
      try {
        const storage = getStorage();
        await sweepOrphanedAssets(storage.projects, storage.assets);
      } catch {
        // Housekeeping only - never worth interrupting the operator over.
      }
    })();

    return () => { cancelled = true; };
    // Boot runs once, deliberately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Load a project's design into the editor. */
  const openInto = useCallback(async (id: string) => {
    const storage = getStorage();
    const project = await storage.projects.getProject(id);
    if (!project) return;

    const { design: loaded, warnings } = await deserialiseDesign(project.design, storage.assets);
    // Assign BEFORE handing the design to React, so no autosave can observe a
    // state where the id and the design belong to different projects.
    syncedRef.current = loaded;
    createdAtRef.current = project.createdAt;
    currentIdRef.current = id;
    nameRef.current = project.name;

    setCurrentId(id);
    setCurrentName(project.name);
    latest.current.applyProfileId(project.profileId);
    latest.current.applyDesign(loaded);
    setSaveState('saved');
    setSaveError(null);
    setLastSavedAt(project.updatedAt);

    if (warnings.length) latest.current.onNotice?.(warnings.join(' · '));
    await refreshProjects();
    await refreshVersions(id);
  }, [refreshProjects, refreshVersions]);

  /* ---------------------------------------------------------------------- */
  /* Autosave                                                                */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    if (!ready || !currentId) return;
    // Identity check: a design that was just loaded or just written is already
    // on disk, and re-writing it would churn the store on every render.
    if (syncedRef.current === design) return;

    setSaveState('idle');
    const timer = setTimeout(() => { void writeNow(design); }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [design, profileId, ready, currentId, writeNow]);

  /**
   * Best-effort write when the tab goes away.
   *
   * The debounce leaves up to AUTOSAVE_MS of work unwritten, and closing a tab
   * gives no time to finish an async write. `visibilitychange` fires early
   * enough to usually win, and there is nothing to lose by trying.
   */
  useEffect(() => {
    const flush = () => {
      if (syncedRef.current !== latest.current.design) {
        void writeNow(latest.current.design);
      }
    };
    const onHidden = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', flush);
    };
  }, [writeNow]);

  /* ---------------------------------------------------------------------- */
  /* Project operations                                                      */
  /* ---------------------------------------------------------------------- */

  const flush = useCallback(async () => {
    if (syncedRef.current !== latest.current.design) {
      await writeNow(latest.current.design);
    }
  }, [writeNow]);

  const newProject = useCallback(async (name = 'Untitled cup') => {
    // Never lose the outgoing design to the debounce.
    await flush();
    const id = randomId();
    const blank: Design = { background: '#1c4532', elements: [] };
    syncedRef.current = blank;
    createdAtRef.current = Date.now();
    currentIdRef.current = id;
    nameRef.current = name;
    setCurrentId(id);
    setCurrentName(name);
    latest.current.applyDesign(blank);
    setVersions([]);
    await writeNow(blank);
  }, [flush, writeNow]);

  const openProject = useCallback(async (id: string) => {
    if (id === currentIdRef.current) return;
    await flush();
    await openInto(id);
  }, [flush, openInto]);

  const renameProject = useCallback(async (id: string, name: string) => {
    const trimmed = name.trim() || 'Untitled cup';
    const storage = getStorage();
    const project = await storage.projects.getProject(id);
    if (!project) return;
    await storage.projects.saveProject({ ...project, name: trimmed, updatedAt: Date.now() });
    if (id === currentIdRef.current) {
      nameRef.current = trimmed;
      setCurrentName(trimmed);
    }
    await refreshProjects();
  }, [refreshProjects]);

  const duplicateProject = useCallback(async (id: string) => {
    await flush();
    const storage = getStorage();
    const source = await storage.projects.getProject(id);
    if (!source) return;
    // Copies the stored document as-is. Assets are content-addressed, so the
    // copy shares its artwork bytes rather than doubling them.
    await storage.projects.saveProject({
      ...source,
      id: randomId(),
      name: `${source.name} copy`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await refreshProjects();
  }, [flush, refreshProjects]);

  const deleteProject = useCallback(async (id: string) => {
    const storage = getStorage();
    const wasCurrent = id === currentIdRef.current;

    // Drop the reference BEFORE deleting. Otherwise the fallback below flushes
    // pending edits through writeNow, which still holds the deleted id - and
    // the project the operator just deleted is written straight back.
    if (wasCurrent) {
      currentIdRef.current = null;
      setCurrentId(null);
    }

    await storage.projects.deleteProject(id);
    const remaining = await storage.projects.listProjects();
    setProjects(remaining);

    if (wasCurrent) {
      if (remaining[0]) await openInto(remaining[0].id);
      else await newProject();
    }
    await refreshProjects();

    // Reclaim what the deleted project was holding. Assets inside the sweep's
    // grace period survive to the next session's sweep, which is fine - this
    // is housekeeping, not a guarantee.
    try {
      await sweepOrphanedAssets(storage.projects, storage.assets);
    } catch {
      // Never let cleanup surface as a failed delete.
    }
  }, [newProject, openInto, refreshProjects]);

  /* ---------------------------------------------------------------------- */
  /* Versions                                                                */
  /* ---------------------------------------------------------------------- */

  const saveVersion = useCallback(async (label: string) => {
    const id = currentIdRef.current;
    if (!id) return;
    // Write the working design first, so the snapshot and the project agree.
    await flush();
    const storage = getStorage();
    const stored: StoredDesign = await serialiseDesign(
      latest.current.design, storage.assets);
    const existing = await storage.projects.listVersions(id);
    const ordinal = (existing[0]?.ordinal ?? 0) + 1;

    await storage.projects.saveVersion({
      id: randomId(),
      projectId: id,
      ordinal,
      label: label.trim() || `Version ${ordinal}`,
      profileId: profileIdRef.current,
      design: stored,
      createdAt: Date.now(),
      ...(thumbnailFor(latest.current.design, latest.current.makeThumbnail) ?? {}),
    });
    await refreshVersions(id);
  }, [flush, refreshVersions]);

  const restoreVersion = useCallback(async (versionId: string) => {
    const storage = getStorage();
    const version = await storage.projects.getVersion(versionId);
    if (!version) return;

    const { design: loaded, warnings } = await deserialiseDesign(version.design, storage.assets);
    // Restoring REPLACES the working design and is itself autosaved. The
    // snapshot is untouched, so restoring the wrong one is recoverable by
    // restoring another - nothing is consumed by being restored.
    syncedRef.current = null;
    latest.current.applyProfileId(version.profileId);
    latest.current.applyDesign(loaded);
    if (warnings.length) latest.current.onNotice?.(warnings.join(' · '));
  }, []);

  const deleteVersion = useCallback(async (versionId: string) => {
    await getStorage().projects.deleteVersion(versionId);
    await refreshVersions(currentIdRef.current);
  }, [refreshVersions]);

  return {
    ready, projects, currentId, currentName, saveState, saveError, lastSavedAt,
    versions, storageInfo,
    newProject, openProject, renameProject, duplicateProject, deleteProject,
    saveVersion, restoreVersion, deleteVersion, flush,
  };
}

/** Thumbnails are a nicety - never let one fail a save. */
function thumbnailFor(
  design: Design,
  make: ((d: Design) => string | null) | undefined,
): { thumbnail: string } | null {
  try {
    const url = make?.(design);
    return url ? { thumbnail: url } : null;
  } catch {
    return null;
  }
}
