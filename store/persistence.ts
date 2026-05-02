/**
 * store/persistence.ts
 *
 * Shared MMKV-backed Zustand persistence infrastructure.
 * This file has NO app-level dependencies — it is pure infrastructure.
 *
 * Exports:
 *   mmkv                   — raw MMKV instance for direct key-value access
 *   debouncedMmkvStorage   — StateStorage adapter with 300ms debounced writes
 *   flushPendingWrites     — flush all buffered writes immediately (call before backgrounding)
 *   createPersistOptions   — helper that builds PersistOptions for a named store
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
//
// SECURITY NOTE: This key is embedded in the JS bundle and is recoverable by
// anyone with access to the app binary. MMKV encryption here prevents casual
// filesystem browsing of the .mmkv file (e.g. via iTunes file sharing), but
// does NOT protect against adversarial extraction. For this app's data
// (session state, user preferences), this trade-off is acceptable.
// TODO: Replace with a device-derived key from expo-secure-store when the
// dependency is available.
// ---------------------------------------------------------------------------
export const mmkv = createMMKV({
  id: 'clean-swipe-store',
  encryptionKey: 'cs-secure-key-v1',
});

// ---------------------------------------------------------------------------
// 2. Zustand StateStorage adapter (internal — not exported)
//    Maps the zustand interface onto react-native-mmkv v4 method names:
//      getString  (returns string | undefined  → coerce to string | null)
//      set        (write string/bool/number/ArrayBuffer)
//      remove     (v4 renamed from v2's "delete")
// ---------------------------------------------------------------------------
const mmkvStorage: StateStorage = {
  getItem: (name: string) => mmkv.getString(name) ?? null,
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
//    getItem    — always pass-through (reads must be fresh)
//    removeItem — always immediate (consistency: no stale pending write)
//
//    Each Map entry carries both the timer ID and the pending value so that
//    flushPendingWrites() can write synchronously without relying on the
//    timer callback.
// ---------------------------------------------------------------------------
const pendingWrites = new Map<string, { timer: ReturnType<typeof setTimeout>; value: string }>();

export const debouncedMmkvStorage: StateStorage = {
  getItem: (name: string) => mmkv.getString(name) ?? null,

  setItem: (name: string, value: string): void => {
    const existing = pendingWrites.get(name);
    if (existing !== undefined) {
      clearTimeout(existing.timer);
    }
    const timer = setTimeout(() => {
      mmkvStorage.setItem(name, value);
      pendingWrites.delete(name);
    }, 300);
    pendingWrites.set(name, { timer, value });
  },

  removeItem: (name: string): void => {
    // Cancel any buffered write so a removed key cannot resurface.
    const existing = pendingWrites.get(name);
    if (existing !== undefined) {
      clearTimeout(existing.timer);
      pendingWrites.delete(name);
    }
    mmkvStorage.removeItem(name);
  },
};

// ---------------------------------------------------------------------------
// 4. flushPendingWrites
//    Writes all debounced entries to MMKV synchronously and clears the queue.
//    Call this from the app root before the app moves to the background so
//    that no state is lost when the JS runtime is suspended.
//
//    Usage (e.g. in AppState change handler):
//      AppState.addEventListener('change', (state) => {
//        if (state === 'background') flushPendingWrites();
//      });
// ---------------------------------------------------------------------------
export function flushPendingWrites(): void {
  for (const [name, { timer, value }] of pendingWrites) {
    clearTimeout(timer);
    mmkvStorage.setItem(name, value);
    pendingWrites.delete(name);
  }
}

// ---------------------------------------------------------------------------
// 5. createPersistOptions helper
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
