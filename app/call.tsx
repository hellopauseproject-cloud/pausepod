import { Entypo, FontAwesome, FontAwesome5 } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { AppState, Image, StyleSheet, Text, TouchableOpacity, Vibration, View } from 'react-native';
import { isInboxActive } from '../lib/inboxGuard';
import { supabase } from '../lib/supabase';
import { unopenedResponsesQuery } from '../lib/supportStories';
import { getPending, setPending } from '../lib/supportQueue';
import { AppPalette } from '../constants/appTheme';
import { RoomProvider, usePalette } from '../contexts/ThemeContext';
import { roomShell, ScreenBackground } from '../components/screen-background';

type SupportInfo = {
  responseType: 'text' | 'voice' | 'video';
  senderName: string;
  senderAvatarUrl: string | null;
};

const VIBRATION_PATTERN = [0, 200, 1200, 200, 1200, 200, 1200, 200, 1200];

/**
 * Hör till **friends-rummet**. Rummet följer ärendet och inte filträdet — se
 * ROOMS i [constants/appTheme.ts](../constants/appTheme.ts). Skalet är
 * identiskt med de andra rummens: en komponent kan inte läsa sin egen
 * provider, och en bakgrund i skalet täcker varje gren skärmen returnerar.
 */
export default function CallRoom() {
  return (
    <RoomProvider room="friends">
      <View style={roomShell}>
        <ScreenBackground room="friends" />
        <CallScreen />
      </View>
    </RoomProvider>
  );
}

function CallScreen() {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  const ringtonePlayer = useAudioPlayer(require('../assets/images/Ringsignal.mp3'));
  const [supportInfo, setSupportInfo] = useState<SupportInfo | null>(null);

  useEffect(() => {
    if (isInboxActive()) {
      return;
    }
  }, []);

  // Check for a queued support response and override caller display
  useEffect(() => {
    const checkQueue = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) return;

      // Bara det som faktiskt ringer. Frågan tog förut det äldsta oöppnade
      // svaret av VILKEN sort som helst, trots att vägen hit (luren i Friends)
      // bara öppnas när det finns röst eller video — ett äldre textsvar kunde
      // alltså ringa som ett samtal. Med fotosvaret blev det värre: `photo`
      // finns inte i ternären som sätter underrubriken och hade fallit igenom
      // till "video". Sorterna som inte ringer bärs av kuvertet i stället.
      // Svaren överlever förfrågan: alla egna stories, också utgångna.
      const { data: responses } = await unopenedResponsesQuery(
        userId, 'id, story_id, response_type, content_url, text_content, sender_id',
      )
        .in('response_type', ['voice', 'video'])
        .order('created_at', { ascending: true })
        .limit(1);

      if (!responses || responses.length === 0) return;
      const r = responses[0];

      const { data: sender } = await supabase
        .from('profiles').select('username, avatar_url').eq('id', r.sender_id).maybeSingle();

      setPending({
        id: r.id,
        storyId: r.story_id,
        responseType: r.response_type as 'text' | 'voice' | 'video',
        contentUrl: r.content_url,
        textContent: r.text_content,
        senderName: sender?.username ?? 'A friend',
        senderAvatarUrl: sender?.avatar_url ?? null,
      });

      setSupportInfo({
        responseType: r.response_type as 'text' | 'voice' | 'video',
        senderName: sender?.username ?? 'A friend',
        senderAvatarUrl: sender?.avatar_url ?? null,
      });
    };
    checkQueue();
  }, []);

  useEffect(() => {
    let mounted = true;

    const startAudio = async () => {
      if (!mounted) return;
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          interruptionMode: 'doNotMix',
          shouldRouteThroughEarpiece: false,
        });
        if (!mounted) return;
        ringtonePlayer.loop = true;
        ringtonePlayer.play();
      } catch (e) {
        console.log('Audio error:', e);
      }
      if (mounted) Vibration.vibrate(VIBRATION_PATTERN, true);
    };

    let audioTimer: ReturnType<typeof setTimeout> | null = null;

    if (AppState.currentState === 'active') {
      audioTimer = setTimeout(startAudio, 1000);
    } else {
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          sub.remove();
          audioTimer = setTimeout(startAudio, 500);
        }
      });
      return () => {
        mounted = false;
        sub.remove();
        if (audioTimer) clearTimeout(audioTimer);
        Vibration.cancel();
        try { ringtonePlayer.pause(); } catch {}
      };
    }

    return () => {
      mounted = false;
      if (audioTimer) clearTimeout(audioTimer);
      Vibration.cancel();
      try { ringtonePlayer.pause(); } catch {}
    };
  }, []);

  const stopRinging = async () => {
    Vibration.cancel();
    try {
      ringtonePlayer.loop = false;
      ringtonePlayer.pause();
    } catch (e) {}
    await new Promise(resolve => setTimeout(resolve, 300));
  };

  const handleAccept = async () => {
    await stopRinging();
    const pending = getPending();
    if (!pending) { router.replace('/(tabs)'); return; }
    if (pending.responseType === 'text') router.replace('/support-view-text');
    else if (pending.responseType === 'video') router.replace('/video');
    else router.replace('/voice');
  };

  const handleHangUp = async () => {
    await stopRinging();
    router.replace('/(tabs)');
  };

  const displayName = supportInfo ? supportInfo.senderName : 'Connecting...';
  const displayPhoto = supportInfo ? supportInfo.senderAvatarUrl : null;
  const displaySubtitle = supportInfo
    ? `Support from ${supportInfo.senderName} (${supportInfo.responseType === 'text' ? 'text' : supportInfo.responseType === 'voice' ? 'voice' : 'video'})`
    : 'Incoming call...';

  return (
    <View style={styles.container}>
      <View style={styles.logoContainer}>
        <FontAwesome name="pause" size={16} color={Palette.accent} />
        <Text style={styles.appName}>PAUSE POD</Text>
      </View>

      <View style={styles.callerInfo}>
        {displayPhoto ? (
          <Image source={{ uri: displayPhoto }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <FontAwesome5 name="user" size={48} color={Palette.accent} />
          </View>
        )}
        <Text style={styles.callerName}>{displayName}</Text>
        <Text style={styles.callerSubtitle}>{displaySubtitle}</Text>
      </View>

      <View style={styles.buttons}>
        <View style={styles.buttonRow}>
          {!supportInfo ? (
            <>
              <TouchableOpacity style={styles.videoButton} onPress={handleAccept}>
                <FontAwesome5 name="video" size={28} color={Palette.onAccent} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.voiceButton} onPress={handleAccept}>
                <FontAwesome5 name="phone-alt" size={28} color={Palette.onAccent} />
              </TouchableOpacity>
            </>
          ) : supportInfo.responseType === 'video' ? (
            <TouchableOpacity style={styles.videoButton} onPress={handleAccept}>
              <FontAwesome5 name="video" size={28} color={Palette.onAccent} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.voiceButton} onPress={handleAccept}>
              <FontAwesome5 name="phone-alt" size={28} color={Palette.onAccent} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity style={styles.hangUpButton} onPress={handleHangUp}>
          <Entypo name="block" size={28} color={Palette.onAccent} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (Palette: AppPalette) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
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
    color: Palette.accent,
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
    backgroundColor: Palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 30,
    borderWidth: 2,
    borderColor: Palette.accent,
  },
  callerName: {
    fontSize: 36,
    color: Palette.textPrimary,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  callerSubtitle: {
    fontSize: 18,
    color: Palette.textSecondary,
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
    backgroundColor: Palette.callAccept,
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoButton: {
    backgroundColor: Palette.accent,
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hangUpButton: {
    backgroundColor: Palette.danger,
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
