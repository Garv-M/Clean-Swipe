import { Tabs } from 'expo-router';
import React from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useTrashStore } from '@/store/trash';
import { useUIStore } from '@/store/ui';

export default function TabLayout() {
  const isSwipeSessionActive = useUIStore((state) => state.isSwipeSessionActive);
  const stagedCount = useTrashStore((s) => s.staged.length);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textSecondary,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: isSwipeSessionActive
          ? { display: 'none' as const }
          : {
              backgroundColor: Colors.background,
              borderTopColor: Colors.border,
              borderTopWidth: 1,
            },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="house.fill" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="bin"
        options={{
          title: 'Bin',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="trash.fill" color={color} />
          ),
          tabBarBadge: stagedCount > 0 ? stagedCount : undefined,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="person.fill" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
