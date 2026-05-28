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
 *
 * Deep-link behaviour:
 *  - When navigated to with a `highlight=<clusterId>` URL param the screen
 *    scrolls to the matching cluster card and plays a brief border-glow pulse.
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
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Alert,
  Animated,
  ScrollView,
  StyleSheet,
  Text as RNText,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const PRIMARY_BORDER = 'rgba(249,115,22,0.35)' as const;
const BELL_HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 } as const;

// ---------------------------------------------------------------------------
// HomeScreen
// ---------------------------------------------------------------------------

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // ── URL params ────────────────────────────────────────────────────────────
  const { highlight } = useLocalSearchParams<{ highlight?: string }>();

  // ── Store selectors ───────────────────────────────────────────────────────
  const onboarded = useSettingsStore((s) => s.onboarded);

  const totalFreedBytes = useStatsStore((s) => s.totalFreedBytes);
  const todayFreedBytes = useStatsStore((s) => s.todayFreedBytes);
  const photosReviewed = useStatsStore((s) => s.photosReviewed);
  const sessionsCompleted = useStatsStore((s) => s.sessionsCompleted);
  const todayReviewed = useStatsStore((s) => s.todayReviewed);

  const clusters = useClusterStore((s) => s.clusters);

  const sessions = useSessionStore((s) => s.sessions);
  const createSession = useSessionStore((s) => s.createSession);

  // ── Refs ──────────────────────────────────────────────────────────────────

  /** ScrollView ref used to programmatically scroll to a highlighted card. */
  const scrollViewRef = useRef<ScrollView>(null);

  /**
   * Tracks the Y offset (in scroll-content coordinates) of each cluster card
   * keyed by cluster.id, populated via onLayout callbacks.
   */
  const cardYPositions = useRef<Record<string, number>>({});

  /** Drives the border-glow pulse for the highlighted cluster card. */
  const highlightAnim = useRef(new Animated.Value(0)).current;

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

  const contentStyle = useMemo(
    () => [styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }],
    [insets.top, insets.bottom],
  );

  // ── Scroll to highlighted cluster ─────────────────────────────────────────

  useEffect(() => {
    if (!highlight || clusters.length === 0) return;

    // Allow a short delay so onLayout callbacks have fired before we scroll.
    const timer = setTimeout(() => {
      const y = cardYPositions.current[highlight];
      if (y == null) return;
      scrollViewRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
    }, 300);

    return () => clearTimeout(timer);
  }, [highlight, clusters]);

  // ── Border-glow pulse for highlighted cluster ─────────────────────────────

  useEffect(() => {
    if (!highlight) return;

    // Reset so re-navigating to the same highlight replays the animation.
    highlightAnim.setValue(0);

    Animated.sequence([
      Animated.timing(highlightAnim, { toValue: 1, duration: 300, useNativeDriver: false }),
      Animated.delay(600),
      Animated.timing(highlightAnim, { toValue: 0, duration: 600, useNativeDriver: false }),
    ]).start();
  }, [highlight, highlightAnim]);

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
      ref={scrollViewRef}
      style={styles.scroll}
      contentContainerStyle={contentStyle}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Header row ── */}
      <View style={styles.headerRow}>
        {/* Two-tone logo */}
        <View style={styles.logoRow}>
          <RNText style={styles.logoClean}>Clean</RNText>
          <RNText style={styles.logoSwipe}> Swipe</RNText>
        </View>
        {/* Right side: bell + avatar */}
        <View style={styles.headerRight}>
          <TouchableOpacity hitSlop={BELL_HIT_SLOP} activeOpacity={0.7}>
            <IconSymbol name="bell" size={24} color={Colors.textSecondary} />
          </TouchableOpacity>
          <View style={styles.avatar}>
            <RNText style={styles.avatarText}>G</RNText>
          </View>
        </View>
      </View>

      {/* ── Storage Hero Card ── */}
      <Card style={styles.heroCard}>
        <View style={styles.heroTopRow}>
          <Text variant="hero">{formatBytes(totalFreedBytes)}</Text>
          {todayFreedBytes > 0 && (
            <View style={styles.todayBadge}>
              <RNText style={styles.todayBadgeText}>+{formatBytes(todayFreedBytes)} today</RNText>
            </View>
          )}
        </View>
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
        {/* Photos cleaned — green */}
        <Card style={[styles.statCard, { borderColor: 'rgba(34,197,94,0.35)' }]}>
          <RNText style={[styles.statNumber, { color: Colors.success }]}>{photosReviewed}</RNText>
          <Text variant="caption" style={styles.statLabel}>
            Photos{'\n'}cleaned
          </Text>
        </Card>

        {/* Sessions done — blue */}
        <Card style={[styles.statCard, { borderColor: 'rgba(59,130,246,0.35)' }]}>
          <RNText style={[styles.statNumber, { color: Colors.info }]}>{sessionsCompleted}</RNText>
          <Text variant="caption" style={styles.statLabel}>
            Sessions{'\n'}done
          </Text>
        </Card>

        {/* Today — orange */}
        <Card style={[styles.statCard, { borderColor: PRIMARY_BORDER }]}>
          <RNText style={[styles.statNumber, { color: Colors.primary }]}>{todayReviewed}</RNText>
          <Text variant="caption" style={styles.statLabel}>
            {'\n'}Today
          </Text>
        </Card>
      </View>

      {/* ── Quick Clean ── */}
      <Button
        variant="primary"
        label="QUICK CLEAN  →"
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
        SESSIONS FOR YOU
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
          const isHighlighted = cluster.id === highlight;

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
            /**
             * Animated.View wrapper serves two purposes:
             *  1. onLayout records the card's Y offset inside the scroll
             *     content view so we can scrollTo it.
             *  2. When isHighlighted, it carries the animated border-glow.
             *
             * borderRadius matches Card (16) so the glow ring follows the
             * card's rounded corners. useNativeDriver: false is required
             * because borderColor is not handled by the native driver.
             */
            <Animated.View
              key={cluster.id}
              style={[
                styles.highlightWrapper,
                isHighlighted && {
                  borderWidth: 2,
                  borderColor: highlightAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['transparent', Colors.primary],
                  }),
                },
              ]}
              onLayout={(e) => {
                cardYPositions.current[cluster.id] = e.nativeEvent.layout.y;
              }}
            >
              <Card style={styles.sessionCard}>
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
                    variant={isCompleted ? 'ghost' : 'primary'}
                    label={isCompleted ? 'Done' : isInProgress ? 'Continue' : 'Go'}
                    disabled={isCompleted}
                    onPress={() => handleGoCluster(cluster)}
                  />
                </View>
              </Card>
            </Animated.View>
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
  logoRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  logoClean: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.primary,
  },
  logoSwipe: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.textPrimary,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },

  // ── Hero card ──────────────────────────────────────────────────────────────
  heroCard: {
    gap: 4,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  todayBadge: {
    backgroundColor: 'rgba(249,115,22,0.18)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: PRIMARY_BORDER,
  },
  todayBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
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
  statNumber: {
    fontSize: 22,
    fontWeight: '700',
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
  /**
   * Wrapper for each cluster card. Carries the animated border-glow when the
   * card is the deep-link highlight target. borderRadius matches Card (16).
   */
  highlightWrapper: {
    borderRadius: 16,
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
