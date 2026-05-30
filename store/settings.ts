import { createPersistOptions } from '@/store/persistence';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ---------------------------------------------------------------------------
// State & actions interface
// ---------------------------------------------------------------------------

interface SettingsState {
  /** How many days confirmed-deleted assets are retained before final purge. */
  retentionDays: 7 | 14 | 30;

  /** Whether the user has completed the first-run onboarding flow. */
  onboarded: boolean;

  /**
   * Active colour scheme. Only dark mode is shipped in v1; kept as a union
   * type so we can add 'light' | 'system' without a breaking store migration.
   */
  theme: 'dark';

  /** Unix ms timestamp of when onboarding was first completed. null if not yet onboarded. */
  memberSince: number | null;

  /** Last time we sent the "pending cleanup" push notification (Unix ms). null = never. */
  lastPendingCleanupNotifiedAt: number | null;

  /** Month key ("YYYY-MM") of the last monthly digest notification sent. null = never. */
  lastMonthlyDigestMonth: string | null;

  setRetentionDays(days: 7 | 14 | 30): void;
  completeOnboarding(): void;
  setLastPendingCleanupNotifiedAt(ts: number): void;
  setLastMonthlyDigestMonth(month: string): void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      retentionDays: 30,
      onboarded: false,
      theme: 'dark',
      memberSince: null,
      lastPendingCleanupNotifiedAt: null,
      lastMonthlyDigestMonth: null,

      setRetentionDays(days) {
        set({ retentionDays: days });
      },

      completeOnboarding() {
        set((state) => ({
          onboarded: true,
          memberSince: state.memberSince ?? Date.now(), // only set once
        }));
      },

      setLastPendingCleanupNotifiedAt(ts) { set({ lastPendingCleanupNotifiedAt: ts }); },
      setLastMonthlyDigestMonth(month) { set({ lastMonthlyDigestMonth: month }); },
    }),
    createPersistOptions<SettingsState>('settings'),
  ),
);
