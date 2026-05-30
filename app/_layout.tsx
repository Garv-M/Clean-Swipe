import { Colors } from '@/constants/theme';
import { useRetentionScheduler } from '@/hooks/useRetentionScheduler';
import { registerBackgroundTask } from '@/services/backgroundTask';
import { NotificationData, requestNotificationPermission } from '@/services/notifications';
import { flushPendingWrites } from '@/store/persistence';
import { useSettingsStore } from '@/store/settings';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../global.css';

export const unstable_settings = {
  anchor: '(tabs)',
};

function AppShell({ children }: { children: React.ReactNode }) {
  useRetentionScheduler();

  const router = useRouter();
  const onboarded = useSettingsStore((s) => s.onboarded);

  // Flush in-memory writes to AsyncStorage whenever the app moves to background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') flushPendingWrites();
    });
    return () => sub.remove();
  }, []);

  // Register the background fetch task once on mount.
  // Silently ignore failures on simulators / environments that don't support it.
  useEffect(() => {
    registerBackgroundTask().catch(() => {});
  }, []);

  // Request notification permission as soon as the user finishes onboarding.
  useEffect(() => {
    if (!onboarded) return;
    requestNotificationPermission().catch(() => {});
  }, [onboarded]);

  // Route the user to the relevant screen when they tap a notification.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as NotificationData | undefined;
      if (!data) return;

      switch (data.type) {
        case 'new_photos':
          router.push('/(tabs)');
          break;
        case 'storage_pressure':
          router.push('/(tabs)');
          break;
        case 'post_trip':
          // Deep-link to home with a highlight param so the cluster card is highlighted.
          router.push({ pathname: '/(tabs)', params: { highlight: data.clusterId } });
          break;
        case 'pending_cleanup':
          router.push('/(tabs)/bin');
          break;
        case 'monthly_digest':
          router.push('/(tabs)');
          break;
      }
    });
    return () => sub.remove();
  }, [router]);

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors.background }}>
      <SafeAreaProvider>
        <AppShell>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="onboarding" options={{ headerShown: false }} />
            <Stack.Screen name="swipe" options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
          </Stack>
          <StatusBar style="light" />
        </AppShell>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}