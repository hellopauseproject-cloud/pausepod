import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import NfcManager from 'react-native-nfc-manager';
import { useBLE } from '../context/BLEContext';
import { useNfc } from '../hooks/useNfc';
import { setInboxActive } from '../lib/inboxGuard';

type Phase = 'touch' | 'nfc2' | 'lid';

const activeInstanceRef = { current: null as string | null };

export default function PlaceInBoxScreen() {
  const { mode, category } = useLocalSearchParams<{ mode: string; category: string }>();
  const myId = useRef(Math.random().toString(36).substr(2, 5));
  const phaseRef = useRef<Phase>('touch');
  const [phase, setPhaseState] = useState<Phase>('touch');
  const setPhase = (newPhase: Phase) => {
    phaseRef.current = newPhase;
    setPhaseState(newPhase);
  };

  // Animations
  const breathe = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.3)).current;

  // BLE
  const { bleMessage, resetMessage, sendMessageToDevice } = useBLE();

  // Touch-hint
  const hintOpacity = useRef(new Animated.Value(1)).current;
  const touchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeHint = () =>
    Animated.timing(hintOpacity, { toValue: 0, duration: 500, useNativeDriver: true }).start();

  // NFC
  const nfcHandledRef = useRef(false);
  const nfcActiveRef = useRef(false);

  // Återställ nfcHandled vid varje fasbyte
  useEffect(() => {
    nfcHandledRef.current = false;
  }, [phase]);

  // Meddela ESP32 om touch-fasens start och slut
  useEffect(() => {
    if (phase === 'touch') {
      sendMessageToDevice('TOUCH_PHASE_START');
    }
    if (phase === 'nfc2' || phase === 'lid') {
      sendMessageToDevice('TOUCH_PHASE_END');
    }
  }, [phase]);

  const { scan } = useNfc(() => {
    if (nfcHandledRef.current) return;
    nfcHandledRef.current = true;
    if (phaseRef.current === 'nfc2') {
      sendMessageToDevice('NFC_SCANNED');
      setPhase('lid');
    }
  });

  // NFC-loop — körs endast i nfc2, stoppas vid fasbyte
  useEffect(() => {
    if (phase !== 'nfc2') {
      nfcActiveRef.current = false;
      return;
    }
    nfcActiveRef.current = true;

    const keepScanning = async () => {
      while (nfcActiveRef.current && phaseRef.current === 'nfc2') {
        try {
          await scan();
        } catch (e) {
          // ignorera tyst
        }
        if (nfcActiveRef.current) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
    };

    keepScanning();

    return () => {
      nfcActiveRef.current = false;
      NfcManager.cancelTechnologyRequest().catch(() => {});
    };
  }, [phase]);

  // Registrera aktiv instans
  useEffect(() => {
    activeInstanceRef.current = myId.current;
    return () => {
      if (activeInstanceRef.current === myId.current) {
        activeInstanceRef.current = null;
      }
    };
  }, []);

  // BLE — hantera meddelanden enbart i rätt fas
  useEffect(() => {
    if (activeInstanceRef.current !== myId.current) return;
    if (!bleMessage) return;
    if (phaseRef.current === 'touch') {
      if (bleMessage === 'TOUCH_START') { player.play(); fadeHint(); }
      if (bleMessage === 'TOUCH_END') player.pause();
    }
    if (phaseRef.current === 'lid') {
      if (bleMessage === 'LID_CLOSED') handleStartPause();
    }
    resetMessage();
  }, [bleMessage]);

  // Video
  const videoRef = useRef(null);
  const player = useVideoPlayer(require('../assets/images/landscape.mp4'), p => {
    p.loop = false;
  });

  // Sätt flaggan aktiv medan vi är på den här skärmen
  useEffect(() => {
    setInboxActive(true, { mode: String(mode), category: String(category ?? '') });
    return () => setInboxActive(false);
  }, []);

  // Andningsanimation (alltid aktiv)
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1.15, duration: 3000, useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 1, duration: 3000, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  // Touch-fas: säkerställ pausat läge + lyssna på videoklipp slut → nfc2
  useEffect(() => {
    if (phase !== 'touch') return;
    player.pause();
    const sub = player.addListener('playToEnd', () => {
      setPhase('nfc2');
    });
    return () => {
      sub.remove();
      if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
    };
  }, [phase]);

  // Lid-fas: pulsanimation
  useEffect(() => {
    if (phase !== 'lid') return;
    Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulse, { toValue: 2.2, duration: 1400, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(pulseOpacity, { toValue: 0.7, duration: 1400, useNativeDriver: true }),
          Animated.timing(pulseOpacity, { toValue: 0, duration: 1400, useNativeDriver: true }),
        ]),
      ])
    ).start();
  }, [phase]);

  const handleStartPause = () => {
    router.replace({
      pathname: '/pausing',
      params: { mode, category: category ?? '' },
    });
  };

  return (
    <View style={styles.container}>

      {/* ── FAS 1: Touch-initiering ── */}
      {phase === 'touch' && (
        <View style={styles.touchScreen}>
          <Animated.Text style={[styles.title, { fontSize: 18, marginBottom: -28, opacity: hintOpacity }]}>
            Håll händerna mot lådan för att starta
          </Animated.Text>
          <VideoView
            ref={videoRef}
            player={player}
            style={styles.video}
            nativeControls={false}
            contentFit="contain"
          />
          <TouchableOpacity
            style={styles.devButton}
            onPressIn={() => {
              player.currentTime = 0;
              player.play();
              touchTimerRef.current = setTimeout(fadeHint, 1500);
            }}
            onPressOut={() => {
              player.pause();
              if (touchTimerRef.current) {
                clearTimeout(touchTimerRef.current);
                touchTimerRef.current = null;
              }
            }}
          >
            <Text style={styles.devText}>Simulera touch-funktion</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── FAS 2: NFC-scan (insida) ── */}
      {phase === 'nfc2' && (
        <>
          <View style={styles.pulseWrapper}>
            <Animated.View style={[styles.circle, { transform: [{ scale: breathe }] }]} />
          </View>
          <Text style={styles.title}>Lägg ner telefonen i lådan{'\n'}</Text>
          <Text style={styles.subtitle}>Väntar på NFC...</Text>
          <TouchableOpacity
            style={styles.devButton}
            onPress={() => {
              sendMessageToDevice('NFC_SCANNED');
              nfcActiveRef.current = false;
              NfcManager.cancelTechnologyRequest().catch(() => {});
              setPhase('lid');
            }}
          >
            <Text style={styles.devText}>Simulera NFC-tagg</Text>
          </TouchableOpacity>
        </>
      )}

      {/* ── FAS 3: Väntar på locket ── */}
      {phase === 'lid' && (
        <>
          <View style={styles.pulseWrapper}>
            <Animated.View
              style={[
                styles.pulseRing,
                { transform: [{ scale: pulse }], opacity: pulseOpacity },
              ]}
            />
            <Animated.View style={[styles.circle, styles.circleActive]} />
          </View>
          <Text style={styles.title}>Lägg på locket för{'\n'}att starta pausen</Text>

          <TouchableOpacity
            style={styles.devButton}
            onPress={handleStartPause}
          >
            <Text style={styles.devText}>Simulera lockpåläggning</Text>
          </TouchableOpacity>
        </>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 36,
  },
  touchScreen: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 36,
  },
  pulseWrapper: {
    width: 180,
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(46, 134, 222, 0.3)',
  },
  circle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#2e86de',
    opacity: 0.5,
  },
  circleActive: {
    opacity: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
    paddingHorizontal: 32,
    lineHeight: 38,
  },
  subtitle: {
    fontSize: 13,
    color: '#444',
    letterSpacing: 2,
  },
  video: {
    alignSelf: 'stretch',
    aspectRatio: 2 / 3,
  },
  touchHint: {
    fontSize: 13,
    color: '#555',
    letterSpacing: 1,
    textAlign: 'center',
  },
  devButton: {
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  devText: {
    color: '#444',
    fontSize: 12,
    letterSpacing: 1,
  },
});
