import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { useClusterStore } from '@/store/cluster';
import { useSessionStore } from '@/store/session';
import { useUIStore } from '@/store/ui';
import { Decision } from '@/types';
import { formatBytes } from '@/utils/format';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ---------------------------------------------------------------------------
// Sub-component: single stat column inside the info card
// ---------------------------------------------------------------------------

interface StatColumnProps {
  value: string;
  label: string;
}

function StatColumn({ value, label }: StatColumnProps) {
  return (
    <View style={styles.statColumn}>
      <Text variant="heading" style={styles.statValue}>
        {value}
      </Text>
      <Text variant="label" style={styles.statLabel}>
        {label}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function SessionStartScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Store selectors
  const session = useSessionStore((state) =>
    sessionId ? state.sessions[sessionId] : undefined,
  );
  const cluster = useClusterStore((state) =>
    session?.clusterId
      ? state.clusters.find((c) => c.id === session.clusterId)
      : undefined,
  );
  const setSwipeSessionActive = useUIStore((state) => state.setSwipeSessionActive);

  // Hide the tab bar while this screen is visible
  useEffect(() => {
    setSwipeSessionActive(true);
    return () => setSwipeSessionActive(false);
  }, [setSwipeSessionActive]);

  // ── Missing session fallback ──────────────────────────────────────────────
  if (!session) {
    return (
      <View
        style={[
          styles.container,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
        ]}>
        <View style={styles.notFoundContainer}>
          <Text variant="heading" style={styles.centeredText}>
            Session not found
          </Text>
          <Button
            variant="ghost"
            label="Go Back"
            onPress={() => router.back()}
            style={styles.backButton}
          />
        </View>
      </View>
    );
  }

  // ── Derived data ──────────────────────────────────────────────────────────

  const displayName = cluster?.name ?? session.name ?? 'Photo Session';
  const count = session.queueIds.length;

  // 200 photos/min is a comfortable review pace; minimum 1 minute
  const estimatedMinutes = Math.max(1, Math.ceil(count / 200));
  const estimatedLabel = estimatedMinutes === 1 ? '~1 min' : `~${estimatedMinutes} min`;

  // Potential savings: prefer the cluster's total size estimate (shows full
  // potential upside). Fall back to summing bytes from staged decisions already
  // recorded in this session (covers manually-assembled sessions).
  const stagedBytes = session.decisions
    .filter((d) => d.decision === Decision.DELETE_STAGED)
    .reduce((acc, d) => acc + (d.bytes ?? 0), 0);
  const savingsBytes =
    cluster && cluster.estimatedBytes > 0 ? cluster.estimatedBytes : stagedBytes;
  const savingsLabel = savingsBytes > 0 ? formatBytes(savingsBytes) : '—';

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleStart = () => {
    // Navigate to the swipe screen within the same [sessionId] directory.
    // The target file (../swipe) is created in a subsequent task; the cast
    // suppresses the typed-routes compile error for this forward reference.
    router.push(`/swipe/${sessionId}/swipe` as any);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 16 },
      ]}>
      {/* Title section */}
      <View style={styles.header}>
        <Text variant="title" style={styles.centeredText}>
          {displayName}
        </Text>
        <Text variant="label" style={[styles.centeredText, styles.subtitleText]}>
          Review your photos and decide what to keep
        </Text>
      </View>

      {/* Stats card */}
      <Card style={styles.statsCard}>
        <View style={styles.statsRow}>
          <StatColumn value={count.toLocaleString()} label="Photos" />
          <View style={styles.statDivider} />
          <StatColumn value={estimatedLabel} label="Est. time" />
          <View style={styles.statDivider} />
          <StatColumn value={savingsLabel} label="Potential savings" />
        </View>
      </Card>

      {/* Flexible spacer pushes the CTAs to the bottom */}
      <View style={styles.spacer} />

      {/* CTA buttons */}
      <View style={styles.actions}>
        <Button
          variant="primary"
          label="Start Swiping"
          onPress={handleStart}
          style={styles.fullWidthButton}
        />
        <Button
          variant="ghost"
          label="Maybe Later"
          onPress={() => router.back()}
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

  // ── Not-found fallback ────────────────────────────────────────────────────
  notFoundContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  backButton: {
    minWidth: 120,
  },

  // ── Title section ─────────────────────────────────────────────────────────
  header: {
    marginBottom: 28,
    gap: 8,
  },
  centeredText: {
    textAlign: 'center',
  },
  subtitleText: {
    color: Colors.textSecondary,
  },

  // ── Stats card ────────────────────────────────────────────────────────────
  statsCard: {
    // Card handles its own padding; no additional margin needed here
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statColumn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    gap: 4,
  },
  statValue: {
    color: Colors.primary,
    textAlign: 'center',
  },
  statLabel: {
    textAlign: 'center',
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: Colors.border,
  },

  // ── Layout ────────────────────────────────────────────────────────────────
  spacer: {
    flex: 1,
  },

  // ── CTA buttons ───────────────────────────────────────────────────────────
  actions: {
    gap: 12,
  },
  fullWidthButton: {
    width: '100%',
  },
});
