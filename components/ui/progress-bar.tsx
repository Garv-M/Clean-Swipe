import { Colors } from '@/constants/theme';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

interface ProgressBarProps {
  progress: number;
  color?: string;
  gradientColors?: [string, string];
  height?: number;
}

export function ProgressBar({
  progress,
  color = Colors.primary,
  gradientColors,
  height = 5,
}: ProgressBarProps) {
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const width = useSharedValue(clampedProgress);

  useEffect(() => {
    width.value = withTiming(Math.min(1, Math.max(0, progress)), { duration: 250 });
  }, [progress, width]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: `${width.value * 100}%` as `${number}%`,
  }));

  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }]}>
      <Animated.View style={[{ height, borderRadius: height / 2 }, animatedStyle]}>
        {gradientColors ? (
          <LinearGradient
            colors={gradientColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ flex: 1, borderRadius: height / 2 }}
          />
        ) : (
          <View style={{ flex: 1, backgroundColor: color, borderRadius: height / 2 }} />
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    overflow: 'hidden',
  },
});
