import { describe, it, expect } from 'vitest';
import { hashBytes, isContentAddressed, encodeJson, decodeJson, randomId } from '../src/index';

const bytes = (...n: number[]) => new Uint8Array(n);

describe('content hashing', () => {
  it('gives identical bytes the same id', async () => {
    expect(await hashBytes(bytes(1, 2, 3))).toBe(await hashBytes(bytes(1, 2, 3)));
  });

  it('gives different bytes different ids', async () => {
    expect(await hashBytes(bytes(1, 2, 3))).not.toBe(await hashBytes(bytes(1, 2, 4)));
  });

  it('is order sensitive', async () => {
    expect(await hashBytes(bytes(1, 2))).not.toBe(await hashBytes(bytes(2, 1)));
  });

  it('produces a sha256-prefixed id in this runtime', async () => {
    const id = await hashBytes(bytes(9));
    expect(id.startsWith('sha256-')).toBe(true);
    expect(isContentAddressed(id)).toBe(true);
    // 32 bytes of SHA-256 as hex.
    expect(id.slice('sha256-'.length)).toHaveLength(64);
  });

  it('matches the known SHA-256 of the empty input', async () => {
    // Independent constant, not something this code produced.
    expect(await hashBytes(new Uint8Array(0))).toBe(
      'sha256-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('hashes only the view, not the buffer behind it', async () => {
    // THE TRAP: a Uint8Array is often a window onto a larger pool (every Node
    // Buffer is). Digesting `.buffer` directly would hash the whole pool, so
    // two identical assets read from different pools would get different ids
    // and deduplication would silently never fire.
    const pool = new Uint8Array([99, 99, 1, 2, 3, 99]);
    const view = pool.subarray(2, 5);
    expect(await hashBytes(view)).toBe(await hashBytes(bytes(1, 2, 3)));
  });

  it('treats a uid- id as not content addressed', () => {
    // The insecure-context fallback must never be mistaken for a real hash,
    // because deduplication would then be reasoning from a random number.
    expect(isContentAddressed('uid-abc')).toBe(false);
  });

  it('random ids do not repeat', () => {
    const ids = new Set(Array.from({ length: 500 }, () => randomId()));
    expect(ids.size).toBe(500);
  });
});

describe('json encoding', () => {
  it('round-trips a nested value', () => {
    const value = { a: [1, 2, { b: 'x' }], c: true };
    expect(decodeJson(encodeJson(value))).toEqual(value);
  });

  it('encodes non-ASCII as UTF-8', () => {
    expect(decodeJson(encodeJson({ n: 'café — ünï' }))).toEqual({ n: 'café — ünï' });
  });
});
