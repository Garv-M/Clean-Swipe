/**
 * app/(tabs)/index.tsx
 *
 * Home Dashboard screen.
 *
 * Shows:
 *  - Storage hero card (total freed + today's progress bar)
 *  - Stats row (photos cleaned, sessions done, today reviewed)
 *  - Quick Clean primary action
 *  - Resumable session card (conditional)
 *  - Per-cluster session list with Go / Continue buttons
 *  - Create Custom Session ghost button
 *
 * Redirects to /onboarding if the user has not completed onboarding.
 */

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { useClusterStore } from '@/store/cluster';
import { useSessionStore } from '@/store/session';
import { useSettingsStore } from '@/store/settings';
import { useStatsStore } from '@/store/stats';
import type { EventCluster } from '@/types';
import { formatBytes } from '@/utils/format';
import { Redirect, useRouter } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ---------------------------------------------------------------------------
// HomeScreen
// ---------------------------------------------------------------------------

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // ── Store selectors ───────────────────────────────────────────────────────
  const onboarded = useSettingsStore((s) => s.onboarded);

  const totalFreedBytes = useStatsStore((s) => s.totalFreedBytes);
  const photosReviewed = useStatsStore((s) => s.photosReviewed);
  const sessionsCompleted = useStatsStore((s) => s.sessionsCompleted);
  const todayReviewed = useStatsStore((s) => s.todayReviewed);

  const clusters = useClusterStore((s) => s.clusters);

  const sessions = useSessionStore((s) => s.sessions);
  const createSession = useSessionStore((s) => s.createSession);

  // ── Derived values (all hooks called unconditionally before early return) ──

  const resumable = useMemo(
    () =>
      Object.values(sessions).find(
        (s) => !s.completedAt && (s.cursor ?? 0) < s.queueIds.length,
      ) ?? null,
    [sessions],
  );

  const sessionForCluster = useCallback(
    (clusterId: string) =>
      Object.values(sessions).find((s) => s.clusterId === clusterId) ?? null,
    [sessions],
  );

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleQuickClean = useCallback(() => {
    if (resumable) {
      router.push(`/swipe/${resumable.id}/start` as any);
      return;
    }
    // Pick the first cluster that has no existing session
    const available = clusters.find((c) => !sessionForCluster(c.id));
    if (!available) {
      Alert.alert('No sessions available');
      return;
    }
    const newId = createSession({
      name: available.name,
      clusterId: available.id,
      queueIds: available.assetIds,
      decisions: [],
      undoStack: [],
      freedBytesEstimated: 0,
    });
    router.push(`/swipe/${newId}/start` as any);
  }, [resumable, clusters, sessionForCluster, createSession, router]);

  const handleGoCluster = useCallback(
    (cluster: EventCluster) => {
      const existing = sessionForCluster(cluster.id);
      if (!existing) {
        const newId = createSession({
          name: cluster.name,
          clusterId: cluster.id,
          queueIds: cluster.assetIds,
          decisions: [],
          undoStack: [],
          freedBytesEstimated: 0,
        });
        router.push(`/swipe/${newId}/start` as any);
      } else if (!existing.completedAt) {
        router.push(`/swipe/${existing.id}/start` as any);
      }
      // Completed sessions: button is disabled — no navigation needed
    },
    [sessionForCluster, createSession, router],
  );

  // ── Declarative redirect — after all hooks ────────────────────────────────
  if (!onboarded) {
    return <Redirect href="/onboarding" />;
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Header row ── */}
      <View style={styles.headerRow}>
        <Text variant="title">Clean Swipe</Text>
        <TouchableOpacity
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          activeOpacity={0.7}
        >
          <IconSymbol name="bell" size={24} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* ── Storage Hero Card ── */}
      <Card style={styles.heroCard}>
        <Text variant="hero">{formatBytes(totalFreedBytes)}</Text>
        <Text variant="label" style={styles.heroLabel}>
          Total Space Freed
        </Text>
        <View style={styles.progressRow}>
          <ProgressBar progress={Math.min(1, todayReviewed / 100)} />
        </View>
        <Text variant="caption">Today: {todayReviewed} reviewed</Text>
      </Card>

      {/* ── Stats row ── */}
      <View style={styles.statsRow}>
        <Card style={styles.statCard}>
          <Text variant="heading">{photosReviewed}</Text>
          <Text variant="caption" style={styles.statLabel}>
            Photos{'\n'}cleaned
          </Text>
        </Card>
        <Card style={styles.statCard}>
          <Text variant="heading">{sessionsCompleted}</Text>
          <Text variant="caption" style={styles.statLabel}>
            Sessions{'\n'}done
          </Text>
        </Card>
        <Card style={styles.statCard}>
          <Text variant="heading">{todayReviewed}</Text>
          <Text variant="caption" style={styles.statLabel}>
            {'\n'}Today
          </Text>
        </Card>
      </View>

      {/* ── Quick Clean ── */}
      <Button
        variant="primary"
        label="QUICK CLEAN"
        onPress={handleQuickClean}
        style={styles.quickCleanButton}
      />

      {/* ── Resume card (conditional) ── */}
      {resumable && (
        <Card style={styles.resumeCard}>
          <View style={styles.resumeTop}>
            <View style={styles.resumeInfo}>
              <Text variant="label" style={styles.resumeTag}>
                Resume
              </Text>
              <Text variant="heading" style={{ flexShrink: 1 }}>
                {resumable.name ?? 'Session'}
              </Text>
              <Text variant="label">
                {resumable.cursor ?? 0} / {resumable.queueIds.length} done
              </Text>
            </View>
            <Button
              variant="secondary"
              label="Continue"
              onPress={() =>
                router.push(`/swipe/${resumable.id}/swipe` as any)
              }
            />
          </View>
        </Card>
      )}

      {/* ── Sessions section ── */}
      <Text variant="heading" style={styles.sectionTitle}>
        Sessions
      </Text>

      {clusters.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Text variant="body" style={styles.emptyText}>
            No sessions yet — scan your library
          </Text>
        </Card>
      ) : (
        clusters.map((cluster) => {
          const session = sessionForCluster(cluster.id);
          const isCompleted = !!session?.completedAt;
          const isInProgress = !!session && !isCompleted;

          const statusLabel = isCompleted
            ? 'Complete'
            : isInProgress
            ? 'In Progress'
            : 'Ready';

          const statusColor = isCompleted
            ? Colors.success
            : isInProgress
            ? Colors.info
            : Colors.textSecondary;

          return (
            <Card key={cluster.id} style={styles.sessionCard}>
              <View style={styles.sessionRow}>
                <View style={styles.sessionInfo}>
                  <Text variant="body">{cluster.name}</Text>
                  <Text variant="label">
                    {cluster.assetCount} photos ·{' '}
                    {formatBytes(cluster.estimatedBytes)}
                  </Text>
                  <Text
                    variant="caption"
                    style={{ color: statusColor }}
                  >
                    {statusLabel}
                  </Text>
                </View>
                <Button
                  variant={isCompleted ? 'ghost' : 'secondary'}
                  label={isCompleted ? 'Done' : 'Go'}
                  disabled={isCompleted}
                  onPress={() => handleGoCluster(cluster)}
                />
              </View>
            </Card>
          );
        })
      )}

      {/* ── Create Custom Session ── */}
      <Button
        variant="ghost"
        label="+ Create Custom Session"
        onPress={() => Alert.alert('Coming soon')}
        style={styles.createButton}
      />
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingHorizontal: 16,
    gap: 12,
  },

  // ── Header ─────────────────────────────────────────────────────────────────
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },

  // ── Hero card ──────────────────────────────────────────────────────────────
  heroCard: {
    gap: 4,
  },
  heroLabel: {
    marginTop: 2,
  },
  progressRow: {
    marginTop: 10,
    marginBottom: 4,
  },

  // ── Stats row ──────────────────────────────────────────────────────────────
  statsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  statLabel: {
    textAlign: 'center',
  },

  // ── Quick Clean ────────────────────────────────────────────────────────────
  quickCleanButton: {
    marginTop: 4,
  },

  // ── Resume card ────────────────────────────────────────────────────────────
  resumeCard: {
    borderColor: Colors.info,
    borderWidth: 1,
  },
  resumeTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  resumeInfo: {
    flex: 1,
    gap: 2,
  },
  resumeTag: {
    color: Colors.info,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // ── Sessions section ───────────────────────────────────────────────────────
  sectionTitle: {
    marginTop: 8,
    marginBottom: 4,
  },
  emptyCard: {
    alignItems: 'center',
  },
  emptyText: {
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  sessionCard: {
    marginBottom: 0,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sessionInfo: {
    flex: 1,
    gap: 2,
  },

  // ── Create button ──────────────────────────────────────────────────────────
  createButton: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
  },
});
