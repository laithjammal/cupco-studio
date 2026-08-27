import { describe, it, expect, beforeAll } from 'vitest';
import { createMemoryStorage, assetIdsIn, SCHEMA_VERSION } from '@cupco/persistence';
import type { PlacedArtwork } from '@cupco/vector';
import { serialiseDesign, deserialiseDesign } from '@/lib/serialise';
import {
  createBandElement, createTextElement, createQrElement, createVectorElement, nextId,
  withQrStyle,
} from '@/lib/design';
import type { Design, ImageElement } from '@/lib/design';

/* -------------------------------------------------------------------------- */
/* A minimal stand-in for the browser image pipeline.                           */
/* Tests run in Node, so object URLs and <img> decoding do not exist. Only the  */
/* three calls the serialiser actually makes are provided.                      */
/* -------------------------------------------------------------------------- */

const decoded: Uint8Array[] = [];

beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  const blobs = new Map<string, Blob>();
  g['URL'] = Object.assign(URL, {
    createObjectURL: (b: Blob) => { const u = `blob:${Math.random()}`; blobs.set(u, b); return u; },
    revokeObjectURL: (u: string) => { blobs.delete(u); },
  });
  g['Image'] = class {
    naturalWidth = 0; naturalHeight = 0;
    #src = '';
    set src(value: string) {
      this.#src = value;
      // Encode dimensions in the stored bytes so the test can prove the RIGHT
      // asset came back, not merely that something did.
      const blob = blobs.get(value);
      if (blob) void blob.arrayBuffer().then((b) => decoded.push(new Uint8Array(b)));
    }
    get src() { return this.#src; }
    async decode() {
      const blob = blobs.get(this.#src);
      if (!blob) throw new Error('no such object URL');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      this.naturalWidth = bytes[0] ?? 0;
      this.naturalHeight = bytes[1] ?? 0;
    }
  };
});

const fakeImage = (w: number, h: number) =>
  ({ naturalWidth: w, naturalHeight: h } as HTMLImageElement);

const art = (aspect: number, x = 0.25): PlacedArtwork => ({
  aspect,
  shapes: [{ fill: [10, 20, 30], opacity: 1, subpaths: [[{ x, y: 0 }, { x: 0.75, y: 1 }]] }],
});

const imageElement = (assetId: string, w = 120, h = 60): ImageElement => ({
  id: nextId(), type: 'image', name: 'photo.png',
  u: 0.5, v: 0.5, rotation: 0, widthU: 0.3,
  image: fakeImage(w, h), assetId,
});

async function roundTrip(design: Design) {
  const { assets } = createMemoryStorage();
  const stored = await serialiseDesign(design, assets);
  const reloaded = await deserialiseDesign(JSON.parse(JSON.stringify(stored)), assets);
  return { stored, assets, ...reloaded };
}

/* -------------------------------------------------------------------------- */

describe('serialising plain elements', () => {
  it('round-trips every field of a text element', async () => {
    const text = {
      ...createTextElement('CUPCO'),
      u: 0.3, v: 0.7, rotation: 12, opacity: 0.4,
      sizeV: 0.21, color: '#ff8800', weight: 300,
      fontFamily: 'oswald', italic: true, tracking: 0.08, align: 'right' as const,
    };
    const { design } = await roundTrip({ background: '#102030', elements: [text] });
    expect(design.background).toBe('#102030');
    expect(design.elements[0]).toEqual(text);
  });

  it('round-trips a band', async () => {
    const band = { ...createBandElement('#abcdef', 0.3, 0.18), rotation: 0 };
    const { design } = await roundTrip({ background: '#fff', elements: [band] });
    expect(design.elements[0]).toEqual(band);
  });

  it('preserves z-order', async () => {
    const els = [createBandElement('#111'), createTextElement('A'), createTextElement('B')];
    const { design } = await roundTrip({ background: '#fff', elements: els });
    expect(design.elements.map((e) => e.id)).toEqual(els.map((e) => e.id));
  });

  it('keeps an absent opacity absent rather than defaulting it to 1', async () => {
    // renderDesign reads `el.opacity ?? 1`, so writing an explicit 1 would be
    // harmless today but would quietly change meaning if the default ever moved.
    const { stored, design } = await roundTrip({
      background: '#fff', elements: [createTextElement('X')],
    });
    expect(stored.elements[0]).not.toHaveProperty('opacity');
    expect(design.elements[0]).not.toHaveProperty('opacity');
  });

  it('stamps the current schema version', async () => {
    const { stored } = await roundTrip({ background: '#fff', elements: [] });
    expect(stored.schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe('vector artwork', () => {
  it('round-trips shapes, fill and aspect', async () => {
    const el = createVectorElement(art(0.5), 'logo.svg', false);
    const { design } = await roundTrip({ background: '#fff', elements: [el] });
    const out = design.elements[0]!;
    expect(out.type).toBe('vector');
    if (out.type !== 'vector') return;
    expect(out.art.aspect).toBeCloseTo(0.5, 6);
    expect(out.art.shapes[0]!.fill).toEqual([10, 20, 30]);
    expect(out.art.shapes[0]!.subpaths[0]).toHaveLength(2);
    expect(out.traced).toBe(false);
    expect(out.widthU).toBeCloseTo(el.widthU, 10);
  });

  it('remembers that artwork was traced', async () => {
    const el = createVectorElement(art(1), 'traced', true);
    const { design } = await roundTrip({ background: '#fff', elements: [el] });
    expect(design.elements[0]).toMatchObject({ traced: true });
  });

  it('stores two identical logos as ONE asset', async () => {
    // The point of content addressing. Without it, applying a concept that
    // repeats a mark eight times would store eight copies of it.
    const shared = art(0.5);
    const els = Array.from({ length: 8 }, () => createVectorElement(shared, 'mark', false));
    const { assets, stored } = await roundTrip({ background: '#fff', elements: els });

    expect(await assets.list()).toHaveLength(1);
    const ids = new Set(assetIdsIn(stored));
    expect(ids.size).toBe(1);
  });

  it('stores genuinely different logos separately', async () => {
    const els = [
      createVectorElement(art(0.5, 0.25), 'a', false),
      createVectorElement(art(0.5, 0.30), 'b', false),
    ];
    const { assets } = await roundTrip({ background: '#fff', elements: els });
    expect(await assets.list()).toHaveLength(2);
  });

  it('keeps quantisation error below the export flatness tolerance', async () => {
    // Stored coordinates are rounded. Checked here in printed millimetres
    // against the real tolerance, rather than by restating the rounding rule.
    const noisy: PlacedArtwork = {
      aspect: 1,
      shapes: [{
        fill: [0, 0, 0], opacity: 1,
        subpaths: [Array.from({ length: 200 }, (_, i) => ({
          x: Math.sin(i) * 0.4999 + 0.5, y: Math.cos(i * 1.7) * 0.4999 + 0.5,
        }))],
      }],
    };
    const el = createVectorElement(noisy, 'noisy', true);
    const { design } = await roundTrip({ background: '#fff', elements: [el] });
    const out = design.elements[0]!;
    if (out.type !== 'vector') throw new Error('expected vector');

    const before = noisy.shapes[0]!.subpaths[0]!;
    const after = out.art.shapes[0]!.subpaths[0]!;
    const logoWidthMm = 60;   // widthU 0.25 on the 8oz blank
    const toleranceMm = 0.02; // DEFAULT_FLATNESS_MM in the path warper

    let worstMm = 0;
    for (let i = 0; i < before.length; i++) {
      worstMm = Math.max(worstMm,
        Math.abs(after[i]!.x - before[i]!.x) * logoWidthMm,
        Math.abs(after[i]!.y - before[i]!.y) * logoWidthMm);
    }
    expect(worstMm).toBeLessThan(toleranceMm / 100);
  });
});

describe('QR codes', () => {
  it('stores only the URL, never the generated modules', async () => {
    const el = createQrElement('https://cupco.example/menu');
    const { stored, assets } = await roundTrip({ background: '#fff', elements: [el] });
    const s = stored.elements[0]!;
    expect(s).toMatchObject({ type: 'qr', url: 'https://cupco.example/menu' });
    expect(s).not.toHaveProperty('art');
    expect(s).not.toHaveProperty('moduleCount');
    // A QR pins no bytes at all.
    expect(await assets.list()).toHaveLength(0);
  });

  it('regenerates identical modules on load', async () => {
    const el = createQrElement('https://cupco.example/menu');
    const { design } = await roundTrip({ background: '#fff', elements: [el] });
    const out = design.elements[0]!;
    if (out.type !== 'qr') throw new Error('expected qr');
    expect(out.moduleCount).toBe(el.moduleCount);
    expect(out.live).toBe(true);
    expect(out.art.shapes.length).toBe(el.art.shapes.length);
    expect(out.art).toEqual(el.art);
  });

  it('round-trips the style, and rebuilds the code in it', async () => {
    const el = createQrElement('https://cupco.example', undefined, 'dots');
    const { stored, design } = await roundTrip({ background: '#fff', elements: [el] });
    // The style is stored; the artwork it produces is not.
    expect(stored.elements[0]).toMatchObject({ type: 'qr', styleId: 'dots' });
    expect(stored.elements[0]).not.toHaveProperty('art');
    const out = design.elements[0]!;
    if (out.type !== 'qr') throw new Error('expected qr');
    expect(out.styleId).toBe('dots');
    expect(out.art).toEqual(el.art);
    expect(out.moduleCount).toBe(el.moduleCount);
  });

  it('a style change alters the drawing but never the data', async () => {
    // Styling must be decoration only. A different module count would mean the
    // code now says something different.
    const classic = createQrElement('https://cupco.example', undefined, 'classic');
    const dots = withQrStyle(classic, 'dots');
    expect(dots.moduleCount).toBe(classic.moduleCount);
    expect(dots.url).toBe(classic.url);
    expect(dots.art).not.toEqual(classic.art);
  });

  it('restores a placeholder QR as a placeholder', async () => {
    const el = createQrElement('');
    expect(el.live).toBe(false);
    const { design } = await roundTrip({ background: '#fff', elements: [el] });
    expect(design.elements[0]).toMatchObject({ live: false, url: '' });
  });
});

describe('images', () => {
  it('round-trips through the asset store', async () => {
    const { assets } = createMemoryStorage();
    // First two bytes carry the dimensions, so the stub can prove the right
    // asset came back rather than merely that something decoded.
    const id = await assets.put('image', new Uint8Array([120, 60, 7, 7]),
      { contentType: 'image/png', name: 'photo.png' });

    const el = imageElement(id, 120, 60);
    const stored = await serialiseDesign({ background: '#fff', elements: [el] }, assets);
    expect(stored.elements[0]).toMatchObject({
      type: 'image', assetId: id, naturalWidth: 120, naturalHeight: 60,
    });

    const { design, warnings } = await deserialiseDesign(stored, assets);
    expect(warnings).toEqual([]);
    const out = design.elements[0]!;
    if (out.type !== 'image') throw new Error('expected image');
    expect(out.assetId).toBe(id);
    expect(out.image.naturalWidth).toBe(120);
    expect(out.image.naturalHeight).toBe(60);
  });

  it('records natural dimensions so a design is measurable without decoding', async () => {
    const { assets } = createMemoryStorage();
    const stored = await serialiseDesign(
      { background: '#fff', elements: [imageElement('sha256-x', 400, 250)] }, assets);
    expect(stored.elements[0]).toMatchObject({ naturalWidth: 400, naturalHeight: 250 });
  });
});

describe('missing assets', () => {
  it('warns by name and keeps the rest of the design', async () => {
    // A design silently missing its logo looks like it was saved wrong. The
    // operator has to be told which of the two happened.
    const { assets } = createMemoryStorage();
    const stored = await serialiseDesign({
      background: '#fff',
      elements: [imageElement('sha256-gone'), createTextElement('KEEP ME')],
    }, assets);

    const { design, warnings } = await deserialiseDesign(stored, assets);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('photo.png');
    expect(design.elements).toHaveLength(1);
    expect(design.elements[0]).toMatchObject({ type: 'text', content: 'KEEP ME' });
  });

  it('warns when vector artwork has gone missing', async () => {
    const { assets } = createMemoryStorage();
    const stored = await serialiseDesign(
      { background: '#fff', elements: [createVectorElement(art(1), 'brandmark.svg', false)] },
      assets);
    // Simulate the asset being lost after the design was written.
    for (const info of await assets.list()) await assets.delete(info.id);

    const { design, warnings } = await deserialiseDesign(stored, assets);
    expect(design.elements).toHaveLength(0);
    expect(warnings[0]).toContain('brandmark.svg');
  });
});

describe('id reservation', () => {
  it('a new element after a load cannot collide with a loaded one', async () => {
    // Ids come from a module counter that restarts at zero each page load, so
    // without reservation the first new element would reuse a loaded id - and
    // selection, hit-testing and undo all key on id.
    const { assets } = createMemoryStorage();
    const stored = {
      schemaVersion: SCHEMA_VERSION,
      background: '#fff',
      elements: [
        { id: 'el-500', type: 'band' as const, u: 0.5, v: 0.2, rotation: 0, name: 'B', heightV: 0.1, color: '#000' },
        { id: 'el-9000', type: 'band' as const, u: 0.5, v: 0.4, rotation: 0, name: 'C', heightV: 0.1, color: '#111' },
      ],
    };
    const { design } = await deserialiseDesign(stored, assets);
    const fresh = createTextElement('new');
    expect(design.elements.some((e) => e.id === fresh.id)).toBe(false);
    expect(Number(fresh.id.slice(3))).toBeGreaterThan(9000);
  });
});
