/**
 * Content addressing for assets.
 *
 * An asset's id is the hash of its bytes, so writing the same logo twice
 * stores it once and no refcount is needed on the write path.
 */

import type { AssetId } from './types';

/**
 * Hash bytes to an asset id.
 *
 * WHY THERE IS A NON-HASH FALLBACK
 * --------------------------------
 * `crypto.subtle` is unavailable outside a secure context - which includes
 * opening the app over plain http on a LAN address. Rather than fail the save,
 * this falls back to a random id.
 *
 * The fallback is deliberately RANDOM rather than a cheap non-cryptographic
 * hash. A weak hash would keep deduplication working, but a collision would
 * silently serve one customer's logo in place of another's, and that is not a
 * bug anyone would ever trace back to here. Losing dedup is an optimisation;
 * losing correctness is not. The `uid-` prefix makes which path ran visible in
 * the stored data.
 */
export async function hashBytes(bytes: Uint8Array): Promise<AssetId> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return `uid-${randomId()}`;

  // Copy into a standalone ArrayBuffer: the incoming view may be a window onto
  // a larger pool (a Node Buffer usually is), and digesting the whole pool
  // would hash the wrong bytes.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await subtle.digest('SHA-256', copy.buffer);
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `sha256-${hex}`;
}

/** True when this id came from real content hashing, so dedup can be trusted. */
export function isContentAddressed(id: AssetId): boolean {
  return id.startsWith('sha256-');
}

/** A random identifier for projects, versions and non-hashable assets. */
export function randomId(): string {
  // Cast so the optional check survives: the DOM lib types `crypto` as always
  // present, which it is not in every runtime this package targets.
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  // Node 18 without webcrypto, and older browsers.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const encoder = new TextEncoder();

/** Encode a JSON payload to bytes, for hashing and storage. */
export function encodeJson(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

const decoder = new TextDecoder();

export function decodeJson<T>(bytes: Uint8Array): T {
  return JSON.parse(decoder.decode(bytes)) as T;
}
