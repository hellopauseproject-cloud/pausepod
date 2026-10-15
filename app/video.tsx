import { FontAwesome } from '@expo/vector-icons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openPauseStart } from '../lib/pauseFlow';
import { supabase } from '../lib/supabase';
import { clearPending, getPending } from '../lib/supportQueue';
import { AppPalette, Radius } from '../constants/appTheme';
import { usePalette } from '../contexts/ThemeContext';

export default function VideoScreen() {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
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

      setNoFile(true);
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
    openPauseStart('push');
  };

  if (!permission) return <View />;

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={{ color: 'white', marginBottom: 20 }}>The app needs access to the camera</Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={{ color: 'white' }}>Allow camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Video area fills remaining space above controls */}
      {noFile ? (
        <View style={styles.noFilePlaceholder}>
          <Text style={styles.noFileText}>No message to play</Text>
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
          <Text style={styles.callerOverlayText}>Support from {callerName}</Text>
        </View>
      )}

      {/* Black controls area — pause button top, hang-up below, both centered */}
      <View style={[styles.controlsArea, { paddingBottom: insets.bottom || 20 }]}>
        {showPauseLink && (
          <Animated.View style={{ opacity: fadeAnim }}>
            <TouchableOpacity style={styles.pauseBtn} onPress={handlePauseLink} activeOpacity={0.85}>
              <FontAwesome name="pause" size={16} color="white" />
              <Text style={styles.pauseBtnText}>TAKE A PAUSE</Text>
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

// Den här skärmen byter aldrig läge. Bakgrunden är kamerabilden, inte en yta
// appen målar, och allt som ligger ovanpå den (svart botten bakom, vit
// chrome framför) måste stå kvar mot en bild vi inte känner färgen på. Ett
// ljust tema hade gett vit text på video. Därför är literalerna här med flit
// literaler — det är inte färger som glömdes bort i temaomläggningen.
const makeStyles = (Palette: AppPalette) => StyleSheet.create({
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
    color: Palette.textSecondary,
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
    backgroundColor: Palette.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pauseBtn: {
    backgroundColor: Palette.accent,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: Radius.pill,
    ...Palette.cardShadow,
  },
  pauseBtnText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 3,
  },
  hangUpButton: {
    backgroundColor: Palette.danger,
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionButton: {
    marginTop: 20,
    backgroundColor: Palette.accent,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callerOverlay: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    backgroundColor: Palette.scrim,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    zIndex: 10,
  },
  callerOverlayText: {
    color: Palette.communitySoft,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
