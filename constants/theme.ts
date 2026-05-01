import { Platform } from 'react-native';

// ── Design-system palette ──────────────────────────────────────────────────
export const Colors = {
  primary: '#F97316',           // orange
  success: '#22C55E',           // green
  info: '#3B82F6',              // blue
  destructive: '#EF4444',       // red
  background: '#1F2937',        // dark slate
  cardFrom: '#283548',
  cardTo: '#232f3e',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255,255,255,0.45)',
  textTertiary: 'rgba(255,255,255,0.4)',
  border: 'rgba(255,255,255,0.08)',
} as const;

// ── Legacy palette kept for useThemeColor / ThemedText / ThemedView ────────
// The app is dark-only; both "light" and "dark" slots map to the same values
// so existing themed components continue to work without modification.
const legacyPalette = {
  text: '#FFFFFF',
  background: '#1F2937',
  tint: '#F97316',
  icon: '#F97316',
  tabIconDefault: 'rgba(255,255,255,0.45)',
  tabIconSelected: '#F97316',
} as const;

export const LegacyColors = {
  light: legacyPalette,
  dark: legacyPalette,
} as const;

// ── Typography ────────────────────────────────────────────────────────────
export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
