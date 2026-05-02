import { Colors } from '@/constants/theme';
import { useRetentionScheduler } from '@/hooks/useRetentionScheduler';
import { flushPendingWrites } from '@/store/persistence';
import { Stack } from 'expo-router';
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

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') flushPendingWrites();
    });
    return () => sub.remove();
  }, []);

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
            <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
          </Stack>
          <StatusBar style="light" />
        </AppShell>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}