'use client';

/**
 * IndexedDB implementation of the storage adapters.
 *
 * WHY INDEXEDDB AND NOT localStorage
 * ----------------------------------
 * Uploaded artwork is measured in megabytes. localStorage caps at around 5MB
 * for the whole origin, stores strings only (so bytes would need base64, a 33%
 * penalty), and is SYNCHRONOUS - every write would block the main thread mid-
 * edit. IndexedDB is asynchronous, stores binary directly, and its quota is a
 * share of free disk.
 *
 * TRANSACTION DISCIPLINE
 * ----------------------
 * An IndexedDB transaction auto-commits as soon as the event loop runs dry, so
 * awaiting anything that is not an IDB request inside one silently kills it.
 * Every method here therefore does its non-IDB work (hashing, encoding) FIRST,
 * then opens a transaction and does nothing else inside it.
 */

import { hashBytes, StorageQuotaError } from '@cupco/persistence';
import type {
  AssetId, AssetInfo, AssetKind, AssetStore, DesignVersion, DesignVersionSummary,
  Project, ProjectStore, StoredAsset, StoredPlate, Storage as CupcoStorage,
} from '@cupco/persistence';

const DB_NAME = 'cupco-studio';
/**
 * 2 added the `plates` store. The upgrade is additive - existing projects,
 * versions and assets are untouched - so an existing database opens and keeps
 * everything it had.
 */
const DB_VERSION = 2;
const PROJECTS = 'projects';
const VERSIONS = 'versions';
const ASSETS = 'assets';
const PLATES = 'plates';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser has no IndexedDB, so work cannot be saved.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROJECTS)) {
        db.createObjectStore(PROJECTS, { keyPath: 'id' })
          .createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains(VERSIONS)) {
        db.createObjectStore(VERSIONS, { keyPath: 'id' })
          .createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains(ASSETS)) {
        db.createObjectStore(ASSETS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(PLATES)) {
        db.createObjectStore(PLATES, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open the local database'));
    // Another tab is holding the old version open during an upgrade.
    req.onblocked = () => reject(new Error(
      'Another Cupco Studio tab is open with an older version. Close it and reload.',
    ));
  });
  return dbPromise;
}

/** Promisify one IDB request. */
function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(translate(req.error));
  });
}

/**
 * Quota exhaustion is the one storage failure with a real remedy, so it gets
 * its own type and the UI can say "delete an old project" instead of surfacing
 * a DOMException nobody can act on.
 */
function translate(error: DOMException | null): Error {
  if (error?.name === 'QuotaExceededError') {
    return new StorageQuotaError(
      'Local storage is full. Delete a project or an old version to free space.',
    );
  }
  return error ?? new Error('Storage request failed');
}

async function tx<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  run: (t: IDBTransaction) => Promise<T>,
): Promise<T> {
  const db = await openDb();
  const t = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(translate(t.error));
    t.onabort = () => reject(translate(t.error));
  });
  const result = await run(t);
  // Await the transaction itself so a write that fails at COMMIT time - which
  // is when quota is actually enforced - still rejects rather than reporting
  // success.
  if (mode === 'readwrite') await done;
  return result;
}

/* -------------------------------------------------------------------------- */

class IdbAssetStore implements AssetStore {
  async put(
    kind: AssetKind,
    bytes: Uint8Array,
    meta: { contentType?: string; name?: string } = {},
  ): Promise<AssetId> {
    // Hash before opening the transaction: awaiting crypto inside one would
    // let it auto-commit underneath us.
    const id = await hashBytes(bytes);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);

    const record: StoredAsset = {
      id, kind, bytes: copy,
      byteLength: copy.byteLength,
      createdAt: Date.now(),
      ...(meta.contentType !== undefined ? { contentType: meta.contentType } : {}),
      ...(meta.name !== undefined ? { name: meta.name } : {}),
    };

    await tx(ASSETS, 'readwrite', async (t) => {
      const store = t.objectStore(ASSETS);
      const existing = await wrap(store.count(id));
      // Content-addressed: identical bytes are already stored under this id,
      // so rewriting them would only churn the disk.
      if (existing === 0) await wrap(store.put(record));
    });
    return id;
  }

  async get(id: AssetId): Promise<StoredAsset | null> {
    return tx(ASSETS, 'readonly', async (t) =>
      (await wrap<StoredAsset | undefined>(t.objectStore(ASSETS).get(id))) ?? null);
  }

  async has(id: AssetId): Promise<boolean> {
    return tx(ASSETS, 'readonly', async (t) =>
      (await wrap(t.objectStore(ASSETS).count(id))) > 0);
  }

  async delete(id: AssetId): Promise<void> {
    await tx(ASSETS, 'readwrite', async (t) => { await wrap(t.objectStore(ASSETS).delete(id)); });
  }

  async list(): Promise<AssetInfo[]> {
    return tx(ASSETS, 'readonly', async (t) => {
      const all = await wrap<StoredAsset[]>(t.objectStore(ASSETS).getAll());
      return all.map(({ bytes: _bytes, ...info }) => info);
    });
  }
}

class IdbProjectStore implements ProjectStore {
  async listProjects() {
    return tx(PROJECTS, 'readonly', async (t) => {
      const all = await wrap<Project[]>(t.objectStore(PROJECTS).getAll());
      return all
        .map(({ design, ...rest }) => ({ ...rest, elementCount: design.elements.length }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }

  async getProject(id: string): Promise<Project | null> {
    return tx(PROJECTS, 'readonly', async (t) =>
      (await wrap<Project | undefined>(t.objectStore(PROJECTS).get(id))) ?? null);
  }

  async saveProject(project: Project): Promise<void> {
    await tx(PROJECTS, 'readwrite', async (t) => {
      await wrap(t.objectStore(PROJECTS).put(project));
    });
  }

  /** A project's version history goes with it. */
  async deleteProject(id: string): Promise<void> {
    await tx([PROJECTS, VERSIONS], 'readwrite', async (t) => {
      await wrap(t.objectStore(PROJECTS).delete(id));
      const index = t.objectStore(VERSIONS).index('projectId');
      const keys = await wrap<IDBValidKey[]>(index.getAllKeys(IDBKeyRange.only(id)));
      for (const key of keys) await wrap(t.objectStore(VERSIONS).delete(key));
    });
  }

  async listVersions(projectId: string): Promise<DesignVersionSummary[]> {
    return tx(VERSIONS, 'readonly', async (t) => {
      const all = await wrap<DesignVersion[]>(
        t.objectStore(VERSIONS).index('projectId').getAll(IDBKeyRange.only(projectId)));
      return all
        .map(({ design: _design, ...rest }) => rest)
        .sort((a, b) => b.ordinal - a.ordinal);
    });
  }

  async getVersion(id: string): Promise<DesignVersion | null> {
    return tx(VERSIONS, 'readonly', async (t) =>
      (await wrap<DesignVersion | undefined>(t.objectStore(VERSIONS).get(id))) ?? null);
  }

  async saveVersion(version: DesignVersion): Promise<void> {
    await tx(VERSIONS, 'readwrite', async (t) => {
      await wrap(t.objectStore(VERSIONS).put(version));
    });
  }

  async deleteVersion(id: string): Promise<void> {
    await tx(VERSIONS, 'readwrite', async (t) => {
      await wrap(t.objectStore(VERSIONS).delete(id));
    });
  }

  async listPlates(): Promise<StoredPlate[]> {
    return tx(PLATES, 'readonly', async (t) => {
      const all = await wrap<StoredPlate[]>(t.objectStore(PLATES).getAll());
      return all.sort((a, b) => b.createdAt - a.createdAt);
    });
  }

  async savePlate(plate: StoredPlate): Promise<void> {
    await tx(PLATES, 'readwrite', async (t) => { await wrap(t.objectStore(PLATES).put(plate)); });
  }

  async deletePlate(id: string): Promise<void> {
    await tx(PLATES, 'readwrite', async (t) => { await wrap(t.objectStore(PLATES).delete(id)); });
  }
}

let storage: CupcoStorage | null = null;

/** The app's storage, created once. */
export function getStorage(): CupcoStorage {
  storage ??= { projects: new IdbProjectStore(), assets: new IdbAssetStore() };
  return storage;
}

/** Rough usage figures for the UI, where the browser exposes them. */
export async function storageEstimate(): Promise<{ usedMb: number; quotaMb: number } | null> {
  const estimate = navigator.storage?.estimate;
  if (!estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usedMb: usage / 1e6, quotaMb: quota / 1e6 };
}
