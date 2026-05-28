import { createPersistOptions } from '@/store/persistence';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
  photosDeleted: number;
  sessionsCompleted: number;

  /** Storage freed per calendar month. Key format: 'YYYY-MM'. */
  monthlyFreedBytes: Record<string, number>;

  /** Assets reviewed on the current calendar day (resets at midnight). */
  todayReviewed: number;

  /** Storage freed on the current calendar day in bytes (resets at midnight). */
  todayFreedBytes: number;

  /** The 'YYYY-MM-DD' date when `todayReviewed` was last zeroed out. */
  lastResetDate: string;

  /** Increment the count of assets permanently deleted from device. */
  recordDeleted(count: number): void;

  /** Add `bytes` to the running total and to the current month's bucket. */
  recordFreed(bytes: number): void;

  /** Increment `photosReviewed` and `todayReviewed`. Defaults to 1. */
  recordReviewed(count?: number): void;

  undoFreed(bytes: number): void;
  undoReviewed(count?: number): void;

  recordFavorite(): void;
  recordSessionCompleted(): void;

  /**
   * If `lastResetDate` differs from today, zero out `todayReviewed` and
   * `todayFreedBytes`, then update `lastResetDate`. Call at app launch and
   * whenever the app returns to the foreground.
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
      photosDeleted: 0,
      sessionsCompleted: 0,
      monthlyFreedBytes: {},
      todayReviewed: 0,
      todayFreedBytes: 0,
      lastResetDate: todayDateString(),

      undoFreed(bytes) {
        const month = currentMonthKey();
        const today = todayDateString();
        set((state) => {
          const isToday = state.lastResetDate === today;
          // Ensure we don't carry over yesterday's stats if the first action of the day is an undo
          const currentTodayFreed = isToday ? state.todayFreedBytes : 0;
          const currentTodayReviewed = isToday ? state.todayReviewed : 0;

          return {
            totalFreedBytes: Math.max(0, state.totalFreedBytes - bytes),
            todayFreedBytes: Math.max(0, currentTodayFreed - bytes),
            todayReviewed: currentTodayReviewed,
            lastResetDate: today,
            monthlyFreedBytes: {
              ...state.monthlyFreedBytes,
              [month]: Math.max(0, (state.monthlyFreedBytes[month] ?? 0) - bytes),
            },
          };
        });
      },

      undoReviewed(count = 1) {
        const today = todayDateString();
        set((state) => {
          const isToday = state.lastResetDate === today;
          const currentTodayReviewed = isToday ? state.todayReviewed : 0;
          const currentTodayFreed = isToday ? state.todayFreedBytes : 0;

          return {
            photosReviewed: Math.max(0, state.photosReviewed - count),
            todayReviewed: Math.max(0, currentTodayReviewed - count),
            todayFreedBytes: currentTodayFreed,
            lastResetDate: today,
          };
        });
      },

      recordFreed(bytes) {
        const month = currentMonthKey();
        const today = todayDateString();
        set((state) => ({
          totalFreedBytes: state.totalFreedBytes + bytes,
          todayFreedBytes: (state.lastResetDate === today ? state.todayFreedBytes : 0) + bytes,
          todayReviewed: state.lastResetDate === today ? state.todayReviewed : 0,
          lastResetDate: today,
          monthlyFreedBytes: {
            ...state.monthlyFreedBytes,
            [month]: (state.monthlyFreedBytes[month] ?? 0) + bytes,
          },
        }));
      },

      recordReviewed(count = 1) {
        const today = todayDateString();
        set((state) => ({
          photosReviewed: state.photosReviewed + count,
          todayReviewed: (state.lastResetDate === today ? state.todayReviewed : 0) + count,
          todayFreedBytes: state.lastResetDate === today ? state.todayFreedBytes : 0,
          lastResetDate: today,
        }));
      },

      recordFavorite() {
        set((state) => ({ favoritesCount: state.favoritesCount + 1 }));
      },

      recordDeleted(count) {
        set((state) => ({ photosDeleted: state.photosDeleted + count }));
      },

      recordSessionCompleted() {
        set((state) => ({ sessionsCompleted: state.sessionsCompleted + 1 }));
      },

      resetTodayIfNeeded() {
        const today = todayDateString();
        if (get().lastResetDate !== today) {
          set({ todayReviewed: 0, todayFreedBytes: 0, lastResetDate: today });
        }
      },
    }),
    createPersistOptions<StatsState>('stats'),
  ),
);
