import { Colors } from '@/constants/theme';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

interface ProgressBarProps {
  /** Value between 0 and 1 */
  progress: number;
  color?: string;
}

export function ProgressBar({ progress, color = Colors.primary }: ProgressBarProps) {
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const width = useSharedValue(clampedProgress);

  useEffect(() => {
    width.value = withTiming(Math.min(1, Math.max(0, progress)), { duration: 250 });
  }, [progress, width]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: `${width.value * 100}%` as `${number}%`,
  }));

  return (
    <View style={styles.track}>
      <Animated.View style={[styles.fill, { backgroundColor: color }, animatedStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
  },
});
