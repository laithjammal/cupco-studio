/**
 * In-memory implementation of both stores.
 *
 * This is the reference behaviour: the IndexedDB adapter is correct exactly
 * insofar as it matches this. It is also what the test suite runs against, so
 * serialisation and garbage collection can be tested with no browser at all.
 *
 * COPY ON THE WAY IN AND OUT
 * -------------------------
 * Every read and write is deep-copied. A real store serialises, so callers
 * never share a mutable object with it. Handing back live references here
 * would let a test mutate the "stored" design by accident and still pass -
 * hiding exactly the bug the real adapter would have.
 */

import { hashBytes } from './hash';
import type { AssetStore, ProjectStore, Storage } from './store';
import type {
  AssetId, AssetInfo, AssetKind, DesignVersion, DesignVersionSummary,
  Project, ProjectSummary, StoredAsset,
} from './types';

const clone = <T>(value: T): T => structuredClone(value);

export class MemoryAssetStore implements AssetStore {
  private readonly items = new Map<AssetId, StoredAsset>();

  async put(
    kind: AssetKind,
    bytes: Uint8Array,
    meta: { contentType?: string; name?: string } = {},
  ): Promise<AssetId> {
    const id = await hashBytes(bytes);
    // Idempotent: identical bytes are already here, under this same id.
    if (this.items.has(id)) return id;

    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    this.items.set(id, {
      id, kind, bytes: copy,
      byteLength: copy.byteLength,
      createdAt: Date.now(),
      ...(meta.contentType !== undefined ? { contentType: meta.contentType } : {}),
      ...(meta.name !== undefined ? { name: meta.name } : {}),
    });
    return id;
  }

  async get(id: AssetId): Promise<StoredAsset | null> {
    const found = this.items.get(id);
    return found ? clone(found) : null;
  }

  async has(id: AssetId): Promise<boolean> {
    return this.items.has(id);
  }

  async delete(id: AssetId): Promise<void> {
    this.items.delete(id);
  }

  async list(): Promise<AssetInfo[]> {
    return [...this.items.values()].map(({ bytes: _bytes, ...info }) => clone(info));
  }
}

export class MemoryProjectStore implements ProjectStore {
  private readonly projects = new Map<string, Project>();
  private readonly versions = new Map<string, DesignVersion>();

  async listProjects(): Promise<ProjectSummary[]> {
    return [...this.projects.values()]
      .map(({ design, ...rest }) => ({ ...clone(rest), elementCount: design.elements.length }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getProject(id: string): Promise<Project | null> {
    const found = this.projects.get(id);
    return found ? clone(found) : null;
  }

  async saveProject(project: Project): Promise<void> {
    this.projects.set(project.id, clone(project));
  }

  /** Deleting a project deletes its version history with it. */
  async deleteProject(id: string): Promise<void> {
    this.projects.delete(id);
    for (const [vid, v] of this.versions) {
      if (v.projectId === id) this.versions.delete(vid);
    }
  }

  async listVersions(projectId: string): Promise<DesignVersionSummary[]> {
    return [...this.versions.values()]
      .filter((v) => v.projectId === projectId)
      .map(({ design: _design, ...rest }) => clone(rest))
      .sort((a, b) => b.ordinal - a.ordinal);
  }

  async getVersion(id: string): Promise<DesignVersion | null> {
    const found = this.versions.get(id);
    return found ? clone(found) : null;
  }

  async saveVersion(version: DesignVersion): Promise<void> {
    this.versions.set(version.id, clone(version));
  }

  async deleteVersion(id: string): Promise<void> {
    this.versions.delete(id);
  }
}

export function createMemoryStorage(): Storage {
  return { projects: new MemoryProjectStore(), assets: new MemoryAssetStore() };
}
