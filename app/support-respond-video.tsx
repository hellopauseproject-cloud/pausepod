import { FontAwesome5, Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Linking, Pressable, StyleSheet,
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

const RING_DOTS = 30;
const RING_R = 50;
const DOT_D = 6;
const RING_SIZE = (RING_R + DOT_D / 2 + 2) * 2;

function CountdownRing({ countdown }: { countdown: number }) {
  const cx = RING_SIZE / 2;
  const cy = RING_SIZE / 2;
  return (
    <View style={{ width: RING_SIZE, height: RING_SIZE, position: 'absolute' }}>
      {Array.from({ length: RING_DOTS }, (_, i) => {
        const angle = (i / RING_DOTS) * 2 * Math.PI - Math.PI / 2;
        const x = cx + RING_R * Math.cos(angle) - DOT_D / 2;
        const y = cy + RING_R * Math.sin(angle) - DOT_D / 2;
        const active = i >= RING_DOTS - countdown;
        return (
          <View key={i} style={{
            position: 'absolute', left: x, top: y,
            width: DOT_D, height: DOT_D, borderRadius: DOT_D / 2,
            backgroundColor: active ? '#e74c3c' : 'rgba(255,255,255,0.12)',
          }} />
        );
      })}
    </View>
  );
}

type Phase = 'preview' | 'recording' | 'reviewing' | 'uploading' | 'sent';

export default function SupportRespondVideoScreen() {
  const { user } = useAuth();
  const { storyId, ownerName } = useLocalSearchParams<{ storyId: string; ownerName: string }>();
  const insets = useSafeAreaInsets();

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  const permissionsReady = !!(cameraPermission?.granted && micPermission?.granted);
  const cameraDenied = cameraPermission?.canAskAgain === false;
  const micDenied = micPermission?.canAskAgain === false;

  const [phase, setPhase] = useState<Phase>('preview');
  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [videoEnded, setVideoEnded] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [countdown, setCountdown] = useState(30);
  const countdownRef = useRef(30);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cameraRef = useRef<CameraView>(null);

  // Be om kamerabehörighet direkt
  useEffect(() => {
    if (!cameraPermission) return;
    if (!cameraPermission.granted && cameraPermission.canAskAgain) {
      requestCameraPermission();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraPermission?.status]);

  // Be om mikrofonbehörighet när kamera är klar
  useEffect(() => {
    if (!cameraPermission?.granted) return;
    if (!micPermission) return;
    if (!micPermission.granted && micPermission.canAskAgain) {
      requestMicPermission();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraPermission?.granted, micPermission?.status]);

  const player = useVideoPlayer(
    phase === 'reviewing' && recordedUri ? { uri: recordedUri } : null,
    p => {
      p.loop = false;
      if (recordedUri) p.play();
    }
  );

  // Lyssna på när videon är klar → visa replay-indikator
  useEffect(() => {
    if (phase !== 'reviewing') return;
    const sub = player.addListener('playToEnd', () => setVideoEnded(true));
    return () => sub.remove();
  }, [player, phase]);

  const handleReplay = () => {
    setVideoEnded(false);
    player.seekTo(0);
    player.play();
  };

  if (!permissionsReady) {
    const permanentlyDenied = cameraDenied || micDenied;
    const deniedWhat = cameraDenied ? 'Kamera' : 'Mikrofon';
    return (
      <View style={[st.permContainer, { paddingBottom: insets.bottom + 24 }]}>
        <FontAwesome5 name="video" size={36} color="rgba(162,155,254,0.5)" />
        {permanentlyDenied ? (
          <>
            <Text style={st.permText}>
              {deniedWhat}tillstånd nekades.{'\n'}Aktivera i Inställningar → Appar → Integritet.
            </Text>
            <Pressable style={st.permBtn} onPress={() => Linking.openSettings()}>
              <Text style={st.permBtnText}>Öppna inställningar</Text>
            </Pressable>
          </>
        ) : cameraPermission?.granted ? (
          <>
            <Text style={st.permText}>Tillåt åtkomst till mikrofonen för att spela in video.</Text>
            <Pressable style={st.permBtn} onPress={() => requestMicPermission()}>
              <Text style={st.permBtnText}>Tillåt mikrofon</Text>
            </Pressable>
          </>
        ) : (
          <Text style={st.permText}>Begär kameratillstånd…</Text>
        )}
        <Pressable onPress={() => router.back()} style={[st.closeBtn, { top: insets.top + 12 }]}>
          <FontAwesome5 name="chevron-left" size={15} color="#fff" />
        </Pressable>
      </View>
    );
  }

  const stopRecording = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    cameraRef.current?.stopRecording();
  };

  const startRecording = async () => {
    if (!cameraRef.current) return;
    setPhase('recording');
    setErrorMsg('');
    setCountdown(30);
    countdownRef.current = 30;
    timerRef.current = setInterval(() => {
      countdownRef.current -= 1;
      setCountdown(countdownRef.current);
      if (countdownRef.current <= 0) {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        cameraRef.current?.stopRecording();
      }
    }, 1000);
    try {
      const result = await cameraRef.current.recordAsync({ maxDuration: 30 });
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (result?.uri) {
        setRecordedUri(result.uri);
        setVideoEnded(false);
        setPhase('reviewing');
      } else {
        setPhase('preview');
      }
    } catch {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setPhase('preview');
    }
  };

  const handleSend = async () => {
    if (!user || !recordedUri || !storyId) return;
    setPhase('uploading');
    try { player.pause(); } catch {}
    try {
      const path = `${user.id}/${Date.now()}.mp4`;
      const contentUrl = await uploadViaXhr(recordedUri, path, 'video/mp4');

      const { error: dbError } = await supabase.from('support_responses').insert({
        story_id: storyId,
        sender_id: user.id,
        response_type: 'video',
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
    setVideoEnded(false);
    setPhase('preview');
  };

  // Nedre padding = safe area + extra luft
  const bottomPad = insets.bottom + 32;

  return (
    <View style={st.container}>
      <TouchableOpacity
        onPress={() => router.back()}
        style={[st.closeBtn, { top: insets.top + 12 }]}
        activeOpacity={0.7}
      >
        <FontAwesome5 name="chevron-left" size={15} color="#fff" />
      </TouchableOpacity>

      <Text style={[st.title, { top: insets.top + 16 }]}>Videopepp till {ownerName}</Text>

      {phase === 'preview' && (
        <TouchableOpacity
          onPress={() => setFacing(f => f === 'front' ? 'back' : 'front')}
          style={[st.flipBtn, { top: insets.top + 12 }]}
          activeOpacity={0.7}
        >
          <Ionicons name="camera-reverse-outline" size={22} color="#fff" />
        </TouchableOpacity>
      )}

      {(phase === 'preview' || phase === 'recording') ? (
        <CameraView ref={cameraRef} style={st.camera} facing={facing} mode="video" />
      ) : phase === 'reviewing' && recordedUri ? (
        <View style={st.camera}>
          <VideoView style={StyleSheet.absoluteFill} player={player} nativeControls={false} />
          {/* Replay-overlay när videon är färdig */}
          {videoEnded && (
            <TouchableOpacity style={st.replayOverlay} onPress={handleReplay} activeOpacity={0.8}>
              <View style={st.replayBtn}>
                <FontAwesome5 name="redo" size={28} color="#fff" />
              </View>
              <Text style={st.replayLabel}>Se igen</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <View style={st.camera} />
      )}

      <View style={[st.controls, { paddingBottom: bottomPad }]}>
        {(phase === 'preview' || phase === 'recording') && (
          <>
            {phase === 'preview' && <Text style={st.hint}>Tryck för att spela in</Text>}
            <View style={{ width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center' }}>
              {phase === 'recording' && <CountdownRing countdown={countdown} />}
              <TouchableOpacity
                style={[st.recordBtn, phase === 'recording' && st.recordBtnActive]}
                onPress={phase === 'recording' ? stopRecording : startRecording}
                activeOpacity={0.85}
              >
                <FontAwesome5 name={phase === 'recording' ? 'stop' : 'circle'} size={28} color="#fff" />
              </TouchableOpacity>
            </View>
          </>
        )}

        {phase === 'reviewing' && (
          <View style={st.reviewActions}>
            <TouchableOpacity style={st.sendBtn} onPress={handleSend} activeOpacity={0.85}>
              <FontAwesome5 name="paper-plane" size={13} color="#fff" />
              <Text style={st.sendBtnText}>Skicka</Text>
            </TouchableOpacity>
          </View>
        )}

        {phase === 'uploading' && (
          <View style={{ alignItems: 'center', gap: 12 }}>
            <ActivityIndicator color="#a29bfe" size="large" />
            <Text style={st.hint}>Laddar upp…</Text>
          </View>
        )}

        {phase === 'sent' && (
          <View style={{ alignItems: 'center', gap: 12 }}>
            <View style={st.sentIcon}>
              <FontAwesome5 name="check" size={24} color="#fff" />
            </View>
            <Text style={st.hint}>Skickat!</Text>
          </View>
        )}

        {!!errorMsg && (
          <View style={st.errorBox}>
            <Text style={st.errorText}>{errorMsg}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  closeBtn: { position: 'absolute', left: 16, zIndex: 10, padding: 14 },
  flipBtn: { position: 'absolute', right: 20, zIndex: 10, padding: 10 },
  title: {
    position: 'absolute', alignSelf: 'center', zIndex: 10,
    color: '#fff', fontSize: 15, fontWeight: '600',
  },
  camera: { flex: 1 },
  controls: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 32,
    alignItems: 'center', gap: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingTop: 20,
  },
  hint: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  recordBtn: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#a29bfe', alignItems: 'center', justifyContent: 'center',
    borderWidth: 4, borderColor: 'rgba(255,255,255,0.3)',
  },
  recordBtnActive: { backgroundColor: '#e74c3c' },
  reviewActions: { width: '100%' },
  sendBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 28, backgroundColor: '#a29bfe',
  },
  sendBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  sentIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#27ae60', alignItems: 'center', justifyContent: 'center',
  },
  errorBox: {
    backgroundColor: 'rgba(231,76,60,0.12)', borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(231,76,60,0.3)',
    padding: 12, width: '100%',
  },
  errorText: { color: '#e74c3c', fontSize: 12, textAlign: 'center', lineHeight: 17 },

  // Replay overlay
  replayOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center', gap: 12,
  },
  replayBtn: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  replayLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 15 },

  permContainer: {
    flex: 1, backgroundColor: '#0f0f1a',
    alignItems: 'center', justifyContent: 'center',
    padding: 40, gap: 20,
  },
  permText: {
    color: 'rgba(255,255,255,0.7)', fontSize: 16,
    textAlign: 'center', lineHeight: 24,
  },
  permBtn: {
    backgroundColor: '#a29bfe', paddingVertical: 14, paddingHorizontal: 36,
    borderRadius: 28, marginTop: 8,
  },
  permBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
