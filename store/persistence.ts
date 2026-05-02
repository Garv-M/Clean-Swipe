/**
 * store/persistence.ts
 *
 * Shared Zustand persistence infrastructure.
 * Uses MMKV (encrypted) in dev/prod builds; falls back to in-memory storage
 * when running in Expo Go (which does not support NitroModules).
 *
 * Exports:
 *   mmkv                   — raw MMKV instance, or null in Expo Go
 *   debouncedMmkvStorage   — StateStorage adapter with 300ms debounced writes
 *   flushPendingWrites     — flush all buffered writes immediately (call before backgrounding)
 *   createPersistOptions   — helper that builds PersistOptions for a named store
 */

import {
  createJSONStorage,
  type PersistOptions,
  type StateStorage,
} from 'zustand/middleware';

// ---------------------------------------------------------------------------
// Minimal MMKV interface — avoids a top-level import that crashes Expo Go
// ---------------------------------------------------------------------------
type MMKVInstance = {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
};

// ---------------------------------------------------------------------------
// 1. MMKV instance — null when NitroModules are unavailable (Expo Go)
//
// SECURITY NOTE: The encryption key is embedded in the JS bundle and is
// recoverable from the app binary. MMKV encryption here prevents casual
// filesystem browsing of the .mmkv file (e.g. via iTunes file sharing), but
// does NOT protect against adversarial extraction. For this app's data
// (session state, user preferences), this trade-off is acceptable.
// TODO: Replace with a device-derived key from expo-secure-store when available.
// ---------------------------------------------------------------------------
let _mmkv: MMKVInstance | null = null;

try {
  // Use require() so Metro can tree-shake this in Expo Go without a hard crash.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createMMKV } = require('react-native-mmkv') as {
    createMMKV: (opts: { id: string; encryptionKey: string }) => MMKVInstance;
  };
  _mmkv = createMMKV({ id: 'clean-swipe-store', encryptionKey: 'cs-secure-key-v1' });
} catch {
  if (__DEV__) {
    console.warn(
      '[persistence] MMKV unavailable (Expo Go / NitroModules not supported). ' +
        'Falling back to in-memory storage — state will NOT persist across restarts.',
    );
  }
}

/** Raw MMKV instance. Null when running in Expo Go. */
export const mmkv = _mmkv;

// ---------------------------------------------------------------------------
// 2. Base synchronous storage
//    MMKV in real builds; plain Map in Expo Go.
// ---------------------------------------------------------------------------
const memStore = new Map<string, string>();

const baseStorage: StateStorage = _mmkv
  ? {
      getItem: (name) => _mmkv!.getString(name) ?? null,
      setItem: (name, value) => { _mmkv!.set(name, value); },
      removeItem: (name) => { _mmkv!.remove(name); },
    }
  : {
      getItem: (name) => memStore.get(name) ?? null,
      setItem: (name, value) => { memStore.set(name, value); },
      removeItem: (name) => { memStore.delete(name); },
    };

// ---------------------------------------------------------------------------
// 3. Debounced write wrapper
//    Batches setItem calls and flushes after 300 ms of inactivity per key.
//    Reads and removes are always immediate.
// ---------------------------------------------------------------------------
const pendingWrites = new Map<string, { timer: ReturnType<typeof setTimeout>; value: string }>();

export const debouncedMmkvStorage: StateStorage = {
  getItem: (name) => baseStorage.getItem(name),

  setItem: (name, value) => {
    const existing = pendingWrites.get(name);
    if (existing !== undefined) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      baseStorage.setItem(name, value);
      pendingWrites.delete(name);
    }, 300);
    pendingWrites.set(name, { timer, value });
  },

  removeItem: (name) => {
    const existing = pendingWrites.get(name);
    if (existing !== undefined) {
      clearTimeout(existing.timer);
      pendingWrites.delete(name);
    }
    baseStorage.removeItem(name);
  },
};

// ---------------------------------------------------------------------------
// 4. flushPendingWrites
//    Drains the debounce queue synchronously. Call before backgrounding.
// ---------------------------------------------------------------------------
export function flushPendingWrites(): void {
  for (const [name, { timer, value }] of pendingWrites) {
    clearTimeout(timer);
    baseStorage.setItem(name, value);
    pendingWrites.delete(name);
  }
}

// ---------------------------------------------------------------------------
// 5. createPersistOptions helper
// ---------------------------------------------------------------------------
export function createPersistOptions<T>(storeName: string): PersistOptions<T> {
  return {
    name: storeName,
    storage: createJSONStorage<T>(() => debouncedMmkvStorage),
  };
}
