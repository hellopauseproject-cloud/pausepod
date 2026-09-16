import { FontAwesome5 } from '@expo/vector-icons';
import { RecordingPresets, getRecordingPermissionsAsync, requestRecordingPermissionsAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder } from 'expo-audio';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Linking, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

const SUPABASE_URL = 'https://iwyumzgewiwvcbuqzjnk.supabase.co';
const BUCKET = 'support-media';

async function uploadViaXhr(localUri: string, storagePath: string, mimeType: string): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Inte inloggad');

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`HTTP ${xhr.status}: ${xhr.responseText}`));
    };
    xhr.onerror = () => reject(new Error('Nätverksfel'));
    const form = new FormData();
    form.append('', { uri: localUri, type: mimeType, name: storagePath.split('/').pop() ?? 'file' } as any);
    xhr.send(form);
  });

  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;
}

type Phase = 'idle' | 'recording' | 'reviewing' | 'uploading' | 'sent';

export default function SupportRespondVoiceScreen() {
  const { user } = useAuth();
  const { storyId, ownerName } = useLocalSearchParams<{ storyId: string; ownerName: string }>();
  const insets = useSafeAreaInsets();

  const [permDeniedPerm, setPermDeniedPerm] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [phase, setPhase] = useState<Phase>('idle');
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const durationRef = useRef(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

  const player = useAudioPlayer(recordedUri ? { uri: recordedUri } : null);
  const playerStatus = useAudioPlayerStatus(player);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      try { player.pause(); } catch {}
    };
  }, []);

  const startRecording = async () => {
    setErrorMsg('');
    try {
      // Kolla nuläget utan att visa dialog
      const current = await getRecordingPermissionsAsync();
      if (!current.granted) {
        if (!current.canAskAgain) {
          setPermDeniedPerm(true);
          return;
        }
        const result = await requestRecordingPermissionsAsync();
        if (!result.granted) {
          if (!result.canAskAgain) setPermDeniedPerm(true);
          return;
        }
      }
    } catch { /* fortsätt ändå, låt prepareToRecordAsync kasta om det behövs */ }

    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase('recording');
      setDuration(0);
      durationRef.current = 0;
      timerRef.current = setInterval(() => {
        durationRef.current += 1;
        setDuration(durationRef.current);
        if (durationRef.current >= 59) {
          if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
          stopRecording();
        }
      }, 1000);

      pulseLoop.current = Animated.loop(Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.25, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]));
      pulseLoop.current.start();
    } catch (e: any) {
      setErrorMsg('Kunde inte starta inspelning: ' + (e?.message ?? 'okänt fel'));
    }
  };

  const stopRecording = async () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    pulseLoop.current?.stop();
    pulseAnim.setValue(1);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (uri) {
        setRecordedUri(uri);
        setPhase('reviewing');
      } else {
        setErrorMsg('Inspelningen misslyckades — ingen fil skapades.');
        setPhase('idle');
      }
    } catch (e: any) {
      setErrorMsg('Stoppa-fel: ' + (e?.message ?? 'okänt fel'));
      setPhase('idle');
    }
  };

  const handleSend = async () => {
    if (!user || !recordedUri || !storyId) return;
    setPhase('uploading');
    try { player.pause(); } catch {}

    try {
      const path = `${user.id}/${Date.now()}.m4a`;
      const contentUrl = await uploadViaXhr(recordedUri, path, 'audio/m4a');

      const { error: dbError } = await supabase.from('support_responses').insert({
        story_id: storyId,
        sender_id: user.id,
        response_type: 'voice',
        content_url: contentUrl,
      });
      if (dbError) throw dbError;

      setPhase('sent');
      setTimeout(() => router.back(), 900);
    } catch (e: any) {
      setErrorMsg('Uppladdningsfel: ' + (e?.message ?? JSON.stringify(e)));
      setPhase('reviewing');
    }
  };

  const handleReRecord = () => {
    try { player.pause(); } catch {}
    setRecordedUri(null);
    setDuration(0);
    setPhase('idle');
  };

  const togglePlay = () => {
    if (playerStatus.playing) player.pause();
    else player.play();
  };

  const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  // Permission nekad permanent
  if (permDeniedPerm) {
    return (
      <View style={[st.container, { paddingBottom: insets.bottom + 24 }]}>
        <View style={st.header}>
          <TouchableOpacity onPress={() => router.back()} style={st.closeBtn} activeOpacity={0.7}>
            <FontAwesome5 name="chevron-left" size={15} color="#2e86de" />
          </TouchableOpacity>
          <Text style={st.title}>Röstpepp till {ownerName}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={st.mainArea}>
          <FontAwesome5 name="microphone-slash" size={40} color="rgba(162,155,254,0.4)" />
          <Text style={st.permText}>
            Mikrofonåtkomst nekades.{'\n'}Aktivera i Inställningar → Appar → Integritet.
          </Text>
          <TouchableOpacity style={st.sendBtn} onPress={() => Linking.openSettings()} activeOpacity={0.85}>
            <Text style={st.sendBtnText}>Öppna inställningar</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[st.container, { paddingBottom: insets.bottom + 24 }]}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => router.back()} style={st.closeBtn} activeOpacity={0.7}>
          <FontAwesome5 name="chevron-left" size={15} color="#2e86de" />
        </TouchableOpacity>
        <Text style={st.title}>Röstpepp till {ownerName}</Text>
        <View style={{ width: 40 }} />
      </View>

      <Text style={st.subtitle}>Max 60 sekunder.</Text>

      <View style={st.mainArea}>
        {phase === 'idle' && (
          <>
            <TouchableOpacity style={st.recordBtn} onPress={startRecording} activeOpacity={0.85}>
              <FontAwesome5 name="microphone" size={36} color="#fff" />
            </TouchableOpacity>
            <Text style={st.hintText}>Tryck för att börja spela in</Text>
          </>
        )}

        {phase === 'recording' && (
          <>
            <Animated.View style={[st.recordingRing, { transform: [{ scale: pulseAnim }] }]}>
              <TouchableOpacity style={st.recordBtn} onPress={stopRecording} activeOpacity={0.85}>
                <FontAwesome5 name="stop" size={28} color="#fff" />
              </TouchableOpacity>
            </Animated.View>
            <Text style={st.durationText}>{fmtDur(duration)}</Text>
            <Text style={st.hintText}>Tryck för att stoppa</Text>
          </>
        )}

        {phase === 'reviewing' && (
          <View style={st.reviewArea}>
            <Text style={st.durationText}>{fmtDur(duration)}</Text>
            <View style={st.reviewBtns}>
              <TouchableOpacity style={st.playBtn} onPress={togglePlay} activeOpacity={0.85}>
                <FontAwesome5 name={playerStatus.playing ? 'pause' : 'play'} size={22} color="#fff" />
              </TouchableOpacity>
            </View>
            <View style={st.reviewActions}>
              <TouchableOpacity style={st.reRecordBtn} onPress={handleReRecord} activeOpacity={0.75}>
                <FontAwesome5 name="redo" size={13} color="rgba(255,255,255,0.5)" />
                <Text style={st.reRecordText}>Spela in igen</Text>
              </TouchableOpacity>
              <TouchableOpacity style={st.sendBtn} onPress={handleSend} activeOpacity={0.85}>
                <FontAwesome5 name="paper-plane" size={13} color="#fff" />
                <Text style={st.sendBtnText}>Skicka</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {phase === 'uploading' && (
          <>
            <ActivityIndicator color="#a29bfe" size="large" />
            <Text style={st.hintText}>Laddar upp…</Text>
          </>
        )}

        {phase === 'sent' && (
          <>
            <View style={st.sentIcon}>
              <FontAwesome5 name="check" size={28} color="#fff" />
            </View>
            <Text style={st.hintText}>Skickat!</Text>
          </>
        )}
      </View>

      {!!errorMsg && (
        <View style={st.errorBox}>
          <Text style={st.errorText}>{errorMsg}</Text>
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: '#0f0f1a',
    paddingHorizontal: 24, paddingTop: 60, gap: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  closeBtn: { width: 44, height: 44, justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: '#ffffff', letterSpacing: 0.2 },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginBottom: 12 },
  mainArea: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 },
  permText: { fontSize: 15, color: 'rgba(255,255,255,0.6)', textAlign: 'center', lineHeight: 24 },
  recordBtn: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: '#a29bfe', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#a29bfe', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 8,
  },
  recordingRing: {
    width: 130, height: 130, borderRadius: 65,
    backgroundColor: 'rgba(162,155,254,0.15)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(162,155,254,0.3)',
  },
  durationText: { fontSize: 48, fontWeight: '800', color: '#ffffff', letterSpacing: -1 },
  hintText: { fontSize: 14, color: 'rgba(255,255,255,0.35)', textAlign: 'center' },
  reviewArea: { alignItems: 'center', gap: 24, width: '100%' },
  reviewBtns: { flexDirection: 'row', gap: 16 },
  playBtn: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(162,155,254,0.2)', borderWidth: 1.5, borderColor: '#a29bfe',
    alignItems: 'center', justifyContent: 'center',
  },
  reviewActions: { flexDirection: 'row', gap: 16, width: '100%' },
  reRecordBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 28,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  reRecordText: { color: 'rgba(255,255,255,0.5)', fontSize: 14, fontWeight: '600' },
  sendBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 28, backgroundColor: '#a29bfe',
  },
  sendBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  sentIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#27ae60', alignItems: 'center', justifyContent: 'center',
  },
  errorBox: {
    backgroundColor: 'rgba(231,76,60,0.12)', borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(231,76,60,0.3)',
    padding: 12, marginBottom: 8,
  },
  errorText: { color: '#e74c3c', fontSize: 13, textAlign: 'center', lineHeight: 18 },
});
