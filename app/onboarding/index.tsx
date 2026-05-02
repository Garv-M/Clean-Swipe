import React, { useCallback, useEffect, useState } from 'react';
import { Dimensions, Linking, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { useSettingsStore } from '@/store/settings';
import { useClusterStore } from '@/store/cluster';
import { requestPermissions, fetchAssetsPage } from '@/services/mediaLibrary';
import { clusterAssets } from '@/services/clustering';
import type { Asset } from '@/types';

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

// ─── WelcomeStep ─────────────────────────────────────────────────────────────

interface WelcomeStepProps {
  onComplete: () => void;
}

function WelcomeStep({ onComplete }: WelcomeStepProps) {
  const insets = useSafeAreaInsets();
  const [activeIndex, setActiveIndex] = useState(0);
  const currentIndex = useSharedValue(0);
  const translateX = useSharedValue(0);

  const syncIndex = useCallback((i: number) => setActiveIndex(i), []);

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = -currentIndex.value * SCREEN_WIDTH + e.translationX;
    })
    .onEnd((e) => {
      const threshold = SCREEN_WIDTH * 0.3;
      let next = currentIndex.value;
      if (e.translationX < -threshold && currentIndex.value < WELCOME_CARDS.length - 1) {
        next = currentIndex.value + 1;
      } else if (e.translationX > threshold && currentIndex.value > 0) {
        next = currentIndex.value - 1;
      }
      currentIndex.value = next;
      runOnJS(syncIndex)(next);
      translateX.value = withSpring(-next * SCREEN_WIDTH, { damping: 20, stiffness: 150 });
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 32 }]}>
      <View style={styles.cardsContainer}>
        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.cardsRow, animatedStyle]}>
            {WELCOME_CARDS.map((card, i) => (
              <View key={i} style={styles.card}>
                <Text style={styles.cardIcon}>{card.icon}</Text>
                <Text variant="title" style={styles.cardHeadline}>
                  {card.headline}
                </Text>
                <Text variant="label" style={styles.cardSubtitle}>
                  {card.subtitle}
                </Text>
              </View>
            ))}
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.bottomArea}>
        <View style={styles.dots}>
          {WELCOME_CARDS.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i === activeIndex ? styles.dotActive : styles.dotInactive]}
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
  'Analyzing your library...',
  'Extracting GPS data...',
  'Grouping into sessions...',
  'Almost ready...',
];
const MIN_DISPLAY_MS = 2500;

function ScanStep({ onComplete }: { onComplete: () => void }) {
  const insets = useSafeAreaInsets();
  const setClusters = useClusterStore((s) => s.setClusters);
  const setScanning = useClusterStore((s) => s.setScanning);

  const [totalScanned, setTotalScanned] = useState(0);
  const [tripsFound, setTripsFound] = useState(0);
  const [screenshotsFound, setScreenshotsFound] = useState(0);
  const [gbToReview, setGbToReview] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);
  const [statusIdx, setStatusIdx] = useState(0);
  const [scanDone, setScanDone] = useState(false);

  useEffect(() => {
    const startTime = Date.now();
    let cancelled = false;

    const statusTimer = setInterval(() => {
      if (!cancelled) setStatusIdx((i) => Math.min(i + 1, STATUS_MESSAGES.length - 1));
    }, 700);

    const run = async () => {
      setScanning(true);
      let cursor: string | undefined;
      const allAssets: Asset[] = [];
      let screenshots = 0;
      let totalBytes = 0;

      do {
        const page = await fetchAssetsPage({ after: cursor, first: 50 });
        if (cancelled) return;
        allAssets.push(...page.assets);
        screenshots += page.assets.filter((a) => a.filename.startsWith('Screenshot')).length;
        totalBytes += page.assets.reduce((s, a) => s + (a.bytes ?? 3_000_000), 0);
        cursor = page.endCursor;
        setTotalScanned(allAssets.length);
        setScreenshotsFound(screenshots);
        setGbToReview(Math.round((totalBytes / 1e9) * 10) / 10);
      } while (cursor);

      const clusters = clusterAssets(allAssets);
      setClusters(clusters);

      const trips = clusters.filter((c) => c.source == null).length;
      setTripsFound(trips);
      setSessionCount(clusters.length);

      const elapsed = Date.now() - startTime;
      const delay = Math.max(0, MIN_DISPLAY_MS - elapsed);
      setTimeout(() => {
        if (!cancelled) setScanDone(true);
      }, delay);
    };

    run()
      .catch(() => {
        if (!cancelled) setScanDone(true);
      })
      .finally(() => clearInterval(statusTimer));

    return () => {
      cancelled = true;
      clearInterval(statusTimer);
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
        <Text style={styles.scanBigNumber}>{totalScanned.toLocaleString()}</Text>
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
            <Text style={[styles.scanTileNum, { color: Colors.primary }]}>{gbToReview} GB</Text>
            <Text variant="caption" style={styles.scanTileLabel}>
              to review
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
