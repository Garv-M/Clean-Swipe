import { createPersistOptions } from '@/store/persistence';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ---------------------------------------------------------------------------
// State & actions interface
// ---------------------------------------------------------------------------

interface SettingsState {
  /** How many days confirmed-deleted assets are retained before final purge. */
  retentionDays: 7 | 14 | 30;

  /**
   * When true, assets that exist only in cloud storage (not downloaded to the
   * device) are excluded from review queues. Avoids triggering unintended
   * cloud downloads during swipe sessions.
   */
  skipCloudOnly: boolean;

  /** Whether the user has completed the first-run onboarding flow. */
  onboarded: boolean;

  /**
   * Active colour scheme. Only dark mode is shipped in v1; kept as a union
   * type so we can add 'light' | 'system' without a breaking store migration.
   */
  theme: 'dark';

  setRetentionDays(days: 7 | 14 | 30): void;
  setSkipCloudOnly(skip: boolean): void;
  completeOnboarding(): void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      retentionDays: 30,
      skipCloudOnly: true,
      onboarded: false,
      theme: 'dark',

      setRetentionDays(days) {
        set({ retentionDays: days });
      },

      setSkipCloudOnly(skip) {
        set({ skipCloudOnly: skip });
      },

      completeOnboarding() {
        set({ onboarded: true });
      },
    }),
    createPersistOptions<SettingsState>('settings'),
  ),
);
