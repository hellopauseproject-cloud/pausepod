import { FontAwesome, FontAwesome5 } from '@expo/vector-icons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { clearPending, getPending } from '../lib/supportQueue';

export default function VoiceScreen() {
  const pickupPlayer = useAudioPlayer(require('../assets/images/Pickupsound.mp3'));
  const voicePlayer = useAudioPlayer(null);
  const hangupPlayer = useAudioPlayer(require('../assets/images/HangUpSound.mp3'));
  const voiceStatus = useAudioPlayerStatus(voicePlayer);

  const [speakerOn, setSpeakerOn] = useState(false);
  const [callerName, setCallerName] = useState('Dig själv');
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
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        if (!mounted) return;
        if (session?.user?.id) {
          const { data: profile } = await supabase
            .from('profiles').select('username, avatar_url').eq('id', session.user.id).maybeSingle();
          if (!mounted) return;
          setCallerName(profile?.username || 'Dig själv');
          if (profile?.avatar_url?.startsWith('https://')) setCallerPhoto(profile.avatar_url);
        }
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

      // Existing behaviour: play from local file
      let audioUri: string | null = null;
      try {
        const savedFiles = await FileSystem.readAsStringAsync(
          FileSystem.documentDirectory + 'selectedFiles.json'
        );
        const { voice } = JSON.parse(savedFiles);
        if (voice) audioUri = voice;
      } catch (e) {}

      if (!mounted) return;

      if (!audioUri) {
        setNoFile(true);
        return;
      }

      voicePlayer.replace({ uri: audioUri });
      voicePlayer.play();
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
    router.push('/pause');
  };

  return (
    <View style={styles.container}>
      <View style={styles.callerInfo}>
        {callerPhoto ? (
          <Image source={{ uri: callerPhoto }} style={styles.avatar} />
        ) : (
          <View style={styles.avatar}>
            <FontAwesome5 name="user" size={48} color="#2e86de" />
          </View>
        )}
        <Text style={styles.callerName}>{callerName}</Text>
        <Text style={styles.callerSubtitle}>
          {noFile ? 'Inget röstmeddelande uppladdat' : showReplay ? 'Meddelandet är slut' : 'Röstsamtal pågår...'}
        </Text>
      </View>

      <View style={styles.buttons}>
        {showReplay && (
          <TouchableOpacity style={styles.replayButton} onPress={handleReplay}>
            <MaterialIcons name="replay" size={32} color="white" />
          </TouchableOpacity>
        )}

        {showPauseLink && (
          <Animated.View style={{ opacity: fadeAnim }}>
            <TouchableOpacity style={styles.pauseBtn} onPress={handlePauseLink} activeOpacity={0.85}>
              <FontAwesome name="pause" size={16} color="white" />
              <Text style={styles.pauseBtnText}>TA EN PAUS</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        <TouchableOpacity
          style={[styles.speakerButton, speakerOn && styles.speakerButtonActive]}
          onPress={toggleSpeaker}
        >
          <FontAwesome5 name="volume-up" size={24} color="white" />
        </TouchableOpacity>

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
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 80,
  },
  callerInfo: { alignItems: 'center' },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#2a2a3e',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    borderWidth: 2,
    borderColor: '#2e86de',
  },
  callerName: {
    fontSize: 36,
    color: 'white',
    fontWeight: 'bold',
    marginBottom: 8,
  },
  callerSubtitle: { fontSize: 18, color: '#aaa' },
  buttons: { alignItems: 'center', gap: 20 },
  replayButton: {
    backgroundColor: '#2a2a3e',
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#2e86de',
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
  speakerButton: {
    alignItems: 'center',
    backgroundColor: '#555',
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
  },
  speakerButtonActive: { backgroundColor: '#2e86de' },
  hangUpButton: {
    backgroundColor: '#e74c3c',
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
