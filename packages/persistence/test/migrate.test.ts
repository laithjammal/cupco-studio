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
