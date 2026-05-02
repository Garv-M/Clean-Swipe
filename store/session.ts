import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Session, DecisionRecord } from '@/types';
import { createPersistOptions } from '@/store/persistence';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UNDO_STACK_LIMIT = 20;

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

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
   * Pop the most-recent undoStack entry, remove its corresponding record from
   * `decisions` (matched by assetId + timestamp), and return it.
   * Returns null if the session is missing or the undoStack is empty.
   */
  undo(sessionId: string): DecisionRecord | null;

  /** Stamp `completedAt` on the session with the current wall-clock time. */
  completeSession(sessionId: string): void;

  /**
   * Return the first session that has not been completed and still has assets
   * to review (cursor < queueIds.length). Returns null if none found.
   */
  findResumable(): Session | null;

  /** Append additional asset IDs to a session's review queue. */
  appendQueueIds(sessionId: string, ids: string[]): void;
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

          return {
            sessions: {
              ...state.sessions,
              [sessionId]: { ...session, decisions, undoStack },
            },
          };
        });
      },

      undo(sessionId) {
        // Use a closure variable that the synchronous `set` updater will fill.
        let popped: DecisionRecord | null = null;

        set((state) => {
          const session = state.sessions[sessionId];
          if (!session || session.undoStack.length === 0) return state;

          const undoStack = [...session.undoStack];
          // Access the last element before popping so TypeScript is satisfied.
          const record = undoStack[undoStack.length - 1] as DecisionRecord;
          undoStack.pop();
          popped = record;

          // Remove from decisions: match by assetId + timestamp.
          const decisions = session.decisions.filter(
            (d) => !(d.assetId === record.assetId && d.timestamp === record.timestamp),
          );

          return {
            sessions: {
              ...state.sessions,
              [sessionId]: { ...session, decisions, undoStack },
            },
          };
        });

        return popped;
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
    }),
    createPersistOptions<SessionState>('sessions'),
  ),
);
