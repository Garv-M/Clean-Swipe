// utils/responsive.ts
import { Dimensions, PixelRatio } from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const BASE_WIDTH = 390; // iPhone 14 reference

/**
 * Scale a pixel value proportionally to screen width.
 * On a 390px screen, returns the input unchanged.
 */
export function scale(size: number): number {
  return (SCREEN_WIDTH / BASE_WIDTH) * size;
}

/**
 * Scale a font size respecting the user's accessibility font scale setting.
 */
export function scaledFont(size: number): number {
  const scaled = scale(size);
  const fontScale = PixelRatio.getFontScale();
  return scaled * fontScale;
}

/**
 * Horizontal padding as percentage of screen width.
 * Default 5.1% ≈ 20px on a 390px screen.
 */
export const HORIZONTAL_PADDING = SCREEN_WIDTH * 0.051;
