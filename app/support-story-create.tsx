import { Entypo, FontAwesome5 } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import DismissKeyboardView from './components/DismissKeyboardView';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { sendPushNotification } from '../lib/notifications';
import { supabase } from '../lib/supabase';
import { Category, DEFAULT_CATEGORIES } from './pauseLogger';

const CUSTOM_CATEGORIES_PATH = (FileSystem.documentDirectory ?? '') + 'customCategories.json';

const SUPPORT_TYPES = [
  { id: 'tröst', label: 'Tröst' },
  { id: 'värme', label: 'Värme' },
  { id: 'närvaro', label: 'Närvaro' },
  { id: 'sällskap', label: 'Sällskap' },
  { id: 'empati', label: 'Empati' },
  { id: 'förståelse', label: 'Förståelse' },
  { id: 'stöd', label: 'Stöd' },
  { id: 'lugn', label: 'Lugn' },
  { id: 'hopp', label: 'Hopp' },
  { id: 'skratt', label: 'Skratt' },
  { id: 'pepp', label: 'Pepp' },
  { id: 'hejarop', label: 'Hejarop' },
  { id: 'en knuff', label: 'En knuff' },
  { id: 'hjälp att börja', label: 'Hjälp att börja' },
  { id: 'råd', label: 'Råd' },
  { id: 'perspektiv', label: 'Perspektiv' },
  { id: 'klarhet', label: 'Klarhet' },
  { id: 'visdom', label: 'Visdom' },
  { id: 'strategi', label: 'Strategi' },
  { id: 'ärlighet', label: 'Ärlighet' },
  { id: 'reality check', label: 'Reality check' },
  { id: 'motivationstal', label: 'Motivationstal' },
  { id: 'predikan', label: 'Predikan' },
  { id: 'tillsägelse', label: 'Tillsägelse' },
];

const CATEGORY_VERB: Record<string, string> = {
  focus: 'fokusera',
  walk: 'promenera',
  workout: 'träna',
  social: 'umgås',
  clean: 'städa',
  meditate: 'meditera',
  read: 'läsa',
  study: 'studera',
  rest: 'vila',
  create: 'skapa',
  music: 'spela musik',
  nature: 'vara i naturen',
};

const CARD_W = 82;
const CARD_GAP = 12;

export default function SupportStoryCreateScreen() {
  const { user } = useAuth();
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [supportTypeExpanded, setSupportTypeExpanded] = useState(false);
  const [categories, setCategories] = useState<Category[]>(DEFAULT_CATEGORIES);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [showFreeText, setShowFreeText] = useState(false);
  const [freeEmoji, setFreeEmoji] = useState('');
  const [freeActivity, setFreeActivity] = useState('');
  const [personalNote, setPersonalNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const json = await FileSystem.readAsStringAsync(CUSTOM_CATEGORIES_PATH);
        const customCats: Category[] = JSON.parse(json);
        if (customCats.length > 0) setCategories([...DEFAULT_CATEGORIES, ...customCats]);
      } catch { /* no custom categories */ }
    })();
  }, []);

  const selectedCategory = categories.find(c => c.id === selectedCategoryId) ?? null;
  const hasIntention = showFreeText ? freeActivity.trim().length > 0 : !!selectedCategoryId;
  const canSubmit = hasIntention;

  const handleSubmit = async () => {
    if (!user || !canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const intentionId = showFreeText ? null : selectedCategoryId;
      const activity = showFreeText
        ? (freeEmoji.trim() ? `${freeEmoji.trim()} ${freeActivity.trim()}` : freeActivity.trim())
        : (CATEGORY_VERB[selectedCategory!.id] ?? selectedCategory!.label.toLowerCase());

      const { error } = await supabase.from('support_stories').insert({
        user_id: user.id,
        support_type: selectedTypes.length > 0 ? selectedTypes.join(',') : null,
        activity,
        intention_id: intentionId,
        personal_note: personalNote.trim() || null,
      });
      if (error) { setSubmitting(false); Alert.alert('Fel', error.message); return; }

      const { data: myProfile } = await supabase
        .from('profiles').select('username').eq('id', user.id).maybeSingle();
      const userName = myProfile?.username ?? 'Någon';
      const { data: friendships } = await supabase
        .from('friendships')
        .select('requester_id, receiver_id, req:profiles!requester_id(id, push_token), rec:profiles!receiver_id(id, push_token)')
        .or(`requester_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .eq('status', 'accepted');

      for (const f of (friendships ?? [])) {
        const reqProfile = (f as any).req;
        const recProfile = (f as any).rec;
        const friendProfile = reqProfile?.id !== user.id ? reqProfile : recProfile;
        if (friendProfile?.id && friendProfile.id !== user.id && friendProfile.push_token) {
          sendPushNotification(
            friendProfile.push_token,
            `${userName} ber om stöd`,
            'Klicka för att läsa mer',
            { screen: 'friends', type: 'support_story' }
          );
        }
      }
      router.back();
    } catch (e: any) {
      setSubmitting(false);
      Alert.alert('Fel', e?.message ?? 'Okänt fel');
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={s.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <DismissKeyboardView style={s.content}>
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <FontAwesome5 name="chevron-left" size={15} color="#2e86de" />
          </TouchableOpacity>
          <Text style={s.title}>Be om stöd</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* 1. INTENTION */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>Vad vill du?</Text>
          {showFreeText ? (
            <View>
              <TouchableOpacity
                onPress={() => { setShowFreeText(false); setFreeActivity(''); setFreeEmoji(''); }}
                style={s.backToCarouselBtn}
                activeOpacity={0.7}
              >
                <FontAwesome5 name="chevron-left" size={11} color="#a29bfe" />
                <Text style={s.backToCarouselText}>Välj intention</Text>
              </TouchableOpacity>
              <View style={s.freeInputRow}>
                <View style={{ justifyContent: 'center', alignItems: 'center' }}>
                  <TextInput
                    style={s.emojiInput}
                    value={freeEmoji}
                    onChangeText={setFreeEmoji}
                    placeholder=""
                    maxLength={2}
                    textAlign="center"
                  />
                  {!freeEmoji && (
                    <Entypo name="emoji-happy" size={22} color="rgba(255,255,255,0.2)" style={{ position: 'absolute', pointerEvents: 'none' }} />
                  )}
                </View>
                <TextInput
                  style={[s.textInput, { flex: 1 }]}
                  value={freeActivity}
                  onChangeText={t => { if (t.length <= 50) setFreeActivity(t); }}
                  placeholder="Vad vill du göra?"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  maxLength={50}
                  autoFocus
                />
              </View>
              <Text style={s.charCount}>{50 - freeActivity.length}</Text>
            </View>
          ) : (
            <ScrollView
              horizontal
              snapToInterval={CARD_W + CARD_GAP}
              decelerationRate="fast"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.carouselContent}
            >
              {categories.map(cat => {
                const active = selectedCategoryId === cat.id;
                return (
                  <TouchableOpacity
                    key={cat.id}
                    style={[s.carouselCard, active && s.carouselCardActive]}
                    onPress={() => setSelectedCategoryId(active ? null : cat.id)}
                    activeOpacity={0.75}
                  >
                    <Text style={s.carouselEmoji}>{cat.emoji}</Text>
                    <Text style={[s.carouselLabel, active && s.carouselLabelActive]} numberOfLines={1}>
                      {cat.label.length > 9 ? cat.label.slice(0, 7) + '…' : cat.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                style={s.carouselCard}
                onPress={() => { setSelectedCategoryId(null); setShowFreeText(true); }}
                activeOpacity={0.75}
              >
                <Text style={s.carouselEmoji}>✏️</Text>
                <Text style={s.carouselLabel}>Skriv eget</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>

        {/* 3. PERSONLIG RAD */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>Vill du lägga till något?</Text>
          <TextInput
            style={[s.textInput, s.noteInput]}
            value={personalNote}
            onChangeText={t => { if (t.length <= 100) setPersonalNote(t); }}
            placeholder="T.ex. 'Har provtenta imorgon'"
            placeholderTextColor="rgba(255,255,255,0.2)"
            maxLength={100}
            multiline
          />
          <Text style={s.charCount}>{100 - personalNote.length}</Text>
        </View>

        {/* 3. SPECIFIKT SORTS STÖD — kollapsad */}
        <View style={s.expandSection}>
          <TouchableOpacity
            style={s.expandToggle}
            onPress={() => setSupportTypeExpanded(e => !e)}
            activeOpacity={0.7}
          >
            <Text style={s.expandToggleText}>
              {selectedTypes.length > 0
                ? selectedTypes.map(id => SUPPORT_TYPES.find(t => t.id === id)?.label ?? id).join(', ')
                : 'Specifikt sorts stöd?'}
            </Text>
            <FontAwesome5
              name={supportTypeExpanded ? 'chevron-up' : 'chevron-down'}
              size={11}
              color="rgba(255,255,255,0.25)"
            />
          </TouchableOpacity>

          {supportTypeExpanded && (
            <View style={s.expandContent}>
              <Text style={s.expandHint}>Välj vilken sorts svar du önskar</Text>
              <View style={s.tagCloud}>
                <TouchableOpacity
                  style={[s.chip, selectedTypes.length === 0 && s.chipActive]}
                  onPress={() => setSelectedTypes([])}
                  activeOpacity={0.75}
                >
                  <Text style={[s.chipText, selectedTypes.length === 0 && s.chipTextActive]}>Inget specifikt</Text>
                </TouchableOpacity>
                {SUPPORT_TYPES.map(t => {
                  const active = selectedTypes.includes(t.id);
                  return (
                    <TouchableOpacity
                      key={t.id}
                      style={[s.chip, active && s.chipActive]}
                      onPress={() => setSelectedTypes(prev =>
                        active ? prev.filter(id => id !== t.id) : [...prev, t.id]
                      )}
                      activeOpacity={0.75}
                    >
                      <Text style={[s.chipText, active && s.chipTextActive]}>{t.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}
        </View>

        {/* 4. SUBMIT */}
        <TouchableOpacity
          style={[s.submitBtn, !canSubmit && s.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={!canSubmit || submitting}
          activeOpacity={0.85}
        >
          <Text style={s.submitText}>{submitting ? 'Lägger upp…' : 'Lägg upp'}</Text>
        </TouchableOpacity>
        </DismissKeyboardView>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a' },
  content: { padding: 24, paddingBottom: 60, gap: 40 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginTop: 16,
  },
  backBtn: { width: 44, height: 44, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700', color: '#ffffff', letterSpacing: 0.2 },

  section: { gap: 14 },
  sectionLabel: {
    fontSize: 13, fontWeight: '500',
    color: 'rgba(255,255,255,0.35)', letterSpacing: 0.3,
  },

  chipRow: { gap: 8, paddingHorizontal: 2, paddingVertical: 4 },
  chip: {
    paddingHorizontal: 16, paddingVertical: 9, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  chipActive: { backgroundColor: 'rgba(162,155,254,0.15)', borderColor: '#a29bfe' },
  chipText: { color: 'rgba(255,255,255,0.45)', fontSize: 13, fontWeight: '500' },
  chipTextActive: { color: '#c4b5fd', fontWeight: '600' },

  carouselContent: { gap: CARD_GAP, paddingHorizontal: 2, paddingVertical: 4 },
  carouselCard: {
    width: CARD_W,
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    gap: 8,
  },
  carouselCardActive: {
    backgroundColor: 'rgba(162,155,254,0.12)',
    borderColor: '#a29bfe',
  },
  carouselEmoji: { fontSize: 30, lineHeight: 38 },
  carouselLabel: {
    fontSize: 9, color: 'rgba(255,255,255,0.35)',
    letterSpacing: 0.5, textAlign: 'center',
  },
  carouselLabelActive: { color: '#c4b5fd' },

  backToCarouselBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10,
  },
  backToCarouselText: { color: '#a29bfe', fontSize: 12, fontWeight: '500' },

  freeInputRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  emojiInput: {
    width: 54,
    height: 54,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    fontSize: 26,
    textAlign: 'center',
    color: '#ffffff',
  },
  textInput: {
    backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    padding: 14, color: '#ffffff', fontSize: 14,
  },
  noteInput: { minHeight: 64, textAlignVertical: 'top' },
  charCount: {
    color: 'rgba(255,255,255,0.2)', fontSize: 11, textAlign: 'right', marginTop: 4,
  },

  expandSection: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
    paddingTop: 20,
  },
  expandToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  expandToggleText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.4)',
    fontWeight: '500',
  },
  expandContent: {
    gap: 12,
    paddingTop: 16,
  },
  tagCloud: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  expandHint: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.25)',
    letterSpacing: 0.2,
  },

  submitBtn: {
    backgroundColor: '#a29bfe', paddingVertical: 16,
    borderRadius: 32, alignItems: 'center', marginTop: 8,
  },
  submitBtnDisabled: { backgroundColor: 'rgba(162,155,254,0.2)' },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
});
