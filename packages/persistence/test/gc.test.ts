import { describe, it, expect } from 'vitest';
import { createMemoryStorage, sweepOrphanedAssets, assetIdsIn, SCHEMA_VERSION } from '../src/index';
import type { AssetId, StoredDesign } from '../src/index';

/**
 * Assets are stamped "now" by the store on write, and the sweep takes `now` as
 * a parameter. So rather than reaching into the store to backdate records,
 * every test writes assets normally and then runs the sweep from an hour in
 * the FUTURE. Same effect, no private state touched.
 */
const HOUR = 60 * 60 * 1000;
const later = () => Date.now() + HOUR;
const OLD = 1_000_000;

function designWith(imageId: AssetId | null, artId: AssetId | null): StoredDesign {
  const elements: StoredDesign['elements'] = [];
  if (imageId) {
    elements.push({
      id: 'el-1', type: 'image', u: 0.5, v: 0.5, rotation: 0, name: 'Photo',
      assetId: imageId, widthU: 0.3, naturalWidth: 100, naturalHeight: 50,
    });
  }
  if (artId) {
    elements.push({
      id: 'el-2', type: 'vector', u: 0.5, v: 0.5, rotation: 0, name: 'Logo',
      artId, widthU: 0.25, traced: false,
    });
  }
  elements.push({
    id: 'el-3', type: 'qr', u: 0.7, v: 0.5, rotation: 0, name: 'QR',
    url: 'https://cupco.example', widthU: 0.13, styleId: 'classic',
  });
  return { schemaVersion: SCHEMA_VERSION, background: '#fff', elements };
}

describe('assetIdsIn', () => {
  it('finds image and vector references and ignores the rest', () => {
    expect(assetIdsIn(designWith('img', 'art')).sort()).toEqual(['art', 'img']);
  });

  it('returns nothing for a design with no assets', () => {
    // A QR stores only its URL, so it pins no bytes.
    expect(assetIdsIn(designWith(null, null))).toEqual([]);
  });
});

describe('sweepOrphanedAssets', () => {
  it('deletes an old asset nothing refers to', async () => {
    const storage = createMemoryStorage();
    const id = await storage.assets.put('art', new Uint8Array([1, 2, 3]));

    const result = await sweepOrphanedAssets(storage.projects, storage.assets, { now: later() });
    expect(result.deleted).toEqual([id]);
    expect(result.bytesReclaimed).toBe(3);
    expect(await storage.assets.has(id)).toBe(false);
  });

  it('SPARES an asset a project still refers to', async () => {
    const storage = createMemoryStorage();
    const id = await storage.assets.put('art', new Uint8Array([1, 2, 3]));
    await storage.projects.saveProject({
      id: 'p1', name: 'Cup', profileId: '8oz-single-wall',
      design: designWith(null, id), createdAt: OLD, updatedAt: OLD,
    });

    const result = await sweepOrphanedAssets(storage.projects, storage.assets, { now: later() });
    expect(result.deleted).toEqual([]);
    expect(await storage.assets.has(id)).toBe(true);
  });

  it('SPARES an asset only an old VERSION refers to', async () => {
    // A snapshot exists to answer "what exactly was approved?". Collecting the
    // artwork out from under one would make it answer that question wrongly.
    const storage = createMemoryStorage();
    const id = await storage.assets.put('image', new Uint8Array([9]));
    await storage.projects.saveProject({
      id: 'p1', name: 'Cup', profileId: '8oz-single-wall',
      design: designWith(null, null), createdAt: OLD, updatedAt: OLD,
    });
    await storage.projects.saveVersion({
      id: 'v1', projectId: 'p1', ordinal: 1, label: 'Approved',
      profileId: '8oz-single-wall', design: designWith(id, null), createdAt: OLD,
    });

    const result = await sweepOrphanedAssets(storage.projects, storage.assets, { now: later() });
    expect(result.deleted).toEqual([]);
  });

  it('SPARES a freshly written asset even with nothing referring to it', async () => {
    // The window that matters: a logo has just been uploaded and the debounced
    // autosave that records the reference has not fired. Collecting here would
    // delete the bytes out from under the element on screen.
    const storage = createMemoryStorage();
    const id = await storage.assets.put('art', new Uint8Array([1]));

    const result = await sweepOrphanedAssets(storage.projects, storage.assets, {});
    expect(result.deleted).toEqual([]);
    expect(result.spared).toBe(1);
    expect(await storage.assets.has(id)).toBe(true);
  });

  it('collects once the grace period has passed', async () => {
    const storage = createMemoryStorage();
    const id = await storage.assets.put('art', new Uint8Array([1]));

    // One hour old, judged against a two-hour threshold: too young to collect.
    expect((await sweepOrphanedAssets(storage.projects, storage.assets,
      { now: later(), minAgeMs: 2 * HOUR })).deleted).toEqual([]);
    // The same asset against a thirty-minute threshold: now collectable.
    expect((await sweepOrphanedAssets(storage.projects, storage.assets,
      { now: later(), minAgeMs: 30 * 60 * 1000 })).deleted).toEqual([id]);
  });

  it('SPARES a plate photograph, which no design refers to', async () => {
    // Plates are a library: nothing in any design points at their photo, so
    // without an explicit reference the sweep would delete every plate the
    // first time it ran.
    const storage = createMemoryStorage();
    const photo = await storage.assets.put('image', new Uint8Array([1, 2, 3, 4]));
    await storage.projects.savePlate({
      id: 'plate-1', name: 'In hand', assetId: photo,
      widthPx: 100, heightPx: 100,
      calibration: {
        topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 },
        bottomLeft: { x: 0, y: 1 }, bottomRight: { x: 1, y: 1 },
        topBow: 0, bottomBow: 0, centreU: 0.5, visibleSpan: 0.5,
      },
      mask: { minBrightness: 0.45, maxSaturation: 0.22, edgeFade: 0.06, opacity: 1 },
      createdAt: 0, updatedAt: 0,
    });

    const result = await sweepOrphanedAssets(storage.projects, storage.assets, { now: later() });
    expect(result.deleted).toEqual([]);
    expect(await storage.assets.has(photo)).toBe(true);
  });

  it('reclaims a deleted project\'s assets but keeps a shared one', async () => {
    // Deduplication means two projects can point at the same bytes. Deleting
    // one must not strip the logo from the other.
    const storage = createMemoryStorage();
    const shared = await storage.assets.put('art', new Uint8Array([1, 1]));
    const lonely = await storage.assets.put('art', new Uint8Array([2, 2, 2]));

    for (const [pid, aid] of [['p1', shared], ['p2', shared], ['p3', lonely]] as const) {
      await storage.projects.saveProject({
        id: pid, name: pid, profileId: '8oz-single-wall',
        design: designWith(null, aid), createdAt: OLD, updatedAt: OLD,
      });
    }
    await storage.projects.deleteProject('p3');
    await storage.projects.deleteProject('p1');

    const result = await sweepOrphanedAssets(storage.projects, storage.assets, { now: later() });
    expect(result.deleted).toEqual([lonely]);
    expect(await storage.assets.has(shared)).toBe(true);
  });
});
