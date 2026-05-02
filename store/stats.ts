import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createPersistOptions } from '@/store/persistence';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the current date as 'YYYY-MM-DD' in local time. */
function todayDateString(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Returns the current month as 'YYYY-MM' in local time. */
function currentMonthKey(): string {
  return todayDateString().slice(0, 7);
}

// ---------------------------------------------------------------------------
// State & actions interface
// ---------------------------------------------------------------------------

interface StatsState {
  totalFreedBytes: number;
  photosReviewed: number;
  favoritesCount: number;
  sessionsCompleted: number;

  /** Storage freed per calendar month. Key format: 'YYYY-MM'. */
  monthlyFreedBytes: Record<string, number>;

  /** Assets reviewed on the current calendar day (resets at midnight). */
  todayReviewed: number;

  /** The 'YYYY-MM-DD' date when `todayReviewed` was last zeroed out. */
  lastResetDate: string;

  /** Add `bytes` to the running total and to the current month's bucket. */
  recordFreed(bytes: number): void;

  /** Increment `photosReviewed` and `todayReviewed`. Defaults to 1. */
  recordReviewed(count?: number): void;

  recordFavorite(): void;
  recordSessionCompleted(): void;

  /**
   * If `lastResetDate` differs from today (i.e. the calendar day has changed),
   * zero out `todayReviewed` and update `lastResetDate`. Call this at app
   * launch and when the app returns to the foreground.
   */
  resetTodayIfNeeded(): void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useStatsStore = create<StatsState>()(
  persist(
    (set, get) => ({
      totalFreedBytes: 0,
      photosReviewed: 0,
      favoritesCount: 0,
      sessionsCompleted: 0,
      monthlyFreedBytes: {},
      todayReviewed: 0,
      lastResetDate: todayDateString(),

      recordFreed(bytes) {
        const month = currentMonthKey();
        set((state) => ({
          totalFreedBytes: state.totalFreedBytes + bytes,
          monthlyFreedBytes: {
            ...state.monthlyFreedBytes,
            [month]: (state.monthlyFreedBytes[month] ?? 0) + bytes,
          },
        }));
      },

      recordReviewed(count = 1) {
        set((state) => ({
          photosReviewed: state.photosReviewed + count,
          todayReviewed: state.todayReviewed + count,
        }));
      },

      recordFavorite() {
        set((state) => ({ favoritesCount: state.favoritesCount + 1 }));
      },

      recordSessionCompleted() {
        set((state) => ({ sessionsCompleted: state.sessionsCompleted + 1 }));
      },

      resetTodayIfNeeded() {
        const today = todayDateString();
        if (get().lastResetDate !== today) {
          set({ todayReviewed: 0, lastResetDate: today });
        }
      },
    }),
    createPersistOptions<StatsState>('stats'),
  ),
);
