import { Entypo, FontAwesome, FontAwesome5 } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Image, StyleSheet, Text, TouchableOpacity, Vibration, View } from 'react-native';
import { isInboxActive } from '../lib/inboxGuard';
import { supabase } from '../lib/supabase';
import { getPending, setPending } from '../lib/supportQueue';

type SupportInfo = {
  responseType: 'text' | 'voice' | 'video';
  senderName: string;
  senderAvatarUrl: string | null;
};

const VIBRATION_PATTERN = [0, 200, 1200, 200, 1200, 200, 1200, 200, 1200];

export default function CallScreen() {
  const ringtonePlayer = useAudioPlayer(require('../assets/images/Ringsignal.mp3'));
  const [callerName, setCallerName] = useState('');
  const [callerPhoto, setCallerPhoto] = useState<string | null>(null);
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

      const { data: myStories } = await supabase
        .from('support_stories')
        .select('id')
        .eq('user_id', userId)
        .eq('is_active', true);

      if (!myStories || myStories.length === 0) return;

      const { data: responses } = await supabase
        .from('support_responses')
        .select('id, story_id, response_type, content_url, text_content, sender_id')
        .in('story_id', myStories.map(s => s.id))
        .is('delivered_at', null)
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
        senderName: sender?.username ?? 'En vän',
        senderAvatarUrl: sender?.avatar_url ?? null,
      });

      setSupportInfo({
        responseType: r.response_type as 'text' | 'voice' | 'video',
        senderName: sender?.username ?? 'En vän',
        senderAvatarUrl: sender?.avatar_url ?? null,
      });
    };
    checkQueue();
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadProfile = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;
      const userId = session?.user?.id;
      if (!userId) return;
      const { data } = await supabase.from('profiles').select('username, avatar_url').eq('id', userId).maybeSingle();
      if (!mounted) return;
      if (!getPending()) {
        setCallerName(data?.username ?? 'Dig själv');
        setCallerPhoto(data?.avatar_url ?? null);
      }
    };
    loadProfile();

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

  const handleAccept = async (fallback: 'voice' | 'video' = 'voice') => {
    await stopRinging();
    const pending = getPending();
    if (pending) {
      if (pending.responseType === 'text') router.replace('/support-view-text');
      else if (pending.responseType === 'video') router.replace('/video');
      else router.replace('/voice');
    } else {
      router.replace(fallback === 'video' ? '/video' : '/voice');
    }
  };

  const handleHangUp = async () => {
    await stopRinging();
    router.replace('/(tabs)');
  };

  const displayName = supportInfo ? supportInfo.senderName : (callerName || 'Dig själv');
  const displayPhoto = supportInfo ? supportInfo.senderAvatarUrl : callerPhoto;
  const displaySubtitle = supportInfo
    ? `Pepp från ${supportInfo.senderName} (${supportInfo.responseType === 'text' ? 'text' : supportInfo.responseType === 'voice' ? 'röst' : 'video'})`
    : 'Inkommande samtal...';

  return (
    <View style={styles.container}>
      <View style={styles.logoContainer}>
        <FontAwesome name="pause" size={16} color="#2e86de" />
        <Text style={styles.appName}>PAUSE POD</Text>
      </View>

      <View style={styles.callerInfo}>
        {displayPhoto ? (
          <Image source={{ uri: displayPhoto }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <FontAwesome5 name="user" size={48} color="#2e86de" />
          </View>
        )}
        <Text style={styles.callerName}>{displayName}</Text>
        <Text style={styles.callerSubtitle}>{displaySubtitle}</Text>
      </View>

      <View style={styles.buttons}>
        <View style={styles.buttonRow}>
          {!supportInfo ? (
            <>
              <TouchableOpacity style={styles.videoButton} onPress={() => handleAccept('video')}>
                <FontAwesome5 name="video" size={28} color="white" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.voiceButton} onPress={() => handleAccept('voice')}>
                <FontAwesome5 name="phone-alt" size={28} color="white" />
              </TouchableOpacity>
            </>
          ) : supportInfo.responseType === 'video' ? (
            <TouchableOpacity style={styles.videoButton} onPress={() => handleAccept()}>
              <FontAwesome5 name="video" size={28} color="white" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.voiceButton} onPress={() => handleAccept()}>
              <FontAwesome5 name="phone-alt" size={28} color="white" />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity style={styles.hangUpButton} onPress={handleHangUp}>
          <Entypo name="block" size={28} color="white" />
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
    color: '#2e86de',
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
    backgroundColor: '#2a2a3e',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 30,
    borderWidth: 2,
    borderColor: '#2e86de',
  },
  callerName: {
    fontSize: 36,
    color: 'white',
    fontWeight: 'bold',
    marginBottom: 8,
  },
  callerSubtitle: {
    fontSize: 18,
    color: '#aaa',
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
    backgroundColor: '#2ecc71',
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoButton: {
    backgroundColor: '#2e86de',
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hangUpButton: {
    backgroundColor: '#e74c3c',
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
