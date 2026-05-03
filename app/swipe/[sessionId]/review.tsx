/**
 * app/swipe/[sessionId]/review.tsx
 *
 * Review & confirm deletion screen.
 *
 * Loads all staged items for the session, lets the user rescue individual
 * photos (tap to deselect) or all at once (Deselect All), then commits the
 * remaining selection to confirmed deletion via confirmDeletion().
 *
 * On mount: setSwipeSessionActive(false) — tab bar is visible here.
 */

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { getAssetInfo } from '@/services/mediaLibrary';
import { useSettingsStore } from '@/store/settings';
import { useTrashStore } from '@/store/trash';
import { useUIStore } from '@/store/ui';
import type { Asset } from '@/types';
import { formatBytes } from '@/utils/format';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_COLUMNS = 3;
/** Pixel gap between tiles in both axes. */
const TILE_GAP = 2;
/** Yellow border colour applied to suspicious tiles. */
const SUSPICIOUS_BORDER_COLOR = '#EAB308';
const SUSPICIOUS_BORDER_WIDTH = 2;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReviewItem {
  assetId: string;
  sessionId: string;
  isSuspicious: boolean;
  stagedAt: number;
  asset: Asset | null;
}

// ---------------------------------------------------------------------------
// PhotoTile
// ---------------------------------------------------------------------------

interface PhotoTileProps {
  item: ReviewItem;
  isSelected: boolean;
  /** Pre-computed tile side length so every tile is exactly square. */
  size: number;
  onPress: () => void;
}

function PhotoTile({ item, isSelected, size, onPress }: PhotoTileProps) {
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      style={[
        styles.tile,
        { width: size, height: size },
        item.isSuspicious && styles.tileSuspicious,
      ]}
    >
      {item.asset?.uri ? (
        <Image
          source={{ uri: item.asset.uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.tilePlaceholder]} />
      )}

      {/*
        Selection overlay:
        - Darkened tint signals "this photo WILL be deleted"
        - Checkmark reinforces the selection state
        Default state is selected (marked for deletion); tapping rescues it.
      */}
      {isSelected && (
        <View
          style={[StyleSheet.absoluteFill, styles.selectedOverlay]}
          pointerEvents="none"
        >
          <Text style={styles.checkmark}>✓</Text>
        </View>
      )}

      {/* Suspicious fast-swipe badge: yellow border + ⚡ in top-left corner */}
      {item.isSuspicious && (
        <View style={styles.suspiciousBadge} pointerEvents="none">
          <Text style={styles.suspiciousIcon}>⚡</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// ReviewScreen
// ---------------------------------------------------------------------------

export default function ReviewScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  /**
   * Tile side length: divide screen width evenly across 3 columns with gaps
   * between (but not outside) them, then floor to avoid sub-pixel gaps.
   */
  const tileSize = Math.floor(
    (screenWidth - TILE_GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS,
  );

  // ── Store selectors ──────────────────────────────────────────────────────
  const setSwipeSessionActive = useUIStore((s) => s.setSwipeSessionActive);
  const retentionDays = useSettingsStore((s) => s.retentionDays);

  // ── Local state ──────────────────────────────────────────────────────────
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  /**
   * Set of assetIds currently marked for deletion.
   * Starts as all items; user taps to rescue (remove from set).
   * Always create a new Set when updating so React detects the change.
   */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  /**
   * Celebration state: set after confirmDeletion is called.
   * Shows a brief success overlay before navigating home.
   */
  const [celebration, setCelebration] = useState<{ count: number; bytes: number } | null>(null);
  const celebrationScale = useRef(new Animated.Value(0)).current;

  // ── On mount: restore tab bar ────────────────────────────────────────────
  useEffect(() => {
    setSwipeSessionActive(false);
  }, [setSwipeSessionActive]);

  // ── Load asset metadata in parallel ──────────────────────────────────────
  useEffect(() => {
    if (!sessionId) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    // Snapshot staged items at mount time — we don't need a reactive subscription
    // because the grid represents the state at the moment the user arrives here.
    const stagedForSession = useTrashStore
      .getState()
      .staged.filter((s) => s.sessionId === sessionId);

    if (stagedForSession.length === 0) {
      setIsLoading(false);
      return;
    }

    (async () => {
      // Fetch full asset metadata (URI, bytes, etc.) for every staged item
      // in parallel so the screen is ready as quickly as possible.
      const loaded = await Promise.all(
        stagedForSession.map(async (item): Promise<ReviewItem> => ({
          assetId: item.assetId,
          sessionId: item.sessionId,
          isSuspicious: item.isSuspicious ?? false,
          stagedAt: item.stagedAt,
          asset: await getAssetInfo(item.assetId),
        })),
      );

      if (cancelled) return;

      // Suspicious items float to the top; relative order is preserved within
      // each group so the user sees fast-swipe decisions first.
      const sorted = [...loaded].sort((a, b) => {
        if (a.isSuspicious === b.isSuspicious) return 0;
        return a.isSuspicious ? -1 : 1;
      });

      setReviewItems(sorted);
      // All items start selected (i.e., will be deleted)
      setSelectedIds(new Set(sorted.map((i) => i.assetId)));
      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally once — sessionId is stable within this screen mount

  // ── Celebration spring animation ─────────────────────────────────────────
  useEffect(() => {
    if (!celebration) return;
    celebrationScale.setValue(0);
    Animated.spring(celebrationScale, {
      toValue: 1,
      tension: 100,
      friction: 7,
      useNativeDriver: true,
    }).start();
  }, [celebration, celebrationScale]);

  // ── Derived values ───────────────────────────────────────────────────────

  const { totalBytes, selectedCount } = useMemo(() => {
    let bytes = 0;
    let count = 0;
    for (const item of reviewItems) {
      if (selectedIds.has(item.assetId)) {
        count++;
        bytes += item.asset?.bytes ?? 0;
      }
    }
    return { totalBytes: bytes, selectedCount: count };
  }, [reviewItems, selectedIds]);

  // ── Interaction handlers ─────────────────────────────────────────────────

  const handleTilePress = useCallback(
    (item: ReviewItem) => {
      const isCurrentlySelected = selectedIds.has(item.assetId);

      if (isCurrentlySelected) {
        // Rescue: remove from visual selection AND immediately unstage so the
        // item is no longer in the trash bin even if the user leaves this screen.
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(item.assetId);
          return next;
        });
        useTrashStore.getState().removeFromStaged(item.assetId);
      } else {
        // Re-select: add back to the deletion set and re-stage.
        // stageForDeletion is a no-op if the item is already staged, so this
        // is safe even if the caller toggles rapidly.
        setSelectedIds((prev) => new Set([...prev, item.assetId]));
        useTrashStore
          .getState()
          .stageForDeletion(item.assetId, item.sessionId, item.isSuspicious);
      }
    },
    [selectedIds],
  );

  const handleSelectAll = useCallback(() => {
    // Re-stage any items that were previously rescued before adding them back.
    reviewItems.forEach((item) => {
      if (!selectedIds.has(item.assetId)) {
        useTrashStore
          .getState()
          .stageForDeletion(item.assetId, item.sessionId, item.isSuspicious);
      }
    });
    setSelectedIds(new Set(reviewItems.map((i) => i.assetId)));
  }, [reviewItems, selectedIds]);

  const handleDeselectAll = useCallback(() => {
    // Unstage every currently selected item before clearing the visual set.
    selectedIds.forEach((assetId) => {
      useTrashStore.getState().removeFromStaged(assetId);
    });
    setSelectedIds(new Set<string>());
  }, [selectedIds]);

  const handleDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    // Capture summary before confirmDeletion clears the staged list.
    const count = selectedCount;
    const bytes = totalBytes;
    // Move staged → confirmed; DeletionService handles the actual OS deletion.
    useTrashStore
      .getState()
      .confirmDeletion(Array.from(selectedIds), retentionDays);
    // Show celebration overlay for 1 second, then navigate home.
    setCelebration({ count, bytes });
    setTimeout(() => {
      router.replace('/(tabs)/' as any);
    }, 1000);
  }, [selectedIds, selectedCount, totalBytes, retentionDays, router]);

  // ── Loading state ─────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <View
        style={[
          styles.container,
          styles.centered,
          { paddingTop: insets.top },
        ]}
      >
        <ActivityIndicator color={Colors.primary} size="large" />
        <Text variant="label" style={styles.loadingText}>
          Loading photos...
        </Text>
      </View>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────────

  if (reviewItems.length === 0) {
    return (
      <View
        style={[
          styles.container,
          styles.centered,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
        ]}
      >
        <Text variant="heading" style={styles.centeredText}>
          Nothing to delete — all clear!
        </Text>
        <Button
          variant="primary"
          label="Back to Dashboard"
          onPress={() => router.replace('/(tabs)/' as any)}
          style={styles.centeredButton}
        />
      </View>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <Text variant="heading">Review Deletions</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>
              {reviewItems.length}{' '}
              {reviewItems.length === 1 ? 'photo' : 'photos'}
            </Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={handleSelectAll}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text variant="label" style={styles.actionLink}>
              Select All
            </Text>
          </TouchableOpacity>

          <View style={styles.actionDivider} />

          <TouchableOpacity
            onPress={handleDeselectAll}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text variant="label" style={styles.actionLink}>
              Deselect All
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Photo grid ── */}
      <FlatList<ReviewItem>
        data={reviewItems}
        /**
         * extraData forces FlatList to diff renderItem output whenever
         * selectedIds changes, even though the underlying data array is stable.
         */
        extraData={selectedIds}
        keyExtractor={(item) => item.assetId}
        numColumns={NUM_COLUMNS}
        renderItem={({ item }) => (
          <PhotoTile
            item={item}
            isSelected={selectedIds.has(item.assetId)}
            size={tileSize}
            onPress={() => handleTilePress(item)}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: TILE_GAP }} />}
        columnWrapperStyle={{ gap: TILE_GAP }}
        showsVerticalScrollIndicator={false}
        style={styles.list}
      />

      {/* ── Sticky bottom bar ── */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        {totalBytes > 0 && (
          <Text variant="label" style={styles.spaceText}>
            Frees {formatBytes(totalBytes)}
          </Text>
        )}
        <Button
          variant="destructive"
          label={
            selectedCount === 0
              ? 'No photos selected'
              : `Delete ${selectedCount} ${selectedCount === 1 ? 'photo' : 'photos'}`
          }
          onPress={handleDelete}
          disabled={selectedCount === 0}
          style={styles.deleteButton}
        />
      </View>

      {/* ── Celebration overlay (shown for 1 s after deletion) ── */}
      {celebration && (
        <View style={[StyleSheet.absoluteFill, styles.celebrationOverlay]}>
          <Animated.View
            style={[
              styles.celebrationCard,
              { transform: [{ scale: celebrationScale }] },
            ]}
          >
            <Text variant="title" style={styles.celebrationEmoji}>🎉</Text>
            <Text variant="heading" style={styles.celebrationTitle}>
              {celebration.count}{' '}
              {celebration.count === 1 ? 'photo' : 'photos'} deleted!
            </Text>
            {celebration.bytes > 0 && (
              <Text variant="label" style={styles.celebrationSub}>
                {formatBytes(celebration.bytes)} freed
              </Text>
            )}
          </Animated.View>
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

  // ── Shared centred layout (loading + empty) ────────────────────────────────
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  centeredText: {
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  centeredButton: {
    minWidth: 200,
  },
  loadingText: {
    color: Colors.textSecondary,
  },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  countBadge: {
    backgroundColor: Colors.cardFrom,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.textSecondary,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actionLink: {
    color: Colors.primary,
  },
  actionDivider: {
    width: 1,
    height: 14,
    backgroundColor: Colors.border,
  },

  // ── FlatList ──────────────────────────────────────────────────────────────
  list: {
    flex: 1,
  },

  // ── Photo tile ─────────────────────────────────────────────────────────────
  tile: {
    overflow: 'hidden',
    backgroundColor: Colors.cardFrom,
  },
  /**
   * Suspicious tiles: yellow border.
   * React Native's default box model is border-box, so the border is drawn
   * inside the tile's explicit width/height — no grid misalignment.
   */
  tileSuspicious: {
    borderWidth: SUSPICIOUS_BORDER_WIDTH,
    borderColor: SUSPICIOUS_BORDER_COLOR,
  },
  tilePlaceholder: {
    backgroundColor: Colors.cardFrom,
  },
  /** Semi-transparent dark overlay = "this photo will be deleted". */
  selectedOverlay: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    fontSize: 28,
    color: Colors.textPrimary,
    fontWeight: '700',
  },
  /** Small rounded pill that renders the ⚡ glyph in the top-left corner. */
  suspiciousBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  suspiciousIcon: {
    fontSize: 11,
    lineHeight: 14,
  },

  // ── Bottom action bar ─────────────────────────────────────────────────────
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
    alignItems: 'center',
  },
  spaceText: {
    color: Colors.success,
  },
  deleteButton: {
    width: '100%',
  },

  // ── Celebration overlay ───────────────────────────────────────────────────
  celebrationOverlay: {
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  celebrationCard: {
    backgroundColor: '#283548',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 40,
    paddingVertical: 36,
    alignItems: 'center',
    gap: 8,
  },
  celebrationEmoji: {
    fontSize: 48,
    lineHeight: 56,
    textAlign: 'center',
  },
  celebrationTitle: {
    color: '#22C55E',
    textAlign: 'center',
  },
  celebrationSub: {
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
  },
});
