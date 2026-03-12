import { FontAwesome, FontAwesome5 } from '@expo/vector-icons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getProfile } from './userProfile';

export default function VoiceScreen() {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [speakerOn, setSpeakerOn] = useState(false);
  const [callerName, setCallerName] = useState('Dig själv');
  const [noFile, setNoFile] = useState(false);
  const [showReplay, setShowReplay] = useState(false);
  const [showPauseLink, setShowPauseLink] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    const load = async () => {
      const profile = await getProfile();
      setCallerName(profile.name || 'Dig själv');

      await new Promise(resolve => setTimeout(resolve, 600));

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: true,
      });

      const { sound: pickupSound } = await Audio.Sound.createAsync(
        require('../assets/images/Pickupsound.mp3')
      );
      await pickupSound.playAsync();
      await new Promise(resolve => setTimeout(resolve, 1000));
      await pickupSound.unloadAsync();

      let audioUri: { uri: string } | null = null;
      try {
        const savedFiles = await FileSystem.readAsStringAsync(
          FileSystem.documentDirectory + 'selectedFiles.json'
        );
        const { voice } = JSON.parse(savedFiles);
        if (voice) audioUri = { uri: voice };
      } catch (e) {}

      if (!audioUri) {
        setNoFile(true);
        return;
      }

      const { sound } = await Audio.Sound.createAsync(audioUri);
      soundRef.current = sound;
      setSound(sound);

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          setShowReplay(true);
        }
      });

      await sound.playAsync();
    };

    load();

    const pauseTimer = setTimeout(() => {
      setShowPauseLink(true);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      }).start();
    }, 5000);

    return () => {
      clearTimeout(pauseTimer);
      soundRef.current?.stopAsync();
      soundRef.current?.unloadAsync();
    };
  }, []);

  const handleReplay = async () => {
    setShowReplay(false);
    await sound?.replayAsync();
  };

  const toggleSpeaker = async () => {
    const newSpeakerOn = !speakerOn;
    setSpeakerOn(newSpeakerOn);
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: !newSpeakerOn,
    });
  };

  const handleHangUp = async () => {
    try {
      await sound?.stopAsync();
      await sound?.unloadAsync();
    } catch (e) {}
    try {
      const { sound: hangUpSound } = await Audio.Sound.createAsync(
        require('../assets/images/HangUpSound.mp3')
      );
      await hangUpSound.playAsync();
      setTimeout(() => {
        hangUpSound.unloadAsync();
        router.replace('/(tabs)');
      }, 400);
    } catch (e) {
      router.replace('/(tabs)');
    }
  };

  const handlePauseLink = () => {
    sound?.pauseAsync();
    router.push('/pause');
  };

  return (
    <View style={styles.container}>
      <View style={styles.callerInfo}>
        <View style={styles.avatar}>
          <FontAwesome5 name="user" size={48} color="#2e86de" />
        </View>
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
            <TouchableOpacity onPress={handlePauseLink}>
              <Text style={styles.pauseLink}>Tryck här för att ta en paus</Text>
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
  pauseLink: {
    color: '#2e86de',
    fontSize: 16,
    textDecorationLine: 'underline',
    marginVertical: 4,
    textAlign: 'center',
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
