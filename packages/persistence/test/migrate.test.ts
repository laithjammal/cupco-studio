import { describe, it, expect } from 'vitest';
import { migrateDesign, SchemaVersionError, SCHEMA_VERSION } from '../src/index';

const doc = (over: Record<string, unknown> = {}) =>
  ({ schemaVersion: SCHEMA_VERSION, background: '#fff', elements: [], ...over });

describe('schema migration', () => {
  it('passes a current document through unchanged', () => {
    const out = migrateDesign(doc({ background: '#123456' }));
    expect(out.schemaVersion).toBe(SCHEMA_VERSION);
    expect(out.background).toBe('#123456');
  });

  it('REFUSES a document from a newer build', () => {
    // The dangerous case. Opening it would drop the fields this build does not
    // know about, and the next autosave would write that truncated version back
    // over the original - destroying work that was never corrupt.
    expect(() => migrateDesign(doc({ schemaVersion: SCHEMA_VERSION + 1 })))
      .toThrow(SchemaVersionError);
  });

  it('names both versions in the refusal, so the message is actionable', () => {
    try {
      migrateDesign(doc({ schemaVersion: 99 }));
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('99');
      expect((e as Error).message).toContain(String(SCHEMA_VERSION));
    }
  });

  it('refuses a document with no version rather than guessing', () => {
    expect(() => migrateDesign({ background: '#fff', elements: [] })).toThrow();
  });

  it('refuses non-objects', () => {
    expect(() => migrateDesign(null)).toThrow();
    expect(() => migrateDesign('a design')).toThrow();
    expect(() => migrateDesign(42)).toThrow();
  });

  it('stamps the current version onto the result', () => {
    expect(migrateDesign(doc()).schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe('migrating version 1 to 2: QR codes gained a style', () => {
  const v1 = (elements: unknown[]) => ({ schemaVersion: 1, background: '#fff', elements });

  const qr = { id: 'el-1', type: 'qr', u: 0.5, v: 0.5, rotation: 0, name: 'QR', url: 'https://a.com', widthU: 0.13 };

  it('gives an old QR the plain style it was actually drawn in', () => {
    // Stamped explicitly rather than left to a reader default: an old design
    // must keep looking as it did even if the default preset later changes.
    const out = migrateDesign(v1([qr]));
    expect(out.schemaVersion).toBe(SCHEMA_VERSION);
    expect(out.elements[0]).toMatchObject({ type: 'qr', styleId: 'classic', url: 'https://a.com' });
  });

  it('leaves every other field of the QR alone', () => {
    const out = migrateDesign(v1([qr]));
    expect(out.elements[0]).toMatchObject({ id: 'el-1', u: 0.5, v: 0.5, widthU: 0.13 });
  });

  it('does not touch other element types', () => {
    const band = { id: 'el-2', type: 'band', u: 0.5, v: 0.2, rotation: 0, name: 'B', heightV: 0.1, color: '#000' };
    const out = migrateDesign(v1([band]));
    expect(out.elements[0]).toEqual(band);
    expect(out.elements[0]).not.toHaveProperty('styleId');
  });

  it('does not overwrite a style that is already there', () => {
    const out = migrateDesign(v1([{ ...qr, styleId: 'dots' }]));
    expect(out.elements[0]).toMatchObject({ styleId: 'dots' });
  });

  it('survives a version 1 document with no elements', () => {
    expect(migrateDesign(v1([])).elements).toEqual([]);
  });
});
