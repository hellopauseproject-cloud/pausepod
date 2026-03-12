import { FontAwesome } from '@expo/vector-icons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Audio } from 'expo-av';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import { router } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function VideoScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [showPauseLink, setShowPauseLink] = useState(false);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [noFile, setNoFile] = useState(false);
  const [showReplay, setShowReplay] = useState(false);
  const fadeAnim = useState(new Animated.Value(0))[0];

  useEffect(() => {
    const setup = async () => {
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

      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });
      const { sound } = await Audio.Sound.createAsync(
        require('../assets/images/Pickupsound.mp3')
      );
      await sound.playAsync();
      setTimeout(() => sound.unloadAsync(), 2000);
    };
    setup();

    const pauseTimer = setTimeout(() => {
      setShowPauseLink(true);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      }).start();
    }, 5000);

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
    player.play();
    const subscription = player.addListener('playToEnd', () => {
      setShowReplay(true);
    });
    return () => subscription.remove();
  }, [videoReady, videoUri]);

  const handleHangUp = async () => {
    try {
      const { sound } = await Audio.Sound.createAsync(
        require('../assets/images/HangUpSound.mp3')
      );
      await sound.playAsync();
      setTimeout(() => {
        sound.unloadAsync();
        router.replace('/(tabs)');
      }, 400);
    } catch (e) {
      router.replace('/(tabs)');
    }
  };

  const handlePauseLink = async () => {
    if (videoUri) player.pause();
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
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
      {noFile ? (
        <View style={styles.noFilePlaceholder}>
          <Text style={styles.noFileText}>Ingen videofil uppladdad</Text>
        </View>
      ) : (
        <>
          <VideoView
            style={styles.video}
            player={player}
            nativeControls={false}
          />
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
        </>
      )}

      <View style={styles.cameraContainer}>
        <View style={styles.cameraInner}>
          <CameraView style={styles.camera} facing="front" />
        </View>
      </View>

      {showPauseLink && (
        <Animated.View style={[styles.pauseLinkContainer, { opacity: fadeAnim }]}>
          <TouchableOpacity onPress={handlePauseLink}>
            <Text style={styles.pauseLink}>Tryck här för att ta en paus</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      <TouchableOpacity style={styles.hangUpButton} onPress={handleHangUp}>
        <FontAwesome name="phone" size={32} color="white" style={{ transform: [{ rotate: '135deg' }] }} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  video: {
    width: '100%',
    height: '75%',
    marginTop: -80,
  },
  noFilePlaceholder: {
    width: '100%',
    height: '75%',
    marginTop: -80,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noFileText: {
    color: '#aaa',
    fontSize: 16,
  },
  cameraContainer: {
    position: 'absolute',
    bottom: 215,
    right: 20,
    width: 100,
    height: 150,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'white',
    backgroundColor: 'black',
  },
  cameraInner: {
    flex: 1,
    overflow: 'hidden',
  },
  camera: { flex: 1 },
  replayOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '75%',
    marginTop: -10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pauseLink: {
    color: '#2e86de',
    fontSize: 16,
    textDecorationLine: 'underline',
    marginVertical: 10,
  },
  hangUpButton: {
    marginTop: 40,
    backgroundColor: '#e74c3c',
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  pauseLinkContainer: {
    position: 'absolute',
    bottom: 170,
    alignItems: 'center',
    zIndex: 10,
    elevation: 20,
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
});
