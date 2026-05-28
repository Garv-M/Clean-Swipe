/**
 * services/deletion.ts
 *
 * Drives the staged → confirmed → deleted trash lifecycle.
 *
 * Coordinates between the trash store, settings store, stats store, and the
 * MediaLibrary service. All functions are standalone exports; no class, no
 * singleton, no React, no hooks.
 *
 * Store state is accessed via .getState() — the Zustand pattern that is safe
 * outside of a React component tree.
 */

import { deleteAssets } from '@/services/mediaLibrary';
import { useSettingsStore } from '@/store/settings';
import { useStatsStore } from '@/store/stats';
import { useTrashStore } from '@/store/trash';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface DeletionServiceResult {
  /** Total bytes freed for the successfully deleted assets. */
  freed: number;
  /** Asset IDs whose OS-level deletion failed. */
  failed: string[];
}

// ---------------------------------------------------------------------------
// confirmStaged
// ---------------------------------------------------------------------------

/**
 * Move the given asset IDs from `staged` to `confirmed` in the trash store.
 *
 * Reads `retentionDays` from the settings store at call time so the value
 * always reflects the user's current preference. Pure store coordination —
 * no async I/O.
 *
 * @param assetIds  The staged asset IDs to confirm for deletion.
 */
export function confirmStaged(assetIds: string[]): void {
  if (assetIds.length === 0) return;
  const retentionDays = useSettingsStore.getState().retentionDays;
  useTrashStore.getState().confirmDeletion(assetIds, retentionDays);
}

// ---------------------------------------------------------------------------
// executeDelete
// ---------------------------------------------------------------------------

/**
 * Permanently delete the given assets from the device media library.
 *
 * Flow:
 *  1. Call the MediaLibrary service to perform the OS-level deletion.
 *  2. For every successfully deleted ID, remove it from the trash store's
 *     `confirmed` list so the UI no longer reflects it.
 *  3. Batch-mark any failed IDs in the trash store for the caller to surface
 *     or retry later.
 *  4. Sum freed bytes from the optional `bytesMap` and record the total in
 *     the stats store.
 *
 * Note on `freed` accuracy: The MediaLibrary API does not return file sizes
 * for deleted assets. Pass a `bytesMap` built from asset metadata gathered
 * before deletion (e.g. from the swipe session store) to get an accurate
 * freed-byte count. Omitting `bytesMap`, or omitting entries for individual
 * IDs, falls back to 0 for those assets. The caller is responsible for
 * updating any downstream display that needs the precise figure.
 *
 * Note on confirmed-list cleanup: Successfully deleted assets are removed from
 * the confirmed list in a single batched Zustand state update via
 * `removeAllConfirmed`, avoiding repeated individual mutations.
 *
 * @param assetIds   Asset IDs to delete.
 * @param bytesMap   Optional map of assetId → file size in bytes for freed
 *                   storage accounting.
 */
export async function executeDelete(
  assetIds: string[],
  bytesMap?: Record<string, number>,
): Promise<DeletionServiceResult> {
  const { deleted, failed } = await deleteAssets(assetIds);

  // Remove successfully deleted assets from the confirmed list in one update.
  const trash = useTrashStore.getState();
  if (deleted.length > 0) {
    trash.removeAllConfirmed(deleted);
  }

  // Record OS-level failures so the UI can surface and retry them.
  if (failed.length > 0) {
    trash.markFailed(failed);
  }

  // Sum freed bytes for successfully deleted assets using the provided map.
  let freed = 0;
  if (bytesMap != null) {
    for (const assetId of deleted) {
      freed += bytesMap[assetId] ?? 0;
    }
  }

  // Persist the freed-storage figure in the stats store.
  if (freed > 0) {
    useStatsStore.getState().recordFreed(freed);
  }

  // Record how many assets were permanently deleted.
  if (deleted.length > 0) {
    useStatsStore.getState().recordDeleted(deleted.length);
  }

  return { freed, failed };
}

// ---------------------------------------------------------------------------
// emptyTrash
// ---------------------------------------------------------------------------

/**
 * Delete every confirmed asset in the trash.
 *
 * Retrieves the current confirmed list at call time and delegates to
 * `executeDelete`. The caller may optionally pass a `bytesMap` for accurate
 * storage accounting (see `executeDelete` docs).
 *
 * @param bytesMap  Optional map of assetId → file size in bytes.
 */
export async function emptyTrash(
  bytesMap?: Record<string, number>,
): Promise<DeletionServiceResult> {
  const confirmedIds = useTrashStore.getState().confirmed.map((item) => item.assetId);
  return executeDelete(confirmedIds, bytesMap);
}

// ---------------------------------------------------------------------------
// retryFailed
// ---------------------------------------------------------------------------

/**
 * Retry deletion for all assets currently in the failed-deletions list.
 *
 * The failed list is cleared *before* the deletion attempt so that:
 *  - The UI immediately reflects that a retry is in progress.
 *  - Any assets that fail again are written to `failedDeletions` as a fresh
 *    entry rather than being deduplicated against the stale set.
 *
 * @param bytesMap  Optional map of assetId → file size in bytes.
 */
export async function retryFailed(
  bytesMap?: Record<string, number>,
): Promise<DeletionServiceResult> {
  const trash = useTrashStore.getState();
  const failedAssetIds = [...trash.failedDeletions];

  if (failedAssetIds.length === 0) return { freed: 0, failed: [] };

  // Clear before attempting so re-failures are recorded as a clean new batch.
  trash.clearFailed();

  return executeDelete(failedAssetIds, bytesMap);
}
