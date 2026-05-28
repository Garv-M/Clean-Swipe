/**
 * app/(tabs)/profile.tsx
 *
 * Profile / Stats screen.
 *
 * Section A — Lifetime stats
 *   • Hero card: total space freed + member-since date
 *   • 3 stat boxes: photos reviewed, photos cleared, sessions done
 *   • SVG bar chart: storage freed per month (last 6 calendar months)
 *
 * Section B — Settings
 *   • Tappable rows with chevron icon
 */

import React, { useCallback, useMemo } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text as RNText,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card } from '@/components/ui/card';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { useSettingsStore } from '@/store/settings';
import { useStatsStore } from '@/store/stats';
import { formatBytes } from '@/utils/format';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONTENT_PADDING = 16;
const PRIMARY_BORDER = 'rgba(249,115,22,0.35)' as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns last 6 calendar months (current month last) as data rows. */
function getLast6Months(): Array<{ key: string; label: string; bytes: number }> {
  const result: Array<{ key: string; label: string; bytes: number }> = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleString('default', { month: 'short' });
    result.push({ key, label, bytes: 0 });
  }
  return result;
}

/** Format a Unix-ms timestamp as "Jan 2024". Returns "—" if null. */
function formatMemberSince(ts: number | null): string {
  if (ts === null) return '—';
  const d = new Date(ts);
  return d.toLocaleString('default', { month: 'short', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Settings rows definition
// ---------------------------------------------------------------------------

const SETTINGS_ROWS = [
  { label: "Can't Decide Pile" },
  { label: 'About' },
  { label: 'Privacy Policy' },
  { label: 'Rate the App' },
] as const;

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  // ── Store selectors ───────────────────────────────────────────────────────
  const totalFreedBytes = useStatsStore((s) => s.totalFreedBytes);
  const photosReviewed = useStatsStore((s) => s.photosReviewed);
  const photosDeleted = useStatsStore((s) => s.photosDeleted);
  const sessionsCompleted = useStatsStore((s) => s.sessionsCompleted);
  const monthlyFreedBytes = useStatsStore((s) => s.monthlyFreedBytes);
  const memberSince = useSettingsStore((s) => s.memberSince);

  // ── Chart data ────────────────────────────────────────────────────────────
  const chartData = useMemo(() => {
    const base = getLast6Months();
    return base.map((row) => ({
      ...row,
      bytes: monthlyFreedBytes[row.key] ?? 0,
    }));
  }, [monthlyFreedBytes]);

  const maxBytes = useMemo(
    () => Math.max(...chartData.map((r) => r.bytes), 0),
    [chartData],
  );
  const hasChartData = maxBytes > 0;

  // ── Chart geometry ────────────────────────────────────────────────────────
  const chartWidth = screenWidth - CONTENT_PADDING * 2;
  const chartHeight = 160;
  const barMaxHeight = 120;
  const labelHeight = 16; // space reserved at the bottom for month labels
  const barAreaHeight = barMaxHeight;
  const totalBars = 6;
  const barWidth = Math.floor((chartWidth / totalBars) * 0.6);
  const slotWidth = chartWidth / totalBars;

  // Current month key for colour differentiation
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // ── Handler ───────────────────────────────────────────────────────────────
  const handleComingSoon = useCallback(() => {
    Alert.alert('Coming soon');
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 },
      ]}
      showsVerticalScrollIndicator={false}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text variant="title">Stats</Text>
      </View>

      {/* ═══════════════════════════════════════════════════════════════════
          Section A — Lifetime Stats
      ═══════════════════════════════════════════════════════════════════ */}

      {/* Hero card */}
      <Card style={[styles.heroCard, { borderColor: PRIMARY_BORDER }]}>
        <Text variant="hero">{formatBytes(totalFreedBytes)}</Text>
        <RNText style={styles.heroLabel}>Total Space Freed</RNText>
        <RNText style={styles.heroSince}>
          Member since {formatMemberSince(memberSince)}
        </RNText>
      </Card>

      {/* 3 stat boxes */}
      <View style={styles.statsRow}>
        {/* Photos reviewed — blue */}
        <Card style={styles.statCard}>
          <RNText style={[styles.statNumber, { color: Colors.info }]}>
            {photosReviewed}
          </RNText>
          <Text variant="caption" style={styles.statLabel}>
            Photos{'\n'}Reviewed
          </Text>
        </Card>

        {/* Photos cleared — red */}
        <Card style={styles.statCard}>
          <RNText style={[styles.statNumber, { color: Colors.destructive }]}>
            {photosDeleted}
          </RNText>
          <Text variant="caption" style={styles.statLabel}>
            Photos{'\n'}Cleared
          </Text>
        </Card>

        {/* Sessions done — green */}
        <Card style={styles.statCard}>
          <RNText style={[styles.statNumber, { color: Colors.success }]}>
            {sessionsCompleted}
          </RNText>
          <Text variant="caption" style={styles.statLabel}>
            Sessions{'\n'}Done
          </Text>
        </Card>
      </View>

      {/* Bar chart — Freed per month */}
      <Text variant="label" style={styles.sectionHeader}>
        FREED PER MONTH
      </Text>

      <View style={styles.chartContainer}>
        {hasChartData ? (
          <Svg width={chartWidth} height={chartHeight}>
            {chartData.map((item, index) => {
              const barHeight =
                maxBytes > 0
                  ? Math.max(4, Math.round((item.bytes / maxBytes) * barAreaHeight))
                  : 4;
              const x = Math.round(index * slotWidth + (slotWidth - barWidth) / 2);
              const barY = barAreaHeight - barHeight;
              const isCurrentMonth = item.key === currentMonthKey;
              const barFill = isCurrentMonth ? Colors.primary : Colors.cardFrom;
              const barStroke = isCurrentMonth ? 'transparent' : Colors.border;

              return (
                <React.Fragment key={item.key}>
                  <Rect
                    x={x}
                    y={barY}
                    width={barWidth}
                    height={barHeight}
                    rx={4}
                    fill={barFill}
                    stroke={barStroke}
                    strokeWidth={1}
                  />
                  <SvgText
                    x={x + barWidth / 2}
                    y={barAreaHeight + labelHeight}
                    fontSize={10}
                    fill={Colors.textSecondary}
                    textAnchor="middle">
                    {item.label}
                  </SvgText>
                </React.Fragment>
              );
            })}
          </Svg>
        ) : (
          <RNText style={styles.noDataText}>No data yet</RNText>
        )}
      </View>

      {/* ═══════════════════════════════════════════════════════════════════
          Section B — Settings
      ═══════════════════════════════════════════════════════════════════ */}

      <Text variant="label" style={styles.sectionHeader}>
        SETTINGS
      </Text>

      <View style={styles.settingsSection}>
        {SETTINGS_ROWS.map((row, index) => (
          <View key={row.label}>
            <TouchableOpacity
              style={styles.settingsRow}
              onPress={handleComingSoon}
              activeOpacity={0.7}>
              <Text variant="body">{row.label}</Text>
              <IconSymbol name="chevron.right" size={16} color={Colors.textSecondary} />
            </TouchableOpacity>
            {index < SETTINGS_ROWS.length - 1 && (
              <View style={styles.settingsDivider} />
            )}
          </View>
        ))}
      </View>
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
    gap: 12,
    paddingHorizontal: CONTENT_PADDING,
  },
  header: {
    paddingBottom: 8,
  },

  // ── Hero card ──────────────────────────────────────────────────────────────
  heroCard: {
    gap: 4,
  },
  heroLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textSecondary,
  },
  heroSince: {
    fontSize: 11,
    fontWeight: '400',
    color: Colors.textSecondary,
    marginTop: 4,
  },

  // ── Stat row ───────────────────────────────────────────────────────────────
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
  statNumber: {
    fontSize: 22,
    fontWeight: '700',
  },

  // ── Section header ─────────────────────────────────────────────────────────
  sectionHeader: {
    letterSpacing: 0.8,
    color: Colors.textSecondary,
    marginTop: 8,
  },

  // ── Chart ──────────────────────────────────────────────────────────────────
  chartContainer: {
    marginTop: 4,
  },
  noDataText: {
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingVertical: 40,
  },

  // ── Settings section ────────────────────────────────────────────────────────
  settingsSection: {
    marginTop: 4,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: CONTENT_PADDING,
  },
  settingsDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
    marginHorizontal: CONTENT_PADDING,
  },
});
