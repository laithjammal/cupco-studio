'use client';

/**
 * Undo / redo.
 *
 * The tricky part is granularity. A single drag fires dozens of updates, and
 * pushing each one would mean dozens of undos to reverse one gesture. So the
 * API separates the two cases:
 *
 *   commit()  — a discrete change (add, delete, colour, font). Pushes history.
 *   update()  — a continuous change (drag frame). Does NOT push.
 *   begin()   — called once at the START of a gesture, snapshots the state.
 *
 * A drag therefore costs exactly one history entry: the snapshot taken before
 * it started.
 */

import { useCallback, useRef, useState } from 'react';

const LIMIT = 100;

export interface History<T> {
  state: T;
  /** Discrete change — pushes the previous state onto the undo stack. */
  commit: (next: T | ((prev: T) => T)) => void;
  /** Continuous change — replaces state without touching history. */
  update: (next: T | ((prev: T) => T)) => void;
  /** Snapshot the current state before a gesture begins. */
  begin: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Discard all history, e.g. when loading a different project. */
  reset: (next: T) => void;
}

export function useHistory<T>(initial: T): History<T> {
  const [state, setState] = useState<T>(initial);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const [, force] = useState(0);
  const bump = useCallback(() => force((n) => n + 1), []);

  const resolve = (next: T | ((prev: T) => T), prev: T): T =>
    typeof next === 'function' ? (next as (p: T) => T)(prev) : next;

  const push = useCallback((prev: T) => {
    past.current.push(prev);
    if (past.current.length > LIMIT) past.current.shift();
    // Any new edit invalidates the redo branch.
    future.current = [];
  }, []);

  const commit = useCallback((next: T | ((prev: T) => T)) => {
    setState((prev) => {
      const value = resolve(next, prev);
      if (value === prev) return prev;
      push(prev);
      return value;
    });
    bump();
  }, [push, bump]);

  const update = useCallback((next: T | ((prev: T) => T)) => {
    setState((prev) => resolve(next, prev));
  }, []);

  const begin = useCallback(() => {
    setState((prev) => { push(prev); return prev; });
    bump();
  }, [push, bump]);

  const undo = useCallback(() => {
    setState((prev) => {
      const p = past.current.pop();
      if (p === undefined) return prev;
      future.current.push(prev);
      return p;
    });
    bump();
  }, [bump]);

  const redo = useCallback(() => {
    setState((prev) => {
      const f = future.current.pop();
      if (f === undefined) return prev;
      past.current.push(prev);
      return f;
    });
    bump();
  }, [bump]);

  const reset = useCallback((next: T) => {
    past.current = [];
    future.current = [];
    setState(next);
    bump();
  }, [bump]);

  return {
    state, commit, update, begin, undo, redo, reset,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}
