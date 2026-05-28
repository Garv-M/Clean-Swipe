/**
 * services/notifications.ts
 *
 * Standalone async helpers for scheduling and cancelling local notifications
 * via expo-notifications.
 *
 * All functions are standalone exports; no class, no singleton, no React, no
 * hooks. Safe to call from store actions, background tasks, or any non-React
 * context.
 */

import * as Notifications from 'expo-notifications';

// ---------------------------------------------------------------------------
// Default notification handler
// ---------------------------------------------------------------------------

// Configure how arriving notifications are presented while the app is in the
// foreground. Must be set at module load time before any scheduling occurs.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const NOTIF_ID = {
  NEW_PHOTOS: 'new-photos',
  STORAGE_PRESSURE: 'storage-pressure',
  POST_TRIP: 'post-trip',
  PENDING_CLEANUP: 'pending-cleanup',
  MONTHLY_DIGEST: 'monthly-digest',
} as const;

// ---------------------------------------------------------------------------
// Notification data payload
// ---------------------------------------------------------------------------

export type NotificationData =
  | { type: 'new_photos'; count: number }
  | { type: 'storage_pressure'; usedPct: number }
  | { type: 'post_trip'; clusterId: string; clusterName: string; count: number }
  | { type: 'pending_cleanup'; count: number }
  | { type: 'monthly_digest'; month: string; freedGB: string; newCount: number };

// ---------------------------------------------------------------------------
// requestNotificationPermission
// ---------------------------------------------------------------------------

/**
 * Request permission to display local notifications.
 *
 * Returns `true` immediately when permission is already granted. Otherwise
 * presents the OS prompt and returns whether the user granted access.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

// ---------------------------------------------------------------------------
// cancelNotification
// ---------------------------------------------------------------------------

/**
 * Cancel a scheduled notification by its identifier.
 *
 * Silently ignores errors — if the notification was already delivered or never
 * scheduled the call is a no-op.
 *
 * @param identifier  The string identifier used when the notification was
 *                    scheduled (one of the `NOTIF_ID` values).
 */
export async function cancelNotification(identifier: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});
}

// ---------------------------------------------------------------------------
// scheduleImmediate (internal helper)
// ---------------------------------------------------------------------------

/**
 * Cancel any existing notification with the given identifier, then schedule a
 * new one for immediate delivery.
 *
 * `trigger: null` instructs expo-notifications to deliver the notification
 * right away rather than at a future time.
 */
async function scheduleImmediate(
  identifier: string,
  title: string,
  body: string,
  data: NotificationData,
): Promise<void> {
  await cancelNotification(identifier);
  await Notifications.scheduleNotificationAsync({
    identifier,
    content: { title, body, data, sound: true },
    trigger: null, // deliver immediately
  });
}

// ---------------------------------------------------------------------------
// scheduleNewPhotosNotification
// ---------------------------------------------------------------------------

/**
 * Notify the user that new photos are available for review.
 *
 * Replaces any previously scheduled new-photos notification so only one is
 * ever pending at a time.
 *
 * @param count  Number of new photos detected.
 */
export async function scheduleNewPhotosNotification(count: number): Promise<void> {
  await scheduleImmediate(
    NOTIF_ID.NEW_PHOTOS,
    `${count} new photos to review`,
    'Quick clean before they pile up?',
    { type: 'new_photos', count },
  );
}

// ---------------------------------------------------------------------------
// scheduleStoragePressureNotification
// ---------------------------------------------------------------------------

/**
 * Notify the user that device storage is running low.
 *
 * Replaces any previously scheduled storage-pressure notification.
 *
 * @param usedPct  Percentage of device storage currently used (0–100).
 */
export async function scheduleStoragePressureNotification(usedPct: number): Promise<void> {
  await scheduleImmediate(
    NOTIF_ID.STORAGE_PRESSURE,
    `Your phone is ${usedPct}% full`,
    'Clean Swipe has sessions ready to help.',
    { type: 'storage_pressure', usedPct },
  );
}

// ---------------------------------------------------------------------------
// schedulePostTripNotification
// ---------------------------------------------------------------------------

/**
 * Notify the user that a photo cluster (e.g. a recent trip) has new photos
 * ready for review while the memories are still fresh.
 *
 * Replaces any previously scheduled post-trip notification.
 *
 * @param clusterId    Unique identifier for the photo cluster used for deep
 *                     linking.
 * @param clusterName  Human-readable cluster name shown in the notification
 *                     title.
 * @param count        Number of photos in the cluster.
 */
export async function schedulePostTripNotification(
  clusterId: string,
  clusterName: string,
  count: number,
): Promise<void> {
  await scheduleImmediate(
    NOTIF_ID.POST_TRIP,
    `${count} new photos from ${clusterName}`,
    'Clean while the memories are fresh!',
    { type: 'post_trip', clusterId, clusterName, count },
  );
}

// ---------------------------------------------------------------------------
// schedulePendingCleanupNotification
// ---------------------------------------------------------------------------

/**
 * Remind the user that they have photos staged for deletion awaiting
 * confirmation.
 *
 * Replaces any previously scheduled pending-cleanup notification.
 *
 * @param count  Number of photos currently awaiting deletion confirmation.
 */
export async function schedulePendingCleanupNotification(count: number): Promise<void> {
  await scheduleImmediate(
    NOTIF_ID.PENDING_CLEANUP,
    `${count} photos waiting for cleanup`,
    'You marked these for deletion. Ready to confirm?',
    { type: 'pending_cleanup', count },
  );
}

// ---------------------------------------------------------------------------
// scheduleMonthlyDigestNotification
// ---------------------------------------------------------------------------

/**
 * Send the user their monthly storage-and-cleanup summary.
 *
 * Replaces any previously scheduled monthly-digest notification.
 *
 * @param month    Display name of the month (e.g. "April 2026").
 * @param freedGB  Human-readable gigabytes freed last month (e.g. "1.4 GB").
 * @param newCount Number of new photos added since the last digest.
 */
export async function scheduleMonthlyDigestNotification(
  month: string,
  freedGB: string,
  newCount: number,
): Promise<void> {
  await scheduleImmediate(
    NOTIF_ID.MONTHLY_DIGEST,
    `Your ${month} summary`,
    `You freed ${freedGB} last month. ${newCount} new photos to review.`,
    { type: 'monthly_digest', month, freedGB, newCount },
  );
}
