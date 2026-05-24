import { Colors } from '@/constants/theme';
import { Text } from '@/components/ui/text';
import { formatBytes } from '@/utils/format';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

const PHOTO_COLOR = Colors.primary;
const VIDEO_COLOR = Colors.info;
const BAR_HEIGHT = 10;
const ANIMATION_DURATION = 600;

interface StorageBarProps {
  photoBytes: number;
  videoBytes: number;
}

export function StorageBar({ photoBytes, videoBytes }: StorageBarProps) {
  const total = photoBytes + videoBytes;
  const photoFraction = total > 0 ? photoBytes / total : 0;
  const videoFraction = total > 0 ? videoBytes / total : 0;

  const photoWidth = useSharedValue(0);
  const videoWidth = useSharedValue(0);

  useEffect(() => {
    photoWidth.value = withTiming(photoFraction, { duration: ANIMATION_DURATION });
    videoWidth.value = withTiming(videoFraction, { duration: ANIMATION_DURATION });
  }, [photoFraction, videoFraction, photoWidth, videoWidth]);

  const photoStyle = useAnimatedStyle(() => ({
    width: `${photoWidth.value * 100}%` as `${number}%`,
  }));

  const videoStyle = useAnimatedStyle(() => ({
    width: `${videoWidth.value * 100}%` as `${number}%`,
  }));

  return (
    <View style={styles.container}>
      {/* Segmented bar */}
      <View style={styles.track}>
        <Animated.View
          style={[styles.segment, { backgroundColor: PHOTO_COLOR, borderTopLeftRadius: BAR_HEIGHT / 2, borderBottomLeftRadius: BAR_HEIGHT / 2 }, photoStyle]}
        />
        <Animated.View
          style={[styles.segment, { backgroundColor: VIDEO_COLOR, borderTopRightRadius: BAR_HEIGHT / 2, borderBottomRightRadius: BAR_HEIGHT / 2 }, videoStyle]}
        />
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: PHOTO_COLOR }]} />
          <Text variant="caption">Photos · {formatBytes(photoBytes)}</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: VIDEO_COLOR }]} />
          <Text variant="caption">Videos · {formatBytes(videoBytes)}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  track: {
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  segment: {
    height: '100%',
  },
  legend: {
    flexDirection: 'row',
    gap: 16,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
