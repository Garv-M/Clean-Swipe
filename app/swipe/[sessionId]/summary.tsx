/**
 * app/swipe/[sessionId]/summary.tsx
 *
 * "Dopamine hit" screen displayed after a swipe session completes.
 * Shows session stats and provides CTAs to either review staged deletions
 * or return to the home dashboard.
 *
 * On mount: restores the tab bar by calling setSwipeSessionActive(false).
 */

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { useSessionStore } from '@/store/session';
import { useUIStore } from '@/store/ui';
import { Decision } from '@/types';
import { formatBytes } from '@/utils/format';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ---------------------------------------------------------------------------
// StatRow — a single labelled metric inside the stats card
// ---------------------------------------------------------------------------

interface StatRowProps {
  icon: string;
  label: string;
  value: string;
  /** Overrides the default textPrimary colour for the value. */
  valueColor?: string;
  /** Suppresses the bottom divider line on the last row. */
  isLast?: boolean;
}

function StatRow({ icon, label, value, valueColor, isLast }: StatRowProps) {
  return (
    <>
      <View style={styles.statRow}>
        <View style={styles.statLeft}>
          <Text style={styles.statIcon}>{icon}</Text>
          <Text variant="label" style={styles.statLabelText}>
            {label}
          </Text>
        </View>
        <Text
          variant="heading"
          style={[
            styles.statValue,
            valueColor != null ? { color: valueColor } : undefined,
          ]}
        >
          {value}
        </Text>
      </View>
      {!isLast && <View style={styles.statDivider} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// SummaryScreen
// ---------------------------------------------------------------------------

export default function SummaryScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const session = useSessionStore((state) =>
    sessionId ? state.sessions[sessionId] : undefined,
  );
  const setSwipeSessionActive = useUIStore((state) => state.setSwipeSessionActive);

  // Restore the tab bar — the session is complete.
  useEffect(() => {
    setSwipeSessionActive(false);
  }, [setSwipeSessionActive]);

  // ── Session not found ──────────────────────────────────────────────────────
  if (!session) {
    return (
      <View
        style={[
          styles.container,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
        ]}
      >
        <View style={styles.centeredFill}>
          <Text variant="heading" style={styles.centeredText}>
            Session not found
          </Text>
          <Button
            variant="ghost"
            label="Go Back"
            onPress={() => router.replace('/(tabs)/' as any)}
            style={styles.centeredButton}
          />
        </View>
      </View>
    );
  }

  // ── Derived stats ──────────────────────────────────────────────────────────

  const photosReviewed = session.decisions.length;

  const markedForDeletion = session.decisions.filter(
    (d) => d.decision === Decision.DELETE_STAGED,
  ).length;

  // Show "—" rather than "0 B" when nothing is staged — avoids a misleading metric.
  const spaceToFree =
    session.freedBytesEstimated > 0
      ? formatBytes(session.freedBytesEstimated)
      : '—';

  // Both timestamps must be present to compute duration.
  const hasTiming =
    session.completedAt != null && session.startedSwipingAt != null;
  const durationMs = hasTiming
    ? session.completedAt! - session.startedSwipingAt!
    : null;

  const timeSpentLabel =
    durationMs == null
      ? '—'
      : durationMs < 60_000
      ? '< 1 min'
      : `${Math.round(durationMs / 60_000)} min`;

  // Guard against zero/negative durations (clock skew) as well as empty sessions.
  const avgSpeedSecs =
    durationMs != null && durationMs > 0 && photosReviewed > 0
      ? durationMs / photosReviewed / 1000
      : null;

  const avgSpeedLabel =
    avgSpeedSecs != null ? `${avgSpeedSecs.toFixed(1)} sec/photo` : '—';

  // Session name takes priority over the generic header; fall back to generic.
  const headerTitle = session.name ?? 'Session Complete!';

  // ── Navigation handlers ────────────────────────────────────────────────────

  const handleReviewCleanUp = () => {
    router.push(`/swipe/${sessionId}/review` as any);
  };

  const handleDoneForNow = () => {
    router.replace('/(tabs)/' as any);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom + 16 },
      ]}
    >
      {/* Scrollable body — stats may overflow on very small screens. */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={styles.trophy}>🎉</Text>
          <Text variant="title" style={styles.centeredText}>
            {headerTitle}
          </Text>
          <Text variant="label" style={[styles.centeredText, styles.subtitleText]}>
            Here's how your session went
          </Text>
        </View>

        {/* ── Stats card ── */}
        <Card style={styles.statsCard}>
          <StatRow
            icon="📸"
            label="Photos Reviewed"
            value={photosReviewed.toLocaleString()}
            valueColor={Colors.primary}
          />
          <StatRow
            icon="🗑️"
            label="Marked for Deletion"
            value={markedForDeletion.toLocaleString()}
            valueColor={markedForDeletion > 0 ? Colors.destructive : undefined}
          />
          <StatRow
            icon="💾"
            label="Space to Free"
            value={spaceToFree}
            valueColor={
              session.freedBytesEstimated > 0 ? Colors.success : undefined
            }
          />
          <StatRow
            icon="⏱️"
            label="Time Spent"
            value={timeSpentLabel}
          />
          <StatRow
            icon="⚡"
            label="Avg Decision Speed"
            value={avgSpeedLabel}
            isLast
          />
        </Card>

        {/* ── Congratulatory message — only shown when timing data is available ── */}
        {avgSpeedSecs != null && (
          <View style={styles.congratsContainer}>
            <Text variant="label" style={[styles.centeredText, styles.congratsText]}>
              {`You decided on average in ${avgSpeedSecs.toFixed(1)} seconds per photo`}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* ── CTA buttons — pinned to bottom, always reachable ── */}
      <View style={styles.actions}>
        {markedForDeletion > 0 ? (
          <Button
            variant="primary"
            label="Review & Clean Up"
            onPress={handleReviewCleanUp}
            style={styles.fullWidthButton}
          />
        ) : (
          // Nothing staged — skip the review step and go straight home.
          <Button
            variant="primary"
            label="Back to Dashboard"
            onPress={handleDoneForNow}
            style={styles.fullWidthButton}
          />
        )}
        <Button
          variant="ghost"
          label="Done for Now"
          onPress={handleDoneForNow}
          style={styles.fullWidthButton}
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: 24,
  },

  // ── Not-found fallback ──────────────────────────────────────────────────────
  centeredFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  centeredButton: {
    minWidth: 120,
  },

  // ── Scroll container ────────────────────────────────────────────────────────
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 32,
    paddingBottom: 16,
  },

  // ── Header ─────────────────────────────────────────────────────────────────
  header: {
    alignItems: 'center',
    marginBottom: 28,
    gap: 8,
  },
  trophy: {
    fontSize: 52,
    marginBottom: 4,
  },
  centeredText: {
    textAlign: 'center',
  },
  subtitleText: {
    color: Colors.textSecondary,
  },

  // ── Stats card ─────────────────────────────────────────────────────────────
  statsCard: {
    // Card provides its own padding; no extra override needed.
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  statLeft: {
    // flex: 1 ensures the icon + label section absorbs all slack,
    // pushing the value to the far right of the row.
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statIcon: {
    fontSize: 20,
  },
  statLabelText: {
    color: Colors.textSecondary,
  },
  statValue: {
    // Default colour; may be overridden per row via the valueColor prop.
    color: Colors.textPrimary,
    textAlign: 'right',
  },
  statDivider: {
    height: 1,
    backgroundColor: Colors.border,
  },

  // ── Congratulatory message ──────────────────────────────────────────────────
  congratsContainer: {
    marginTop: 20,
    paddingHorizontal: 4,
  },
  congratsText: {
    color: Colors.textSecondary,
    lineHeight: 20,
  },

  // ── CTA buttons ─────────────────────────────────────────────────────────────
  actions: {
    gap: 12,
    paddingTop: 12,
  },
  fullWidthButton: {
    width: '100%',
  },
});
