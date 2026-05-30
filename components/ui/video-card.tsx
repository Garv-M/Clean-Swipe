import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

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
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const progressBarWidthRef = useRef(0);
  const isScrubbingRef = useRef(false);

  const player = useVideoPlayer(uri, (p) => {
    p.muted = true;
    p.timeUpdateEventInterval = 0.1;
  });

  const stop = useCallback(() => {
    player.pause();
    player.currentTime = 0;
    setIsPlaying(false);
    setCurrentTime(0);
  }, [player]);

  useImperativeHandle(ref, () => ({ stop }), [stop]);

  // Auto-play muted when top card; pause otherwise
  useEffect(() => {
    if (isTopCard) {
      player.play();
    } else {
      player.pause();
    }
  }, [isTopCard, player]);

  // Event listeners
  useEffect(() => {
    const playingSub = player.addListener('playingChange', ({ isPlaying: playing }) => {
      setIsPlaying(playing);
    });

    const timeUpdateSub = player.addListener('timeUpdate', ({ currentTime: time }) => {
      if (!isScrubbingRef.current) {
        setCurrentTime(time);
      }
    });

    const playToEndSub = player.addListener('playToEnd', () => {
      setIsPlaying(false);
      player.currentTime = 0;
      setCurrentTime(0);
    });

    const statusSub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') {
        setDuration(player.duration);
      }
    });

    return () => {
      playingSub.remove();
      timeUpdateSub.remove();
      playToEndSub.remove();
      statusSub.remove();
    };
  }, [player]);

  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
    }
  }, [isPlaying, player]);

  const toggleMute = useCallback(() => {
    const next = !isMuted;
    setIsMuted(next);
    player.muted = next;
  }, [isMuted, player]);

  // RNGH Tap gestures — work reliably inside parent GestureDetector
  const playPauseTapGesture = useMemo(
    () =>
      Gesture.Tap().onEnd(() => {
        runOnJS(togglePlayPause)();
      }),
    [togglePlayPause],
  );

  const muteTapGesture = useMemo(
    () =>
      Gesture.Tap().onEnd(() => {
        runOnJS(toggleMute)();
      }),
    [toggleMute],
  );

  // Scrub gesture
  const handleScrubAt = useCallback(
    (x: number) => {
      if (progressBarWidthRef.current <= 0 || duration <= 0) return;
      const ratio = Math.max(0, Math.min(1, x / progressBarWidthRef.current));
      const newTime = ratio * duration;
      setCurrentTime(newTime);
      player.currentTime = newTime;
    },
    [duration, player],
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

  const progress = duration > 0 ? currentTime / duration : 0;
  const showControls = duration > 0;

  return (
    <View style={styles.container}>
      {/* Thumbnail — visible while paused */}
      <Image
        source={uri}
        style={[StyleSheet.absoluteFill, { opacity: isPlaying ? 0 : 1 }]}
        contentFit="contain"
      />

      {/* Video player — no native controls, touches pass through */}
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        nativeControls={false}
        contentFit="contain"
        pointerEvents="none"
      />

      {/* Centered play / pause button */}
      <GestureDetector gesture={playPauseTapGesture}>
        <View style={styles.playPauseButton}>
          <View style={styles.playPauseCircle}>
            <Text style={styles.playPauseIcon}>{isPlaying ? '⏸' : '▶'}</Text>
          </View>
        </View>
      </GestureDetector>

      {/* Bottom controls — mute + scrub bar */}
      {showControls && (
        <View style={styles.bottomControls}>
          <GestureDetector gesture={muteTapGesture}>
            <View style={styles.muteButton}>
              <Text style={styles.muteIcon}>{isMuted ? '🔇' : '🔊'}</Text>
            </View>
          </GestureDetector>

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
