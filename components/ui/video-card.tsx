import { AVPlaybackStatus, ResizeMode, Video } from 'expo-av';
import { Image } from 'expo-image';
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { Colors } from '@/constants/theme';
import { Text } from '@/components/ui/text';

export interface VideoCardHandle {
  stop: () => void;
}

interface VideoCardProps {
  uri: string;
  isTopCard: boolean;
}

const VideoCard = forwardRef<VideoCardHandle, VideoCardProps>(function VideoCard(
  { uri, isTopCard },
  ref,
) {
  const videoRef = useRef<Video>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const progressBarWidthRef = useRef(0);
  const isScrubbingRef = useRef(false);

  const stop = useCallback(() => {
    videoRef.current?.stopAsync().catch(() => {});
    setIsPlaying(false);
  }, []);

  useImperativeHandle(ref, () => ({ stop }), [stop]);

  useEffect(() => {
    if (isTopCard) {
      videoRef.current?.playAsync().catch(() => {});
    } else {
      videoRef.current?.pauseAsync().catch(() => {});
    }
  }, [isTopCard]);

  useEffect(() => {
    return () => {
      videoRef.current?.stopAsync().catch(() => {});
    };
  }, []);

  const handleStatus = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    if (!isScrubbingRef.current) {
      setPositionMs(status.positionMillis);
    }
    setDurationMs(status.durationMillis ?? 0);
    setIsPlaying(status.isPlaying);
    if (status.didJustFinish) {
      setIsPlaying(false);
      videoRef.current?.setPositionAsync(0).catch(() => {});
    }
  }, []);

  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      videoRef.current?.pauseAsync().catch(() => {});
    } else {
      videoRef.current?.playAsync().catch(() => {});
    }
  }, [isPlaying]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  const handleScrubAt = useCallback(
    (x: number) => {
      if (progressBarWidthRef.current <= 0 || durationMs <= 0) return;
      const ratio = Math.max(0, Math.min(1, x / progressBarWidthRef.current));
      const newMs = ratio * durationMs;
      setPositionMs(newMs);
      videoRef.current?.setPositionAsync(newMs).catch(() => {});
    },
    [durationMs],
  );

  const startScrubbing = useCallback(() => {
    isScrubbingRef.current = true;
  }, []);

  const stopScrubbing = useCallback(() => {
    isScrubbingRef.current = false;
  }, []);

  const scrubGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onStart((e) => {
          runOnJS(startScrubbing)();
          runOnJS(handleScrubAt)(e.x);
        })
        .onUpdate((e) => {
          runOnJS(handleScrubAt)(e.x);
        })
        .onEnd(() => {
          runOnJS(stopScrubbing)();
        }),
    [handleScrubAt, startScrubbing, stopScrubbing],
  );

  const progress = durationMs > 0 ? positionMs / durationMs : 0;
  const showControls = durationMs > 0;

  return (
    <View style={styles.container}>
      <Image
        source={uri}
        style={[StyleSheet.absoluteFill, { opacity: isPlaying ? 0 : 1 }]}
        contentFit="contain"
      />

      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Video
          ref={videoRef}
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          resizeMode={ResizeMode.CONTAIN}
          onPlaybackStatusUpdate={handleStatus}
          isMuted={isMuted}
        />
      </View>

      <Pressable
        onPress={togglePlayPause}
        style={styles.playPauseButton}
        hitSlop={{ top: 24, bottom: 24, left: 24, right: 24 }}
      >
        <View style={styles.playPauseCircle}>
          <Text style={styles.playPauseIcon}>{isPlaying ? '⏸' : '▶'}</Text>
        </View>
      </Pressable>

      {showControls && (
        <View style={styles.bottomControls}>
          <Pressable
            onPress={toggleMute}
            style={styles.muteButton}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={styles.muteIcon}>{isMuted ? '🔇' : '🔊'}</Text>
          </Pressable>

          <GestureDetector gesture={scrubGesture}>
            <View
              style={styles.progressTouchArea}
              onLayout={(e) => {
                progressBarWidthRef.current = e.nativeEvent.layout.width;
              }}
            >
              <View style={styles.progressTrack}>
                <View
                  style={[styles.progressFill, { width: `${progress * 100}%` as any }]}
                />
              </View>
              <View
                style={[styles.scrubThumb, { left: `${progress * 100}%` as any }]}
              />
            </View>
          </GestureDetector>
        </View>
      )}
    </View>
  );
});

export default VideoCard;

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: '100%',
  },
  playPauseButton: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -40 }, { translateY: -40 }],
  },
  playPauseCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playPauseIcon: {
    fontSize: 32,
    color: '#FFFFFF',
    marginLeft: 4,
  },
  bottomControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.45)',
    gap: 10,
  },
  muteButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  muteIcon: {
    fontSize: 18,
    color: '#FFFFFF',
  },
  progressTouchArea: {
    flex: 1,
    height: 28,
    justifyContent: 'center',
  },
  progressTrack: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 2,
  },
  scrubThumb: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#FFFFFF',
    top: '50%',
    transform: [{ translateX: -7 }, { translateY: -7 }],
  },
});
