import { create } from 'zustand';

interface UIState {
  isSwipeSessionActive: boolean;
  setSwipeSessionActive: (active: boolean) => void;
}

export const useUIStore = create<UIState>()((set) => ({
  isSwipeSessionActive: false,
  setSwipeSessionActive: (active) => set({ isSwipeSessionActive: active }),
}));
