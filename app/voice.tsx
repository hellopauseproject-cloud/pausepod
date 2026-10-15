import { FontAwesome, FontAwesome5 } from '@expo/vector-icons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { openPauseStart } from '../lib/pauseFlow';
import { supabase } from '../lib/supabase';
import { clearPending, getPending } from '../lib/supportQueue';
import { AppPalette, Radius } from '../constants/appTheme';
import { RoomProvider, usePalette } from '../contexts/ThemeContext';
import { roomShell, ScreenBackground } from '../components/screen-background';

/**
 * Hör till **friends-rummet**. Rummet följer ärendet och inte filträdet — se
 * ROOMS i [constants/appTheme.ts](../constants/appTheme.ts). Skalet är
 * identiskt med de andra rummens: en komponent kan inte läsa sin egen
 * provider, och en bakgrund i skalet täcker varje gren skärmen returnerar.
 */
export default function VoiceRoom() {
  return (
    <RoomProvider room="friends">
      <View style={roomShell}>
        <ScreenBackground room="friends" />
        <VoiceScreen />
      </View>
    </RoomProvider>
  );
}

function VoiceScreen() {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  const pickupPlayer = useAudioPlayer(require('../assets/images/Pickupsound.mp3'));
  const voicePlayer = useAudioPlayer(null);
  const hangupPlayer = useAudioPlayer(require('../assets/images/HangUpSound.mp3'));
  const voiceStatus = useAudioPlayerStatus(voicePlayer);

  const [speakerOn, setSpeakerOn] = useState(false);
  const [callerName, setCallerName] = useState('');
  const [callerPhoto, setCallerPhoto] = useState<string | null>(null);
  const [noFile, setNoFile] = useState(false);
  const [showReplay, setShowReplay] = useState(false);
  const [showPauseLink, setShowPauseLink] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const markedRef = useRef(false);
  const supportResponseIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (voiceStatus.didJustFinish) {
      setShowReplay(true);
    }
  }, [voiceStatus.didJustFinish]);

  // Mark support response as played when audio starts
  useEffect(() => {
    if (voiceStatus.playing && !markedRef.current) {
      const pending = getPending();
      if (pending?.responseType === 'voice') {
        markedRef.current = true;
        const now = new Date().toISOString();
        supabase.from('support_responses').update({ delivered_at: now, played_at: now }).eq('id', pending.id);
        clearPending();
      }
    }
  }, [voiceStatus.playing]);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const pending = getPending();

      if (pending?.responseType === 'voice') {
        supportResponseIdRef.current = pending.id;
        setCallerName(pending.senderName);
        if (pending.senderAvatarUrl) setCallerPhoto(pending.senderAvatarUrl);
      }

      if (!mounted) return;
      await new Promise(resolve => setTimeout(resolve, 600));
      if (!mounted) return;

      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        interruptionMode: 'duckOthers',
        shouldRouteThroughEarpiece: true,
      });

      if (!mounted) return;
      pickupPlayer.play();
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (!mounted) return;

      // Support response: play from URL
      if (pending?.responseType === 'voice' && pending.contentUrl) {
        voicePlayer.replace({ uri: pending.contentUrl });
        voicePlayer.play();
        return;
      }

      setNoFile(true);
    };

    load();

    const pauseTimer = setTimeout(() => {
      if (!mounted) return;
      setShowPauseLink(true);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }).start();
    }, 1500);

    return () => {
      mounted = false;
      clearTimeout(pauseTimer);
      try { voicePlayer.pause(); } catch {}
    };
  }, []);

  const handleReplay = async () => {
    setShowReplay(false);
    await voicePlayer.seekTo(0);
    voicePlayer.play();
  };

  const toggleSpeaker = async () => {
    const newSpeakerOn = !speakerOn;
    setSpeakerOn(newSpeakerOn);
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      interruptionMode: 'duckOthers',
      shouldRouteThroughEarpiece: !newSpeakerOn,
    });
  };

  const handleHangUp = async () => {
    voicePlayer.pause();
    // Guarantee DB write is committed before navigating back (idempotent update)
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
    voicePlayer.pause();
    if (supportResponseIdRef.current) {
      const ts = new Date().toISOString();
      await supabase.from('support_responses').update({ delivered_at: ts, played_at: ts }).eq('id', supportResponseIdRef.current);
      supportResponseIdRef.current = null;
    }
    openPauseStart('push');
  };

  return (
    <View style={styles.container}>
      <View style={styles.callerInfo}>
        {callerPhoto ? (
          <Image source={{ uri: callerPhoto }} style={styles.avatar} />
        ) : (
          <View style={styles.avatar}>
            <FontAwesome5 name="user" size={48} color={Palette.accent} />
          </View>
        )}
        <Text style={styles.callerName}>{callerName}</Text>
        <Text style={styles.callerSubtitle}>
          {noFile ? 'No message to play' : showReplay ? 'Message finished' : 'Call in progress...'}
        </Text>
      </View>

      <View style={styles.buttons}>
        {showReplay && (
          <TouchableOpacity style={styles.replayButton} onPress={handleReplay}>
            <MaterialIcons name="replay" size={32} color={Palette.onAccent} />
          </TouchableOpacity>
        )}

        {showPauseLink && (
          <Animated.View style={{ opacity: fadeAnim }}>
            <TouchableOpacity style={styles.pauseBtn} onPress={handlePauseLink} activeOpacity={0.85}>
              <FontAwesome name="pause" size={16} color={Palette.onAccent} />
              <Text style={styles.pauseBtnText}>TAKE A PAUSE</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        <TouchableOpacity
          style={[styles.speakerButton, speakerOn && styles.speakerButtonActive]}
          onPress={toggleSpeaker}
        >
          <FontAwesome5 name="volume-up" size={24} color={Palette.onAccent} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.hangUpButton} onPress={handleHangUp}>
          <FontAwesome name="phone" size={32} color={Palette.onAccent} style={{ transform: [{ rotate: '135deg' }] }} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (Palette: AppPalette) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 80,
  },
  callerInfo: { alignItems: 'center' },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: Palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    borderWidth: 2,
    borderColor: Palette.accent,
  },
  callerName: {
    fontSize: 36,
    color: Palette.textPrimary,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  callerSubtitle: { fontSize: 18, color: Palette.textSecondary },
  buttons: { alignItems: 'center', gap: 20 },
  replayButton: {
    backgroundColor: Palette.surface,
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Palette.accent,
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
    color: Palette.onAccent,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 3,
  },
  speakerButton: {
    alignItems: 'center',
    backgroundColor: Palette.textFaint,
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
  },
  speakerButtonActive: { backgroundColor: Palette.accent },
  hangUpButton: {
    backgroundColor: Palette.danger,
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
