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
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface StatRowProps {
  label: string;
  value: string;
  valueColor?: string;
  isLast?: boolean;
}

function StatRow({ label, value, valueColor, isLast }: StatRowProps) {
  return (
    <>
      <View style={styles.statRow}>
        <Text variant="body" style={styles.statLabelText}>{label}</Text>
        <Text variant="heading" style={[styles.statValue, valueColor ? { color: valueColor } : undefined]}>
          {value}
        </Text>
      </View>
      {!isLast && <View style={styles.statDivider} />}
    </>
  );
}

export default function SummaryScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const session = useSessionStore((state) =>
    sessionId ? state.sessions[sessionId] : undefined,
  );
  const setSwipeSessionActive = useUIStore((state) => state.setSwipeSessionActive);

  useEffect(() => {
    setSwipeSessionActive(false);
  }, [setSwipeSessionActive]);

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

  const photosReviewed = session.decisions.length;

  const keptCount = session.decisions.filter(d => d.decision === Decision.KEEP).length;

  const markedForDeletion = session.decisions.filter(
    (d) => d.decision === Decision.DELETE_STAGED,
  ).length;

  const favoritedCount = session.decisions.filter(d => d.decision === Decision.FAVORITE).length;

  const spaceToFree =
    session.freedBytesEstimated > 0
      ? formatBytes(session.freedBytesEstimated)
      : '—';

  const handleReviewCleanUp = () => {
    router.push(`/swipe/${sessionId}/review` as any);
  };

  const handleDoneForNow = () => {
    router.replace('/(tabs)/' as any);
  };

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom + 16 },
      ]}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.celebrationCircle}>
            <Text style={styles.celebrationCheck}>✓</Text>
          </View>
          <Text variant="title" style={styles.centeredText}>
            Session Complete
          </Text>
          <Text variant="caption" style={[styles.centeredText, styles.subtitleText]}>
            {session.name ?? 'Session'} · {photosReviewed} reviewed
          </Text>
        </View>

        <Card style={styles.statsCard}>
          <StatRow label="Kept" value={keptCount.toLocaleString()} valueColor={Colors.success} />
          <StatRow label="Marked for deletion" value={markedForDeletion.toLocaleString()} valueColor={Colors.destructive} />
          <StatRow label="Favorited" value={favoritedCount.toLocaleString()} valueColor={Colors.info} />
          <StatRow label="Space to free" value={spaceToFree} valueColor={Colors.primary} isLast />
        </Card>
      </ScrollView>

      <View style={styles.actions}>
        {markedForDeletion > 0 && (
          <Button
            variant="destructive"
            label="Review & Clean Up"
            onPress={handleReviewCleanUp}
            style={styles.fullWidthButton}
          />
        )}
        <TouchableOpacity onPress={handleDoneForNow} style={styles.doneButton}>
          <Text style={styles.doneText}>Done for now</Text>
        </TouchableOpacity>
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

  centeredFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  centeredButton: {
    minWidth: 120,
  },

  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 32,
    paddingBottom: 16,
  },

  header: {
    alignItems: 'center',
    marginBottom: 28,
    gap: 8,
  },
  celebrationCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(34,197,94,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  celebrationCheck: {
    fontSize: 28,
    fontWeight: '700',
    color: '#22C55E',
  },
  centeredText: {
    textAlign: 'center',
  },
  subtitleText: {
    color: Colors.textSecondary,
  },

  statsCard: {
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  statLabelText: {
    color: 'rgba(255,255,255,0.5)',
  },
  statValue: {
    color: Colors.textPrimary,
  },
  statDivider: {
    height: 1,
    backgroundColor: Colors.border,
  },

  actions: {
    gap: 12,
    paddingTop: 12,
  },
  fullWidthButton: {
    width: '100%',
  },
  doneButton: {
    padding: 14,
    alignItems: 'center',
  },
  doneText: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.35)',
  },
});
