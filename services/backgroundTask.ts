/**
 * services/backgroundTask.ts
 *
 * Background fetch task for Clean Swipe. Runs on a periodic OS-managed
 * interval to check for new photos, storage pressure, post-trip clusters,
 * pending cleanup reminders, and the monthly digest.
 *
 * Design constraints:
 * - No React, no hooks — all store access via `.getState()`.
 * - `TaskManager.defineTask` MUST be called at module top-level; it cannot be
 *   deferred inside a function or lifecycle method.
 * - Avoid importing anything that triggers React-side effects on import.
 */

import * as BackgroundFetch from 'expo-background-fetch';
import { Paths } from 'expo-file-system';
import * as TaskManager from 'expo-task-manager';

import { fetchAssetsPage } from '@/services/mediaLibrary';
import {
  scheduleMonthlyDigestNotification,
  scheduleNewPhotosNotification,
  schedulePendingCleanupNotification,
  schedulePostTripNotification,
  scheduleStoragePressureNotification,
} from '@/services/notifications';
import { useClusterStore } from '@/store/cluster';
import { useSettingsStore } from '@/store/settings';
import { useStatsStore } from '@/store/stats';
import { useTrashStore } from '@/store/trash';
import type { Asset, EventCluster } from '@/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Name used to register the background fetch task with expo-task-manager. */
export const BACKGROUND_FETCH_TASK = 'clean-swipe-background-fetch';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Generate a compact, unique ID suitable for a new cluster created in the
 * background context (crypto.randomUUID is not guaranteed in all BG runtimes).
 */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/**
 * Format a Date as a 'YYYY-MM-DD' day key in local time.
 * Used to group assets by calendar day for post-trip detection.
 */
function toDayKey(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Task definition — MUST remain at module top-level
// ---------------------------------------------------------------------------

/**
 * The actual task logic. Defined at module scope as required by
 * expo-task-manager; the handler receives no useful data for background-fetch
 * tasks, so the body parameter is ignored.
 */
TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
  try {
    let notified = false;

    // -----------------------------------------------------------------------
    // 1. New photos check
    //    Fetch all photos created since the last clustering run (or 7 days
    //    ago as a safe fallback). Fire a notification when the count crosses
    //    one of the defined thresholds.
    // -----------------------------------------------------------------------
    const { lastClusteredAt } = useClusterStore.getState();
    const since = lastClusteredAt ?? Date.now() - 7 * 24 * 60 * 60 * 1000;

    const { assets: newAssets } = await fetchAssetsPage({ createdAfter: since });
    const newPhotoCount = newAssets.length;

    if (newPhotoCount >= 50) {
      await scheduleNewPhotosNotification(newPhotoCount);
      notified = true;
    }

    // -----------------------------------------------------------------------
    // 2. Storage pressure check
    //    Use the new synchronous Paths API (expo-file-system v19+).
    // -----------------------------------------------------------------------
    const totalDisk = Paths.totalDiskSpace;
    if (totalDisk > 0) {
      const freeDisk = Paths.availableDiskSpace;
      const usedPct = Math.round((1 - freeDisk / totalDisk) * 100);
      if (usedPct >= 85) {
        await scheduleStoragePressureNotification(usedPct);
        notified = true;
      }
    }

    // -----------------------------------------------------------------------
    // 3. Post-trip detection (incremental clustering)
    //    Group the newly-fetched photos by calendar day. Any day that has
    //    >= 10 photos and is not already covered by an existing cluster
    //    becomes a new cluster.  Notify once for the largest new cluster.
    // -----------------------------------------------------------------------
    const dayMap = new Map<string, Asset[]>();
    for (const asset of newAssets) {
      const key = toDayKey(asset.createdAt);
      const bucket = dayMap.get(key);
      if (bucket) {
        bucket.push(asset);
      } else {
        dayMap.set(key, [asset]);
      }
    }

    const { clusters: existingClusters } = useClusterStore.getState();
    // Build a flat set of all assetIds already tracked by existing clusters.
    const existingAssetIdSet = new Set<string>(
      existingClusters.flatMap((c) => c.assetIds),
    );

    const addedClusters: EventCluster[] = [];
    let biggestNew: { id: string; name: string; count: number } | null = null;

    for (const [dayKey, dayAssets] of dayMap) {
      // Require a meaningful batch to avoid noise from scattered uploads.
      if (dayAssets.length < 10) continue;

      // Skip if every asset in this day group is already tracked — the group
      // was already picked up by a previous clustering run.
      const hasUncoveredAsset = dayAssets.some(
        (a) => !existingAssetIdSet.has(a.id),
      );
      if (!hasUncoveredAsset) continue;

      const clusterId = generateId();
      const clusterName = `Photos from ${dayKey}`;

      // Compute the temporal span of this day's assets.
      let from = Infinity;
      let to = -Infinity;
      let estimatedBytes = 0;
      const assetIds: string[] = [];
      for (const a of dayAssets) {
        if (a.createdAt < from) from = a.createdAt;
        if (a.createdAt > to) to = a.createdAt;
        estimatedBytes += a.bytes ?? 0;
        assetIds.push(a.id);
      }

      const newCluster: EventCluster = {
        id: clusterId,
        name: clusterName,
        dateRange: { from, to },
        assetCount: dayAssets.length,
        estimatedBytes,
        assetIds,
      };

      addedClusters.push(newCluster);

      if (!biggestNew || dayAssets.length > biggestNew.count) {
        biggestNew = { id: clusterId, name: clusterName, count: dayAssets.length };
      }
    }

    if (addedClusters.length > 0) {
      // Merge new clusters into the existing list and update the timestamp.
      useClusterStore.setState({
        clusters: [...existingClusters, ...addedClusters],
        lastClusteredAt: Date.now(),
      });

      // Only notify for the single largest new cluster to avoid spamming the
      // user when multiple days' worth of photos arrive at once.
      if (biggestNew) {
        await schedulePostTripNotification(
          biggestNew.id,
          biggestNew.name,
          biggestNew.count,
        );
        notified = true;
      }
    }

    // -----------------------------------------------------------------------
    // 4. Pending cleanup check
    //    Remind the user about photos they staged but haven't confirmed.
    //    Notify only after 3 days of sitting, before 14 days, and no more
    //    than once every 3 days.
    // -----------------------------------------------------------------------
    const { staged } = useTrashStore.getState();
    if (staged.length > 0) {
      const { lastPendingCleanupNotifiedAt } = useSettingsStore.getState();

      const oldestStagedAt = staged.reduce(
        (min, s) => Math.min(min, s.stagedAt),
        Infinity,
      );
      const daysSinceOldest = Math.floor(
        (Date.now() - oldestStagedAt) / (24 * 60 * 60 * 1000),
      );

      const notifCooldownPassed =
        lastPendingCleanupNotifiedAt === null ||
        Date.now() - lastPendingCleanupNotifiedAt > 3 * 24 * 60 * 60 * 1000;

      if (daysSinceOldest >= 3 && daysSinceOldest < 14 && notifCooldownPassed) {
        await schedulePendingCleanupNotification(staged.length);
        useSettingsStore.getState().setLastPendingCleanupNotifiedAt(Date.now());
        notified = true;
      }
    }

    // -----------------------------------------------------------------------
    // 5. Monthly digest check
    //    On the 1st of each month, send a summary of last month's activity.
    //    Guard against duplicate sends within the same month.
    // -----------------------------------------------------------------------
    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7); // "YYYY-MM"
    const { lastMonthlyDigestMonth } = useSettingsStore.getState();

    if (now.getDate() === 1 && lastMonthlyDigestMonth !== currentMonth) {
      // Derive the previous month key.
      const curYear = now.getFullYear();
      const curMonthIndex = now.getMonth() + 1; // 1-indexed
      const prevMonthIndex = curMonthIndex === 1 ? 12 : curMonthIndex - 1;
      const prevYear = curMonthIndex === 1 ? curYear - 1 : curYear;
      const prevMonthKey = `${prevYear}-${String(prevMonthIndex).padStart(2, '0')}`;

      const { monthlyFreedBytes } = useStatsStore.getState();
      const bytes = monthlyFreedBytes[prevMonthKey] ?? 0;
      const freedGB = (bytes / 1e9).toFixed(1) + ' GB';

      // Human-readable label, e.g. "April 2026".
      const monthLabel = new Date(prevYear, prevMonthIndex - 1).toLocaleString(
        'default',
        { month: 'long', year: 'numeric' },
      );

      await scheduleMonthlyDigestNotification(monthLabel, freedGB, newPhotoCount);
      useSettingsStore.getState().setLastMonthlyDigestMonth(currentMonth);
      notified = true;
    }

    return notified
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch (err) {
    if (__DEV__) console.error('[BackgroundTask] error', err);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// ---------------------------------------------------------------------------
// Registration helper
// ---------------------------------------------------------------------------

/**
 * Register the background fetch task with the OS scheduler.
 *
 * Call this once during app initialisation after notification permissions have
 * been granted. Safe to call multiple times — expo-background-fetch is
 * idempotent when the task is already registered.
 *
 * @example
 * // In your root layout or app entry point:
 * await registerBackgroundTask();
 */
export async function registerBackgroundTask(): Promise<void> {
  await BackgroundFetch.registerTaskAsync(BACKGROUND_FETCH_TASK, {
    minimumInterval: 15 * 60, // 15 minutes in seconds
    stopOnTerminate: false,   // Android: keep running after app is killed
    startOnBoot: true,        // Android: restart after device reboot
  });
}
