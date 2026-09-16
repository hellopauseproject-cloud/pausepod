import { FontAwesome } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSession } from '../context/SessionContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { PauseType } from '../lib/sessionMachine';
import { clearSessionCheckpoint, findCategoryById, logPause, saveSessionCheckpoint } from './pauseLogger';

const RESPITE_SECONDS = 30;

function generateLocalSeq(): string {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function PausingScreen() {
  useKeepAwake();
  const { user } = useAuth();
  const { state, dispatch } = useSession();
  const {
    category,
    sharedSessionId,
    sharedWithName,
    withPod,
    pauseType,
    targetSeconds,
  } = useLocalSearchParams<{
    category: string;
    sharedSessionId: string;
    withPod: string;
    sharedWithName: string;
    pauseType: string;
    targetSeconds: string;
  }>();

  // Var vi i idle när skärmen monterades? Då är DET HÄR som äger start och
  // slut (lådlöst flöde, eller ett delat-med-vän-flöde som aldrig gick via
  // ritualen). Var vi redan 'active' (eller på väg dit via RESTORE) äger
  // lådan sessionen — SessionContext har redan skrivit och ackat innan
  // fasen blir 'ended', vi bara visar och navigerar vidare.
  const isManualOriginRef = useRef(state.phase === 'idle');
  const endedHandledRef = useRef(false);
  const autoEndFiredRef = useRef(false);

  const [, forceTick] = useState(0);

  const pulse1 = useRef(new Animated.Value(1)).current;
  const pulse2 = useRef(new Animated.Value(1)).current;
  const pulse3 = useRef(new Animated.Value(1)).current;

  // ── Starta manuellt om vi kom hit utan att ha gått via lådans ritual ──
  useEffect(() => {
    if (!isManualOriginRef.current) return;
    const isRegulate = pauseType === 'regulate';
    dispatch({
      type: 'SESSION_STARTED',
      seq: generateLocalSeq(),
      withPod: withPod === 'true',
      pauseType: (isRegulate ? 'regulate' : 'session') as PauseType,
      targetSeconds: isRegulate ? parseInt(targetSeconds ?? '0', 10) : undefined,
      category: category || undefined,
      sharedSessionId: sharedSessionId || undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── is_pausing-flaggan, oavsett flöde ──
  useEffect(() => {
    if (!user?.id) return;
    supabase.from('profiles').update({ is_pausing: true }).eq('id', user.id);
    return () => {
      supabase.from('profiles').update({ is_pausing: false }).eq('id', user.id);
    };
  }, [user?.id]);

  // ── Krasch-checkpoint — bara för det manuella flödet. Lådans egen
  // state-synk vid återanslutning (se _layout.tsx) täcker box-flödet. ──
  useEffect(() => {
    if (!isManualOriginRef.current || !user?.id || state.phase !== 'active') return;
    saveSessionCheckpoint({
      startedAt: new Date(state.startedAt ?? Date.now()).toISOString(),
      userId: user.id,
      category: state.category || undefined,
      pauseType: state.pauseType,
      targetSeconds: state.pauseType === 'regulate' ? state.targetSeconds : undefined,
      sharedSessionId: state.sharedSessionId || undefined,
    });
  }, [isManualOriginRef.current, user?.id, state.phase, state.startedAt]);

  // ── Pulsanimation ──
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

  // ── Sekundvisning — tickar bara om för att trigga omrendering; faktiskt
  // elapsed räknas ut vid varje render från state, se computeElapsedMs. ──
  useEffect(() => {
    const interval = setInterval(() => forceTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const computeElapsedMs = (): number => {
    if (!state.startedAt) return 0;
    const now = state.phase === 'respite' && state.respiteStartedAt ? state.respiteStartedAt : Date.now();
    return Math.max(0, now - state.startedAt - state.pausedMs + state.elapsedBaselineMs);
  };

  const elapsedMs = computeElapsedMs();
  const isRegulate = state.pauseType === 'regulate' && !!state.targetSeconds;
  const seconds = isRegulate
    ? Math.max(0, (state.targetSeconds ?? 0) - Math.floor(elapsedMs / 1000))
    : Math.floor(elapsedMs / 1000);

  const respiteSecondsLeft = state.respiteStartedAt
    ? Math.max(0, RESPITE_SECONDS - Math.floor((Date.now() - state.respiteStartedAt) / 1000))
    : RESPITE_SECONDS;

  // ── Regulate-nedräkning (bara lådlöst) tar slut av sig själv ──
  useEffect(() => {
    if (!isManualOriginRef.current || !isRegulate || autoEndFiredRef.current) return;
    if (seconds > 0) return;
    autoEndFiredRef.current = true;
    dispatch({
      type: 'SESSION_ENDED',
      seq: state.seq ?? '',
      durationMs: (state.targetSeconds ?? 0) * 1000,
      completed: true,
    });
  }, [seconds, isRegulate]);

  // ── Sessionen är slut. Manuellt ursprung sparar till Supabase precis som
  // innan; box-ursprung är redan sparat (SessionContext skrev till outboxen
  // och ackade innan den dispatchade SESSION_ENDED). ──
  useEffect(() => {
    if (state.phase !== 'ended' || !state.lastEnded || endedHandledRef.current) return;
    endedHandledRef.current = true;

    (async () => {
      const durationSeconds = Math.round(state.lastEnded!.durationMs / 1000);

      if (isManualOriginRef.current) {
        const now = new Date().toISOString();
        if (state.sharedSessionId && user?.id) {
          await supabase
            .from('pause_sessions')
            .update({ ended_at: now, duration_seconds: durationSeconds })
            .eq('shared_session_id', state.sharedSessionId)
            .eq('user_id', user.id);
        } else if (user?.id) {
          let intentionLabel: string | null = null;
          if (state.category) {
            const cat = await findCategoryById(state.category);
            intentionLabel = cat?.label ?? null;
          }
          const { error } = await supabase.from('pause_sessions').insert({
            user_id: user.id,
            started_at: new Date(Date.now() - durationSeconds * 1000).toISOString(),
            ended_at: now,
            duration_seconds: durationSeconds,
            intention: intentionLabel,
            is_shared: false,
            with_pod: state.withPod,
            completed: state.lastEnded!.completed,
          });
          if (error) console.log('pause_sessions insert error:', JSON.stringify(error));
        }
        await logPause(durationSeconds, 'session', state.category || undefined);
        await clearSessionCheckpoint();
      }

      const finalCategory = state.category ?? '';
      const finalSharedWithName = sharedWithName ?? '';
      const finalSharedSessionId = state.sharedSessionId ?? '';

      dispatch({ type: 'RESET' });

      router.replace({
        pathname: '/pausesummary',
        params: {
          duration: String(durationSeconds),
          mode: 'session',
          category: finalCategory,
          sharedWithName: finalSharedWithName,
          sharedSessionId: finalSharedSessionId,
        },
      });
    })();
  }, [state.phase]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const titleText = isRegulate ? 'Regulate pågår...' : 'Session pågår...';

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

      <Text style={styles.title}>{titleText}</Text>
      <Text style={styles.subtitle}> </Text>

      <View style={styles.timerWrap}>
        <Text style={styles.timer}>{formatTime(seconds)}</Text>
        {isRegulate && (
          <Text style={styles.timerLabel}>kvar</Text>
        )}
      </View>

      {/* Lådan äger avslutet i box-flödet — ingen "Klar"-knapp där. */}
      {isManualOriginRef.current && (
        <TouchableOpacity
          style={styles.doneButton}
          onPress={() => {
            if (autoEndFiredRef.current) return;
            autoEndFiredRef.current = true;
            dispatch({
              type: 'SESSION_ENDED',
              seq: state.seq ?? '',
              durationMs: elapsedMs,
              completed: true,
            });
          }}
        >
          <Text style={styles.doneText}>Klar</Text>
        </TouchableOpacity>
      )}

      {state.phase === 'respite' && (
        <View style={styles.lidOpenOverlay}>
          <Text style={styles.lidOpenTitle}>{respiteSecondsLeft}</Text>
          <Text style={styles.lidOpenSubtitle}>
            Stäng locket för{'\n'}att fortsätta
          </Text>
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
  timerWrap: {
    alignItems: 'center',
    gap: 4,
  },
  timer: { fontSize: 56, fontWeight: 'bold', color: 'white', letterSpacing: 4 },
  timerLabel: {
    fontSize: 13,
    color: '#2e86de',
    fontWeight: '600',
    letterSpacing: 3,
    textTransform: 'uppercase',
    opacity: 0.8,
  },
  doneButton: {
    marginTop: 20,
    backgroundColor: '#2e86de',
    paddingVertical: 16,
    paddingHorizontal: 60,
    borderRadius: 32,
  },
  doneText: { color: 'white', fontSize: 20, fontWeight: 'bold' },
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
});
