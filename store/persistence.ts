/**
 * store/persistence.ts
 *
 * Shared MMKV-backed Zustand persistence infrastructure.
 * This file has NO app-level dependencies — it is pure infrastructure.
 *
 * Exports:
 *   mmkv               — raw MMKV instance for direct key-value access
 *   mmkvStorage        — StateStorage adapter backed by mmkv
 *   debouncedMmkvStorage — mmkvStorage with 300ms debounced writes
 *   createPersistOptions — helper that builds PersistOptions for a named store
 */

import { createMMKV } from 'react-native-mmkv';
import {
  createJSONStorage,
  type PersistOptions,
  type StateStorage,
} from 'zustand/middleware';

// ---------------------------------------------------------------------------
// 1. Shared encrypted MMKV instance
//    encryptionKey is 16 ASCII bytes — fits AES-128 (the default).
// ---------------------------------------------------------------------------
export const mmkv = createMMKV({
  id: 'clean-swipe-store',
  encryptionKey: 'cs-secure-key-v1',
});

// ---------------------------------------------------------------------------
// 2. Zustand StateStorage adapter
//    Maps the zustand interface onto react-native-mmkv v4 method names:
//      getString  (returns string | undefined  → coerce to string | null)
//      set        (write string/bool/number/ArrayBuffer)
//      remove     (v4 renamed from v2's "delete")
// ---------------------------------------------------------------------------
export const mmkvStorage: StateStorage = {
  getItem: (name: string): string | null => mmkv.getString(name) ?? null,
  setItem: (name: string, value: string): void => {
    mmkv.set(name, value);
  },
  removeItem: (name: string): void => {
    mmkv.remove(name);
  },
};

// ---------------------------------------------------------------------------
// 3. Debounced write wrapper
//    Batches setItem calls and flushes after 300 ms of inactivity.
//    One pending timer is tracked per key so rapid updates to the same key
//    collapse into a single disk write (critical during fast-swipe sessions).
//
//    getItem  — always pass-through (reads must be fresh)
//    removeItem — always immediate (consistency: no stale pending write)
// ---------------------------------------------------------------------------
const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();

export const debouncedMmkvStorage: StateStorage = {
  getItem: (name: string): string | null => mmkvStorage.getItem(name) as string | null,

  setItem: (name: string, value: string): void => {
    const existing = pendingWrites.get(name);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      mmkvStorage.setItem(name, value);
      pendingWrites.delete(name);
    }, 300);
    pendingWrites.set(name, timer);
  },

  removeItem: (name: string): void => {
    // Cancel any buffered write so a removed key cannot resurface.
    const existing = pendingWrites.get(name);
    if (existing !== undefined) {
      clearTimeout(existing);
      pendingWrites.delete(name);
    }
    mmkvStorage.removeItem(name);
  },
};

// ---------------------------------------------------------------------------
// 4. createPersistOptions helper
//    Returns a ready-made PersistOptions object for zustand's persist()
//    middleware. Each store passes its unique name; storage is shared.
//
//    Usage:
//      persist(stateCreator, createPersistOptions<MyState>('my-store'))
// ---------------------------------------------------------------------------
export function createPersistOptions<T>(storeName: string): PersistOptions<T> {
  return {
    name: storeName,
    storage: createJSONStorage<T>(() => debouncedMmkvStorage),
  };
}
