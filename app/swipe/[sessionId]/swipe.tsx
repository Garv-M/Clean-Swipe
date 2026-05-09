/**
 * app/swipe/[sessionId]/swipe.tsx
 *
 * Core swiping UX for Clean Swipe.
 * Fetches assets from the media library in batches of 200, displays them as a
 * 3-card stack, records decisions to the session/trash/stats stores, and
 * navigates to the summary screen on completion.
 */

import { Button } from '@/components/ui/button';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { getAssetsByIds } from '@/services/mediaLibrary';
import { useSessionStore } from '@/store/session';
import { useStatsStore } from '@/store/stats';
import { useTrashStore } from '@/store/trash';
import { useUIStore } from '@/store/ui';
import type { Asset } from '@/types';
import { Decision } from '@/types';
import { formatBytes } from '@/utils/format';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 200;
const PREFETCH_THRESHOLD = 40;
const VELOCITY_THRESHOLD = 800;
const SUSPICIOUS_VELOCITY = 2000;
const SUSPICIOUS_TIME_MS = 500;
const CARD_FLY_DURATION = 280;

// Card stack visual offsets (bottom → top order for rendering)
const CARD_STACK = [
  { scale: 0.9, translateY: 20 },  // third (bottom)
  { scale: 0.95, translateY: 10 }, // second (middle)
  { scale: 1.0, translateY: 0 },   // top (interactive)
] as const;

// ---------------------------------------------------------------------------
// MetadataModal
// ---------------------------------------------------------------------------

interface MetadataModalProps {
  asset: Asset | null;
  visible: boolean;
  onClose: () => void;
}

function MetadataModal({ asset, visible, onClose }: MetadataModalProps) {
  if (!asset) return null;

  const formattedDate = asset.createdAt
    ? new Date(asset.createdAt).toLocaleString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Tap outside to dismiss */}
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        {/* Stop propagation so tapping inside the card doesn't close */}
        <Pressable style={styles.modalCard} onPress={() => { /* noop */ }}>
          <Text variant="heading" style={styles.modalTitle}>
            {asset.filename}
          </Text>

          <MetaRow label="Date" value={formattedDate} />

          {asset.bytes != null && (
            <MetaRow label="Size" value={formatBytes(asset.bytes)} />
          )}

          {asset.location != null && (
            <MetaRow
              label="Location"
              value={`${asset.location.lat.toFixed(5)}, ${asset.location.lng.toFixed(5)}`}
            />
          )}

          {asset.albums.length > 0 && (
            <MetaRow label="Albums" value={asset.albums.join(', ')} />
          )}

          <Button
            variant="ghost"
            label="Close"
            onPress={onClose}
            style={styles.modalCloseButton}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text variant="label" style={styles.metaLabel}>{label}</Text>
      <Text variant="body" style={styles.metaValue}>{value}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// SwipeScreen
// ---------------------------------------------------------------------------

export default function SwipeScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // ── Screen dimensions (dynamic — handles orientation/multi-window) ────────
  const { width: SCREEN_W, height: SCREEN_H } = useWindowDimensions();
  const SWIPE_X_THRESHOLD = SCREEN_W * 0.3;
  const SWIPE_Y_THRESHOLD = SCREEN_H * 0.3;
  const FLY_X = SCREEN_W * 1.6;
  const FLY_Y = SCREEN_H * 1.6;

  // ── Store selectors ──────────────────────────────────────────────────────
  const session = useSessionStore((s) =>
    sessionId ? s.sessions[sessionId] : undefined,
  );
  const setSwipeSessionActive = useUIStore((s) => s.setSwipeSessionActive);

  // ── Local state ──────────────────────────────────────────────────────────
  const [assetBuffer, setAssetBuffer] = useState<Asset[]>([]);
  const [hasNextPage, setHasNextPage] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  const [metadataAsset, setMetadataAsset] = useState<Asset | null>(null);
  const [metadataVisible, setMetadataVisible] = useState(false);

  // ── Stable refs (readable in runOnJS closures without stale-closure risk) ─
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const assetBufferRef = useRef<Asset[]>([]);
  assetBufferRef.current = assetBuffer;

  const hasNextPageRef = useRef(hasNextPage);
  hasNextPageRef.current = hasNextPage;

  const isFetchingRef = useRef(isFetching);
  isFetchingRef.current = isFetching;

  /** Index into queueIds — tracks how far we've loaded from the session queue. */
  const queueOffsetRef = useRef(0);

  /** Cache of every asset ever loaded — used to restore cards after undo. */
  const assetCacheRef = useRef<Record<string, Asset>>({});

  const lastSwipeTimeRef = useRef(0);
  const hasMarkedStartedRef = useRef(false);
  /** Guards against handleComplete firing more than once. */
  const hasCompletedRef = useRef(false);

  // ── Reanimated shared values ─────────────────────────────────────────────
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const isAnimating = useSharedValue(false);
  const zoomScale = useSharedValue(1);
  const isZoomed = useSharedValue(false);
  const cardOpacity = useSharedValue(1);

  // ── Progress ─────────────────────────────────────────────────────────────
  const cursor = session?.cursor ?? 0;
  const total = session?.queueIds.length ?? 0;

  // ── Mount / unmount ───────────────────────────────────────────────────────
  useEffect(() => {
    setSwipeSessionActive(true);
    return () => setSwipeSessionActive(false);
  }, [setSwipeSessionActive]);

  // ── Populate asset cache whenever buffer changes ──────────────────────────
  useEffect(() => {
    for (const asset of assetBuffer) {
      assetCacheRef.current[asset.id] = asset;
    }
  }, [assetBuffer]);

  // Reset shared values after React has swapped the top card out of the tree.
  const prevTopIdRef = useRef(assetBuffer[0]?.id);
  useEffect(() => {
    const topId = assetBuffer[0]?.id;
    if (topId !== prevTopIdRef.current) {
      prevTopIdRef.current = topId;
      translateX.value = 0;
      translateY.value = 0;
      zoomScale.value = 1;
      isZoomed.value = false;
      isAnimating.value = false;
      cardOpacity.value = 1;
    }
  }, [assetBuffer, translateX, translateY, zoomScale, isZoomed, isAnimating, cardOpacity]);

  // ── Media-library fetch ───────────────────────────────────────────────────

  /**
   * Fetch the next batch of assets from the session's queueIds.
   * Filters out already-decided assets.
   * Stable — reads live state via refs and store.getState().
   */
  const loadNextPage = useCallback(async () => {
    if (isFetchingRef.current || !hasNextPageRef.current) return;
    isFetchingRef.current = true;

    const sId = sessionIdRef.current;
    if (!sId) {
      isFetchingRef.current = false;
      return;
    }

    setIsFetching(true);
    try {
      const storeSession = useSessionStore.getState().sessions[sId];
      if (!storeSession) return;

      const { queueIds } = storeSession;
      const offset = queueOffsetRef.current;

      if (offset >= queueIds.length) {
        setHasNextPage(false);
        return;
      }

      const batch = queueIds.slice(offset, offset + PAGE_SIZE);
      queueOffsetRef.current = offset + batch.length;

      if (offset + batch.length >= queueIds.length) {
        setHasNextPage(false);
      }

      const assets = await getAssetsByIds(batch);

      const decidedIds = new Set(
        useSessionStore.getState().sessions[sId]?.decisions.map((d) => d.assetId) ?? [],
      );

      const displayAssets: Asset[] = [];
      for (const asset of assets) {
        if (decidedIds.has(asset.id)) continue;
        displayAssets.push(asset);
        assetCacheRef.current[asset.id] = asset;
      }

      setAssetBuffer((prev) => [...prev, ...displayAssets]);
    } catch (err) {
      if (__DEV__) console.warn('[SwipeScreen] loadNextPage failed', err);
    } finally {
      setIsFetching(false);
      setIsLoadingInitial(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (!sessionId) return;
    loadNextPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prefetch: keep buffer well-stocked
  useEffect(() => {
    if (assetBuffer.length < PREFETCH_THRESHOLD && hasNextPage && !isFetching) {
      loadNextPage();
    }
  }, [assetBuffer.length, hasNextPage, isFetching, loadNextPage]);

  // ── Session completion ─────────────────────────────────────────────────────

  const handleComplete = useCallback(() => {
    if (hasCompletedRef.current) return;
    hasCompletedRef.current = true;
    const sId = sessionIdRef.current;
    if (!sId) return;
    useSessionStore.getState().completeSession(sId);
    useStatsStore.getState().recordSessionCompleted();
    router.push(`/swipe/${sId}/summary` as any);
  }, [router]);

  // Auto-complete: fires when buffer runs dry and the media library is exhausted.
  // Covers the edge case where all remaining ML assets were already decided,
  // so no further swipes occur to trigger the in-decision completion check.
  useEffect(() => {
    if (
      !isLoadingInitial &&
      assetBuffer.length === 0 &&
      !hasNextPage &&
      !isFetching &&
      cursor > 0
    ) {
      handleComplete();
    }
  }, [isLoadingInitial, assetBuffer.length, hasNextPage, isFetching, cursor, handleComplete]);

  // ── Decision handler (stable — called via runOnJS from gesture worklet) ───

  const handleDecision = useCallback(
    (decision: Decision, velocity: number) => {
      const sId = sessionIdRef.current;
      if (!sId) return;

      const buffer = assetBufferRef.current;
      const currentAsset = buffer[0];
      if (!currentAsset) return;

      // Stamp session start on very first swipe
      if (!hasMarkedStartedRef.current) {
        useSessionStore.getState().markSessionStarted(sId);
        hasMarkedStartedRef.current = true;
      }

      const now = Date.now();
      const isSuspicious =
        velocity > SUSPICIOUS_VELOCITY ||
        (lastSwipeTimeRef.current > 0 &&
          now - lastSwipeTimeRef.current < SUSPICIOUS_TIME_MS);
      lastSwipeTimeRef.current = now;

      const record = {
        assetId: currentAsset.id,
        decision,
        timestamp: now,
        sessionId: sId,
        isSuspicious,
        bytes: currentAsset.bytes,
      };

      useSessionStore.getState().recordDecision(sId, record);

      if (decision === Decision.DELETE_STAGED) {
        useTrashStore
          .getState()
          .stageForDeletion(currentAsset.id, sId, isSuspicious);
        if (record.bytes != null) {
          useStatsStore.getState().recordFreed(record.bytes);
        }
      }
      if (decision === Decision.FAVORITE) {
        useStatsStore.getState().recordFavorite();
      }
      useStatsStore.getState().recordReviewed();

      const newCursor =
        (useSessionStore.getState().sessions[sId]?.cursor ?? 0) + 1;
      useSessionStore.getState().setCursor(sId, newCursor);

      // Advance buffer — useEffect resets shared values after React removes the old card
      setAssetBuffer((prev) => prev.slice(1));

      // Check completion
      const remainingAfter = buffer.slice(1);
      if (remainingAfter.length === 0 && !hasNextPageRef.current) {
        handleComplete();
      }
    },
    [handleComplete],
  );

  // ── Undo ──────────────────────────────────────────────────────────────────

  const handleUndo = useCallback(() => {
    const sId = sessionIdRef.current;
    if (!sId) return;

    const record = useSessionStore.getState().undo(sId);
    if (!record) return;

    if (record.decision === Decision.DELETE_STAGED) {
      useTrashStore.getState().removeFromStaged(record.assetId);
    }

    const currentCursor =
      useSessionStore.getState().sessions[sId]?.cursor ?? 0;
    useSessionStore.getState().setCursor(sId, Math.max(0, currentCursor - 1));

    const cachedAsset = assetCacheRef.current[record.assetId];
    if (cachedAsset) {
      setAssetBuffer((prev) => [cachedAsset, ...prev]);
    }
  }, []);

  // ── Long press → metadata modal ──────────────────────────────────────────

  const handleLongPressJS = useCallback(() => {
    const current = assetBufferRef.current[0];
    if (current) {
      setMetadataAsset(current);
      setMetadataVisible(true);
    }
  }, []);

  // ── Gestures ──────────────────────────────────────────────────────────────

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .onUpdate((e) => {
          if (isAnimating.value) return;
          translateX.value = e.translationX;
          translateY.value = e.translationY;
        })
        .onEnd((e) => {
          if (isAnimating.value) return;

          const { translationX, translationY, velocityX, velocityY } = e;
          const maxV = Math.max(Math.abs(velocityX), Math.abs(velocityY));

          let decision: Decision | null = null;
          let targetX = 0;
          let targetY = 0;

          // Velocity checks have priority over displacement checks
          if (velocityX < -VELOCITY_THRESHOLD) {
            decision = Decision.DELETE_STAGED;
            targetX = -FLY_X;
          } else if (velocityX > VELOCITY_THRESHOLD) {
            decision = Decision.KEEP;
            targetX = FLY_X;
          } else if (velocityY < -VELOCITY_THRESHOLD) {
            decision = Decision.FAVORITE;
            targetY = -FLY_Y;
          } else if (velocityY > VELOCITY_THRESHOLD) {
            decision = Decision.SKIP_LATER;
            targetY = FLY_Y;
          } else if (translationX < -SWIPE_X_THRESHOLD) {
            decision = Decision.DELETE_STAGED;
            targetX = -FLY_X;
          } else if (translationX > SWIPE_X_THRESHOLD) {
            decision = Decision.KEEP;
            targetX = FLY_X;
          } else if (translationY < -SWIPE_Y_THRESHOLD) {
            decision = Decision.FAVORITE;
            targetY = -FLY_Y;
          } else if (translationY > SWIPE_Y_THRESHOLD) {
            decision = Decision.SKIP_LATER;
            targetY = FLY_Y;
          }

          if (decision !== null) {
            isAnimating.value = true;
            const captured = decision;

            if (targetX !== 0) {
              // Horizontal fly-off; let Y drift slightly in the drag direction
              translateX.value = withTiming(
                targetX,
                { duration: CARD_FLY_DURATION },
                (finished) => {
                  isAnimating.value = false;
                  if (finished) {
                    cardOpacity.value = 0;
                    runOnJS(handleDecision)(captured, maxV);
                  }
                },
              );
              translateY.value = withTiming(translationY * 0.4, {
                duration: CARD_FLY_DURATION,
              });
            } else {
              // Vertical fly-off; let X drift slightly
              translateY.value = withTiming(
                targetY,
                { duration: CARD_FLY_DURATION },
                (finished) => {
                  isAnimating.value = false;
                  if (finished) {
                    cardOpacity.value = 0;
                    runOnJS(handleDecision)(captured, maxV);
                  }
                },
              );
              translateX.value = withTiming(translationX * 0.4, {
                duration: CARD_FLY_DURATION,
              });
            }
          } else {
            // Spring back to center
            translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
            translateY.value = withSpring(0, { damping: 20, stiffness: 200 });
          }
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleDecision, SWIPE_X_THRESHOLD, SWIPE_Y_THRESHOLD, FLY_X, FLY_Y],
  );

  const doubleTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .onEnd(() => {
          isZoomed.value = !isZoomed.value;
          zoomScale.value = withTiming(isZoomed.value ? 2 : 1, { duration: 250 });
        }),
    [isZoomed, zoomScale],
  );

  const longPressGesture = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(600)
        .onStart(() => {
          runOnJS(handleLongPressJS)();
        }),
    [handleLongPressJS],
  );

  // Exclusive: first gesture to activate wins.
  // Double-tap wins over long-press over pan (natural priority — no conflicts).
  const composedGesture = useMemo(
    () => Gesture.Exclusive(doubleTapGesture, longPressGesture, panGesture),
    [doubleTapGesture, longPressGesture, panGesture],
  );

  // ── Animated styles ───────────────────────────────────────────────────────

  const topCardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: zoomScale.value },
    ],
    opacity: cardOpacity.value,
  }));

  // Overlays — proportional to drag, only the dominant axis is shown.
  const leftOverlayStyle = useAnimatedStyle(() => {
    const domX = Math.abs(translateX.value) >= Math.abs(translateY.value);
    const opacity =
      domX && translateX.value < 0
        ? interpolate(
            translateX.value,
            [-SWIPE_X_THRESHOLD, 0],
            [1, 0],
            Extrapolation.CLAMP,
          )
        : 0;
    return { opacity };
  });

  const rightOverlayStyle = useAnimatedStyle(() => {
    const domX = Math.abs(translateX.value) >= Math.abs(translateY.value);
    const opacity =
      domX && translateX.value > 0
        ? interpolate(
            translateX.value,
            [0, SWIPE_X_THRESHOLD],
            [0, 1],
            Extrapolation.CLAMP,
          )
        : 0;
    return { opacity };
  });

  const upOverlayStyle = useAnimatedStyle(() => {
    const domY = Math.abs(translateY.value) > Math.abs(translateX.value);
    const opacity =
      domY && translateY.value < 0
        ? interpolate(
            translateY.value,
            [-SWIPE_Y_THRESHOLD, 0],
            [1, 0],
            Extrapolation.CLAMP,
          )
        : 0;
    return { opacity };
  });

  const downOverlayStyle = useAnimatedStyle(() => {
    const domY = Math.abs(translateY.value) > Math.abs(translateX.value);
    const opacity =
      domY && translateY.value > 0
        ? interpolate(
            translateY.value,
            [0, SWIPE_Y_THRESHOLD],
            [0, 1],
            Extrapolation.CLAMP,
          )
        : 0;
    return { opacity };
  });

  // ── Render helpers ────────────────────────────────────────────────────────

  const undoDisabled = !session?.undoStack.length;

  // ── Early-exit states ────────────────────────────────────────────────────

  if (!session) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text variant="heading">Session not found</Text>
        <Button
          variant="ghost"
          label="Go Back"
          onPress={() => router.back()}
          style={styles.centeredButton}
        />
      </View>
    );
  }

  if (isLoadingInitial && assetBuffer.length === 0) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={Colors.primary} size="large" />
        <Text variant="label" style={styles.loadingText}>
          Loading photos…
        </Text>
      </View>
    );
  }

  if (!isLoadingInitial && assetBuffer.length === 0) {
    return (
      <View
        style={[
          styles.container,
          styles.centered,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        <Text variant="heading">{cursor > 0 ? 'All done!' : 'No photos to review'}</Text>
        <Text variant="label" style={styles.loadingText}>
          {cursor > 0
            ? 'You reviewed all the photos in this session.'
            : 'There are no photos available to review in this group.'}
        </Text>
        <Button
          variant="primary"
          label={cursor > 0 ? 'See Summary' : 'Go Back'}
          onPress={cursor > 0 ? handleComplete : () => router.back()}
          style={styles.centeredButton}
        />
      </View>
    );
  }

  const currentAsset = assetBuffer[0];
  const nextAsset = assetBuffer[1] ?? null;
  const thirdAsset = assetBuffer[2] ?? null;

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      {/* ── Top bar ── */}
      <View style={styles.topBar}>
        {/* Progress indicator */}
        <View style={styles.progressGroup}>
          <Text variant="label" style={styles.progressText}>
            {cursor} / {total > 0 ? total : '—'}
          </Text>
          <View style={styles.progressBarWrap}>
            <ProgressBar progress={total > 0 ? cursor / total : 0} />
          </View>
        </View>

        {/* Undo button */}
        <TouchableOpacity
          onPress={handleUndo}
          disabled={undoDisabled}
          style={[styles.undoButton, undoDisabled && styles.disabledOpacity]}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text variant="label" style={styles.undoLabel}>
            Undo
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Card stack ── */}
      <View style={styles.cardStack}>
        {/* Third card (visually behind) */}
        {thirdAsset && (
          <StaticCard
            asset={thirdAsset}
            style={{
              transform: [
                { scale: CARD_STACK[0].scale },
                { translateY: CARD_STACK[0].translateY },
              ],
            }}
          />
        )}

        {/* Second card */}
        {nextAsset && (
          <StaticCard
            asset={nextAsset}
            style={{
              transform: [
                { scale: CARD_STACK[1].scale },
                { translateY: CARD_STACK[1].translateY },
              ],
            }}
          />
        )}

        {/* Top card — interactive */}
        <GestureDetector gesture={composedGesture}>
          <Animated.View style={[styles.card, topCardStyle]}>
            <Image
              source={currentAsset.localUri ?? currentAsset.uri}
              style={styles.cardImage}
              contentFit="contain"
            />

            {currentAsset.kind === 'video' && <VideoBadge />}

            {/* Directional overlays */}
            <Animated.View
              style={[styles.overlay, styles.overlayLeft, leftOverlayStyle]}
              pointerEvents="none"
            >
              <Text variant="heading" style={[styles.overlayLabel, { color: Colors.destructive }]}>
                DELETE
              </Text>
            </Animated.View>

            <Animated.View
              style={[styles.overlay, styles.overlayRight, rightOverlayStyle]}
              pointerEvents="none"
            >
              <Text variant="heading" style={[styles.overlayLabel, { color: Colors.success }]}>
                KEEP
              </Text>
            </Animated.View>

            <Animated.View
              style={[styles.overlay, styles.overlayTop, upOverlayStyle]}
              pointerEvents="none"
            >
              <Text variant="heading" style={[styles.overlayLabel, { color: Colors.info }]}>
                FAV
              </Text>
            </Animated.View>

            <Animated.View
              style={[styles.overlay, styles.overlayBottom, downOverlayStyle]}
              pointerEvents="none"
            >
              <Text variant="heading" style={[styles.overlayLabel, { color: 'rgba(156,163,175,1)' }]}>
                SKIP
              </Text>
            </Animated.View>
          </Animated.View>
        </GestureDetector>
      </View>

      {/* ── Bottom bar ── */}
      <View style={styles.bottomBar}>
        <Button
          variant="ghost"
          label="End Session Early"
          onPress={handleComplete}
        />
      </View>

      {/* ── Metadata modal ── */}
      <MetadataModal
        asset={metadataAsset}
        visible={metadataVisible}
        onClose={() => setMetadataVisible(false)}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// StaticCard — non-interactive background card
// ---------------------------------------------------------------------------

function StaticCard({ asset, style }: { asset: Asset; style?: ViewStyle }) {
  return (
    <View style={[styles.card, style]}>
      <Image source={asset.localUri ?? asset.uri} style={styles.cardImage} contentFit="cover" />
      {asset.kind === 'video' && <VideoBadge />}
    </View>
  );
}

// ---------------------------------------------------------------------------
// VideoBadge — play icon overlay for video assets
// ---------------------------------------------------------------------------

function VideoBadge() {
  return (
    <View style={styles.videoBadge}>
      <Text variant="label" style={styles.videoBadgeText}>▶</Text>
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
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  centeredButton: {
    minWidth: 160,
  },
  loadingText: {
    marginTop: 8,
    textAlign: 'center',
  },

  // ── Top bar ────────────────────────────────────────────────────────────────
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  progressGroup: {
    flex: 1,
    gap: 4,
  },
  progressText: {
    color: Colors.textSecondary,
  },
  progressBarWrap: {
    flex: 1,
  },
  undoButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  undoLabel: {
    color: Colors.textSecondary,
  },
  disabledOpacity: {
    opacity: 0.35,
  },

  // ── Card stack ─────────────────────────────────────────────────────────────
  cardStack: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    marginVertical: 8,
  },
  card: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#000000',
    // Elevation / shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },

  // ── Video badge ───────────────────────────────────────────────────────────
  videoBadge: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  videoBadgeText: {
    fontSize: 12,
    color: '#FFFFFF',
  },

  // ── Overlays ───────────────────────────────────────────────────────────────
  overlay: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayLeft: {
    top: 0,
    bottom: 0,
    left: 0,
    width: '50%',
    backgroundColor: 'rgba(239,68,68,0.18)',
  },
  overlayRight: {
    top: 0,
    bottom: 0,
    right: 0,
    width: '50%',
    backgroundColor: 'rgba(34,197,94,0.18)',
  },
  overlayTop: {
    left: 0,
    right: 0,
    top: 0,
    height: '40%',
    backgroundColor: 'rgba(59,130,246,0.18)',
  },
  overlayBottom: {
    left: 0,
    right: 0,
    bottom: 0,
    height: '40%',
    backgroundColor: 'rgba(156,163,175,0.18)',
  },
  overlayLabel: {
    fontWeight: '800',
    fontSize: 28,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },

  // ── Bottom bar ─────────────────────────────────────────────────────────────
  bottomBar: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    alignItems: 'center',
  },

  // ── Metadata modal ─────────────────────────────────────────────────────────
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  modalCard: {
    width: '100%',
    backgroundColor: Colors.cardFrom,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    gap: 12,
  },
  modalTitle: {
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  metaLabel: {
    width: 72,
    color: Colors.textSecondary,
    paddingTop: 1,
  },
  metaValue: {
    flex: 1,
  },
  modalCloseButton: {
    marginTop: 8,
    alignSelf: 'center',
  },
});
