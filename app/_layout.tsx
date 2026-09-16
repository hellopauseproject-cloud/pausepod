import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { AppState, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { BLEProvider, useBLEControl } from '../context/BLEContext';
import { SessionProvider, useSession } from '../context/SessionContext';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { InviteProvider } from '../contexts/InviteContext';
import { supabase } from '../lib/supabase';
import { BLOCKS_STORAGE_PATH, RESCHEDULE_THRESHOLD, registerForPushNotifications, scheduleBlockNotifications } from '../lib/notifications';
import { restoreScreenBrightness } from '../lib/screenBrightnessGuard';
import { flushOutbox } from '../lib/sessionOutbox';
import { clearSessionCheckpoint, findCategoryById, loadSessionCheckpoint, logPause } from './pauseLogger';
import { getProfile } from './userProfile';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export const unstable_settings = {
  anchor: '(tabs)',
};

function InnerLayout() {
  const colorScheme = useColorScheme();
  const { connectToPausePod } = useBLEControl();
  const { state: sessionState } = useSession();
  const { user, loading, onboardingCompleted } = useAuth();

  const hasRoutedRef = useRef(false);
  const responseListenerRef = useRef<Notifications.EventSubscription | null>(null);
  const recoveryDoneRef = useRef(false);
  const restoreRoutedSeqRef = useRef<string | null>(null);

  useEffect(() => {
    connectToPausePod();
  }, []);

  // Försök synka allt som ligger kvar i den lokala kön (t.ex. sessioner som
  // ackades mot lådan innan appen hade nät) varje gång appen startar.
  useEffect(() => {
    flushOutbox().catch(() => {});
  }, [user?.id]);

  // Skärmljus-skyddsnät för placeinbox accelerometer-dimning (ren kosmetik,
  // se lib/screenBrightnessGuard.ts). Tre saker som inte kan städas av
  // skärmen själv:
  // 1) en tidigare session dog innan den hann återställa — städa vid start
  // 2) appen läggs i bakgrunden medan skärmen fortfarande är dämpad
  // 3) global säkerhet: så fort en paus är helt slut, oavsett vilken skärm
  //    som råkar vara uppe just då
  useEffect(() => {
    restoreScreenBrightness();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') restoreScreenBrightness();
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (sessionState.phase === 'ended') restoreScreenBrightness();
  }, [sessionState.phase]);

  // Om lådan hör av sig med ett pågående tillstånd (state:) efter att appen
  // startat om — hoppa rakt in i rätt skärm istället för att landa på
  // hemskärmen med en låda som redan räknar. Bara den parade lådans state
  // dispatchas som RESTORE (se SessionContext), så det här körs aldrig för
  // en främmande låda.
  useEffect(() => {
    if (!user || !onboardingCompleted) return;
    const { phase, seq } = sessionState;
    if (phase === 'idle' || phase === 'ended') return;
    if (!seq || restoreRoutedSeqRef.current === seq) return;
    restoreRoutedSeqRef.current = seq;

    if (phase === 'active' || phase === 'respite') {
      router.replace({
        pathname: '/pausing',
        params: { mode: 'session', withPod: 'true' },
      } as never);
    } else {
      router.replace({
        pathname: '/placeinbox',
        params: { mode: 'session', withPod: 'true' },
      } as never);
    }
  }, [sessionState.phase, sessionState.seq, user, onboardingCompleted]);

  // Recover any session that was interrupted by the app being killed
  useEffect(() => {
    if (!user?.id || recoveryDoneRef.current) return;
    recoveryDoneRef.current = true;

    (async () => {
      const checkpoint = await loadSessionCheckpoint();
      if (!checkpoint || checkpoint.userId !== user.id) return;

      await clearSessionCheckpoint();

      const startedAt = new Date(checkpoint.startedAt);
      const endedAt = new Date();
      const duration = Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000));

      if (duration < 5) return;

      await logPause(duration, 'session', checkpoint.category);

      let intentionLabel: string | null = null;
      if (checkpoint.category) {
        const cat = await findCategoryById(checkpoint.category);
        intentionLabel = cat?.label ?? null;
      }

      if (checkpoint.sharedSessionId) {
        await supabase
          .from('pause_sessions')
          .update({ ended_at: endedAt.toISOString(), duration_seconds: duration })
          .eq('shared_session_id', checkpoint.sharedSessionId)
          .eq('user_id', user.id);
      } else {
        await supabase.from('pause_sessions').insert({
          user_id: user.id,
          started_at: startedAt.toISOString(),
          ended_at: endedAt.toISOString(),
          duration_seconds: duration,
          intention: intentionLabel,
          is_shared: false,
          with_pod: false,
        });
      }

      await supabase.from('profiles').update({ is_pausing: false }).eq('id', user.id);
    })();
  }, [user?.id]);

  useEffect(() => {
    if (loading) return;

    if (!user) {
      hasRoutedRef.current = false;
      router.replace('/auth/login' as never);
      return;
    }

    if (onboardingCompleted === null) return;

    if (hasRoutedRef.current) return;
    hasRoutedRef.current = true;

    if (!onboardingCompleted) {
      router.replace('/onboarding-flow' as never);
    } else {
      router.replace('/(tabs)' as never);
    }
  }, [loading, user, onboardingCompleted]);

  // Register push token and save to profile
  useEffect(() => {
    if (!user) return;
    registerForPushNotifications().then(async token => {
      if (!token) return;
      const { error } = await supabase
        .from('profiles')
        .update({ push_token: token })
        .eq('id', user.id);
      if (error) console.error('[Notifications] Failed to save push token:', error.message);
    });

    // Auto-reschedule block notifications if running low
    (async () => {
      try {
        const scheduled = await Notifications.getAllScheduledNotificationsAsync();
        if (scheduled.length < RESCHEDULE_THRESHOLD) {
          const path = (FileSystem.documentDirectory ?? '') + BLOCKS_STORAGE_PATH;
          const json = await FileSystem.readAsStringAsync(path).catch(() => null);
          if (!json) return;
          const selectedBlockIds: string[] = JSON.parse(json);
          if (selectedBlockIds.length < 2) return;
          const profile = await getProfile().catch(() => ({ name: 'Dig själv', photo: null }));
          await scheduleBlockNotifications(profile.name ?? 'Dig själv', selectedBlockIds);
        }
      } catch (e) {
        console.log('[Notifications] Reschedule check failed:', e);
      }
    })();

    // Handle notification tap when app is foregrounded or from background
    responseListenerRef.current = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as Record<string, string> | undefined;
      if (data?.screen === 'call') {
        router.replace('/call' as never);
      } else if (data?.screen === 'text-message') {
        const DEFAULT_TEXT = 'Dags att ta en paus från telefonen?';
        supabase
          .from('user_self_texts')
          .select('text_content')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
          .then(({ data: selfText }) => {
            router.replace({
              pathname: '/text-message',
              params: { textContent: selfText?.text_content ?? DEFAULT_TEXT },
            } as never);
          });
      } else if (data?.screen === 'pausing' && data.sharedSessionId) {
        router.replace({
          pathname: '/pausing',
          params: {
            mode: 'session',
            sharedSessionId: data.sharedSessionId,
            sharedWithName: data.sharedWithName ?? '',
            category: data.category ?? '',
          },
        } as never);
      }
    });

    return () => {
      if (responseListenerRef.current) {
        responseListenerRef.current.remove();
      }
    };
  }, [user]);

  const showOverlay = loading || (!!user && onboardingCompleted === null);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="auth" options={{ headerShown: false }} />
        <Stack.Screen name="call" options={{ headerShown: false }} />
        <Stack.Screen name="voice" options={{ headerShown: false }} />
        <Stack.Screen name="video" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding-flow" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding-complete" options={{ headerShown: false }} />
        <Stack.Screen name="pause" options={{ headerShown: false }} />
        <Stack.Screen name="pausesummary" options={{ headerShown: false }} />
        <Stack.Screen name="pausing" options={{ headerShown: false }} />
        <Stack.Screen name="placeinbox" options={{ headerShown: false, animation: 'none', freezeOnBlur: true }} />
        <Stack.Screen name="stats" options={{ headerShown: false }} />
        <Stack.Screen name="profile" options={{ headerShown: false }} />
        <Stack.Screen name="record-message" options={{ headerShown: false }} />
        <Stack.Screen name="add-friend" options={{ headerShown: false }} />
        <Stack.Screen name="friend-wrapped" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="my-wrapped" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="pause-invite-waiting" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="support-story-create" options={{ headerShown: false }} />
        <Stack.Screen name="support-respond-text" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="support-respond-voice" options={{ headerShown: false }} />
        <Stack.Screen name="support-respond-video" options={{ headerShown: false }} />
        <Stack.Screen name="support-view-text" options={{ headerShown: false }} />
        <Stack.Screen name="text-message" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      {showOverlay && (
        <View
          style={{ position: 'absolute', inset: 0, backgroundColor: '#0f0f1a' }}
          pointerEvents="none"
        />
      )}
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <BLEProvider>
          <SessionProvider>
            <InviteProvider>
              <InnerLayout />
            </InviteProvider>
          </SessionProvider>
        </BLEProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
