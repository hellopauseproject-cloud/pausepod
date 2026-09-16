import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { DeviceMotion } from 'expo-sensors';
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useBLE } from '../context/BLEContext';
import { useSession } from '../context/SessionContext';
import { setInboxActive } from '../lib/inboxGuard';
import { dimScreen, restoreScreenBrightness } from '../lib/screenBrightnessGuard';

const KEEP_AWAKE_TAG = 'placeinbox';
const RING_SIZE = 100;

// Accelerometer-driven feedback — ren upplevelse. Triggar den aldrig (telefonen
// vilar i en vinkel vi inte fångar) startar pausen ändå normalt via lådans
// egna phone_down/lid_closed — det här styr bara text och skärmljus.
const FLAT_THRESHOLD_RAD = 0.6;
const MOTION_INTERVAL_MS = 200;
const REQUIRED_CONSECUTIVE_READINGS = 2;
const UNDO_WINDOW_MS = 5000;

export default function PlaceInBoxScreen() {
  const { category } = useLocalSearchParams<{ category: string }>();
  const { state, dispatch } = useSession();
  const { sendPhoneDown } = useBLE();
  const { phase, touches } = state;

  // Checkin-fasens feedback
  const ringFill = useRef(new Animated.Value(0)).current;
  const bothDown = touches.left && touches.right;
  const prevTouchesRef = useRef(touches);
  const prevPhaseRef = useRef(phase);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  // sendPhoneDown byter identitet varje render av BLEProvider (inte
  // memoiserad) — en ref håller DeviceMotion-effekten nedan äkta mount-once.
  const sendPhoneDownRef = useRef(sendPhoneDown);
  sendPhoneDownRef.current = sendPhoneDown;

  // Animationer
  const breathe = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.3)).current;

  // ── Lutningsdetektion (bara relevant i checked_in) ──
  const [phoneFlat, setPhoneFlat] = useState(false);
  const rawStreakRef = useRef<{ value: 'upright' | 'flat'; count: number }>({ value: 'upright', count: 0 });
  const confirmedFlatRef = useRef(false);
  const flatSinceRef = useRef<number | null>(null);
  const hasSentPhoneDownRef = useRef(false);

  // ── Gå in i incheckningsläget. Bara om vi kommer hit från idle — en
  // RESTORE efter återanslutning kan redan ha satt oss i checked_in/awaiting_lid. ──
  useEffect(() => {
    if (state.phase === 'idle') {
      dispatch({ type: 'ENTER_CHECKIN', category: category || undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Flagga aktiv medan vi är på den här skärmen (gate:ar t.ex. fejksamtal) ──
  useEffect(() => {
    setInboxActive(true, { mode: 'session', category: String(category ?? '') });
    return () => setInboxActive(false);
  }, []);

  // ── Skärmen får inte slockna medan tummarna ska hållas ──
  useEffect(() => {
    if (phase === 'checking_in' || phase === 'checked_in') {
      activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    } else {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    }
  }, [phase]);
  useEffect(() => () => { deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {}); }, []);

  // ── Skärmljus städas alltid upp när den här skärmen lämnas, oavsett anledning. ──
  useEffect(() => () => { restoreScreenBrightness(); }, []);

  // ── Andningsanimation (alltid aktiv) ──
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1.15, duration: 3000, useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 1, duration: 3000, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  // ── Ringfyllning: kosmetisk lokal 1,5s-timer medan båda tummarna hålls.
  // Släpps en tumme innan checkin_complete kommit från lådan, backar ringen
  // mjukt (inte ett reset) — och fasen ligger kvar i checking_in tills
  // lådan själv säger klart. ──
  useEffect(() => {
    if (phase !== 'checking_in') return;
    if (bothDown) {
      Animated.timing(ringFill, {
        toValue: 1,
        duration: 1500,
        useNativeDriver: false,
      }).start();
    } else {
      Animated.timing(ringFill, {
        toValue: 0,
        duration: 400,
        useNativeDriver: false,
      }).start();
    }
  }, [bothDown, phase]);

  // ── Haptik vid tumkontakt och vid klar incheckning; navigera vidare när pausen väl startat ──
  useEffect(() => {
    if (touches.left && !prevTouchesRef.current.left) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (touches.right && !prevTouchesRef.current.right) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    prevTouchesRef.current = touches;
  }, [touches.left, touches.right]);

  useEffect(() => {
    if (prevPhaseRef.current === 'checking_in' && phase === 'checked_in') {
      Animated.timing(ringFill, { toValue: 1, duration: 150, useNativeDriver: false }).start();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    if (phase === 'active') {
      router.replace({ pathname: '/pausing', params: { mode: 'session', withPod: 'true' } } as never);
    }
    prevPhaseRef.current = phase;
  }, [phase]);

  // ── Lutningsdetektion: prenumereras en gång vid mount, tas bort vid unmount.
  // Ingen omprenumeration vid fasbyten — callbacken själv ignorerar allt
  // utanför checked_in. ──
  useEffect(() => {
    DeviceMotion.setUpdateInterval(MOTION_INTERVAL_MS);
    const sub = DeviceMotion.addListener(({ rotation }) => {
      if (phaseRef.current !== 'checked_in' || !rotation) return;

      const raw: 'upright' | 'flat' = Math.abs(rotation.beta) < FLAT_THRESHOLD_RAD ? 'flat' : 'upright';
      if (rawStreakRef.current.value === raw) {
        rawStreakRef.current.count += 1;
      } else {
        rawStreakRef.current = { value: raw, count: 1 };
      }
      if (rawStreakRef.current.count < REQUIRED_CONSECUTIVE_READINGS) return;

      const confirmedFlat = raw === 'flat';
      if (confirmedFlat === confirmedFlatRef.current) return;

      if (confirmedFlat) {
        confirmedFlatRef.current = true;
        flatSinceRef.current = Date.now();
        setPhoneFlat(true);
        dimScreen();
        if (!hasSentPhoneDownRef.current) {
          hasSentPhoneDownRef.current = true;
          sendPhoneDownRef.current().catch(() => {});
        }
      } else {
        const elapsed = flatSinceRef.current ? Date.now() - flatSinceRef.current : Infinity;
        if (elapsed < UNDO_WINDOW_MS) {
          // Justering, inte ett ångrande — låt allt vara som det är.
          return;
        }
        confirmedFlatRef.current = false;
        flatSinceRef.current = null;
        hasSentPhoneDownRef.current = false;
        setPhoneFlat(false);
        restoreScreenBrightness();
      }
    });

    return () => sub.remove();
  }, []);

  // ── Pulsanimation medan vi väntar på att locket stängs ──
  useEffect(() => {
    if (phase !== 'awaiting_lid') return;
    const anim = Animated.loop(
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
    );
    anim.start();
    return () => anim.stop();
  }, [phase]);

  return (
    <View style={styles.container}>

      {/* ── Tumgesten ── */}
      {(phase === 'checking_in' || phase === 'idle') && (
        <View style={styles.centerScreen}>
          <Animated.View style={[styles.circle, { transform: [{ scale: breathe }] }]} />
          <Text style={styles.title}>CHECKA IN{'\n'}MED TUMMARNA</Text>
          <View style={styles.checkinRow}>
            <View style={[styles.touchMarker, touches.left && styles.touchMarkerActive]} />
            <View style={styles.ringWrap}>
              <View style={styles.ringTrack} />
              <Animated.View
                style={[
                  styles.ringFillClip,
                  {
                    height: ringFill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                  },
                ]}
              />
            </View>
            <View style={[styles.touchMarker, touches.right && styles.touchMarkerActive]} />
          </View>
        </View>
      )}

      {/* ── Lägg ner telefonen ── */}
      {phase === 'checked_in' && (
        <View style={styles.centerScreen}>
          <Text style={styles.title}>{phoneFlat ? 'LÄGG PÅ\nLOCKET' : 'LÄGG NER\nTELEFONEN'}</Text>
        </View>
      )}

      {/* ── Stäng locket ── */}
      {phase === 'awaiting_lid' && (
        <View style={styles.centerScreen}>
          <View style={styles.pulseWrapper}>
            <Animated.View
              style={[
                styles.pulseRing,
                { transform: [{ scale: pulse }], opacity: pulseOpacity },
              ]}
            />
            <View style={[styles.circle, styles.circleActive]} />
          </View>
          <Text style={styles.title}>STÄNG{'\n'}LOCKET</Text>
        </View>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerScreen: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 40,
  },
  title: {
    fontSize: 26,
    fontWeight: '900',
    color: '#e8f0ff',
    textAlign: 'center',
    letterSpacing: 1,
    lineHeight: 34,
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

  // ── Checkin ──
  checkinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 28,
  },
  touchMarker: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  touchMarkerActive: {
    backgroundColor: '#27ae60',
    borderColor: '#27ae60',
  },
  ringWrap: {
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 2,
    borderColor: 'rgba(46, 134, 222, 0.3)',
    justifyContent: 'flex-end',
  },
  ringTrack: {
    ...StyleSheet.absoluteFillObject,
  },
  ringFillClip: {
    width: '100%',
    backgroundColor: '#27ae60',
  },
});
