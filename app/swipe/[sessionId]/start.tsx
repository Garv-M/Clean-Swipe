import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { useClusterStore } from '@/store/cluster';
import { useSessionStore } from '@/store/session';
import { useUIStore } from '@/store/ui';
import { Decision } from '@/types';
import { formatBytes } from '@/utils/format';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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

function formatDateRange(from: number, to: number): string {
  const f = new Date(from);
  const t = new Date(to);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const yearOpts: Intl.DateTimeFormatOptions = { ...opts, year: 'numeric' };
  if (f.getFullYear() === t.getFullYear()) {
    return `${f.toLocaleDateString(undefined, opts)}\u2013${t.toLocaleDateString(undefined, yearOpts)}`;
  }
  return `${f.toLocaleDateString(undefined, yearOpts)}\u2013${t.toLocaleDateString(undefined, yearOpts)}`;
}

export default function SessionStartScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const session = useSessionStore((state) =>
    sessionId ? state.sessions[sessionId] : undefined,
  );
  const cluster = useClusterStore((state) =>
    session?.clusterId
      ? state.clusters.find((c) => c.id === session.clusterId)
      : undefined,
  );
  const setSwipeSessionActive = useUIStore((state) => state.setSwipeSessionActive);

  useEffect(() => {
    setSwipeSessionActive(true);
    return () => setSwipeSessionActive(false);
  }, [setSwipeSessionActive]);

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

  const displayName = cluster?.name ?? session.name ?? 'Photo Session';
  const count = session.queueIds.length;

  const estimatedMinutes = Math.max(1, Math.ceil(count / 200));
  const estimatedLabel = estimatedMinutes === 1 ? '~1 min' : `~${estimatedMinutes} min`;

  const stagedBytes = session.decisions
    .filter((d) => d.decision === Decision.DELETE_STAGED)
    .reduce((acc, d) => acc + (d.bytes ?? 0), 0);
  const savingsBytes =
    cluster && cluster.estimatedBytes > 0 ? cluster.estimatedBytes : stagedBytes;
  const savingsLabel = savingsBytes > 0 ? formatBytes(savingsBytes) : '\u2014';

  const handleStart = () => {
    router.push(`/swipe/${sessionId}/swipe` as any);
  };

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 16 },
      ]}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={{top:10,bottom:10,left:10,right:10}}>
        <Text variant="body" style={styles.backText}>{'\u2190'} Back</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text variant="title" style={styles.centeredText}>
          {displayName}
        </Text>
        {cluster?.dateRange && (
          <Text variant="caption" style={[styles.centeredText, styles.dateText]}>
            {formatDateRange(cluster.dateRange.from, cluster.dateRange.to)}
          </Text>
        )}
      </View>

      <View style={styles.statsRow}>
        <StatColumn value={count.toLocaleString()} label="Photos" />
        <View style={styles.statDivider} />
        <StatColumn value={savingsLabel} label="Est. Size" />
      </View>

      <View style={styles.spacer} />

      <View style={styles.actions}>
        <Button
          variant="primary"
          label="Start Swiping"
          onPress={handleStart}
          style={styles.fullWidthButton}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: 24,
  },

  notFoundContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  backButton: {
    minWidth: 120,
  },

  backBtn: {
    alignSelf: 'flex-start',
    marginBottom: 24,
  },
  backText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
  },

  header: {
    marginBottom: 28,
    gap: 8,
  },
  centeredText: {
    textAlign: 'center',
  },
  dateText: {
    color: Colors.textTertiary,
  },

  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  statColumn: {
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  statLabel: {
    textAlign: 'center',
  },

  spacer: {
    flex: 1,
  },

  actions: {
    gap: 12,
  },
  fullWidthButton: {
    width: '100%',
  },
});
