import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useNfc } from '../hooks/useNfc';

export default function PlaceInBoxScreen() {
  const { mode, category } = useLocalSearchParams<{ mode: string; category: string }>();

  const pulse = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.6)).current;

  const { scan } = useNfc(() => {
    router.replace({
      pathname: '/pausing',
      params: { mode, category: category ?? '' },
    });
  });

  useEffect(() => {
    // Retry loop — keeps scanning until a tag is found or unmount
    let active = true;
    const keepScanning = async () => {
      while (active) {
        await scan();
        await new Promise(r => setTimeout(r, 1000));
      }
    };
    keepScanning();

    // Pulsing animation
    Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.3, duration: 1800, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 1800, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: 1800, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.6, duration: 1800, useNativeDriver: true }),
        ]),
      ])
    ).start();
    return () => { active = false; };
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.pulseWrapper}>
        <Animated.View
          style={[
            styles.pulseRingOuter,
            { transform: [{ scale: pulse }], opacity },
          ]}
        />
        <Animated.View
          style={[
            styles.pulseRingInner,
            { transform: [{ scale: pulse }], opacity },
          ]}
        />
        <View style={styles.circle} />
      </View>

      <Text style={styles.title}>Lägg telefonen i lådan</Text>
      <Text style={styles.subtitle}>Väntar på NFC-scan...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
  },
  pulseWrapper: {
    width: 160,
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRingOuter: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 2,
    borderColor: 'rgba(46, 134, 222, 0.2)',
  },
  pulseRingInner: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: 'rgba(46, 134, 222, 0.4)',
  },
  circle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#2e86de',
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  subtitle: {
    fontSize: 14,
    color: '#555',
    letterSpacing: 1.5,
  },
});
