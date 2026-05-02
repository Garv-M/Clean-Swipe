import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createPersistOptions } from '@/store/persistence';

// ---------------------------------------------------------------------------
// Sub-types (local — no shared-type entry needed for these storage shapes)
// ---------------------------------------------------------------------------

interface StagedItem {
  assetId: string;
  sessionId: string;
  isSuspicious?: boolean;
  stagedAt: number;
}

interface ConfirmedItem {
  assetId: string;
  confirmedAt: number;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// State & actions interface
// ---------------------------------------------------------------------------

interface TrashState {
  /** Assets queued for deletion but not yet committed to the OS. */
  staged: StagedItem[];

  /** Assets whose deletion has been confirmed; kept until expiresAt for undo window. */
  confirmed: ConfirmedItem[];

  /** Asset IDs where the OS-level file deletion failed. */
  failedDeletions: string[];

  /** Queue an asset for deletion (does not delete from disk). */
  stageForDeletion(assetId: string, sessionId: string, isSuspicious?: boolean): void;

  /**
   * Move the given asset IDs from `staged` to `confirmed`.
   * Sets `expiresAt` = now + retentionDays days in milliseconds.
   */
  confirmDeletion(assetIds: string[], retentionDays: number): void;

  /** Rescue: pull an asset back out of the staged queue without deleting it. */
  removeFromStaged(assetId: string): void;

  /** Restore: remove an asset from confirmed (cancels the pending deletion). */
  removeFromConfirmed(assetId: string): void;

  /** Record assets that could not be deleted at the OS level. */
  markFailed(assetIds: string[]): void;

  /** Clear the failed-deletions list after the caller has handled the errors. */
  clearFailed(): void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useTrashStore = create<TrashState>()(
  persist(
    (set) => ({
      staged: [],
      confirmed: [],
      failedDeletions: [],

      stageForDeletion(assetId, sessionId, isSuspicious) {
        set((state) => ({
          staged: [
            ...state.staged,
            { assetId, sessionId, isSuspicious, stagedAt: Date.now() },
          ],
        }));
      },

      confirmDeletion(assetIds, retentionDays) {
        const now = Date.now();
        const expiresAt = now + retentionDays * 24 * 60 * 60 * 1000;
        const assetIdSet = new Set(assetIds);
        const newConfirmed: ConfirmedItem[] = assetIds.map((assetId) => ({
          assetId,
          confirmedAt: now,
          expiresAt,
        }));
        set((state) => ({
          staged: state.staged.filter((s) => !assetIdSet.has(s.assetId)),
          confirmed: [...state.confirmed, ...newConfirmed],
        }));
      },

      removeFromStaged(assetId) {
        set((state) => ({
          staged: state.staged.filter((s) => s.assetId !== assetId),
        }));
      },

      removeFromConfirmed(assetId) {
        set((state) => ({
          confirmed: state.confirmed.filter((c) => c.assetId !== assetId),
        }));
      },

      markFailed(assetIds) {
        set((state) => ({
          // Deduplicate so repeated markFailed calls don't bloat the list.
          failedDeletions: [...new Set([...state.failedDeletions, ...assetIds])],
        }));
      },

      clearFailed() {
        set({ failedDeletions: [] });
      },
    }),
    createPersistOptions<TrashState>('trash'),
  ),
);
