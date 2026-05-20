import { FontAwesome, FontAwesome5, Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Animated, Dimensions, Image, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import RecordScreen from './components/RecordScreen';
import { DEFAULT_CATEGORIES, logNotificationSettingsChange, saveSelectedCategories } from './pauseLogger';
import { getProfile, saveProfile } from './userProfile';

const { width } = Dimensions.get('window');
const FILES_PATH = FileSystem.documentDirectory + 'selectedFiles.json';
const STORAGE_PATH = FileSystem.documentDirectory + 'selectedBlocks.json';

const TIME_BLOCKS = [
  { id: 'morning',       label: '🌅 Morgon',      time: '07:00-09:00', hour: 7  },
  { id: 'forenoon',      label: '☕ Förmiddag',   time: '09:00-12:00', hour: 9  },
  { id: 'lunch',         label: '🌞 Lunch',        time: '12:00-14:00', hour: 12 },
  { id: 'afternoon',     label: '🌤 Eftermiddag',  time: '14:00-17:00', hour: 14 },
  { id: 'early_evening', label: '🌆 Tidig kväll',  time: '17:00-19:00', hour: 17 },
  { id: 'evening',       label: '🌙 Kväll',        time: '19:00-21:00', hour: 19 },
  { id: 'late_evening',  label: '🌚 Sen kväll',    time: '21:00-23:00', hour: 21 },
  { id: 'night',         label: '🌑 Natt',          time: '00:00-07:00', hour: 2  },
];

// ─── Step 1 ───────────────────────────────────────────────────────────────────
function Step1({ onNext }: { onNext: () => void }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, friction: 6, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <View style={styles.stepCentered}>
      <Animated.View style={{ opacity: fadeAnim, transform: [{ scale: scaleAnim }], alignItems: 'center' }}>
        <View style={styles.logoContainer}>
          <FontAwesome name="pause" size={48} color="#2e86de" />
        </View>
        <Text style={styles.stepTitle}>Välkommen till{'\n'}Pause Pod</Text>
        <Text style={styles.stepSubtitle}>
          En kort genomgång för att anpassa upplevelsen efter dig. Det tar bara några minuter.
        </Text>
      </Animated.View>
      <View style={styles.buttonGroup}>
        <TouchableOpacity style={styles.nextButton} onPress={onNext}>
          <Text style={styles.nextText}>Kom igång →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Step 2 ───────────────────────────────────────────────────────────────────
function Step2({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, friction: 6, useNativeDriver: true }),
    ]).start();
  }, []);

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      const dest = FileSystem.documentDirectory + 'profilePhoto.jpg';
      await FileSystem.copyAsync({ from: uri, to: dest });
      setPhoto(dest);
    }
  };

  const handleNext = async () => {
    await saveProfile(name.trim() || 'Dig själv', photo);
    onNext();
  };

  return (
    <View style={styles.stepCentered}>
      <Animated.View style={{ opacity: fadeAnim, transform: [{ scale: scaleAnim }], alignItems: 'center', width: '100%' }}>
        <Text style={styles.stepTitle}>Låt oss börja med{'\n'}det viktigaste</Text>
        <Text style={styles.stepSubtitle}>
          Ditt namn och foto visas när du får ett inkommande samtal från dig själv.
        </Text>
        <TouchableOpacity style={styles.photoButton} onPress={pickPhoto}>
          {photo ? (
            <Image source={{ uri: photo }} style={styles.photoPreview} />
          ) : (
            <View style={styles.photoPlaceholder}>
              <FontAwesome5 name="camera" size={28} color="#2e86de" />
              <Text style={styles.photoPlaceholderText}>Lägg till foto</Text>
            </View>
          )}
        </TouchableOpacity>
        <TextInput
          style={styles.nameInput}
          placeholder="För- och efternamn"
          placeholderTextColor="#555"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />
      </Animated.View>
      <View style={styles.buttonGroup}>
        <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
          <Text style={styles.nextText}>Nästa →</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Tillbaka</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Step 3 sub-components ────────────────────────────────────────────────────

function FormatSelect({
  onSelect,
  onBack,
  completed,
  onProceed,
}: {
  onSelect: (f: 'voice' | 'video') => void;
  onBack: () => void;
  completed: { voice: string | null; video: string | null };
  onProceed: () => void;
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
  }, []);

  const bothDone = !!completed.voice && !!completed.video;

  return (
    <View style={styles.stepCentered}>
      <Animated.View style={{ opacity: fadeAnim, alignItems: 'center', width: '100%' }}>
        <Text style={styles.stepTitle}>Spela in ditt{'\n'}meddelande</Text>
        <Text style={styles.stepSubtitle}>
          Spela in både ett röst- och ett videomeddelande till dig själv.
        </Text>
        <View style={recStyles.formatRow}>
          <TouchableOpacity
            style={[recStyles.formatCard, completed.voice && recStyles.formatCardDone]}
            onPress={() => onSelect('voice')}
          >
            {completed.voice ? (
              <Ionicons name="checkmark-circle" size={40} color="white" />
            ) : (
              <Ionicons name="mic-outline" size={40} color="#2e86de" />
            )}
            <Text style={[recStyles.formatLabel, completed.voice && { color: 'white' }]}>Röst</Text>
            <Text style={recStyles.formatHint}>
              {completed.voice ? 'Inspelad ✓' : 'Röstmeddelande'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[recStyles.formatCard, completed.video && recStyles.formatCardDone]}
            onPress={() => onSelect('video')}
          >
            {completed.video ? (
              <Ionicons name="checkmark-circle" size={40} color="white" />
            ) : (
              <Ionicons name="videocam-outline" size={40} color="#2e86de" />
            )}
            <Text style={[recStyles.formatLabel, completed.video && { color: 'white' }]}>Video</Text>
            <Text style={recStyles.formatHint}>
              {completed.video ? 'Inspelad ✓' : 'Videomeddelande'}
            </Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
      <View style={styles.buttonGroup}>
        {bothDone && (
          <TouchableOpacity style={styles.nextButton} onPress={onProceed}>
            <Text style={styles.nextText}>Nästa →</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Tillbaka</Text>
        </TouchableOpacity>
        {!bothDone && (
          <TouchableOpacity onPress={onProceed} style={styles.skipButton}>
            <Text style={styles.skipButtonText}>Gör det senare</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── Step 3 ───────────────────────────────────────────────────────────────────
function Step3({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [format, setFormat] = useState<'voice' | 'video' | null>(null);
  const [completed, setCompleted] = useState<{ voice: string | null; video: string | null }>({
    voice: null,
    video: null,
  });

  const handleFormatComplete = (f: 'voice' | 'video', savedUri: string) => {
    setCompleted((prev) => ({ ...prev, [f]: savedUri }));
    setFormat(null);
  };

  const handleProceed = async () => {
    await FileSystem.writeAsStringAsync(FILES_PATH, JSON.stringify(completed));
    onNext();
  };

  if (!format) {
    return (
      <FormatSelect
        completed={completed}
        onSelect={setFormat}
        onBack={onBack}
        onProceed={handleProceed}
      />
    );
  }
  return (
    <RecordScreen
      format={format}
      onComplete={(savedUri: string) => handleFormatComplete(format, savedUri)}
      onBack={() => setFormat(null)}
    />
  );
}

// ─── Step 4 — Välj pausaktiviteter ───────────────────────────────────────────
function Step4({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
  }, []);

  const toggleCategory = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
  };

  const handleNext = async () => {
    await saveSelectedCategories(selected);
    onNext();
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.step}>
        <Animated.View style={{ opacity: fadeAnim, alignItems: 'center', width: '100%' }}>
          <Text style={styles.stepTitle}>Vad gör du under{'\n'}din paus?</Text>
          <Text style={styles.stepSubtitle}>
            Välj de aktiviteter som passar dig — de visas när du startar en paus.
          </Text>
          <Text style={styles.stepHint}>Du kan ändra dina val i inställningarna senare.</Text>

          <View style={styles.categoryGrid}>
            {DEFAULT_CATEGORIES.map(cat => (
              <TouchableOpacity
                key={cat.id}
                style={[styles.categoryChip, selected.includes(cat.id) && styles.categoryChipSelected]}
                onPress={() => toggleCategory(cat.id)}
              >
                <Text style={styles.categoryEmoji}>{cat.emoji}</Text>
                <Text style={[styles.categoryChipText, selected.includes(cat.id) && styles.categoryChipTextSelected]}>
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Animated.View>
      </ScrollView>

      <View style={[styles.buttonGroup, { paddingHorizontal: 32, paddingBottom: 40 }]}>
        <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
          <Text style={styles.nextText}>Nästa →</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Tillbaka</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Step 5 — Tidsblock ───────────────────────────────────────────────────────
function Step5({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
  }, []);

  const toggleBlock = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id]);
  };

  const handleDone = async () => {
    if (selected.length < 2) return;

    let callerName = 'Dig själv';
    try {
      const profile = await getProfile();
      if (profile.name) callerName = profile.name;
    } catch {}

    await FileSystem.writeAsStringAsync(STORAGE_PATH, JSON.stringify(selected));
    await Notifications.cancelAllScheduledNotificationsAsync();

    const selectedBlocks = TIME_BLOCKS.filter(b => selected.includes(b.id));
    for (let day = 0; day < 14; day++) {
      for (const block of selectedBlocks) {
        const randomMinute = Math.floor(Math.random() * 60);
        const date = new Date();
        date.setDate(date.getDate() + day);
        date.setHours(block.hour, randomMinute, 0, 0);
        if (date > new Date()) {
          await Notifications.scheduleNotificationAsync({
            content: {
              title: callerName,
              body: 'Inkommande samtal',
              sound: 'ringtone.wav',
              data: { screen: 'call' },
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date,
              channelId: 'incoming-call',
            },
          });
        }
      }
    }

    await logNotificationSettingsChange({
      timesPerDay: selectedBlocks.length,
      timeSlots: selectedBlocks.map(b => ({ id: b.id, label: b.label, time: b.time })),
    });

    await FileSystem.writeAsStringAsync(
      FileSystem.documentDirectory + 'onboardingDone.json',
      JSON.stringify({ done: true })
    );

    onDone();
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.step}>
        <Animated.View style={{ opacity: fadeAnim, alignItems: 'center', width: '100%' }}>
          <Text style={styles.stepTitle}>När scrollar du mest?</Text>
          <Text style={styles.stepSubtitle}>Välj minst 2 tidsblock — så anpassas påminnelserna efter dig.</Text>
          <View style={styles.blocks}>
            {TIME_BLOCKS.map(block => (
              <TouchableOpacity
                key={block.id}
                style={[styles.block, selected.includes(block.id) && styles.blockSelected]}
                onPress={() => toggleBlock(block.id)}
              >
                <Text style={[styles.blockLabel, selected.includes(block.id) && styles.blockLabelSelected]}>
                  {block.label}
                </Text>
                <Text style={[styles.blockTime, selected.includes(block.id) && styles.blockLabelSelected]}>
                  {block.time}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Animated.View>
      </ScrollView>

      <View style={[styles.buttonGroup, { paddingHorizontal: 32, paddingBottom: 40 }]}>
        <TouchableOpacity
          style={[styles.nextButton, selected.length < 2 && styles.nextButtonDisabled]}
          onPress={handleDone}
          disabled={selected.length < 2}
        >
          <Text style={styles.nextText}>Kom igång!</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Tillbaka</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Main flow ────────────────────────────────────────────────────────────────
export default function OnboardingFlow() {
  const [step, setStep] = useState(0);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const totalSteps = 5;

  const goToNext = () => {
    Animated.sequence([
      Animated.timing(slideAnim, { toValue: -width, duration: 300, useNativeDriver: true }),
    ]).start(() => {
      setStep(prev => prev + 1);
      slideAnim.setValue(width);
      Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start();
    });
  };

  const goBack = () => {
    Animated.sequence([
      Animated.timing(slideAnim, { toValue: width, duration: 300, useNativeDriver: true }),
    ]).start(() => {
      setStep(prev => prev - 1);
      slideAnim.setValue(-width);
      Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start();
    });
  };

  const steps = [
    <Step1 onNext={goToNext} />,
    <Step2 onNext={goToNext} onBack={goBack} />,
    <Step3 onNext={goToNext} onBack={goBack} />,
    <Step4 onNext={goToNext} onBack={goBack} />,
    <Step5 onDone={() => router.replace('/onboarding-complete')} onBack={goBack} />,
  ];

  return (
    <View style={styles.container}>
      <View style={styles.progressBar}>
        {Array.from({ length: totalSteps }).map((_, i) => (
          <View key={i} style={[styles.progressDot, i <= step && styles.progressDotActive]} />
        ))}
      </View>
      <Animated.View style={[{ flex: 1, width: '100%' }, { transform: [{ translateX: slideAnim }] }]}>
        {steps[step]}
      </Animated.View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    paddingTop: 10,
  },
  progressBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 50,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2a2a3e',
  },
  progressDotActive: {
    backgroundColor: '#2e86de',
    width: 24,
  },
  step: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 32,
    paddingBottom: 20,
  },
  logoContainer: {
    marginBottom: 30,
  },
  stepTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 42,
  },
  stepSubtitle: {
    fontSize: 16,
    color: '#aaa',
    textAlign: 'center',
    lineHeight: 26,
    paddingHorizontal: 8,
  },
  stepHint: {
    fontSize: 13,
    color: '#555',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
    fontStyle: 'italic',
  },
  photoButton: {
    marginTop: 32,
    marginBottom: 24,
  },
  photoPreview: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: '#2e86de',
  },
  photoPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#2a2a3e',
    borderWidth: 2,
    borderColor: '#2e86de',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  photoPlaceholderText: {
    color: '#2e86de',
    fontSize: 11,
    textAlign: 'center',
  },
  nameInput: {
    backgroundColor: '#2a2a3e',
    borderRadius: 16,
    padding: 16,
    fontSize: 18,
    color: 'white',
    width: '100%',
    borderWidth: 2,
    borderColor: '#2e86de',
    textAlign: 'center',
  },
  buttonGroup: {
    alignItems: 'center',
    width: '100%',
    paddingBottom: 20,
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
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
    marginTop: 8,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#2a2a3e',
    borderWidth: 1.5,
    borderColor: '#2a2a3e',
    borderRadius: 32,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  categoryChipSelected: {
    borderColor: '#2e86de',
    backgroundColor: '#1a3a5e',
  },
  categoryEmoji: {
    fontSize: 16,
  },
  categoryChipText: {
    color: '#aaa',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1.5,
  },
  categoryChipTextSelected: {
    color: 'white',
  },
  blocks: {
    width: '100%',
    gap: 10,
    marginTop: 24,
  },
  block: {
    backgroundColor: '#2a2a3e',
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  blockSelected: {
    borderColor: '#2e86de',
    backgroundColor: '#1a3a5e',
  },
  blockLabel: {
    fontSize: 16,
    color: '#aaa',
    fontWeight: 'bold',
  },
  blockLabelSelected: {
    color: 'white',
  },
  blockTime: {
    fontSize: 13,
    color: '#777',
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
  stepCentered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    paddingBottom: 40,
    gap: 40,
  },
  skipButton: {
    padding: 8,
    marginTop: 4,
  },
  skipButtonText: {
    color: '#444',
    fontSize: 13,
    textDecorationLine: 'underline',
  },
});

// ─── Format card styles (used by FormatSelect) ────────────────────────────────
const recStyles = StyleSheet.create({
  formatRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 32,
    width: '100%',
  },
  formatCard: {
    flex: 1,
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#2a2a3e',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1.5,
    borderColor: '#2a2a3e',
  },
  formatLabel: {
    color: '#E8E8E8',
    fontSize: 16,
    fontWeight: '600',
  },
  formatHint: {
    color: '#666',
    fontSize: 12,
  },
  formatCardDone: {
    borderColor: '#2e86de',
    backgroundColor: '#1a3a5e',
  },
});
