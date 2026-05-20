import { Entypo, FontAwesome, FontAwesome5 } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, Image, StyleSheet, Text, TouchableOpacity, Vibration, View } from 'react-native';
import { isInboxActive } from '../lib/inboxGuard';
import { getProfile } from './userProfile';

const VIBRATION_PATTERN = [0, 200, 1200, 200, 1200, 200, 1200, 200, 1200];

export default function CallScreen() {
  const soundRef = useRef<Audio.Sound | null>(null);
  const [callerName, setCallerName] = useState('');
  const [callerPhoto, setCallerPhoto] = useState<string | null>(null);

  // Om placeinbox är aktiv ska /call aldrig visas (NFC deep link-kapning)
  useEffect(() => {
    if (isInboxActive()) {
      return; // Gör ingenting — placeinbox hanterar sin egen navigering
    }
  }, []);

  useEffect(() => {
    const loadProfile = async () => {
      const profile = await getProfile();
      setCallerName(profile.name);
      setCallerPhoto(profile.photoUri);
    };
    loadProfile();

    const startAudio = async () => {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
        });
        const { sound } = await Audio.Sound.createAsync(
          require('../assets/images/Ringsignal.mp3'),
          { isLooping: true }
        );
        soundRef.current = sound;
        await sound.playAsync();
      } catch (e) {
        console.log('Audio error:', e);
      }
      Vibration.vibrate(VIBRATION_PATTERN, true);
    };

    if (AppState.currentState === 'active') {
      setTimeout(startAudio, 1000);
    } else {
      
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          sub.remove();
          setTimeout(startAudio, 500);
        }
      });
      return () => {
        sub.remove();
        Vibration.cancel();
        soundRef.current?.stopAsync().then(() => {
          soundRef.current?.unloadAsync();
          soundRef.current = null;
        });
      };
    }

    return () => {
      Vibration.cancel();
      soundRef.current?.stopAsync().then(() => {
        soundRef.current?.unloadAsync();
        soundRef.current = null;
      });
    };
  }, []);

  const stopRinging = async () => {
    Vibration.cancel();
    try {
      await soundRef.current?.stopAsync();
      await soundRef.current?.unloadAsync();
      soundRef.current = null;
    } catch (e) {}
    await new Promise(resolve => setTimeout(resolve, 300));
  };

  const handleVoiceCall = async () => {
    await stopRinging();
    router.push('/voice');
  };

  const handleVideoCall = async () => {
    await stopRinging();
    router.push('/video');
  };

  const handleHangUp = async () => {
    await stopRinging();
    router.replace('/(tabs)');
  };

  return (
    <View style={styles.container}>
      <View style={styles.logoContainer}>
        <FontAwesome name="pause" size={16} color="#2e86de" />
        <Text style={styles.appName}>PAUSE POD</Text>
      </View>

      <View style={styles.callerInfo}>
        {callerPhoto ? (
          <Image source={{ uri: callerPhoto }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <FontAwesome5 name="user" size={48} color="#2e86de" />
          </View>
        )}
        <Text style={styles.callerName}>{callerName || 'Dig själv'}</Text>
        <Text style={styles.callerSubtitle}>Inkommande samtal...</Text>
      </View>

      <View style={styles.buttons}>
        <View style={styles.buttonRow}>
          {/* Video-knapp */}
          <TouchableOpacity style={styles.videoButton} onPress={handleVideoCall}>
            <FontAwesome5 name="video" size={28} color="white" />
          </TouchableOpacity>
          {/* Röst-knapp */}
          <TouchableOpacity style={styles.voiceButton} onPress={handleVoiceCall}>
            <FontAwesome5 name="phone-alt" size={28} color="white" />
          </TouchableOpacity>
        </View>
        {/* Lägg på */}
        <TouchableOpacity style={styles.hangUpButton} onPress={handleHangUp}>
          <Entypo name="block" size={28} color="white" />
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
    paddingVertical: 50,
    marginBottom: 50,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  appName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2e86de',
    letterSpacing: 4,
    lineHeight: 16,
  },
  callerInfo: {
    alignItems: 'center',
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    marginBottom: 30,
  },
  avatarPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#2a2a3e',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 30,
    borderWidth: 2,
    borderColor: '#2e86de',
  },
  callerName: {
    fontSize: 36,
    color: 'white',
    fontWeight: 'bold',
    marginBottom: 8,
  },
  callerSubtitle: {
    fontSize: 18,
    color: '#aaa',
  },
  buttons: {
    alignItems: 'center',
    gap: 40,
    marginBottom: 40,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 60,
  },
  voiceButton: {
    backgroundColor: '#2ecc71',
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoButton: {
    backgroundColor: '#2e86de',
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hangUpButton: {
    backgroundColor: '#e74c3c',
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
