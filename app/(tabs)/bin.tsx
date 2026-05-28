/**
 * app/(tabs)/bin.tsx
 *
 * Bin screen — two-section view for managing deleted photos:
 *
 *  Section A  (Pending Cleanup)  – staged assets the user marked for deletion
 *                                   but hasn't confirmed yet. Tap a tile to
 *                                   rescue (remove from staged). "Delete All"
 *                                   bar confirms all staged → queued for deletion.
 *
 *  Section B  (Recently Deleted) – confirmed assets pending OS-level removal.
 *                                   Tap tiles to select, then restore to cancel.
 *
 * Sticky bottom bar shows "Delete All" when staged items exist.
 * Restore footer lives inside the scroll view below Section B.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { confirmStaged } from '@/services/deletion';
import { getAssetsByIds } from '@/services/mediaLibrary';
import { useSessionStore } from '@/store/session';
import { useSettingsStore } from '@/store/settings';
import { useTrashStore } from '@/store/trash';
import type { Asset } from '@/types';
import { formatBytes } from '@/utils/format';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_COLUMNS = 3;
const TILE_GAP = 2;
const SUSPICIOUS_COLOR = Colors.warning;
// Must match the rendered height of the sticky bottom bar (padding 12*2 + Button height 48 + gap 4).
const BOTTOM_BAR_HEIGHT = 80;
/** Horizontal padding applied to the scroll content. */
const CONTENT_PADDING_H = 16;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysRemaining(expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
}

function totalBytes(assetIds: string[], assetMap: Record<string, Asset>): number {
  return assetIds.reduce((sum, id) => sum + (assetMap[id]?.bytes ?? 0), 0);
}

// ---------------------------------------------------------------------------
// BinScreen
// ---------------------------------------------------------------------------

export default function BinScreen() {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  // Tile size accounts for screen-edge padding on both sides and the gaps
  // between NUM_COLUMNS columns.
  const tileSize = Math.floor(
    (screenWidth - CONTENT_PADDING_H * 2 - TILE_GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS,
  );
  const tileSizeStyle = useMemo(() => ({ width: tileSize, height: tileSize }), [tileSize]);

  // ── Store selectors ─────────────────────────────────────────────────────

  const staged = useTrashStore((s) => s.staged);
  const confirmed = useTrashStore((s) => s.confirmed);
  const removeFromStaged = useTrashStore((s) => s.removeFromStaged);
  const removeAllConfirmed = useTrashStore((s) => s.removeAllConfirmed);
  const sessions = useSessionStore((s) => s.sessions);
  const retentionDays = useSettingsStore((s) => s.retentionDays);

  // ── Local state ─────────────────────────────────────────────────────────

  const [assetMap, setAssetMap] = useState<Record<string, Asset>>({});
  // Show a spinner on initial load when there are items to fetch.
  const [loading, setLoading] = useState(staged.length > 0 || confirmed.length > 0);
  const [selectedConfirmedIds, setSelectedConfirmedIds] = useState<Set<string>>(new Set());

  // Track which IDs have been fetched so we never re-request the same asset.
  const fetchedIdsRef = useRef<Set<string>>(new Set());

  // ── Asset loading ────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    const allIds = [
      ...staged.map((s) => s.assetId),
      ...confirmed.map((c) => c.assetId),
    ];
    const uniqueIds = [...new Set(allIds)];

    if (uniqueIds.length === 0) {
      setLoading(false);
      return;
    }

    const missingIds = uniqueIds.filter((id) => !fetchedIdsRef.current.has(id));
    if (missingIds.length === 0) {
      setLoading(false);
      return;
    }

    // Only show a full-screen spinner on the very first fetch.
    if (fetchedIdsRef.current.size === 0) {
      setLoading(true);
    }

    // Mark IDs as fetched before the async call to prevent duplicate requests
    // from concurrent renders triggering the same fetch twice.
    for (const id of missingIds) fetchedIdsRef.current.add(id);

    getAssetsByIds(missingIds)
      .then((assets) => {
        if (cancelled) return;
        setAssetMap((prev) => {
          const next = { ...prev };
          for (const asset of assets) {
            next[asset.id] = asset;
          }
          return next;
        });
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [staged, confirmed]);

  // Remove selected IDs that no longer exist in confirmed (e.g. purged externally).
  useEffect(() => {
    const liveIds = new Set(confirmed.map((c) => c.assetId));
    setSelectedConfirmedIds((prev) => {
      const filtered = new Set([...prev].filter((id) => liveIds.has(id)));
      return filtered.size === prev.size ? prev : filtered;
    });
  }, [confirmed]);

  // ── Derived values ───────────────────────────────────────────────────────

  /**
   * Staged items grouped by sessionId.
   * Within each group, suspicious items sort before non-suspicious.
   */
  const stagedGroups = useMemo(() => {
    const groupMap = new Map<string, typeof staged>();
    for (const item of staged) {
      const existing = groupMap.get(item.sessionId) ?? [];
      existing.push(item);
      groupMap.set(item.sessionId, existing);
    }

    return Array.from(groupMap.entries()).map(([sessionId, items]) => ({
      sessionId,
      items: [...items].sort((a, b) => {
        if (a.isSuspicious && !b.isSuspicious) return -1;
        if (!a.isSuspicious && b.isSuspicious) return 1;
        return 0;
      }),
    }));
  }, [staged]);

  /** Sum of bytes for all staged assets (used in the "Delete All" label). */
  const totalStagedBytes = useMemo(
    () => totalBytes(staged.map((s) => s.assetId), assetMap),
    [staged, assetMap],
  );

  // ── Handlers ─────────────────────────────────────────────────────────────

  /** Prompt the user, then confirm all staged items → queued for deletion. */
  const handleDeleteAll = useCallback(() => {
    const allStagedIds = staged.map((s) => s.assetId);
    const count = allStagedIds.length;
    Alert.alert(
      `Delete ${count} photo${count !== 1 ? 's' : ''}?`,
      "They'll be queued for permanent deletion.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => confirmStaged(allStagedIds),
        },
      ],
    );
  }, [staged]);

  /** Toggle a confirmed asset's selection state. */
  const handleToggleSelect = useCallback((assetId: string) => {
    setSelectedConfirmedIds((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }
      return next;
    });
  }, []);

  /** Restore selected confirmed assets — removes them from the confirmed list
   *  without any OS-level deletion. */
  const handleRestore = useCallback(() => {
    if (selectedConfirmedIds.size === 0) return;
    removeAllConfirmed([...selectedConfirmedIds]);
    setSelectedConfirmedIds(new Set());
  }, [selectedConfirmedIds, removeAllConfirmed]);

  // ── Flags ────────────────────────────────────────────────────────────────

  const isEmpty = staged.length === 0 && confirmed.length === 0;
  const showDeleteAllBar = staged.length > 0;

  // ── Loading state ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      {/* ── Screen header ─────────────────────────────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text variant="title">Bin</Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: BOTTOM_BAR_HEIGHT + insets.bottom + 16 },
        ]}
        showsVerticalScrollIndicator={false}>

        {/* ── Empty state ─────────────────────────────────────────────── */}
        {isEmpty && (
          <View style={styles.emptyState}>
            <IconSymbol name="trash.fill" size={52} color={Colors.textSecondary} />
            <Text variant="heading" style={styles.emptyTitle}>
              Your bin is empty
            </Text>
            <Text variant="body" style={styles.emptySubtitle}>
              Photos you swipe left will appear here
            </Text>
          </View>
        )}

        {/* ── Section A: Pending Cleanup ───────────────────────────────── */}
        {staged.length > 0 && (
          <View style={styles.section}>
            <Text variant="label" style={styles.sectionHeader}>
              PENDING CLEANUP
            </Text>

            <Card>
              <Text variant="body" style={styles.bannerText}>
                You marked these for deletion but didn't confirm. Review and rescue, or delete all.
              </Text>
            </Card>

            {stagedGroups.map(({ sessionId, items }) => {
              const session = sessions[sessionId];
              const sessionName = session?.name ?? 'Session';

              return (
                <View key={sessionId} style={styles.sessionGroup}>
                  <Text variant="label" style={styles.groupHeader}>
                    {sessionName} — {items.length} photo{items.length !== 1 ? 's' : ''} awaiting
                  </Text>

                  <View style={styles.grid}>
                    {items.map((item) => {
                      const asset = assetMap[item.assetId];
                      return (
                        <TouchableOpacity
                          key={item.assetId}
                          onPress={() => removeFromStaged(item.assetId)}
                          activeOpacity={0.7}
                          style={[
                            styles.tile,
                            tileSizeStyle,
                            item.isSuspicious && styles.suspiciousTile,
                          ]}>
                          {asset?.uri ? (
                            <Image
                              source={{ uri: asset.uri }}
                              style={StyleSheet.absoluteFill}
                              contentFit="cover"
                            />
                          ) : (
                            <View style={[StyleSheet.absoluteFill, styles.tilePlaceholder]} />
                          )}
                          {item.isSuspicious && (
                            <View style={styles.suspiciousBadge}>
                              <Text variant="caption" style={styles.suspiciousBadgeText}>
                                ⚡
                              </Text>
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* ── Section B: Recently Deleted ──────────────────────────────── */}
        {confirmed.length > 0 && (
          <View style={styles.section}>
            <Text variant="label" style={styles.sectionHeader}>
              RECENTLY DELETED
            </Text>
            <Text variant="body" style={styles.sectionSubLabel}>
              Tap to select for restore. Items expire after {retentionDays} days.
            </Text>

            <View style={styles.grid}>
              {confirmed.map((item) => {
                const asset = assetMap[item.assetId];
                const isSelected = selectedConfirmedIds.has(item.assetId);
                const days = daysRemaining(item.expiresAt);

                return (
                  <TouchableOpacity
                    key={item.assetId}
                    onPress={() => handleToggleSelect(item.assetId)}
                    activeOpacity={0.8}
                    style={[
                      styles.tile,
                      tileSizeStyle,
                      isSelected && styles.selectedTile,
                    ]}>
                    {asset?.uri ? (
                      <Image
                        source={{ uri: asset.uri }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={[StyleSheet.absoluteFill, styles.tilePlaceholder]} />
                    )}

                    {/* Days remaining overlay at the bottom of the tile */}
                    <View style={styles.daysOverlay}>
                      <Text variant="caption" style={styles.daysText}>
                        {days}d
                      </Text>
                    </View>

                    {/* Green checkmark + tint overlay when selected */}
                    {isSelected && (
                      <View style={styles.selectedOverlay}>
                        <Text variant="body" style={styles.checkmark}>
                          ✓
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Restore footer — non-sticky, lives inside scroll content */}
            <View style={styles.restoreFooter}>
              {selectedConfirmedIds.size > 0 ? (
                <Button
                  variant="secondary"
                  label={`Restore ${selectedConfirmedIds.size} selected`}
                  onPress={handleRestore}
                  style={styles.fullWidth}
                />
              ) : (
                <Text variant="label" style={styles.restoreHint}>
                  Select photos above to restore
                </Text>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {/* ── Sticky bottom bar: Delete All ─────────────────────────────── */}
      {showDeleteAllBar && (
        <View style={[styles.bottomBar, { bottom: insets.bottom }]}>
          <Button
            variant="destructive"
            label={`Delete All (free ${formatBytes(totalStagedBytes)})`}
            onPress={handleDeleteAll}
            style={styles.fullWidth}
          />
        </View>
      )}
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
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Header ─────────────────────────────────────────────────────────────────
  header: {
    paddingHorizontal: CONTENT_PADDING_H,
    paddingBottom: 12,
  },

  // ── Scroll ─────────────────────────────────────────────────────────────────
  scrollContent: {
    paddingHorizontal: CONTENT_PADDING_H,
    gap: 8,
  },

  // ── Empty state ────────────────────────────────────────────────────────────
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingTop: 80,
    paddingBottom: 40,
  },
  emptyTitle: {
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  emptySubtitle: {
    color: Colors.textSecondary,
    textAlign: 'center',
  },

  // ── Sections ───────────────────────────────────────────────────────────────
  section: {
    gap: 12,
    marginTop: 8,
  },
  sectionHeader: {
    letterSpacing: 0.8,
    color: Colors.textSecondary,
  },
  sectionSubLabel: {
    color: Colors.textSecondary,
    marginTop: -4,
  },
  bannerText: {
    color: Colors.textSecondary,
  },

  // ── Session group ──────────────────────────────────────────────────────────
  sessionGroup: {
    gap: 8,
  },
  groupHeader: {
    color: Colors.textSecondary,
  },

  // ── Photo grid ─────────────────────────────────────────────────────────────
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: TILE_GAP,
  },

  // ── Photo tile ─────────────────────────────────────────────────────────────
  tile: {
    overflow: 'hidden',
    borderRadius: 4,
    backgroundColor: Colors.cardFrom,
  },
  suspiciousTile: {
    borderWidth: 2,
    borderColor: SUSPICIOUS_COLOR,
  },
  selectedTile: {
    borderWidth: 2,
    borderColor: Colors.success,
  },
  tilePlaceholder: {
    backgroundColor: Colors.cardFrom,
  },

  // ── Suspicious badge (top-left corner of tile) ─────────────────────────────
  suspiciousBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  suspiciousBadgeText: {
    fontSize: 10,
    lineHeight: 13,
    color: Colors.textPrimary,
  },

  // ── Days remaining overlay (bottom strip of tile) ──────────────────────────
  daysOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingVertical: 3,
    alignItems: 'center',
  },
  daysText: {
    color: Colors.textPrimary,
    fontSize: 10,
    fontWeight: '600',
  },

  // ── Selected overlay (full-tile green tint + checkmark) ────────────────────
  selectedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(34,197,94,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    color: Colors.success,
    fontSize: 22,
    fontWeight: '700',
  },

  // ── Restore footer ─────────────────────────────────────────────────────────
  restoreFooter: {
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 8,
  },
  restoreHint: {
    color: Colors.textSecondary,
    textAlign: 'center',
  },

  // ── Sticky bottom bar ──────────────────────────────────────────────────────
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: CONTENT_PADDING_H,
    paddingVertical: 12,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },

  // ── Shared ─────────────────────────────────────────────────────────────────
  fullWidth: {
    width: '100%',
  },
});
