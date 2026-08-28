import { describe, it, expect } from 'vitest';
import { createMemoryStorage, SCHEMA_VERSION } from '../src/index';
import type { DesignVersion, Project, StoredDesign } from '../src/index';

const design = (background = '#fff'): StoredDesign => ({
  schemaVersion: SCHEMA_VERSION, background,
  elements: [{ id: 'el-1', type: 'band', u: 0.5, v: 0.2, rotation: 0, name: 'Band', heightV: 0.2, color: '#000' }],
});

const project = (id: string, name = id): Project => ({
  id, name, profileId: '8oz-single-wall', design: design(),
  createdAt: 1000, updatedAt: 2000,
});

const version = (id: string, projectId: string, ordinal: number): DesignVersion => ({
  id, projectId, ordinal, label: `v${ordinal}`, profileId: '8oz-single-wall',
  design: design(), createdAt: 1000,
});

describe('asset store', () => {
  it('deduplicates identical bytes to one id and one record', async () => {
    const { assets } = createMemoryStorage();
    const a = await assets.put('art', new Uint8Array([1, 2, 3]));
    const b = await assets.put('art', new Uint8Array([1, 2, 3]));
    expect(a).toBe(b);
    expect(await assets.list()).toHaveLength(1);
  });

  it('keeps different bytes apart', async () => {
    const { assets } = createMemoryStorage();
    await assets.put('art', new Uint8Array([1]));
    await assets.put('art', new Uint8Array([2]));
    expect(await assets.list()).toHaveLength(2);
  });

  it('round-trips bytes and metadata', async () => {
    const { assets } = createMemoryStorage();
    const id = await assets.put('image', new Uint8Array([7, 8, 9]),
      { contentType: 'image/png', name: 'logo.png' });
    const got = await assets.get(id);
    expect([...got!.bytes]).toEqual([7, 8, 9]);
    expect(got!.contentType).toBe('image/png');
    expect(got!.name).toBe('logo.png');
    expect(got!.byteLength).toBe(3);
    expect(got!.kind).toBe('image');
  });

  it('does not hand back a live reference to its own bytes', async () => {
    // A real store serialises, so a caller can never mutate what is stored.
    // If this returned the internal array, a test could corrupt the store by
    // accident and still pass - hiding the bug the IndexedDB adapter would hit.
    const { assets } = createMemoryStorage();
    const id = await assets.put('art', new Uint8Array([1, 2, 3]));
    (await assets.get(id))!.bytes[0] = 42;
    expect((await assets.get(id))!.bytes[0]).toBe(1);
  });

  it('is unaffected by the caller mutating the array it passed in', async () => {
    const { assets } = createMemoryStorage();
    const bytes = new Uint8Array([1, 2, 3]);
    const id = await assets.put('art', bytes);
    bytes[0] = 99;
    expect((await assets.get(id))!.bytes[0]).toBe(1);
  });

  it('reports has() and delete()', async () => {
    const { assets } = createMemoryStorage();
    const id = await assets.put('art', new Uint8Array([5]));
    expect(await assets.has(id)).toBe(true);
    await assets.delete(id);
    expect(await assets.has(id)).toBe(false);
    expect(await assets.get(id)).toBeNull();
  });

  it('omits payload bytes from listings', async () => {
    const { assets } = createMemoryStorage();
    await assets.put('art', new Uint8Array([1, 2, 3]));
    const [info] = await assets.list();
    expect(info).not.toHaveProperty('bytes');
    expect(info!.byteLength).toBe(3);
  });
});

describe('project store', () => {
  it('saves and reloads a project', async () => {
    const { projects } = createMemoryStorage();
    await projects.saveProject(project('p1', 'Blue cup'));
    const got = await projects.getProject('p1');
    expect(got!.name).toBe('Blue cup');
    expect(got!.design.elements).toHaveLength(1);
  });

  it('returns null for an unknown project', async () => {
    const { projects } = createMemoryStorage();
    expect(await projects.getProject('nope')).toBeNull();
  });

  it('lists most-recently-updated first, without designs', async () => {
    const { projects } = createMemoryStorage();
    await projects.saveProject({ ...project('old'), updatedAt: 100 });
    await projects.saveProject({ ...project('new'), updatedAt: 900 });
    const list = await projects.listProjects();
    expect(list.map((p) => p.id)).toEqual(['new', 'old']);
    expect(list[0]).not.toHaveProperty('design');
    expect(list[0]!.elementCount).toBe(1);
  });

  it('does not share a mutable design with its caller', async () => {
    const { projects } = createMemoryStorage();
    const p = project('p1');
    await projects.saveProject(p);
    p.design.background = '#000';
    expect((await projects.getProject('p1'))!.design.background).toBe('#fff');
  });

  it('overwrites on save rather than duplicating', async () => {
    const { projects } = createMemoryStorage();
    await projects.saveProject(project('p1', 'First'));
    await projects.saveProject(project('p1', 'Second'));
    expect(await projects.listProjects()).toHaveLength(1);
    expect((await projects.getProject('p1'))!.name).toBe('Second');
  });
});

describe('plates', () => {
  const plate = (id: string, assetId: string): import('../src/index').StoredPlate => ({
    id, name: `Plate ${id}`, assetId, widthPx: 1200, heightPx: 1500,
    calibration: {
      topLeft: { x: 0, y: 0 }, topRight: { x: 10, y: 0 },
      bottomLeft: { x: 1, y: 10 }, bottomRight: { x: 9, y: 10 },
      topBow: 2, bottomBow: 1, centreU: 0.5, visibleSpan: 0.5,
    },
    mask: { minBrightness: 0.45, maxSaturation: 0.22, edgeFade: 0.06, opacity: 1 },
    createdAt: 100, updatedAt: 100,
  });

  it('saves and lists plates newest first', async () => {
    const { projects } = createMemoryStorage();
    await projects.savePlate({ ...plate('a', 'sha256-1'), createdAt: 100 });
    await projects.savePlate({ ...plate('b', 'sha256-2'), createdAt: 900 });
    expect((await projects.listPlates()).map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('keeps plates when a project is deleted — they are a library, not project data', async () => {
    const { projects } = createMemoryStorage();
    await projects.saveProject(project('p1'));
    await projects.savePlate(plate('a', 'sha256-1'));
    await projects.deleteProject('p1');
    expect(await projects.listPlates()).toHaveLength(1);
  });

  it('deletes a plate on request', async () => {
    const { projects } = createMemoryStorage();
    await projects.savePlate(plate('a', 'sha256-1'));
    await projects.deletePlate('a');
    expect(await projects.listPlates()).toHaveLength(0);
  });
});

describe('versions', () => {
  it('lists newest ordinal first and only for the right project', async () => {
    const { projects } = createMemoryStorage();
    await projects.saveProject(project('p1'));
    await projects.saveProject(project('p2'));
    await projects.saveVersion(version('v1', 'p1', 1));
    await projects.saveVersion(version('v2', 'p1', 2));
    await projects.saveVersion(version('v3', 'p2', 1));

    const list = await projects.listVersions('p1');
    expect(list.map((v) => v.id)).toEqual(['v2', 'v1']);
    expect(list[0]).not.toHaveProperty('design');
  });

  it('deleting a project takes its version history with it', async () => {
    // Otherwise snapshots outlive their project and pin assets forever, so the
    // garbage collector can never reclaim anything.
    const { projects } = createMemoryStorage();
    await projects.saveProject(project('p1'));
    await projects.saveVersion(version('v1', 'p1', 1));
    await projects.saveVersion(version('v2', 'p1', 2));

    await projects.deleteProject('p1');
    expect(await projects.listVersions('p1')).toHaveLength(0);
    expect(await projects.getVersion('v1')).toBeNull();
  });

  it('deleting one project leaves another project untouched', async () => {
    const { projects } = createMemoryStorage();
    await projects.saveProject(project('p1'));
    await projects.saveProject(project('p2'));
    await projects.saveVersion(version('v1', 'p1', 1));
    await projects.saveVersion(version('v3', 'p2', 1));

    await projects.deleteProject('p1');
    expect(await projects.getProject('p2')).not.toBeNull();
    expect(await projects.listVersions('p2')).toHaveLength(1);
  });
});
