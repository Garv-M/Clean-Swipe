import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { clusterAssets } from '@/services/clustering';
import { batchFetchGPS, fetchAssetsPage, getScreenshotCount, requestPermissions } from '@/services/mediaLibrary';
import { useClusterStore } from '@/store/cluster';
import { useSettingsStore } from '@/store/settings';
import type { Asset } from '@/types';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Dimensions, Linking, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    Extrapolate,
    interpolate,
    runOnJS,
    SharedValue,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── Types ───────────────────────────────────────────────────────────────────

type Step = 'welcome' | 'permissions' | 'scan';

// ─── Constants ───────────────────────────────────────────────────────────────

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const WELCOME_CARDS = [
  {
    icon: '🧹',
    headline: 'Swipe left to delete.\nSwipe right to keep.\nThat\'s it.',
    subtitle: 'Take control of your camera roll in minutes',
  },
  {
    icon: '📍',
    headline: 'We group your photos\ninto smart sessions',
    subtitle: 'Trips, screenshots, WhatsApp saves — all organised',
  },
  {
    icon: '🔒',
    headline: 'Nothing is deleted\nuntil YOU confirm',
    subtitle: 'Review before anything leaves your phone',
  },
];

// ─── CardSlide ────────────────────────────────────────────────────────────────

interface CardSlideProps {
  card: { icon: string; headline: string; subtitle: string };
  index: number;
  translateX: SharedValue<number>;
}

function CardSlide({ card, index, translateX }: CardSlideProps) {
  const animatedStyle = useAnimatedStyle(() => {
    const position = (translateX.value + index * SCREEN_WIDTH) / SCREEN_WIDTH;
    const scale = interpolate(position, [-1, 0, 1], [0.94, 1, 0.94], Extrapolate.CLAMP);
    const opacity = interpolate(position, [-1, 0, 1], [0.45, 1, 0.45], Extrapolate.CLAMP);
    return {
      transform: [{ translateX: translateX.value }, { scale }],
      opacity,
    };
  });

  return (
    <Animated.View style={[styles.card, animatedStyle]}>
      <Text style={styles.cardIcon}>{card.icon}</Text>
      <Text variant="title" style={styles.cardHeadline}>
        {card.headline}
      </Text>
      <Text variant="label" style={styles.cardSubtitle}>
        {card.subtitle}
      </Text>
    </Animated.View>
  );
}

// ─── WelcomeStep ─────────────────────────────────────────────────────────────

interface WelcomeStepProps {
  onComplete: () => void;
}

function WelcomeStep({ onComplete }: WelcomeStepProps) {
  const insets = useSafeAreaInsets();
  const [activeIndex, setActiveIndex] = useState(0);

  const currentIndex = useSharedValue(0);
  const translateX = useSharedValue(0);
  const startX = useSharedValue(0);

  const syncIndex = useCallback((i: number) => setActiveIndex(i), []);

  const pan = Gesture.Pan()
    .onStart(() => {
      startX.value = translateX.value;
    })
    .onUpdate((e) => {
      translateX.value = startX.value + e.translationX;
    })
    .onEnd((e) => {
      const threshold = SCREEN_WIDTH * 0.12;
      let next = currentIndex.value;
      if (e.translationX < -threshold || e.velocityX < -400) {
        next = Math.min(currentIndex.value + 1, WELCOME_CARDS.length - 1);
      } else if (e.translationX > threshold || e.velocityX > 400) {
        next = Math.max(currentIndex.value - 1, 0);
      }
      currentIndex.value = next;
      runOnJS(syncIndex)(next);
      translateX.value = withSpring(-next * SCREEN_WIDTH, {
        damping: 30,
        stiffness: 300,
        overshootClamping: true,
      });
    });

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 32 }]}>
      <View style={styles.cardsContainer}>
        <GestureDetector gesture={pan}>
          <Animated.View style={styles.cardsRow}>
            {WELCOME_CARDS.map((card, i) => (
              <CardSlide key={i} card={card} index={i} translateX={translateX} />
            ))}
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.bottomArea}>
        <View style={styles.dots}>
          {WELCOME_CARDS.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === activeIndex ? styles.dotActive : styles.dotInactive,
              ]}
            />
          ))}
        </View>

        {activeIndex === WELCOME_CARDS.length - 1 && (
          <Button label="Get Started" onPress={onComplete} style={styles.fullWidthBtn} />
        )}
      </View>
    </View>
  );
}
// ─── PermissionsStep ─────────────────────────────────────────────────────────

type PermState = 'idle' | 'requesting' | 'denied';

function PermissionsStep({ onGranted }: { onGranted: () => void }) {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<PermState>('idle');

  const handleRequest = useCallback(async () => {
    setState('requesting');
    try {
      const granted = await requestPermissions();
      if (granted) {
        onGranted();
      } else {
        setState('denied');
      }
    } catch {
      setState('idle');
    }
  }, [onGranted]);

  return (
    <View
      style={[
        styles.container,
        styles.centered,
        { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 32 },
      ]}>
      <View style={styles.permContent}>
        <Text style={styles.cardIcon}>📷</Text>
        <Text variant="title" style={styles.permHeadline}>
          {state === 'denied' ? 'Full access needed' : 'We need your photos to get started'}
        </Text>
        <Text variant="body" style={styles.permBody}>
          {state === 'denied'
            ? 'Full access is needed to show your photos for review. Tap below to open Settings.'
            : 'We need access to show your photos for review. We never upload anything.'}
        </Text>
      </View>
      <View style={styles.permActions}>
        {state === 'denied' ? (
          <Button
            label="Open Settings"
            variant="secondary"
            onPress={() => Linking.openSettings()}
            style={styles.fullWidthBtn}
          />
        ) : (
          <Button
            label="Allow Access"
            onPress={handleRequest}
            disabled={state === 'requesting'}
            style={styles.fullWidthBtn}
          />
        )}
      </View>
    </View>
  );
}

// ─── ScanStep ────────────────────────────────────────────────────────────────

const STATUS_MESSAGES = [
  'Scanning your library...',
  'Extracting locations...',
  'Building clusters...',
  'Almost ready...',
];
const MIN_DISPLAY_MS = 3500;

function ScanStep({ onComplete }: { onComplete: () => void }) {
  const insets = useSafeAreaInsets();
  const setClusters = useClusterStore((s) => s.setClusters);
  const setScanning = useClusterStore((s) => s.setScanning);

  const [totalPhotoScanned, setPhotoScanned] = useState(0);
  const [totalVideoScanned, setVideoScanned] = useState(0);
  const [tripsFound, setTripsFound] = useState(0);
  const [screenshotsFound, setScreenshotsFound] = useState(0);
  // const [gbToReview, setGbToReview] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);
  const [statusIdx, setStatusIdx] = useState(0);
  const [scanDone, setScanDone] = useState(false);

  useEffect(() => {
    const startTime = Date.now();
    let cancelled = false;
    let displayTimer: ReturnType<typeof setTimeout> | undefined;
    const allAssets: Asset[] = [];

    const run = async () => {
      setScanning(true);
      if (__DEV__) console.log('[Scan] ⏱ started');
      let cursor: string | undefined;
      let hasMore = true;

      const screenshotCountPromise = getScreenshotCount();

      while (hasMore) {
        const page = await fetchAssetsPage({ after: cursor, first: 100 });
        if (cancelled) return;
        if (page.assets.length === 0) break;
        allAssets.push(...page.assets);
        cursor = page.endCursor;
        hasMore = page.hasNextPage && cursor != null;
        setPhotoScanned(allAssets.filter((a) => a.kind === 'photo').length);
        setVideoScanned(allAssets.filter((a) => a.kind === 'video').length);
      }

      if (cancelled) return;

      const ssCount = await screenshotCountPromise;
      if (!cancelled) setScreenshotsFound(ssCount);

      const fetchDone = Date.now();
      if (__DEV__) console.log(`[Scan] ⏱ fetch done: ${allAssets.length} assets in ${((fetchDone - startTime) / 1000).toFixed(1)}s`);

      setStatusIdx(1);
      await batchFetchGPS(allAssets);
      if (cancelled) return;

      const gpsDone = Date.now();
      if (__DEV__) {
        const withGPS = allAssets.filter((a) => a.location != null).length;
        console.log(`[Scan] ⏱ GPS done: ${withGPS}/${allAssets.length} have coords in ${((gpsDone - fetchDone) / 1000).toFixed(1)}s`);
      }

      setStatusIdx(2);
      const clusters = await clusterAssets(allAssets, {
        onProgress: (_phase, percent) => {
          if (percent >= 0.8 && !cancelled) setStatusIdx(3);
        },
      });
      setClusters(clusters);

      const clusterDone = Date.now();

      const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
      const tripClusters = clusters.filter(
        (c) => (c.dateRange.to - c.dateRange.from) > TWO_DAYS_MS,
      );
      if (__DEV__) {
        const photos = allAssets.filter((a) => a.kind === 'photo').length;
        const videos = allAssets.filter((a) => a.kind === 'video').length;
        const named = clusters.filter((c) => c.locationName).length;
        console.log(`[Scan] ⏱ clustering done in ${((clusterDone - gpsDone) / 1000).toFixed(1)}s`);
        console.log(`[Scan] ${allAssets.length} assets (${photos} photos, ${videos} videos)`);
        console.log(`[Scan] ${clusters.length} sessions (${named} with location names), ${tripClusters.length} trips`);
        tripClusters.forEach((t) => console.log(`  → ${t.name} (${t.assetCount} assets)`));
        console.log(`[Scan] ⏱ TOTAL: ${((clusterDone - startTime) / 1000).toFixed(1)}s (fetch ${((fetchDone - startTime) / 1000).toFixed(1)}s + GPS ${((gpsDone - fetchDone) / 1000).toFixed(1)}s + cluster ${((clusterDone - gpsDone) / 1000).toFixed(1)}s)`);
      }
      setTripsFound(tripClusters.length);
      setSessionCount(clusters.length);

      const elapsed = Date.now() - startTime;
      const delay = Math.max(0, MIN_DISPLAY_MS - elapsed);
      displayTimer = setTimeout(() => {
        if (!cancelled) setScanDone(true);
      }, delay);
    };

    run().catch(async (err) => {
      if (__DEV__) console.error('[Scan] run() crashed:', err);
      if (cancelled) return;
      if (allAssets.length > 0) {
        const clusters = await clusterAssets(allAssets);
        setClusters(clusters);
        const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
        const tripCount = clusters.filter(
          (c) => (c.dateRange.to - c.dateRange.from) > TWO_DAYS_MS,
        ).length;
        setTripsFound(tripCount);
        setSessionCount(clusters.length);
        setStatusIdx(3);
        setScanDone(true);
      } else {
        setScanning(false);
        setScanDone(true);
      }
    });

    return () => {
      cancelled = true;
      if (displayTimer !== undefined) clearTimeout(displayTimer);
      setScanning(false);
    };
  }, []);

  return (
    <View
      style={[
        styles.container,
        styles.centered,
        { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 32 },
      ]}>
      <View style={styles.scanContent}>
        <Text style={styles.scanBigNumber}>{totalPhotoScanned.toLocaleString()}</Text>
        {scanDone ? (
          <Text variant="body" style={styles.scanReveal}>
            photos — organised into {sessionCount} sessions for you
          </Text>
        ) : (
          <Text variant="label" style={styles.scanLabel}>
            photos scanned
          </Text>
        )}

        <View style={styles.scanTiles}>
          <View style={styles.scanTile}>
            <Text style={[styles.scanTileNum, { color: Colors.success }]}>{tripsFound}</Text>
            <Text variant="caption" style={styles.scanTileLabel}>
              trips found
            </Text>
          </View>
          <View style={styles.scanTile}>
            <Text style={[styles.scanTileNum, { color: Colors.info }]}>{screenshotsFound}</Text>
            <Text variant="caption" style={styles.scanTileLabel}>
              screenshots
            </Text>
          </View>
          <View style={styles.scanTile}>
            <Text style={[styles.scanTileNum, { color: Colors.primary }]}>{totalVideoScanned}</Text>
            <Text variant="caption" style={styles.scanTileLabel}>
              Videos
            </Text>
          </View>
        </View>

        {!scanDone && (
          <Text variant="label" style={styles.scanStatus}>
            {STATUS_MESSAGES[statusIdx]}
          </Text>
        )}
      </View>

      {scanDone && (
        <Button label="Let's Go" onPress={onComplete} style={styles.scanCta} />
      )}
    </View>
  );
}

// ─── OnboardingScreen (state machine) ────────────────────────────────────────

export default function OnboardingScreen() {
  const [step, setStep] = useState<Step>('welcome');
  const completeOnboarding = useSettingsStore((s) => s.completeOnboarding);

  const handleScanComplete = () => {
    completeOnboarding();
    router.replace('/(tabs)');
  };

  return (
    <View style={styles.root}>
      {step === 'welcome' && <WelcomeStep onComplete={() => setStep('permissions')} />}
      {step === 'permissions' && <PermissionsStep onGranted={() => setStep('scan')} />}
      {step === 'scan' && <ScanStep onComplete={handleScanComplete} />}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  cardsContainer: {
    flex: 1,
    overflow: 'hidden',
  },
  cardsRow: {
    flex: 1,
    flexDirection: 'row',
    width: SCREEN_WIDTH * WELCOME_CARDS.length,
  },
  card: {
    width: SCREEN_WIDTH,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  cardIcon: {
    fontSize: 64,
    marginBottom: 24,
  },
  cardHeadline: {
    textAlign: 'center',
    fontSize: 26,
    lineHeight: 34,
    marginBottom: 12,
  },
  cardSubtitle: {
    textAlign: 'center',
    lineHeight: 22,
  },
  bottomArea: {
    paddingHorizontal: 24,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginBottom: 20,
  },
  dot: {
    height: 6,
    borderRadius: 3,
  },
  dotActive: {
    width: 20,
    backgroundColor: Colors.primary,
  },
  dotInactive: {
    width: 6,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  fullWidthBtn: {
    width: '100%',
  },
  centered: {
    justifyContent: 'space-between',
  },
  permContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  permHeadline: {
    textAlign: 'center',
    marginBottom: 12,
  },
  permBody: {
    textAlign: 'center',
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  permActions: {
    paddingHorizontal: 24,
  },
  scanContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  scanBigNumber: {
    fontSize: 56,
    fontWeight: '800',
    color: Colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  scanLabel: {
    marginTop: 4,
    marginBottom: 32,
  },
  scanReveal: {
    textAlign: 'center',
    color: Colors.textSecondary,
    marginTop: 4,
    marginBottom: 32,
    paddingHorizontal: 16,
  },
  scanTiles: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  scanTile: {
    flex: 1,
    backgroundColor: Colors.cardFrom,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  scanTileNum: {
    fontSize: 20,
    fontWeight: '700',
  },
  scanTileLabel: {
    marginTop: 2,
    textAlign: 'center',
  },
  scanStatus: {
    color: Colors.textSecondary,
    marginTop: 8,
  },
  scanCta: {
    marginHorizontal: 24,
    width: undefined,
  },
});
