import { FontAwesome } from '@expo/vector-icons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import { router } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { clearPending, getPending } from '../lib/supportQueue';

export default function VideoScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [showPauseLink, setShowPauseLink] = useState(false);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [noFile, setNoFile] = useState(false);
  const [showReplay, setShowReplay] = useState(false);
  const [callerName, setCallerName] = useState<string | null>(null);
  const fadeAnim = useState(new Animated.Value(0))[0];
  const supportResponseIdRef = useRef<string | null>(null);

  const pickupPlayer = useAudioPlayer(require('../assets/images/Pickupsound.mp3'));
  const hangupPlayer = useAudioPlayer(require('../assets/images/HangUpSound.mp3'));
  const videoEndedRef = useRef(false);

  useEffect(() => {
    const setup = async () => {
      const pending = getPending();

      // Support video response: play from URL
      if (pending?.responseType === 'video' && pending.contentUrl) {
        supportResponseIdRef.current = pending.id;
        setCallerName(pending.senderName);
        setVideoUri(pending.contentUrl);
        setVideoReady(true);
        clearPending();
        await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'doNotMix', shouldRouteThroughEarpiece: false });
        pickupPlayer.play();
        return;
      }

      // Existing behaviour: play from local file
      try {
        const savedFiles = await FileSystem.readAsStringAsync(
          FileSystem.documentDirectory + 'selectedFiles.json'
        );
        const { video } = JSON.parse(savedFiles);
        if (video) {
          setVideoUri(video);
        } else {
          setNoFile(true);
        }
      } catch (e) {
        setNoFile(true);
      }

      setVideoReady(true);

      await setAudioModeAsync({
        playsInSilentMode: true,
        interruptionMode: 'doNotMix',
        shouldRouteThroughEarpiece: false,
      });
      pickupPlayer.play();
    };
    setup();

    const pauseTimer = setTimeout(() => {
      setShowPauseLink(true);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }).start();
    }, 1500);

    return () => clearTimeout(pauseTimer);
  }, []);

  const player = useVideoPlayer(
    videoReady && videoUri ? { uri: videoUri } : null,
    (player) => {
      if (videoReady && videoUri) player.play();
    }
  );

  useEffect(() => {
    if (!videoReady || !videoUri) return;
    videoEndedRef.current = false;
    player.play();
    // iOS: pickup sound briefly claims the audio session (doNotMix) and interrupts the video
    // player. When the pickup sound ends the video doesn't auto-resume, so we re-trigger play.
    const iosResumeTimer = setTimeout(() => {
      if (!videoEndedRef.current) player.play();
    }, 1500);
    const subscription = player.addListener('playToEnd', () => {
      videoEndedRef.current = true;
      setShowReplay(true);
    });
    return () => {
      clearTimeout(iosResumeTimer);
      subscription.remove();
    };
  }, [videoReady, videoUri]);

  const handleHangUp = async () => {
    if (videoUri) player.pause();
    if (supportResponseIdRef.current) {
      const ts = new Date().toISOString();
      await supabase.from('support_responses').update({ delivered_at: ts, played_at: ts }).eq('id', supportResponseIdRef.current);
      supportResponseIdRef.current = null;
    }
    try {
      hangupPlayer.play();
      setTimeout(() => {
        router.replace('/(tabs)');
      }, 400);
    } catch (e) {
      router.replace('/(tabs)');
    }
  };

  const handlePauseLink = async () => {
    if (videoUri) player.pause();
    if (supportResponseIdRef.current) {
      const ts = new Date().toISOString();
      await supabase.from('support_responses').update({ delivered_at: ts, played_at: ts }).eq('id', supportResponseIdRef.current);
      supportResponseIdRef.current = null;
    }
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'doNotMix',
      shouldRouteThroughEarpiece: false,
    });
    router.push('/pause');
  };

  if (!permission) return <View />;

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={{ color: 'white', marginBottom: 20 }}>Appen behöver tillgång till kameran</Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={{ color: 'white' }}>Tillåt kamera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Video area fills remaining space above controls */}
      {noFile ? (
        <View style={styles.noFilePlaceholder}>
          <Text style={styles.noFileText}>Ingen videofil uppladdad</Text>
        </View>
      ) : (
        <View style={styles.videoWrapper}>
          <VideoView
            style={styles.video}
            player={player}
            nativeControls={false}
          />
          {/* PiP camera — bottom-right corner of the video */}
          <View style={styles.cameraContainer}>
            <View style={styles.cameraInner}>
              <CameraView style={styles.camera} facing="front" />
            </View>
          </View>
          {showReplay && (
            <TouchableOpacity
              style={styles.replayOverlay}
              onPress={() => {
                player.replay();
                setShowReplay(false);
              }}
            >
              <MaterialIcons name="replay" size={64} color="white" />
            </TouchableOpacity>
          )}
        </View>
      )}

      {!!callerName && (
        <View style={styles.callerOverlay}>
          <Text style={styles.callerOverlayText}>Pepp från {callerName}</Text>
        </View>
      )}

      {/* Black controls area — pause button top, hang-up below, both centered */}
      <View style={[styles.controlsArea, { paddingBottom: insets.bottom || 20 }]}>
        {showPauseLink && (
          <Animated.View style={{ opacity: fadeAnim }}>
            <TouchableOpacity style={styles.pauseBtn} onPress={handlePauseLink} activeOpacity={0.85}>
              <FontAwesome name="pause" size={16} color="white" />
              <Text style={styles.pauseBtnText}>TA EN PAUS</Text>
            </TouchableOpacity>
          </Animated.View>
        )}
        <TouchableOpacity style={styles.hangUpButton} onPress={handleHangUp}>
          <FontAwesome name="phone" size={32} color="white" style={{ transform: [{ rotate: '135deg' }] }} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  videoWrapper: {
    flex: 1,
    width: '100%',
  },
  video: {
    width: '100%',
    flex: 1,
  },
  noFilePlaceholder: {
    flex: 1,
    width: '100%',
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlsArea: {
    width: '100%',
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingTop: 20,
  },
  noFileText: {
    color: '#aaa',
    fontSize: 16,
  },
  cameraContainer: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    width: 90,
    height: 130,
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'white',
    backgroundColor: 'black',
  },
  cameraInner: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: 4,
  },
  camera: { flex: 1 },
  replayOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pauseBtn: {
    backgroundColor: '#2e86de',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 40,
    shadowColor: '#2e86de',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  pauseBtnText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 3,
  },
  hangUpButton: {
    backgroundColor: '#e74c3c',
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionButton: {
    marginTop: 20,
    backgroundColor: '#2e86de',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callerOverlay: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    zIndex: 10,
  },
  callerOverlayText: {
    color: '#c4b5fd',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
