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

  const handleRequest = async () => {
    setState('requesting');
    const granted = await requestPermissions();
    if (granted) {
      onGranted();
    } else {
      setState('denied');
    }
  };

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

// ─── ScanStep (stub) ─────────────────────────────────────────────────────────

function ScanStep({ onComplete }: { onComplete: () => void }) {
  return (
    <View style={styles.container}>
      <Text variant="title">Scan placeholder</Text>
      <Button label="Skip (dev)" onPress={onComplete} />
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
});
