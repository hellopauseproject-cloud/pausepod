import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const TIPS = [
  { emoji: '💭', text: 'Berätta för dig själv varför du vill ta fler pauser från telefonen' },
  { emoji: '🌿', text: 'Beskriv hur du vill att en bra paus ska kännas' },
  { emoji: '💪', text: 'Prata med dig själv som du skulle prata med en vän som behöver en paus' },
  { emoji: '🎯', text: 'Påminn dig om vad du hellre vill lägga din tid på just nu' },
];

// ─── Voice recording tab ──────────────────────────────────────────────────────
function VoiceRecordTab({ onFileReady }: { onFileReady: (uri: string) => void }) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const startRecording = async () => {
    const { granted } = await Audio.requestPermissionsAsync();
    if (!granted) return;
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const { recording } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY
    );
    recordingRef.current = recording;
    setIsRecording(true);
    setSeconds(0);
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    pulseLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.25, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    pulseLoop.current.start();
  };

  const stopRecording = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    pulseLoop.current?.stop();
    pulseAnim.setValue(1);
    setIsRecording(false);
    if (!recordingRef.current) return;
    await recordingRef.current.stopAndUnloadAsync();
    const uri = recordingRef.current.getURI();
    recordingRef.current = null;
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
    if (uri) {
      setRecordedUri(uri);
      onFileReady(uri);
    }
  };

  const togglePreview = async () => {
    if (isPlaying) {
      await soundRef.current?.stopAsync();
      await soundRef.current?.unloadAsync();
      soundRef.current = null;
      setIsPlaying(false);
    } else {
      if (!recordedUri) return;
      const { sound } = await Audio.Sound.createAsync({ uri: recordedUri });
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((st) => {
        if (st.isLoaded && st.didJustFinish) setIsPlaying(false);
      });
      await sound.playAsync();
      setIsPlaying(true);
    }
  };

  const reRecord = async () => {
    await soundRef.current?.stopAsync();
    await soundRef.current?.unloadAsync();
    soundRef.current = null;
    setIsPlaying(false);
    setRecordedUri(null);
    setSeconds(0);
  };

  useEffect(() => {
    return () => {
      recordingRef.current?.stopAndUnloadAsync();
      soundRef.current?.unloadAsync();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return (
    <View style={s.tabContent}>
      <Animated.View style={{ transform: [{ scale: isRecording ? pulseAnim : 1 }] }}>
        <Ionicons
          name={isRecording ? 'mic' : 'mic-outline'}
          size={64}
          color={isRecording ? '#e74c3c' : '#2e86de'}
        />
      </Animated.View>

      {(isRecording || recordedUri) && (
        <Text style={s.durationText}>{fmt(seconds)}</Text>
      )}

      {recordedUri && !isRecording && (
        <View style={s.previewRow}>
          <TouchableOpacity style={s.previewBtn} onPress={togglePreview}>
            <Ionicons name={isPlaying ? 'pause' : 'play'} size={22} color="white" />
          </TouchableOpacity>
          <Text style={s.previewLabel}>Förhandsgranska</Text>
        </View>
      )}

      <TouchableOpacity
        style={[s.recordBtn, isRecording && s.recordBtnActive]}
        onPress={isRecording ? stopRecording : startRecording}
      >
        <Text style={s.recordBtnText}>
          {isRecording ? '■  Avsluta' : recordedUri ? '● Spela in igen' : '●  Starta inspelning'}
        </Text>
      </TouchableOpacity>

      {recordedUri && !isRecording && (
        <TouchableOpacity onPress={reRecord}>
          <Text style={s.rerecordLink}>Börja om</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Video recording tab ──────────────────────────────────────────────────────
function VideoRecordTab({ onFileReady }: { onFileReady: (uri: string) => void }) {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingReady, setRecordingReady] = useState(false);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const readyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fmt = (secs: number) =>
    `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;

  const startRecording = async () => {
    const { granted: audioGranted } = await Audio.requestPermissionsAsync();
    if (!audioGranted) return;
    setIsRecording(true);
    setRecordingReady(false);
    setSeconds(0);
    timerRef.current = setInterval(() => setSeconds((secs) => secs + 1), 1000);
    readyTimerRef.current = setTimeout(() => setRecordingReady(true), 800);
    try {
      const result = await cameraRef.current?.recordAsync({ maxDuration: 120 });
      if (result?.uri) {
        setRecordedUri(result.uri);
        onFileReady(result.uri);
      }
    } catch {
      // "stopped before data could be produced" — cancelled during init, safe to ignore
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      if (readyTimerRef.current) clearTimeout(readyTimerRef.current);
      setIsRecording(false);
      setRecordingReady(false);
    }
  };

  const stopRecording = () => {
    if (!recordingReady) return;
    cameraRef.current?.stopRecording();
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (readyTimerRef.current) clearTimeout(readyTimerRef.current);
    };
  }, []);

  if (!cameraPermission) return <View style={s.tabContent} />;

  if (!cameraPermission.granted) {
    return (
      <View style={s.tabContent}>
        <Ionicons name="videocam-off-outline" size={48} color="#555" style={{ marginBottom: 16 }} />
        <Text style={{ color: '#aaa', marginBottom: 20, textAlign: 'center', paddingHorizontal: 24 }}>
          Kameraåtkomst behövs för att spela in video
        </Text>
        <TouchableOpacity style={s.nextButton} onPress={requestCameraPermission}>
          <Text style={s.nextText}>Tillåt kamera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={s.tabContent}>
      {recordedUri ? (
        <VideoUploadPreview uri={recordedUri} />
      ) : (
        <View style={s.cameraPreviewBox}>
          <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="front" mode="video" />
          {isRecording && (
            <View style={s.recordingBadge}>
              <View style={s.recordingDot} />
              <Text style={s.recordingTime}>{recordingReady ? fmt(seconds) : '…'}</Text>
            </View>
          )}
        </View>
      )}

      <TouchableOpacity
        style={[
          s.recordBtn,
          isRecording && s.recordBtnActive,
          isRecording && !recordingReady && s.recordBtnDisabled,
        ]}
        onPress={isRecording ? stopRecording : (recordedUri ? undefined : startRecording)}
        disabled={(!!recordedUri && !isRecording) || (isRecording && !recordingReady)}
      >
        <Text style={s.recordBtnText}>
          {isRecording
            ? recordingReady ? '■  Avsluta' : 'Startar...'
            : recordedUri ? 'Inspelad' : '●  Starta inspelning'}
        </Text>
      </TouchableOpacity>

      {recordedUri && !isRecording && (
        <TouchableOpacity onPress={() => setRecordedUri(null)}>
          <Text style={s.rerecordLink}>Spela in igen</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Video preview wrapper (useVideoPlayer must be at component level) ─────────
function VideoUploadPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.loop = true;
    p.play();
  });
  return <VideoView player={player} style={s.videoPreviewSmall} nativeControls={false} />;
}

// ─── Upload tab ───────────────────────────────────────────────────────────────
function UploadTab({
  format,
  onFileReady,
  onComplete,
  onBack,
}: {
  format: 'voice' | 'video';
  onFileReady: (uri: string) => Promise<void>;
  onComplete: () => void;
  onBack: () => void;
}) {
  const [selected, setSelected] = useState<{ uri: string; name: string } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  const pickFile = async () => {
    if (format === 'voice') {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
      if (!result.canceled && result.assets[0]) {
        setSelected({ uri: result.assets[0].uri, name: result.assets[0].name });
      }
    } else {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        quality: 1,
      });
      if (!result.canceled && result.assets[0]) {
        const name = result.assets[0].uri.split('/').pop() ?? 'video.mp4';
        setSelected({ uri: result.assets[0].uri, name });
      }
    }
  };

  const toggleAudioPreview = async () => {
    if (format !== 'voice' || !selected) return;
    if (isPlaying) {
      await soundRef.current?.stopAsync();
      await soundRef.current?.unloadAsync();
      soundRef.current = null;
      setIsPlaying(false);
    } else {
      const { sound } = await Audio.Sound.createAsync({ uri: selected.uri });
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((st) => {
        if (st.isLoaded && st.didJustFinish) setIsPlaying(false);
      });
      await sound.playAsync();
      setIsPlaying(true);
    }
  };

  const handleUseFile = async () => {
    if (!selected) return;
    await onFileReady(selected.uri);
    onComplete();
  };

  useEffect(() => {
    return () => { soundRef.current?.unloadAsync(); };
  }, []);

  if (!selected) {
    return (
      <View style={s.uploadArea}>
        <TouchableOpacity style={s.uploadBox} onPress={pickFile}>
          <Ionicons name="cloud-upload-outline" size={48} color="rgba(46,134,222,0.5)" />
          <Text style={s.uploadBoxLabel}>Tryck för att välja fil</Text>
          <Text style={s.uploadBoxHint}>
            {format === 'voice' ? 'Röstmemo, inspelning eller ljud' : 'Video från kamerarullen'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onBack} style={s.backButton}>
          <Text style={s.backButtonText}>← Tillbaka</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={s.uploadArea}>
      {format === 'video' ? (
        <VideoUploadPreview uri={selected.uri} />
      ) : (
        <View style={s.audioFileCard}>
          <Ionicons name="musical-note-outline" size={32} color="#2e86de" />
        </View>
      )}
      <Text style={s.uploadFileName} numberOfLines={1} ellipsizeMode="middle">
        {selected.name}
      </Text>
      {format === 'voice' && (
        <TouchableOpacity style={s.previewBtn} onPress={toggleAudioPreview}>
          <Ionicons name={isPlaying ? 'pause' : 'play'} size={22} color="white" />
        </TouchableOpacity>
      )}
      <TouchableOpacity onPress={() => setSelected(null)}>
        <Text style={s.changeFileLink}>Byt fil</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.useFileBtn} onPress={handleUseFile}>
        <Text style={s.nextText}>Använd den här →</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onBack} style={s.backButton}>
        <Text style={s.backButtonText}>← Tillbaka</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── RecordScreen (exported) ──────────────────────────────────────────────────
export default function RecordScreen({
  format,
  onComplete,
  onBack,
}: {
  format: 'voice' | 'video';
  onComplete: (savedUri: string) => void;
  onBack: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'record' | 'upload'>('record');
  const [fileReady, setFileReady] = useState(false);
  const savedDestRef = useRef<string | null>(null);
  const [showTips, setShowTips] = useState(false);
  const tipSlideAnim = useRef(new Animated.Value(400)).current;

  const handleFileReady = async (uri: string) => {
    const destName = format === 'voice' ? 'voiceMessage.m4a' : 'videoMessage.mp4';
    const dest = (FileSystem.documentDirectory ?? '') + destName;
    await FileSystem.copyAsync({ from: uri, to: dest });
    savedDestRef.current = dest;
    setFileReady(true);
  };

  const handleComplete = () => {
    if (savedDestRef.current) onComplete(savedDestRef.current);
  };

  const openTips = () => {
    setShowTips(true);
    tipSlideAnim.setValue(400);
    Animated.spring(tipSlideAnim, { toValue: 0, friction: 8, useNativeDriver: true }).start();
  };

  const closeTips = () => {
    Animated.timing(tipSlideAnim, { toValue: 400, duration: 250, useNativeDriver: true }).start(
      () => setShowTips(false)
    );
  };

  return (
    <View style={{ flex: 1 }}>
      {/* Header */}
      <View style={s.headerRow}>
        <Text style={s.headerSubtitle} />
        <TouchableOpacity style={s.bulbBtn} onPress={openTips}>
          <Ionicons name="bulb-outline" size={20} color="#2e86de" />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={s.tabRow}>
        <TouchableOpacity style={s.tabBtn} onPress={() => setActiveTab('record')}>
          <Ionicons
            name={format === 'voice' ? 'mic-outline' : 'videocam-outline'}
            size={15}
            color={activeTab === 'record' ? '#E8E8E8' : '#666'}
          />
          <Text style={[s.tabText, activeTab === 'record' && s.tabTextActive]}>Spela in</Text>
          {activeTab === 'record' && <View style={s.tabIndicator} />}
        </TouchableOpacity>
        <View style={{ width: 32 }} />
        <TouchableOpacity style={s.tabBtn} onPress={() => setActiveTab('upload')}>
          <Ionicons
            name="cloud-upload-outline"
            size={15}
            color={activeTab === 'upload' ? '#E8E8E8' : '#666'}
          />
          <Text style={[s.tabText, activeTab === 'upload' && s.tabTextActive]}>Ladda upp</Text>
          {activeTab === 'upload' && <View style={s.tabIndicator} />}
        </TouchableOpacity>
      </View>

      {/* Tab content */}
      <View style={{ flex: 1 }}>
        {activeTab === 'record' ? (
          format === 'voice' ? (
            <VoiceRecordTab onFileReady={handleFileReady} />
          ) : (
            <VideoRecordTab onFileReady={handleFileReady} />
          )
        ) : (
          <UploadTab
            format={format}
            onFileReady={handleFileReady}
            onComplete={handleComplete}
            onBack={onBack}
          />
        )}
      </View>

      {/* Footer — only shown for record tab */}
      {activeTab === 'record' && (
        <View style={s.buttonGroup}>
          <TouchableOpacity
            style={[s.nextButton, !fileReady && s.nextButtonDisabled]}
            onPress={handleComplete}
            disabled={!fileReady}
          >
            <Text style={s.nextText}>Klar →</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onBack} style={s.backButton}>
            <Text style={s.backButtonText}>← Tillbaka</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Tips modal */}
      <Modal transparent visible={showTips} animationType="none" onRequestClose={closeTips}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={closeTips}>
          <Animated.View style={[s.modalSheet, { transform: [{ translateY: tipSlideAnim }] }]}>
            <TouchableOpacity activeOpacity={1} onPress={() => {}}>
              <View style={s.modalHeader}>
                <Text style={s.modalTitle}>Inspiration</Text>
                <TouchableOpacity onPress={closeTips} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close" size={22} color="#666" />
                </TouchableOpacity>
              </View>
              {TIPS.map((tip, i) => (
                <View key={i} style={s.tipRow}>
                  <Text style={s.tipEmoji}>{tip.emoji}</Text>
                  <Text style={s.tipText}>{tip.text}</Text>
                </View>
              ))}
              <Text style={s.tipFooter}>10–30 sekunder räcker. Ingen annan hör det.</Text>
            </TouchableOpacity>
          </Animated.View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  // Buttons
  buttonGroup: {
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 32,
    paddingBottom: 40,
  },
  nextButton: {
    backgroundColor: '#2e86de',
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 32,
    marginTop: 24,
    width: '100%',
    alignItems: 'center',
  },
  nextButtonDisabled: {
    backgroundColor: '#333',
  },
  nextText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  backButton: {
    marginTop: 8,
    marginBottom: 10,
    padding: 8,
  },
  backButtonText: {
    color: '#777',
    fontSize: 14,
  },

  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 12,
  },
  headerSubtitle: {
    flex: 1,
    color: '#8a9a8e',
    fontSize: 14,
    lineHeight: 20,
  },
  bulbBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(46,134,222,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Tabs
  tabRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#1e2a3a',
    marginBottom: 4,
  },
  tabBtn: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 4,
    position: 'relative',
  },
  tabText: {
    color: '#666',
    fontSize: 14,
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#E8E8E8',
  },
  tabIndicator: {
    position: 'absolute',
    bottom: -1,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#2e86de',
  },

  // Tab content
  tabContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  durationText: {
    color: '#E8E8E8',
    fontSize: 24,
    fontWeight: '600',
    letterSpacing: 2,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  previewBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#2e86de',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewLabel: {
    color: '#8a9a8e',
    fontSize: 13,
  },
  recordBtn: {
    backgroundColor: '#2a2a3e',
    borderRadius: 32,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderWidth: 1.5,
    borderColor: '#2e86de',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recordBtnActive: {
    borderColor: '#e74c3c',
    backgroundColor: 'rgba(231,76,60,0.1)',
  },
  recordBtnDisabled: {
    borderColor: '#333',
    backgroundColor: 'transparent',
    opacity: 0.5,
  },
  recordBtnText: {
    color: '#E8E8E8',
    fontSize: 15,
    fontWeight: '500',
  },
  rerecordLink: {
    color: '#2e86de',
    fontSize: 13,
  },

  // Camera
  cameraPreviewBox: {
    width: 200,
    height: 280,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  recordingBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#e74c3c',
  },
  recordingTime: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  videoPreviewSmall: {
    width: 200,
    height: 280,
    borderRadius: 16,
  },

  // Upload tab
  uploadArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 14,
  },
  uploadBox: {
    width: 200,
    height: 200,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(46,134,222,0.3)',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  uploadBoxLabel: {
    color: '#8a9a8e',
    fontSize: 14,
    textAlign: 'center',
  },
  uploadBoxHint: {
    color: '#555',
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  audioFileCard: {
    width: 100,
    height: 100,
    borderRadius: 16,
    backgroundColor: '#2a2a3e',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2e86de',
  },
  uploadFileName: {
    color: '#8a9a8e',
    fontSize: 13,
    maxWidth: 240,
  },
  changeFileLink: {
    color: '#2e86de',
    fontSize: 12,
  },
  useFileBtn: {
    backgroundColor: '#2e86de',
    borderRadius: 14,
    paddingVertical: 16,
    width: '100%',
    alignItems: 'center',
  },

  // Tips modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#1e2a3a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 44,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    color: '#E8E8E8',
    fontSize: 20,
    fontWeight: 'bold',
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  tipEmoji: {
    fontSize: 18,
    lineHeight: 22,
  },
  tipText: {
    color: '#8a9a8e',
    fontSize: 14,
    flex: 1,
    lineHeight: 22,
  },
  tipFooter: {
    color: '#555',
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 20,
    textAlign: 'center',
  },
});
