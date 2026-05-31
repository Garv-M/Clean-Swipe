import { Platform } from 'react-native';

// ── Design-system palette ──────────────────────────────────────────────────
export const Colors = {
  primary: '#F97316',
  success: '#22C55E',
  info: '#3B82F6',
  destructive: '#EF4444',
  warning: '#EAB308',
  background: '#1F2937',
  cardBg: '#283548',
  cardFrom: '#283548',  // kept for backward compat during migration
  cardTo: '#283548',    // flattened — no more gradient
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255,255,255,0.45)',
  textTertiary: 'rgba(255,255,255,0.35)',
  border: 'rgba(255,255,255,0.04)',
} as const;

// ── Spacing tokens ───────────────────────────────────────────────────────
export const Spacing = {
  sectionGap: 24,
  cardPadding: 22,
  cardRadius: 18,
  itemGap: 10,
  buttonRadius: 14,
  buttonHeight: 52,
  tileRadius: 6,
  tileGap: 3,
} as const;

// ── Shadow presets ───────────────────────────────────────────────────────
export const Shadows = {
  primaryGlow: {
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 6,
  },
  destructiveGlow: {
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  cardShadow: {
    shadowColor: 'rgba(0,0,0,0.25)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 3,
  },
} as const;

// ── Legacy palette kept for useThemeColor / ThemedText / ThemedView ────────
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
