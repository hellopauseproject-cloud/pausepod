import { FontAwesome } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useBLE } from '../context/BLEContext';
import { Interruption, logPause } from './pauseLogger';

const REGULATE_SECONDS = 12 * 60;

const activeInstanceRef = { current: null as string | null };

export default function PausingScreen() {
  useKeepAwake();
  const { mode, category } = useLocalSearchParams<{ mode: string; category: string }>();
  const isRegulate = mode === 'regulate';
  const myId = useRef(Math.random().toString(36).substr(2, 5));

  const [seconds, setSeconds] = useState(isRegulate ? REGULATE_SECONDS : 0);
  const [done, setDone] = useState(false);
  const [paused, setPaused] = useState(false);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [isLidOpen, setIsLidOpen] = useState(false);
  const wentToBackground = useRef(false);
  const interruptStartRef = useRef<number | null>(null);
  const interruptTimestampRef = useRef<string | null>(null);
  const interruptionsRef = useRef<Interruption[]>([]);

  const pulse1 = useRef(new Animated.Value(1)).current;
  const pulse2 = useRef(new Animated.Value(1)).current;
  const pulse3 = useRef(new Animated.Value(1)).current;

  const { bleMessage, resetMessage, sendMessageToDevice } = useBLE();

  useEffect(() => {
    activeInstanceRef.current = myId.current;
    return () => {
      if (activeInstanceRef.current === myId.current) {
        activeInstanceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (activeInstanceRef.current !== myId.current) {
      return;
    }
    if (!bleMessage) return;

    if (bleMessage === 'LID_OPEN') {
      if (done) return;
      setIsLidOpen(true);
      interruptStartRef.current = Date.now();
      interruptTimestampRef.current = new Date().toISOString();
      setPaused(true);
    }
    if (bleMessage === 'LID_CLOSED') {
      if (interruptStartRef.current !== null) {
        interruptionsRef.current.push({
          timestamp: interruptTimestampRef.current!,
          durationMs: Date.now() - interruptStartRef.current,
          resumedOrEnded: 'resumed',
        });
        interruptStartRef.current = null;
        interruptTimestampRef.current = null;
      }
      setIsLidOpen(false);
      setPaused(false);
    }
    resetMessage();
  }, [bleMessage]);

  useEffect(() => {
    const createPulse = (anim: Animated.Value, delay: number) => {
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, { toValue: 2.5, duration: 1500, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 1, duration: 1500, useNativeDriver: true }),
        ])
      ).start();
    };
    createPulse(pulse1, 0);
    createPulse(pulse2, 500);
    createPulse(pulse3, 1000);
  }, []);

  // Pausa timern och visa modal om appen lämnas (t.ex. vid samtal)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        wentToBackground.current = true;
        interruptStartRef.current = Date.now();
        interruptTimestampRef.current = new Date().toISOString();
        setPaused(true);
      } else if (nextState === 'active' && wentToBackground.current) {
        setShowResumeModal(true);
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (done || paused) return;
    const interval = setInterval(() => {
      setSeconds(prev => {
        if (isRegulate) {
          if (prev <= 1) { setDone(true); clearInterval(interval); return 0; }
          return prev - 1;
        } else {
          return prev + 1;
        }
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [done, paused]);

  useEffect(() => {
    const modeStr = isRegulate ? 'REGULATE' : 'SESSION';
    const direction = isRegulate ? 'DOWN' : 'UP';
    const startSeconds = isRegulate ? REGULATE_SECONDS : 0;
    sendMessageToDevice(`PAUSE_START:${modeStr}:${direction}:${startSeconds}`);
  }, []);

  useEffect(() => {
    if (paused) {
      sendMessageToDevice('PAUSE_HOLD');
    } else {
      sendMessageToDevice('PAUSE_RESUME');
    }
  }, [paused]);

  useEffect(() => {
    if (done) {
      sendMessageToDevice('PAUSE_DONE');
    }
  }, [done]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleResume = () => {
    if (interruptStartRef.current !== null) {
      interruptionsRef.current.push({
        timestamp: interruptTimestampRef.current!,
        durationMs: Date.now() - interruptStartRef.current,
        resumedOrEnded: 'resumed',
      });
      interruptStartRef.current = null;
      interruptTimestampRef.current = null;
    }
    wentToBackground.current = false;
    setShowResumeModal(false);
    setPaused(false);
  };

  const handleDone = async () => {
    sendMessageToDevice('PAUSE_DONE');
    if (interruptStartRef.current !== null) {
      interruptionsRef.current.push({
        timestamp: interruptTimestampRef.current!,
        durationMs: Date.now() - interruptStartRef.current,
        resumedOrEnded: 'ended',
      });
      interruptStartRef.current = null;
      interruptTimestampRef.current = null;
    }
    const actualDuration = isRegulate ? REGULATE_SECONDS - seconds : seconds;
    const interruptions = interruptionsRef.current.length > 0 ? interruptionsRef.current : undefined;
    await logPause(actualDuration, isRegulate ? 'regulate' : 'session', category || undefined, interruptions);
    router.replace({
      pathname: '/pausesummary',
      params: {
        duration: String(actualDuration),
        mode: isRegulate ? 'regulate' : 'session',
        category: category ?? '',
      },
    });
  };

  return (
    <View style={styles.container}>
      <Modal transparent animationType="fade" visible={showResumeModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Pausen avbröts</Text>
            <Text style={styles.modalSubtitle}>Du lämnade appen. Vill du återuppta pausen?</Text>
            <TouchableOpacity style={styles.modalPrimary} onPress={handleResume}>
              <Text style={styles.modalPrimaryText}>Återuppta paus</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalSecondary} onPress={handleDone}>
              <Text style={styles.modalSecondaryText}>Avsluta</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <View style={styles.pulseContainer}>
        <Animated.View style={[styles.ring, styles.ring3, { transform: [{ scale: pulse3 }] }]} />
        <Animated.View style={[styles.ring, styles.ring2, { transform: [{ scale: pulse2 }] }]} />
        <Animated.View style={[styles.ring, styles.ring1, { transform: [{ scale: pulse1 }] }]} />
        <View style={styles.center}>
          <FontAwesome name="pause" size={40} color="white" />
        </View>
      </View>

      {done ? (
        <>
          <Text style={styles.title}>Bra jobbat!</Text>
          <Text style={styles.subtitle}>Du tog en paus på 12 minuter</Text>
        </>
      ) : (
        <>
          <Text style={styles.title}>{isRegulate ? 'Pausar...' : 'Session pågår...'}</Text>
          <Text style={styles.subtitle}>Lägg telefonen i lådan</Text>
          <Text style={styles.timer}>{formatTime(seconds)}</Text>
        </>
      )}

      <TouchableOpacity style={styles.doneButton} onPress={handleDone}>
        <Text style={styles.doneText}>{done ? 'Stäng' : 'Klar'}</Text>
      </TouchableOpacity>

      {isLidOpen && !done && (
        <View style={styles.lidOpenOverlay}>
          <Text style={styles.lidOpenTitle}>Paus stoppad</Text>
          <Text style={styles.lidOpenSubtitle}>
            Lägg på locket för att{'\n'}återuppta pausen
          </Text>
          {!isRegulate && (
            <TouchableOpacity
              style={styles.donePauseButton}
              onPress={() => {
                sendMessageToDevice('PAUSE_DONE');
                handleDone();
              }}
            >
              <Text style={styles.donePauseText}>PAUS KLAR</Text>
            </TouchableOpacity>
          )}
        </View>
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
    gap: 20,
    marginTop: -45,
  },
  pulseContainer: {
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderRadius: 100,
    borderWidth: 2,
  },
  ring1: { width: 100, height: 100, borderColor: 'rgba(46, 134, 222, 0.6)' },
  ring2: { width: 100, height: 100, borderColor: 'rgba(46, 134, 222, 0.4)' },
  ring3: { width: 100, height: 100, borderColor: 'rgba(46, 134, 222, 0.2)' },
  center: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#2e86de',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 32, fontWeight: 'bold', color: 'white' },
  subtitle: { fontSize: 18, color: '#aaa', textAlign: 'center', paddingHorizontal: 40 },
  timer: { fontSize: 56, fontWeight: 'bold', color: 'white', letterSpacing: 4 },
  doneButton: {
    marginTop: 20,
    backgroundColor: '#2e86de',
    paddingVertical: 16,
    paddingHorizontal: 60,
    borderRadius: 32,
  },
  doneText: { color: 'white', fontSize: 20, fontWeight: 'bold' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBox: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    padding: 32,
    width: '80%',
    alignItems: 'center',
    gap: 16,
    borderWidth: 1,
    borderColor: '#2e86de33',
  },
  modalTitle: { fontSize: 22, fontWeight: 'bold', color: 'white' },
  modalSubtitle: { fontSize: 15, color: '#aaa', textAlign: 'center' },
  modalPrimary: {
    backgroundColor: '#2e86de',
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 28,
    marginTop: 8,
  },
  modalPrimaryText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  modalSecondary: { paddingVertical: 10 },
  modalSecondaryText: { color: '#666', fontSize: 14 },
  lidOpenOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    gap: 16,
  },
  lidOpenTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
  },
  lidOpenSubtitle: {
    fontSize: 16,
    color: '#888',
    textAlign: 'center',
    lineHeight: 24,
  },
  donePauseButton: {
    marginTop: 32,
    backgroundColor: '#2e86de',
    paddingVertical: 18,
    paddingHorizontal: 50,
    borderRadius: 32,
    shadowColor: '#2e86de',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 12,
  },
  donePauseText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 3,
  },
});
