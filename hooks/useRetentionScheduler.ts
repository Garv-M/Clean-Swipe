/**
 * hooks/useRetentionScheduler.ts
 *
 * Runs on mount and every time the app returns to the foreground. Finds any
 * confirmed-deleted items whose retention window has expired and permanently
 * removes them from the device via executeDelete.
 *
 * Mount once in the app root (e.g. app/_layout.tsx). Returns nothing; all
 * side-effects are fire-and-forget against the Zustand stores.
 */

import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useTrashStore } from '@/store/trash';
import { useStatsStore } from '@/store/stats';
import { executeDelete } from '@/services/deletion';

export function useRetentionScheduler(): void {
  // Track the previous AppState value so we can detect background → active
  // transitions without triggering on every state change (e.g. active → inactive).
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const runCheck = async (): Promise<void> => {
      // Reset today's reviewed count if the calendar day has rolled over.
      useStatsStore.getState().resetTodayIfNeeded();

      // Collect all confirmed items whose retention window has elapsed.
      const { confirmed } = useTrashStore.getState();
      const now = Date.now();
      const expiredIds = confirmed
        .filter((item) => item.expiresAt < now)
        .map((item) => item.assetId);

      if (expiredIds.length > 0) {
        // bytesMap is omitted — bytes were not captured at confirmation time.
        // The freed total will be 0 for auto-expired items; this is acceptable
        // because the user never sees a per-item size for auto-purged assets.
        await executeDelete(expiredIds);
      }
    };

    // Run immediately on mount so items that expired while the app was closed
    // are cleaned up before the user interacts with the UI.
    runCheck();

    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        const prev = appState.current;
        appState.current = nextState;

        // Only run when the app transitions from a non-active state to active.
        // This covers both background → active and inactive → active (e.g.
        // notification shade dismissed, phone call ended).
        const wasBackground = prev === 'background' || prev === 'inactive';
        const isNowActive = nextState === 'active';

        if (wasBackground && isNowActive) {
          runCheck();
        }
      },
    );

    return () => subscription.remove();
  }, []); // empty deps: register once on mount, clean up on unmount
}
