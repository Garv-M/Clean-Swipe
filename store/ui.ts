import { create } from 'zustand';

interface UIState {
  isSwipeSessionActive: boolean;
  /** Explicit tab-bar visibility flag. Mirrors !isSwipeSessionActive but is independently settable. */
  tabBarVisible: boolean;
  setSwipeSessionActive: (active: boolean) => void;
  setTabBarVisible: (visible: boolean) => void;
}

export const useUIStore = create<UIState>()((set) => ({
  isSwipeSessionActive: false,
  tabBarVisible: true,
  setSwipeSessionActive: (active) => set({ isSwipeSessionActive: active, tabBarVisible: !active }),
  setTabBarVisible: (visible) => set({ tabBarVisible: visible }),
}));
