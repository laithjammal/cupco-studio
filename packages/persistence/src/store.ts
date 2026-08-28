/**
 * Storage adapters.
 *
 * Everything above these two interfaces is storage-agnostic. The editor talks
 * to `ProjectStore` and `AssetStore` and never to IndexedDB, so moving to
 * Postgres and object storage later is an implementation swap rather than a
 * rewrite - which is the whole reason the boundary is drawn here and not at
 * the call sites.
 *
 * Two implementations exist today: `MemoryStore` (tests, and the reference
 * behaviour every other implementation must match) and the browser's
 * IndexedDB adapter in the web app.
 */

import type {
  AssetId, AssetInfo, AssetKind, DesignVersion, DesignVersionSummary,
  Project, ProjectSummary, StoredAsset, StoredPlate,
} from './types';

/**
 * Blob storage, keyed by content hash.
 *
 * `put` is idempotent: storing bytes that are already present returns the same
 * id and writes nothing.
 */
export interface AssetStore {
  put(
    kind: AssetKind,
    bytes: Uint8Array,
    meta?: { contentType?: string; name?: string },
  ): Promise<AssetId>;
  get(id: AssetId): Promise<StoredAsset | null>;
  has(id: AssetId): Promise<boolean>;
  delete(id: AssetId): Promise<void>;
  list(): Promise<AssetInfo[]>;
}

/**
 * Project and version records.
 *
 * Versions are separate from projects so the project list can be rendered
 * without loading every historical snapshot.
 */
export interface ProjectStore {
  listProjects(): Promise<ProjectSummary[]>;
  getProject(id: string): Promise<Project | null>;
  saveProject(project: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;

  listVersions(projectId: string): Promise<DesignVersionSummary[]>;
  getVersion(id: string): Promise<DesignVersion | null>;
  saveVersion(version: DesignVersion): Promise<void>;
  deleteVersion(id: string): Promise<void>;

  /**
   * Mockup plates, shared across every project rather than owned by one.
   */
  listPlates(): Promise<StoredPlate[]>;
  savePlate(plate: StoredPlate): Promise<void>;
  deletePlate(id: string): Promise<void>;
}

/** Both halves together, which is how callers always want them. */
export interface Storage {
  projects: ProjectStore;
  assets: AssetStore;
}

/**
 * Raised when the backing store is out of room.
 *
 * Called out as its own type because it is the one storage failure with a
 * genuine user remedy ("delete an old project"), and the UI needs to say so
 * rather than reporting a generic write error.
 */
export class StorageQuotaError extends Error {
  override readonly name = 'StorageQuotaError';
  constructor(message = 'Storage is full') {
    super(message);
  }
}
