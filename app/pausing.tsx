import { FontAwesome } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { logPause } from './pauseLogger';

const REGULATE_SECONDS = 12 * 60;

export default function PausingScreen() {
  const { mode, category } = useLocalSearchParams<{ mode: string; category: string }>();
  const isRegulate = mode === 'regulate';

  const [seconds, setSeconds] = useState(isRegulate ? REGULATE_SECONDS : 0);
  const [done, setDone] = useState(false);

  const pulse1 = useRef(new Animated.Value(1)).current;
  const pulse2 = useRef(new Animated.Value(1)).current;
  const pulse3 = useRef(new Animated.Value(1)).current;

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

  useEffect(() => {
    if (done) return;
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
  }, [done]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleDone = async () => {
    const actualDuration = isRegulate ? REGULATE_SECONDS - seconds : seconds;
    await logPause(actualDuration, isRegulate ? 'regulate' : 'session', category || undefined);
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
          <Text style={styles.title}>Bra jobbat! 🎉</Text>
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
});
