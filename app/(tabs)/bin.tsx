/**
 * app/(tabs)/bin.tsx
 *
 * Bin screen — manages photos staged for deletion (Pending Cleanup).
 *
 *  Section A  (Pending Cleanup) – staged assets the user marked for deletion
 *                                  but hasn't confirmed yet. Tap a tile to
 *                                  toggle rescue (checkbox = keep). Long press
 *                                  to view full screen.
 *
 *  Bottom bar behaviour:
 *    - When items are checked for rescue:
 *        [Rescue N selected]              ← success variant
 *        [Delete M remaining (free X MB)] ← destructive variant
 *    - When nothing is checked:
 *        [Delete All (free X MB)]         ← destructive variant
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text as RNText,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { Colors, Spacing } from '@/constants/theme';
import { confirmStaged, executeDelete } from '@/services/deletion';
import { getAssetsByIds } from '@/services/mediaLibrary';
import { useSessionStore } from '@/store/session';
import { useTrashStore } from '@/store/trash';
import type { Asset } from '@/types';
import { formatBytes } from '@/utils/format';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_COLUMNS = 3;
const TILE_GAP = 3;
const TILE_RADIUS = 6;
const SUSPICIOUS_COLOR = Colors.warning;
// Two stacked buttons: 2×48 + gaps + padding. Used as paddingBottom offset for scroll content.
const BOTTOM_BAR_HEIGHT = 112;
/** Horizontal padding applied to the scroll content. */
const CONTENT_PADDING_H = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function totalBytes(assetIds: string[], assetMap: Record<string, Asset>): number {
  return assetIds.reduce((sum, id) => sum + (assetMap[id]?.bytes ?? 0), 0);
}

function buildBytesMap(
  assetIds: string[],
  assetMap: Record<string, Asset>,
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const id of assetIds) {
    const bytes = assetMap[id]?.bytes;
    if (bytes != null) map[id] = bytes;
  }
  return map;
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
  const removeFromStaged = useTrashStore((s) => s.removeFromStaged);
  const sessions = useSessionStore((s) => s.sessions);

  // ── Local state ─────────────────────────────────────────────────────────

  const [assetMap, setAssetMap] = useState<Record<string, Asset>>({});
  // Show a spinner on initial load when there are items to fetch.
  const [loading, setLoading] = useState(staged.length > 0);
  /** IDs of staged items the user has checked — they will be rescued, not deleted. */
  const [rescueSelectedIds, setRescueSelectedIds] = useState<Set<string>>(new Set());
  /** Asset shown in the full-screen preview modal; null means closed. */
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);

  // Track which IDs have been fetched so we never re-request the same asset.
  const fetchedIdsRef = useRef<Set<string>>(new Set());

  // ── Asset loading ────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    const allIds = staged.map((s) => s.assetId);
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
  }, [staged]);

  // Prune rescued IDs that no longer exist in staged (e.g., undone externally).
  useEffect(() => {
    const liveIds = new Set(staged.map((s) => s.assetId));
    setRescueSelectedIds((prev) => {
      const filtered = new Set([...prev].filter((id) => liveIds.has(id)));
      return filtered.size === prev.size ? prev : filtered;
    });
  }, [staged]);

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

  /** Count of staged items that are NOT checked for rescue (will be deleted). */
  const uncheckedCount = staged.length - rescueSelectedIds.size;

  /** Sum of bytes for all staged items (used in the header subtitle). */
  const totalStagedBytes = useMemo(
    () => totalBytes(staged.map((s) => s.assetId), assetMap),
    [staged, assetMap],
  );

  /** Sum of bytes for unchecked staged items only (used in the delete button label). */
  const uncheckedStagedBytes = useMemo(
    () =>
      totalBytes(
        staged.filter((s) => !rescueSelectedIds.has(s.assetId)).map((s) => s.assetId),
        assetMap,
      ),
    [staged, rescueSelectedIds, assetMap],
  );

  // ── Handlers ─────────────────────────────────────────────────────────────

  /**
   * Immediately rescues all checked staged items by removing them from the
   * staged list. No deletion occurs. Clears the rescue selection afterwards.
   */
  const handleRescueSelected = useCallback(() => {
    for (const id of rescueSelectedIds) {
      removeFromStaged(id);
    }
    setRescueSelectedIds(new Set());
  }, [rescueSelectedIds, removeFromStaged]);

  /**
   * Prompt the user, then rescue checked items and permanently delete the
   * unchecked ones via confirmStaged + executeDelete.
   */
  const handleDeleteAll = useCallback(() => {
    // Close any open full-screen preview before showing the confirmation alert.
    setPreviewAsset(null);

    const allStagedIds = staged.map((s) => s.assetId);
    const uncheckedIds = allStagedIds.filter((id) => !rescueSelectedIds.has(id));
    const uCount = uncheckedIds.length;
    const pluralize = (n: number) => (n !== 1 ? 's' : '');

    Alert.alert(
      `Delete ${uCount} photo${pluralize(uCount)}?`,
      `They'll be removed from your library.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            (async () => {
              try {
                for (const id of rescueSelectedIds) removeFromStaged(id);
                if (uncheckedIds.length > 0) {
                  confirmStaged(uncheckedIds);
                  await executeDelete(uncheckedIds, buildBytesMap(uncheckedIds, assetMap));
                }
                setRescueSelectedIds(new Set());
              } catch (err) {
                if (__DEV__) console.error('[BinScreen] deleteAll failed', err);
              }
            })();
          },
        },
      ],
    );
  }, [staged, rescueSelectedIds, removeFromStaged, assetMap]);

  /** Toggle the rescue-checkbox for a staged asset (tap behavior). */
  const toggleRescue = useCallback((assetId: string) => {
    setRescueSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }
      return next;
    });
  }, []);

  // ── Flags ────────────────────────────────────────────────────────────────

  const isEmpty = staged.length === 0;
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
        {staged.length > 0 && (
          <Text variant="caption" style={styles.subtitle}>
            {staged.length} photos pending cleanup · ~{formatBytes(totalStagedBytes)}
          </Text>
        )}
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

            <View style={styles.infoHint}>
              <RNText style={styles.infoIcon}>💡</RNText>
              <Text variant="caption" style={styles.infoText}>Tap to rescue · Long-press to preview</Text>
            </View>

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
                      const isRescued = rescueSelectedIds.has(item.assetId);
                      return (
                        <TouchableOpacity
                          key={item.assetId}
                          onPress={() => toggleRescue(item.assetId)}
                          onLongPress={() => setPreviewAsset(assetMap[item.assetId] ?? null)}
                          activeOpacity={0.7}
                          style={[
                            styles.tile,
                            tileSizeStyle,
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

                          {/* Green tint overlay when the tile is checked for rescue */}
                          {isRescued && <View style={styles.rescuedOverlay} />}

                          {/* Suspicious badge (top-left) */}
                          {item.isSuspicious && (
                            <View style={styles.suspiciousBadge}>
                              <Text variant="caption" style={styles.suspiciousBadgeText}>
                                ⚡
                              </Text>
                            </View>
                          )}

                          {/* Checkbox indicator (top-right) — always visible */}
                          <View
                            style={[
                              styles.checkboxOuter,
                              isRescued && styles.checkboxChecked,
                            ]}>
                            {isRescued && (
                              <Text style={styles.checkboxTick}>✓</Text>
                            )}
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* ── Sticky bottom bar ─────────────────────────────────────────── */}
      {showDeleteAllBar && (
        <>
          <LinearGradient
            colors={['transparent', Colors.background]}
            style={styles.fadeGradient}
          />
          <View style={[styles.bottomBar, { bottom: insets.bottom }]}>
            <View style={styles.bottomBarButtons}>
              {rescueSelectedIds.size > 0 && (
                <TouchableOpacity style={styles.rescueButton} onPress={handleRescueSelected}>
                  <RNText style={styles.rescueButtonText}>Rescue {rescueSelectedIds.size} selected</RNText>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.deleteButton} onPress={handleDeleteAll}>
                <RNText style={styles.deleteButtonText}>Delete {uncheckedCount} · free {formatBytes(uncheckedStagedBytes)}</RNText>
              </TouchableOpacity>
            </View>
          </View>
        </>
      )}

      {/* ── Full-screen preview modal ──────────────────────────────────── */}
      <Modal
        visible={previewAsset !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewAsset(null)}>
        <View style={styles.modalOverlay}>
          <Image
            source={{ uri: previewAsset?.uri }}
            style={styles.modalImage}
            contentFit="contain"
          />
          {/* Close button */}
          <TouchableOpacity
            style={styles.modalCloseBtn}
            onPress={() => setPreviewAsset(null)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.modalCloseTxt}>✕</Text>
          </TouchableOpacity>
          {/* Filename */}
          {previewAsset?.filename && (
            <View style={styles.modalFilenameBar}>
              <Text variant="caption" style={styles.modalFilenameText}>
                {previewAsset.filename}
              </Text>
            </View>
          )}
        </View>
      </Modal>
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
  subtitle: {
    color: Colors.textSecondary,
    marginTop: 4,
  },

  // ── Info hint card ─────────────────────────────────────────────────────────
  infoHint: {
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  infoIcon: {
    fontSize: 16,
  },
  infoText: {
    color: Colors.textSecondary,
    flex: 1,
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
    borderRadius: TILE_RADIUS,
    backgroundColor: Colors.cardFrom,
  },
  tilePlaceholder: {
    backgroundColor: Colors.cardFrom,
  },

  // ── Suspicious badge (top-left corner of tile) ─────────────────────────────
  suspiciousBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    backgroundColor: 'rgba(234,179,8,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(234,179,8,0.25)',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  suspiciousBadgeText: {
    fontSize: 10,
    lineHeight: 13,
    color: Colors.textPrimary,
  },

  // ── Checkbox indicator (top-right corner of staged tile) ──────────────────
  checkboxOuter: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: Colors.success,
    borderColor: Colors.success,
  },
  checkboxTick: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textPrimary,
    lineHeight: 14,
  },

  // ── Rescued overlay (green tint over checked staged tiles) ─────────────────
  rescuedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(34,197,94,0.15)',
  },

  // ── Fade gradient above bottom bar ─────────────────────────────────────────
  fadeGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: BOTTOM_BAR_HEIGHT,
    height: 24,
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
    gap: 8,
  },
  bottomBarButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  rescueButton: {
    flex: 1,
    backgroundColor: 'rgba(34,197,94,0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(34,197,94,0.25)',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
  },
  rescueButtonText: {
    color: Colors.success,
    fontWeight: '600',
    fontSize: 14,
  },
  deleteButton: {
    flex: 1.2,
    backgroundColor: Colors.destructive,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
  },
  deleteButtonText: {
    color: Colors.textPrimary,
    fontWeight: '600',
    fontSize: 14,
  },

  // ── Shared ─────────────────────────────────────────────────────────────────
  fullWidth: {
    width: '100%',
  },

  // ── Full-screen preview modal ──────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalImage: {
    width: '100%',
    height: '80%',
  },
  modalCloseBtn: {
    position: 'absolute',
    top: 52,
    right: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseTxt: {
    color: Colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  modalFilenameBar: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  modalFilenameText: {
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
  },
});
