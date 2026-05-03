import { createPersistOptions } from '@/store/persistence';
import type { DecisionRecord, Session } from '@/types';
import { Decision } from '@/types';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UNDO_STACK_LIMIT = 20;

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

const generateId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older Hermes versions
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
};

// ---------------------------------------------------------------------------
// State & actions interface
// ---------------------------------------------------------------------------

interface SessionState {
  sessions: Record<string, Session>;
  activeSessionId: string | null;

  /**
   * Create a new Session record. The caller provides all fields except `id`
   * and `createdAt`, which are generated here. Returns the new session's id.
   */
  createSession(session: Omit<Session, 'id' | 'createdAt'>): string;

  /**
   * Append a decision to the named session's `decisions` and `undoStack`.
   * The undoStack is capped at UNDO_STACK_LIMIT — oldest entries are dropped.
   */
  recordDecision(sessionId: string, record: DecisionRecord): void;

  /**
   * Pop the most-recent undoStack entry, remove it from `decisions` by
   * reference equality, and return it.
   * Returns null if the session is missing or the undoStack is empty.
   *
   * Cross-store coordination: when the returned record has
   * `decision === Decision.DELETE_STAGED`, the caller must also call
   * `useTrashStore.getState().removeFromStaged(record.assetId)` to keep the
   * trash store consistent.
   */
  undo(sessionId: string): DecisionRecord | null;

  /** Advance the cursor for a session (i.e. move to the next asset). */
  setCursor(sessionId: string, cursor: number): void;

  /** Stamp `completedAt` on the session with the current wall-clock time. */
  completeSession(sessionId: string): void;

  /**
   * Return the first session that has not been completed and still has assets
   * to review (cursor < queueIds.length). Returns null if none found.
   */
  findResumable(): Session | null;

  /** Append additional asset IDs to a session's review queue. */
  appendQueueIds(sessionId: string, ids: string[]): void;

  /** Stamp `startedSwipingAt` the first time a user swipes in a session. */
  markSessionStarted(sessionId: string): void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: {},
      activeSessionId: null,

      createSession(session) {
        const id = generateId();
        const newSession: Session = {
          ...session,
          id,
          createdAt: Date.now(),
        };
        set((state) => ({
          sessions: { ...state.sessions, [id]: newSession },
          activeSessionId: id,
        }));
        return id;
      },

      recordDecision(sessionId, record) {
        set((state) => {
          const session = state.sessions[sessionId];
          if (!session) return state;

          const decisions = [...session.decisions, record];

          // Build new undoStack and enforce the cap by dropping oldest entries.
          const undoStack = [...session.undoStack, record];
          if (undoStack.length > UNDO_STACK_LIMIT) {
            undoStack.splice(0, undoStack.length - UNDO_STACK_LIMIT);
          }

          const freedBytesEstimated =
            session.freedBytesEstimated +
            (record.decision === Decision.DELETE_STAGED ? (record.bytes ?? 0) : 0);

          return {
            sessions: {
              ...state.sessions,
              [sessionId]: { ...session, decisions, undoStack, freedBytesEstimated },
            },
          };
        });
      },

      /**
       * Cross-store note: when the returned record has
       * `decision === Decision.DELETE_STAGED`, the caller must also call
       * `useTrashStore.getState().removeFromStaged(record.assetId)` to keep
       * the trash store consistent.
       */
      undo(sessionId) {
        const session = get().sessions[sessionId];
        if (!session || session.undoStack.length === 0) return null;
        // Capture the reference before entering set() so the filter can use it.
        const record = session.undoStack[session.undoStack.length - 1];
        set((state) => {
          const s = state.sessions[sessionId];
          if (!s) return state;
          const bytesDeduction =
            record.decision === Decision.DELETE_STAGED ? (record.bytes ?? 0) : 0;
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...s,
                undoStack: s.undoStack.slice(0, -1),
                // Reference equality: record is the same object stored in decisions.
                decisions: s.decisions.filter((d) => d !== record),
                freedBytesEstimated: Math.max(0, s.freedBytesEstimated - bytesDeduction),
              },
            },
          };
        });
        return record;
      },

      setCursor(sessionId, cursor) {
        set((state) => {
          const session = state.sessions[sessionId];
          if (!session) return state;
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: { ...session, cursor },
            },
          };
        });
      },

      completeSession(sessionId) {
        set((state) => {
          const session = state.sessions[sessionId];
          if (!session) return state;
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: { ...session, completedAt: Date.now() },
            },
          };
        });
      },

      findResumable() {
        const { sessions } = get();
        return (
          Object.values(sessions).find(
            (s) => !s.completedAt && (s.cursor ?? 0) < s.queueIds.length,
          ) ?? null
        );
      },

      appendQueueIds(sessionId, ids) {
        set((state) => {
          const session = state.sessions[sessionId];
          if (!session) return state;
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...session,
                queueIds: [...session.queueIds, ...ids],
              },
            },
          };
        });
      },

      markSessionStarted(sessionId) {
        set((state) => {
          const s = state.sessions[sessionId];
          if (!s || s.startedSwipingAt != null) return state;
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: { ...s, startedSwipingAt: Date.now() },
            },
          };
        });
      },
    }),
    createPersistOptions<SessionState>('sessions'),
  ),
);
