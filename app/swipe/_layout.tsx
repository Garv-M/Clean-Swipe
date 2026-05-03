import { Stack } from 'expo-router';

/**
 * Layout for the swipe session route group.
 *
 * All screens in this group (start, swipe, summary, review) run as a Stack
 * navigator with the header hidden. The tab bar is also hidden while any
 * screen in this group is active — that is handled by `useUIStore` via
 * `setSwipeSessionActive`, which each child screen calls on mount/unmount.
 */
export default function SwipeLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}
