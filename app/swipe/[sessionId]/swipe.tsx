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
import VideoCard, { type VideoCardHandle } from '@/components/ui/video-card';
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
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
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
const VELOCITY_THRESHOLD = 500;
const SUSPICIOUS_VELOCITY = 2000;
const SUSPICIOUS_TIME_MS = 500;
const CARD_FLY_DURATION = 200;

const STACK_SCALES = [1.0, 0.95, 0.9] as const;
const STACK_OFFSETS = [0, 10, 20] as const;

const SPRING_CONFIG = { damping: 15, stiffness: 200 };
const SNAP_BACK_CONFIG = { damping: 25, stiffness: 180, mass: 0.9 };

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
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
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
// SwipeCard — per-card component with its own Reanimated shared values
// ---------------------------------------------------------------------------

interface SwipeCardHandle {
  triggerSwipe: (decision: Decision) => void;
}

interface SwipeCardProps {
  asset: Asset;
  stackIndex: number; // 0 = top, 1 = middle, 2 = bottom
  onSwipe: (decision: Decision, velocity: number) => void;
  onLongPress: () => void;
  screenW: number;
  screenH: number;
  entryFrom?: { x: number; y: number };
}

const SwipeCard = forwardRef<SwipeCardHandle, SwipeCardProps>(function SwipeCard(
  { asset, stackIndex, onSwipe, onLongPress, screenW, screenH, entryFrom },
  ref,
) {
  const SWIPE_X_THRESHOLD = screenW * 0.25;
  const SWIPE_Y_THRESHOLD = screenH * 0.25;
  const FLY_X = screenW * 2.6;
  const FLY_Y = screenH * 1.6;

  // Stack position animation (smooth transition when card moves up in stack)
  const cardScale = useSharedValue(STACK_SCALES[stackIndex] ?? 0.9);
  const cardOffsetY = useSharedValue(STACK_OFFSETS[stackIndex] ?? 10);

  useEffect(() => {
    const targetScale = STACK_SCALES[stackIndex] ?? 0.9;
    const targetOffset = STACK_OFFSETS[stackIndex] ?? 20;
    cardScale.value = withSpring(targetScale, SPRING_CONFIG);
    cardOffsetY.value = withSpring(targetOffset, SPRING_CONFIG);
  }, [stackIndex, cardScale, cardOffsetY]);

  // Pan gesture values (only meaningful for top card, always 0 for others)
  const panX = useSharedValue(entryFrom?.x ?? 0);
  const panY = useSharedValue(entryFrom?.y ?? 0);
  const isAnimating = useSharedValue(!!entryFrom);

  // Undo entry animation: smooth glide back from the fly-off position
  useEffect(() => {
    if (entryFrom) {
      panX.value = withTiming(0, { duration: 300 }, () => {
        isAnimating.value = false;
      });
      panY.value = withTiming(0, { duration: 300 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Imperative handle for programmatic swipe from buttons
  useImperativeHandle(ref, () => ({
    triggerSwipe(decision: Decision) {
      if (isAnimating.value) return;
      videoCardRef.current?.stop();
      isAnimating.value = true;

      let targetX = 0;
      let targetY = 0;
      switch (decision) {
        case Decision.DELETE_STAGED: targetX = -FLY_X; break;
        case Decision.KEEP:         targetX = FLY_X;  break;
        case Decision.FAVORITE:     targetY = -FLY_Y; break;
        case Decision.SKIP_LATER:   targetY = FLY_Y;  break;
      }

      if (targetX !== 0) {
        panX.value = withTiming(targetX, { duration: CARD_FLY_DURATION }, (finished) => {
          if (finished) runOnJS(onSwipe)(decision, 0);
        });
        panY.value = withTiming(0, { duration: CARD_FLY_DURATION });
      } else {
        panY.value = withTiming(targetY, { duration: CARD_FLY_DURATION }, (finished) => {
          if (finished) runOnJS(onSwipe)(decision, 0);
        });
        panX.value = withTiming(0, { duration: CARD_FLY_DURATION });
      }
    },
  }));

  // Video stop ref — called before any swipe animation runs
  const videoCardRef = useRef<VideoCardHandle>(null);
  const stopVideoOnSwipe = useCallback(() => {
    videoCardRef.current?.stop();
  }, []);

  // Zoom
  const zoomScale = useSharedValue(1);
  const isZoomed = useSharedValue(false);

  // Gestures — use isAnimating as the guard on the UI thread;
  // non-top cards never get gesture events because GestureDetector
  // is only active on the topmost card in the stack (highest z-order).
  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (isAnimating.value) return;
      panX.value = e.translationX;
      panY.value = e.translationY;
    })
    .onEnd((e) => {
      if (isAnimating.value) return;

      const { translationX, translationY, velocityX, velocityY } = e;
      const maxV = Math.max(Math.abs(velocityX), Math.abs(velocityY));

      let decision: Decision | null = null;
      let targetX = 0;
      let targetY = 0;

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
        runOnJS(stopVideoOnSwipe)();
        const captured = decision;

        if (targetX !== 0) {
          panX.value = withTiming(
            targetX,
            { duration: CARD_FLY_DURATION },
            (finished) => {
              if (finished) {
                runOnJS(onSwipe)(captured, maxV);
              }
            },
          );
          panY.value = withTiming(translationY * 0.4, {
            duration: CARD_FLY_DURATION,
          });
        } else {
          panY.value = withTiming(
            targetY,
            { duration: CARD_FLY_DURATION },
            (finished) => {
              if (finished) {
                runOnJS(onSwipe)(captured, maxV);
              }
            },
          );
          panX.value = withTiming(translationX * 0.4, {
            duration: CARD_FLY_DURATION,
          });
        }
      } else {
        panX.value = withSpring(0, SNAP_BACK_CONFIG);
        panY.value = withSpring(0, SNAP_BACK_CONFIG);
      }
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      isZoomed.value = !isZoomed.value;
      zoomScale.value = withTiming(isZoomed.value ? 2 : 1, { duration: 250 });
    });

  const longPressGesture = Gesture.LongPress()
    .minDuration(600)
    .onStart(() => {
      runOnJS(onLongPress)();
    });

  const composedGesture = Gesture.Race(panGesture, Gesture.Exclusive(doubleTapGesture, longPressGesture));

  // Animated style — no branching on shared values.
  // panX/panY/zoomScale are always 0/0/1 for non-top cards (never modified),
  // so the math produces the correct result uniformly.
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: panX.value },
      { translateY: panY.value + cardOffsetY.value },
      { scale: cardScale.value * zoomScale.value },
    ],
  }));

  // Overlays — panX/panY are 0 for non-top cards so opacity stays 0 naturally
  const leftOverlayStyle = useAnimatedStyle(() => {
    const domX = Math.abs(panX.value) >= Math.abs(panY.value);
    const opacity =
      domX && panX.value < 0
        ? interpolate(panX.value, [-SWIPE_X_THRESHOLD, 0], [1, 0], Extrapolation.CLAMP)
        : 0;
    return { opacity };
  });

  const rightOverlayStyle = useAnimatedStyle(() => {
    const domX = Math.abs(panX.value) >= Math.abs(panY.value);
    const opacity =
      domX && panX.value > 0
        ? interpolate(panX.value, [0, SWIPE_X_THRESHOLD], [0, 1], Extrapolation.CLAMP)
        : 0;
    return { opacity };
  });

  const upOverlayStyle = useAnimatedStyle(() => {
    const domY = Math.abs(panY.value) > Math.abs(panX.value);
    const opacity =
      domY && panY.value < 0
        ? interpolate(panY.value, [-SWIPE_Y_THRESHOLD, 0], [1, 0], Extrapolation.CLAMP)
        : 0;
    return { opacity };
  });

  const downOverlayStyle = useAnimatedStyle(() => {
    const domY = Math.abs(panY.value) > Math.abs(panX.value);
    const opacity =
      domY && panY.value > 0
        ? interpolate(panY.value, [0, SWIPE_Y_THRESHOLD], [0, 1], Extrapolation.CLAMP)
        : 0;
    return { opacity };
  });

  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View style={[styles.card, animatedStyle]}>
        {asset.kind === 'video' ? (
          <VideoCard
            ref={videoCardRef}
            uri={asset.uri}
            isTopCard={stackIndex === 0}
          />
        ) : (
          <Image
            source={asset.localUri ?? asset.uri}
            style={styles.cardImage}
            contentFit="contain"
          />
        )}

        {/* Directional overlays (only visible on top card during drag) */}
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
  );
});

// ---------------------------------------------------------------------------
// SwipeScreen
// ---------------------------------------------------------------------------

export default function SwipeScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { width: SCREEN_W, height: SCREEN_H } = useWindowDimensions();

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
  const [undoEntry, setUndoEntry] = useState<{ assetId: string; x: number; y: number } | null>(null);

  // ── Stable refs ──────────────────────────────────────────────────────────
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const assetBufferRef = useRef<Asset[]>([]);
  assetBufferRef.current = assetBuffer;

  const hasNextPageRef = useRef(hasNextPage);
  hasNextPageRef.current = hasNextPage;

  const isFetchingRef = useRef(isFetching);
  isFetchingRef.current = isFetching;

  const queueOffsetRef = useRef(0);
  const assetCacheRef = useRef<Record<string, Asset>>({});
  const lastSwipeTimeRef = useRef(0);
  const hasMarkedStartedRef = useRef(false);
  const hasCompletedRef = useRef(false);
  const topCardRef = useRef<SwipeCardHandle>(null);

  // ── Progress ─────────────────────────────────────────────────────────────
  const cursor = session?.cursor ?? 0;
  const total = session?.queueIds.length ?? 0;

  // ── Mount / unmount ───────────────────────────────────────────────────────
  useEffect(() => {
    setSwipeSessionActive(true);
    return () => setSwipeSessionActive(false);
  }, [setSwipeSessionActive]);

  // ── Populate asset cache ─────────────────────────────────────────────────
  useEffect(() => {
    for (const asset of assetBuffer) {
      assetCacheRef.current[asset.id] = asset;
    }
  }, [assetBuffer]);

  // ── Media-library fetch ───────────────────────────────────────────────────

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

  // Prefetch
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

  const handleEndEarly = useCallback(() => {
    const sId = sessionIdRef.current;
    if (!sId) return;
    router.push(`/swipe/${sId}/summary` as any);
  }, [router]);

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

  // ── Decision handler ─────────────────────────────────────────────────────

  const handleDecision = useCallback(
    (decision: Decision, velocity: number) => {
      const sId = sessionIdRef.current;
      if (!sId) return;

      const buffer = assetBufferRef.current;
      const currentAsset = buffer[0];
      if (!currentAsset) return;

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

      // Remove top card — the next card's SwipeCard instance persists and
      // springs smoothly to the top position via its stackIndex change.
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

    useStatsStore.getState().undoReviewed();
    if (record.decision === Decision.DELETE_STAGED && record.bytes) {
      useStatsStore.getState().undoFreed(record.bytes);
    }

    if (record.decision === Decision.DELETE_STAGED) {
      useTrashStore.getState().removeFromStaged(record.assetId);
    }

    const currentCursor =
      useSessionStore.getState().sessions[sId]?.cursor ?? 0;
    useSessionStore.getState().setCursor(sId, Math.max(0, currentCursor - 1));

    // Compute fly-back direction based on how the card was swiped out
    const flyX = SCREEN_W * 1.6;
    const flyY = SCREEN_H * 1.6;
    let entryX = 0;
    let entryY = 0;
    switch (record.decision) {
      case Decision.DELETE_STAGED: entryX = -flyX; break;
      case Decision.KEEP:         entryX = flyX;  break;
      case Decision.FAVORITE:     entryY = -flyY; break;
      case Decision.SKIP_LATER:   entryY = flyY;  break;
    }

    const cachedAsset = assetCacheRef.current[record.assetId];
    if (cachedAsset) {
      setUndoEntry({ assetId: cachedAsset.id, x: entryX, y: entryY });
      setAssetBuffer((prev) => [cachedAsset, ...prev]);
    }
  }, [SCREEN_W, SCREEN_H]);

  // ── Long press → metadata modal ──────────────────────────────────────────

  const handleLongPress = useCallback(() => {
    const current = assetBufferRef.current[0];
    if (current) {
      setMetadataAsset(current);
      setMetadataVisible(true);
    }
  }, []);

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

  // Show up to 3 cards, rendered bottom-to-top (last element = highest z-index)
  const visibleCards = assetBuffer.slice(0, 3);

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
        <View style={styles.progressGroup}>
          <Text variant="label" style={styles.progressText}>
            {cursor} / {total > 0 ? total : '—'}
          </Text>
          <View style={styles.progressBarWrap}>
            <ProgressBar progress={total > 0 ? cursor / total : 0} />
          </View>
        </View>

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
        {visibleCards
          .slice()
          .reverse()
          .map((asset, reverseIdx) => {
            const stackIndex = visibleCards.length - 1 - reverseIdx;
            const entry =
              stackIndex === 0 && undoEntry?.assetId === asset.id
                ? { x: undoEntry.x, y: undoEntry.y }
                : undefined;
            return (
              <SwipeCard
                key={asset.id}
                ref={stackIndex === 0 ? topCardRef : undefined}
                asset={asset}
                stackIndex={stackIndex}
                onSwipe={handleDecision}
                onLongPress={handleLongPress}
                screenW={SCREEN_W}
                screenH={SCREEN_H}
                entryFrom={entry}
              />
            );
          })}
      </View>

      {/* ── Action buttons ── */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.actionButton, styles.actionDelete]}
          onPress={() => topCardRef.current?.triggerSwipe(Decision.DELETE_STAGED)}
          activeOpacity={0.7}
        >
          <Text style={styles.actionIcon}>✕</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, styles.actionFav]}
          onPress={() => topCardRef.current?.triggerSwipe(Decision.FAVORITE)}
          activeOpacity={0.7}
        >
          <Text style={styles.actionIcon}>♥</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, styles.actionKeep]}
          onPress={() => topCardRef.current?.triggerSwipe(Decision.KEEP)}
          activeOpacity={0.7}
        >
          <Text style={styles.actionIcon}>✓</Text>
        </TouchableOpacity>
      </View>

      {/* ── Bottom bar ── */}
      <View style={styles.bottomBar}>
        <Button
          variant="ghost"
          label="End Session Early"
          onPress={handleEndEarly}
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
    aspectRatio: 3 / 4,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#000000',
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

  // ── Action buttons ─────────────────────────────────────────────────────────
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    paddingVertical: 12,
  },
  actionButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionDelete: {
    borderColor: Colors.destructive,
  },
  actionFav: {
    borderColor: Colors.info,
  },
  actionKeep: {
    borderColor: Colors.success,
  },
  actionIcon: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.textPrimary,
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
