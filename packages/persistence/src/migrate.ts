/**
 * Schema migration for stored designs.
 *
 * A design saved today must still open in a year, after the element types have
 * moved on. Every document records the schema version it was written at, and
 * is walked forward through this chain on load.
 *
 * The chain is deliberately dumb and explicit - one function per version step,
 * no "just add a default in the reader". Defaults scattered through readers is
 * how a format quietly becomes unreadable: each reader disagrees slightly
 * about what an old document meant.
 */

import { SCHEMA_VERSION } from './types';
import type { StoredDesign } from './types';

/** A single version step: version N in, version N+1 out. */
type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/**
 * Keyed by the version being migrated FROM.
 *
 * Empty today because version 1 is the first published shape. The chain is
 * built now rather than later so the first change is a one-line addition
 * instead of a retrofit against documents already in the wild.
 */
const MIGRATIONS: Record<number, Migration> = {};

export class SchemaVersionError extends Error {
  override readonly name = 'SchemaVersionError';
  constructor(readonly found: number) {
    super(
      `This design was saved by a newer version of Cupco Studio ` +
      `(format ${found}, this build understands ${SCHEMA_VERSION}). ` +
      `Update the app to open it.`,
    );
  }
}

/**
 * Bring a stored design up to the current schema version.
 *
 * Throws on a document from the FUTURE. Silently opening one would mean
 * dropping the fields this build does not know about, and then autosave would
 * write the truncated version back over the original - destroying work that
 * was never corrupt in the first place.
 */
export function migrateDesign(raw: unknown): StoredDesign {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('Stored design is not an object');
  }
  let doc = raw as Record<string, unknown>;
  let version = typeof doc['schemaVersion'] === 'number' ? (doc['schemaVersion'] as number) : 0;

  if (version > SCHEMA_VERSION) throw new SchemaVersionError(version);

  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) {
      // No path forward. Better to say so than to hand back a half-migrated
      // document that renders subtly wrong.
      throw new Error(
        `No migration from design format ${version} to ${version + 1}`,
      );
    }
    doc = step(doc);
    version += 1;
  }

  doc['schemaVersion'] = SCHEMA_VERSION;
  return doc as unknown as StoredDesign;
}
