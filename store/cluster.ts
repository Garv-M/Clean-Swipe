import { createPersistOptions } from '@/store/persistence';
import type { EventCluster } from '@/types';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ---------------------------------------------------------------------------
// State & actions interface
// ---------------------------------------------------------------------------

interface ClusterState {
  /** All clusters produced by the most recent scan. */
  clusters: EventCluster[];

  /** Unix timestamp (ms) of the last completed clustering run, or null if never run. */
  lastClusteredAt: number | null;

  /** True while the background clustering algorithm is running. */
  isScanning: boolean;

  /** Replace the full cluster list and record the scan timestamp. */
  setClusters(clusters: EventCluster[]): void;

  /** Toggle the scanning indicator (set true when scan starts, false when done). */
  setScanning(scanning: boolean): void;

  /** Merge a partial patch into a single cluster by id (no-op if id not found). */
  updateCluster(id: string, patch: Partial<Omit<EventCluster, 'id'>>): void;

  /** Remove a cluster by id (e.g. after the user dismisses or acts on it). */
  removeCluster(id: string): void;

  /** Create a new cluster with a generated id and append it to the list. Returns the new cluster's id. */
  createCustomCluster(cluster: Omit<EventCluster, 'id'>): string;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useClusterStore = create<ClusterState>()(
  persist(
    (set) => ({
      clusters: [],
      lastClusteredAt: null,
      isScanning: false,

      setClusters(clusters) {
        set({ clusters, lastClusteredAt: Date.now(), isScanning: false });
      },

      setScanning(scanning) {
        set({ isScanning: scanning });
      },

      updateCluster(id, patch) {
        set((state) => ({
          clusters: state.clusters.map((c) =>
            c.id === id ? { ...c, ...patch } : c,
          ),
        }));
      },

      removeCluster(id) {
        set((state) => ({
          clusters: state.clusters.filter((c) => c.id !== id),
        }));
      },

      createCustomCluster(cluster) {
        const id =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : Date.now().toString(36) + Math.random().toString(36).slice(2);
        const newCluster: EventCluster = { ...cluster, id };
        set((state) => ({ clusters: [...state.clusters, newCluster] }));
        return id;
      },
    }),
    createPersistOptions<ClusterState>('clusters'),
  ),
);
