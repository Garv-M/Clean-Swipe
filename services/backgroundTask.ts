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

const FALLBACK_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;          // 7 days
const DISK_PRESSURE_PCT = 85;
const MIN_TRIP_PHOTOS = 10;
const PENDING_CLEANUP_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;   // 3 days
const MIN_DAYS_BEFORE_CLEANUP_NUDGE = 3;
const MAX_DAYS_BEFORE_CLEANUP_NUDGE = 14;
const BACKGROUND_FETCH_INTERVAL_SEC = 15 * 60;                  // 15 minutes

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
// Core task logic — exported so it can be called directly for testing
// ---------------------------------------------------------------------------

/**
 * Runs all 5 notification checks. Called by the registered background task
 * and can be invoked directly in `__DEV__` builds for manual testing.
 */
export async function runBackgroundChecks(): Promise<BackgroundFetch.BackgroundFetchResult> {
  try {
    let notified = false;

    // -----------------------------------------------------------------------
    // 1. New photos check
    // -----------------------------------------------------------------------
    const { lastClusteredAt } = useClusterStore.getState();
    const rawSince = lastClusteredAt ?? (Date.now() - FALLBACK_LOOKBACK_MS);
    const since = Math.min(rawSince, Date.now());

    const { assets: newAssets } = await fetchAssetsPage({ createdAfter: since });
    const newPhotoCount = newAssets.length;

    if (newPhotoCount >= 50) {
      await scheduleNewPhotosNotification(newPhotoCount);
      notified = true;
    }

    // -----------------------------------------------------------------------
    // 2. Storage pressure check
    // -----------------------------------------------------------------------
    const totalDisk = Paths.totalDiskSpace;
    if (totalDisk > 0) {
      const freeDisk = Paths.availableDiskSpace;
      const usedPct = Math.round((1 - freeDisk / totalDisk) * 100);
      if (usedPct >= DISK_PRESSURE_PCT) {
        await scheduleStoragePressureNotification(usedPct);
        notified = true;
      }
    }

    // -----------------------------------------------------------------------
    // 3. Post-trip detection (incremental clustering)
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
    const existingAssetIdSet = new Set<string>(
      existingClusters.flatMap((c) => c.assetIds),
    );

    const addedClusters: EventCluster[] = [];
    let biggestNew: { id: string; name: string; count: number } | null = null;

    for (const [dayKey, dayAssets] of dayMap) {
      if (dayAssets.length < MIN_TRIP_PHOTOS) continue;
      const hasUncoveredAsset = dayAssets.some((a) => !existingAssetIdSet.has(a.id));
      if (!hasUncoveredAsset) continue;

      const clusterId = generateId();
      const clusterName = `Photos from ${dayKey}`;
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

      addedClusters.push({ id: clusterId, name: clusterName, dateRange: { from, to }, assetCount: dayAssets.length, estimatedBytes, assetIds });
      if (!biggestNew || dayAssets.length > biggestNew.count) {
        biggestNew = { id: clusterId, name: clusterName, count: dayAssets.length };
      }
    }

    if (addedClusters.length > 0) {
      useClusterStore.setState({
        clusters: [...existingClusters, ...addedClusters],
        lastClusteredAt: Date.now(),
      });
      if (biggestNew) {
        await schedulePostTripNotification(biggestNew.id, biggestNew.name, biggestNew.count);
        notified = true;
      }
    }

    // -----------------------------------------------------------------------
    // 4. Pending cleanup check
    // -----------------------------------------------------------------------
    const { staged } = useTrashStore.getState();
    if (staged.length > 0) {
      const { lastPendingCleanupNotifiedAt } = useSettingsStore.getState();
      const oldestStagedAt = staged.reduce((min, s) => Math.min(min, s.stagedAt), Infinity);
      const daysSinceOldest = Math.floor((Date.now() - oldestStagedAt) / (24 * 60 * 60 * 1000));
      const notifCooldownPassed =
        lastPendingCleanupNotifiedAt === null ||
        Date.now() - lastPendingCleanupNotifiedAt > PENDING_CLEANUP_COOLDOWN_MS;

      if (daysSinceOldest >= MIN_DAYS_BEFORE_CLEANUP_NUDGE && daysSinceOldest < MAX_DAYS_BEFORE_CLEANUP_NUDGE && notifCooldownPassed) {
        await schedulePendingCleanupNotification(staged.length);
        useSettingsStore.getState().setLastPendingCleanupNotifiedAt(Date.now());
        notified = true;
      }
    }

    // -----------------------------------------------------------------------
    // 5. Monthly digest check
    // -----------------------------------------------------------------------
    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7);
    const { lastMonthlyDigestMonth } = useSettingsStore.getState();

    if (now.getDate() === 1 && lastMonthlyDigestMonth !== currentMonth) {
      const curYear = now.getFullYear();
      const curMonthIndex = now.getMonth() + 1;
      const prevMonthIndex = curMonthIndex === 1 ? 12 : curMonthIndex - 1;
      const prevYear = curMonthIndex === 1 ? curYear - 1 : curYear;
      const prevMonthKey = `${prevYear}-${String(prevMonthIndex).padStart(2, '0')}`;
      const { monthlyFreedBytes } = useStatsStore.getState();
      const bytes = monthlyFreedBytes[prevMonthKey] ?? 0;
      const freedGB = (bytes / 1e9).toFixed(1) + ' GB';
      const monthLabel = new Date(prevYear, prevMonthIndex - 1).toLocaleString('default', { month: 'long', year: 'numeric' });

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
}

// ---------------------------------------------------------------------------
// Task definition — MUST remain at module top-level
// ---------------------------------------------------------------------------

TaskManager.defineTask(BACKGROUND_FETCH_TASK, () => runBackgroundChecks());

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
    minimumInterval: BACKGROUND_FETCH_INTERVAL_SEC,
    stopOnTerminate: false,   // Android: keep running after app is killed
    startOnBoot: true,        // Android: restart after device reboot
  });
}
