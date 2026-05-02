import React, { useEffect, useLayoutEffect } from 'react';
import { AppState } from 'react-native';
import { Colors } from '@/constants/theme';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useRetentionScheduler } from '@/hooks/useRetentionScheduler';
import { flushPendingWrites } from '@/store/persistence';
import { useSettingsStore } from '@/store/settings';
import '../global.css';

export const unstable_settings = {
  anchor: '(tabs)',
};

function AppShell({ children }: { children: React.ReactNode }) {
  useRetentionScheduler();

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') flushPendingWrites();
    });
    return () => sub.remove();
  }, []);

  return <>{children}</>;
}

export default function RootLayout() {
  const onboarded = useSettingsStore((s) => s.onboarded);
  const router = useRouter();

  useLayoutEffect(() => {
    if (!onboarded) {
      router.replace('/onboarding');
    }
  }, [onboarded, router]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors.background }}>
      <SafeAreaProvider>
        <AppShell>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="onboarding" options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
          </Stack>
          <StatusBar style="light" />
        </AppShell>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
