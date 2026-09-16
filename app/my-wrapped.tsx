import { FontAwesome5, Octicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type MyWrappedData = {
  pauseCount: number;
  totalMinutes: number;
  avgMinutes: number;
  longestMinutes: number;
  topIntention: string | null;
  topIntentionEmoji: string | null;
  avatarUrl: string | null;
  sharedPauseCount: number;
  bestBuddy: { username: string; avatarUrl: string | null } | null;
};

type PageConfig = {
  bg: string;
  accentColor: string;
  isInsightSlide?: boolean;
  render: (data: MyWrappedData) => React.ReactNode;
};

function formatMinutes(minutes: number): string {
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}

const CATEGORY_INFO: Record<string, { label: string; emoji: string }> = {
  focus:      { label: 'FOKUS',      emoji: '🎯' },
  walk:       { label: 'PROMENAD',   emoji: '🚶' },
  workout:    { label: 'TRÄNING',    emoji: '💪' },
  social:     { label: 'SOCIALT',    emoji: '💬' },
  clean:      { label: 'STÄDA',      emoji: '🧹' },
  meditate:   { label: 'MEDITATION', emoji: '🧘' },
  read:       { label: 'LÄSNING',    emoji: '📖' },
  study:      { label: 'STUDIER',    emoji: '✏️' },
  rest:       { label: 'VILA',       emoji: '😴' },
  create:     { label: 'SKAPANDE',   emoji: '🎨' },
  music:      { label: 'MUSIK',      emoji: '🎵' },
  nature:     { label: 'NATUR',      emoji: '🌲' },
  FOKUS:      { label: 'FOKUS',      emoji: '🎯' },
  PROMENAD:   { label: 'PROMENAD',   emoji: '🚶' },
  TRÄNING:    { label: 'TRÄNING',    emoji: '💪' },
  SOCIALT:    { label: 'SOCIALT',    emoji: '💬' },
  STÄDA:      { label: 'STÄDA',      emoji: '🧹' },
  MEDITATION: { label: 'MEDITATION', emoji: '🧘' },
  LÄSNING:    { label: 'LÄSNING',    emoji: '📖' },
  STUDIER:    { label: 'STUDIER',    emoji: '✏️' },
  VILA:       { label: 'VILA',       emoji: '😴' },
  SKAPANDE:   { label: 'SKAPANDE',   emoji: '🎨' },
  MUSIK:      { label: 'MUSIK',      emoji: '🎵' },
  NATUR:      { label: 'NATUR',      emoji: '🌲' },
};

const INTENTION_STATEMENT: Record<string, string> = {
  FOKUS:      'Du lade ner tid på djupt fokusarbete den här veckan.',
  PROMENAD:   'Du kom ut i friska luften och rörde på dig den här veckan.',
  TRÄNING:    'Du prioriterade kroppen och träningen den här veckan.',
  SOCIALT:    'Du spenderade tid med nära och kära den här veckan.',
  STÄDA:      'Du skapade ordning och reda runt dig den här veckan.',
  MEDITATION: 'Du tog dig tid för stilla närvaro den här veckan.',
  LÄSNING:    'Du bytte scrollning mot riktiga berättelser den här veckan.',
  STUDIER:    'Du investerade tid i lärande den här veckan.',
  VILA:       'Du gav dig själv tillåtelse att vila ordentligt den här veckan.',
  SKAPANDE:   'Du lät kreativiteten flöda den här veckan.',
  MUSIK:      'Du fann ro i musiken den här veckan.',
  NATUR:      'Du hittade tillbaka till naturen den här veckan.',
};

// ─── Insight slide ─────────────────────────────────────────────────────────────

function InsightSlide({
  initialInsight,
  accentColor,
  onSave,
  onClear,
}: {
  initialInsight: string;
  accentColor: string;
  onSave: (text: string) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [text, setText] = useState(initialInsight);
  const [saved, setSaved] = useState(!!initialInsight);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const MAX = 140;

  useEffect(() => {
    setText(initialInsight);
    setSaved(!!initialInsight);
  }, [initialInsight]);

  const handleSave = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    await onSave(text.trim());
    setSaving(false);
    setSaved(true);
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 1.04, duration: 120, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start();
  };

  const handleClear = async () => {
    if (clearing) return;
    setClearing(true);
    await onClear();
    setText('');
    setSaved(false);
    setClearing(false);
  };

  const btnStyle = saved
    ? styles.insightBtnDone
    : !text.trim()
    ? styles.insightBtnDisabled
    : [styles.insightBtn, { backgroundColor: accentColor }];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.page, { gap: 18 }]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Text style={styles.eyebrow}>DIN INBLICK</Text>
        <Octicons name="north-star" size={10} color="rgba(255,255,255,0.3)" />
      </View>

      <Text style={[styles.statement, { color: accentColor, fontSize: 22, lineHeight: 30 }]}>
        Vad tar du med{'\n'}dig den här veckan?
      </Text>

      <View style={[styles.insightInputWrapper, { borderColor: accentColor + '44' }]}>
        <TextInput
          style={styles.insightInput}
          value={text}
          onChangeText={t => {
            if (t.length <= MAX) { setText(t); setSaved(false); }
          }}
          placeholder="En reflektion, insikt eller inspiration till vänner…"
          placeholderTextColor="rgba(255,255,255,0.18)"
          multiline
          maxLength={MAX}
          returnKeyType="done"
          blurOnSubmit
        />
        <Text style={styles.insightCharCount}>{text.length}/{MAX}</Text>
      </View>

      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <TouchableOpacity
          style={btnStyle}
          onPress={handleSave}
          disabled={saving || !text.trim()}
          activeOpacity={0.85}
        >
          {saving || saved ? (
            <Text style={styles.insightBtnText}>
              {saving ? 'Delar…' : '✓  Delad'}
            </Text>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Octicons name="north-star" size={13} color="white" />
              <Text style={styles.insightBtnText}>Dela inblick</Text>
            </View>
          )}
        </TouchableOpacity>
      </Animated.View>

      {(!!text.trim() || saved) && (
        <TouchableOpacity onPress={handleClear} disabled={clearing} activeOpacity={0.6}>
          <Text style={styles.insightClearBtn}>
            {clearing ? 'Rensar…' : 'Rensa inblick'}
          </Text>
        </TouchableOpacity>
      )}

      <Text style={styles.insightNote}>Syns för dina vänner i din veckovy.</Text>
    </KeyboardAvoidingView>
  );
}

// ─── Page definitions ──────────────────────────────────────────────────────────

const PAGES: PageConfig[] = [
  {
    bg: '#0d1220',
    accentColor: '#2e86de',
    render: (data) => (
      <View style={styles.page}>
        <Text style={styles.eyebrow}>DEN HÄR VECKAN</Text>
        <Text style={[styles.bigNumber, { color: '#2e86de' }]}>{data.pauseCount}</Text>
        <Text style={styles.statement}>
          {data.pauseCount === 0
            ? 'Inga pauser den här veckan ännu.'
            : data.pauseCount === 1
            ? 'Du tog en paus den här veckan.'
            : `Du tog ${data.pauseCount} pauser den här veckan.`}
        </Text>
        {data.pauseCount >= 7 && (
          <Text style={styles.subtle}>Mer än en om dagen. Imponerande.</Text>
        )}
        {data.pauseCount >= 3 && data.pauseCount < 7 && (
          <Text style={styles.subtle}>En bra rytm.</Text>
        )}
      </View>
    ),
  },
  {
    bg: '#0a1a2a',
    accentColor: '#5ba8f5',
    render: (data) => (
      <View style={styles.page}>
        <Text style={styles.eyebrow}>TOTAL TID</Text>
        <Text style={[styles.bigNumber, { color: '#5ba8f5', fontSize: data.totalMinutes >= 100 ? 56 : 80 }]}>
          {data.totalMinutes > 0 ? formatMinutes(data.totalMinutes) : '—'}
        </Text>
        <Text style={styles.statement}>
          {data.totalMinutes > 0
            ? 'Tid den här veckan som var helt din.'
            : 'Ta din första paus den här veckan.'}
        </Text>
        {data.totalMinutes >= 60 && (
          <Text style={styles.subtle}>Mer än en timme borta från bruset.</Text>
        )}
      </View>
    ),
  },
  {
    bg: '#0d1a14',
    accentColor: '#2ecc71',
    render: (data) => (
      <View style={styles.page}>
        <Text style={styles.eyebrow}>LÄNGSTA PAUS</Text>
        <Text style={[styles.bigNumber, { color: '#2ecc71', fontSize: data.longestMinutes >= 100 ? 56 : 80 }]}>
          {data.longestMinutes > 0 ? formatMinutes(data.longestMinutes) : '—'}
        </Text>
        <Text style={styles.statement}>
          {data.longestMinutes >= 30
            ? 'Du gav hjärnan riktigt djup vila.'
            : data.longestMinutes >= 12
            ? 'En ordentlig paus. Kroppen märker det.'
            : data.longestMinutes > 0
            ? 'Varje minut av närvaro räknas.'
            : 'Din längsta paus väntar på dig.'}
        </Text>
      </View>
    ),
  },
  {
    bg: '#1a0d20',
    accentColor: '#9b59b6',
    render: (data) => (
      <View style={[styles.page, { gap: 36 }]}>
        <Text style={styles.eyebrow}>VANLIGASTE INTENTION</Text>
        {data.topIntention ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <Text style={{ fontSize: 36 }}>{data.topIntentionEmoji ?? '⏸'}</Text>
              <Text style={[styles.bigNumber, { color: '#9b59b6', fontSize: 36 }]}>
                {data.topIntention}
              </Text>
            </View>
            <Text style={styles.statement}>
              {INTENTION_STATEMENT[data.topIntention] ?? 'Du pausade med avsikt den här veckan.'}
            </Text>
          </>
        ) : (
          <Text style={styles.statement}>
            Du pausade utan en specifik intention den här veckan.
          </Text>
        )}
      </View>
    ),
  },
  {
    bg: '#0d1a2a',
    accentColor: '#5ba8f5',
    render: (data) => (
      <View style={styles.page}>
        <Text style={styles.eyebrow}>PAUSADE TILLSAMMANS</Text>
        <Text style={[styles.bigNumber, { color: '#5ba8f5' }]}>{data.sharedPauseCount}</Text>
        <Text style={styles.statement}>
          {data.sharedPauseCount === 0
            ? 'Inga delade pauser den här veckan.'
            : data.sharedPauseCount === 1
            ? 'Du pausade med en vän den här veckan.'
            : `Du pausade med vänner ${data.sharedPauseCount} gånger den här veckan.`}
        </Text>
        {data.bestBuddy && (
          <View style={styles.buddyCard}>
            <Text style={styles.buddyLabel}>FAVORITPAUSKOMPIS</Text>
            <View style={styles.buddyRow}>
              {data.bestBuddy.avatarUrl ? (
                <Image source={{ uri: data.bestBuddy.avatarUrl }} style={styles.buddyAvatar} />
              ) : (
                <View style={styles.buddyAvatarFallback} />
              )}
              <Text style={styles.buddyName}>@{data.bestBuddy.username}</Text>
            </View>
          </View>
        )}
      </View>
    ),
  },
  {
    bg: '#0a0a18',
    accentColor: '#a29bfe',
    isInsightSlide: true,
    render: () => null,
  },
  {
    bg: '#0f0f1a',
    accentColor: '#f9ca24',
    render: (data) => (
      <View style={[styles.page, { alignItems: 'center', justifyContent: 'flex-start', paddingTop: 140 }]}>
        <Text style={{ fontSize: 56, marginBottom: 12 }}>
          {data.pauseCount >= 5 ? '🌟' : data.pauseCount > 0 ? '✨' : '🌱'}
        </Text>
        <Text style={[styles.bigNumber, { color: '#f9ca24', fontSize: 28, textAlign: 'center', lineHeight: 38 }]}>
          {data.pauseCount > 0 ? 'Varje paus är en investering.' : 'Nästa vecka börjar nu.'}
        </Text>
        <Text style={[styles.statement, { textAlign: 'center', marginTop: 32, fontSize: 18, lineHeight: 28 }]}>
          {data.pauseCount > 0
            ? 'Ditt framtida jag minns det här.'
            : 'Ta din första paus idag. Även 5 minuter gör skillnad.'}
        </Text>
        {data.avatarUrl ? (
          <Image source={{ uri: data.avatarUrl }} style={styles.lastSlideAvatar} />
        ) : (
          <View style={styles.lastSlideAvatarFallback} />
        )}
      </View>
    ),
  },
];

// ─── Dot indicator ─────────────────────────────────────────────────────────────

function Dots({ count, activeIndex }: { count: number; activeIndex: number }) {
  return (
    <View style={styles.dots}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[styles.dot, i === activeIndex && styles.dotActive]} />
      ))}
    </View>
  );
}

// ─── Main screen ───────────────────────────────────────────────────────────────

export default function MyWrappedScreen() {
  const { user } = useAuth();
  const [data, setData] = useState<MyWrappedData | null>(null);
  const [insight, setInsight] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const load = async () => {
      if (!user?.id) return;
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [{ data: sessions }, { data: profile }] = await Promise.all([
        supabase
          .from('pause_sessions')
          .select('duration_seconds, intention, shared_session_id')
          .eq('user_id', user.id)
          .gte('started_at', sevenDaysAgo)
          .not('ended_at', 'is', null),
        supabase
          .from('profiles')
          .select('weekly_insight, avatar_url')
          .eq('id', user.id)
          .maybeSingle(),
      ]);

      setInsight(profile?.weekly_insight ?? '');

      const rows = sessions ?? [];
      const pauseCount = rows.length;
      const totalSeconds = rows.reduce((s, r) => s + (r.duration_seconds ?? 0), 0);
      const totalMinutes = totalSeconds / 60;
      const avgMinutes = pauseCount > 0 ? totalMinutes / pauseCount : 0;
      const longestMinutes = rows.reduce(
        (max, r) => Math.max(max, (r.duration_seconds ?? 0) / 60),
        0
      );
      const intentionCounts: Record<string, number> = {};
      for (const r of rows) {
        if (!r.intention || /^custom_\d+$/.test(r.intention)) continue;
        const label = CATEGORY_INFO[r.intention]?.label ?? r.intention;
        intentionCounts[label] = (intentionCounts[label] ?? 0) + 1;
      }
      const topIntention = Object.keys(intentionCounts).sort(
        (a, b) => intentionCounts[b] - intentionCounts[a]
      )[0] ?? null;
      const topIntentionEmoji = topIntention ? (CATEGORY_INFO[topIntention]?.emoji ?? '⏸') : null;

      const sharedRows = rows.filter(r => r.shared_session_id);
      const sharedPauseCount = sharedRows.length;
      let bestBuddy: { username: string; avatarUrl: string | null } | null = null;
      if (sharedRows.length > 0) {
        const sharedIds = sharedRows.map(r => r.shared_session_id!);
        const { data: partnerSessions } = await supabase
          .from('pause_sessions')
          .select('shared_session_id, user_id')
          .in('shared_session_id', sharedIds)
          .neq('user_id', user.id);
        const partnerCounts: Record<string, number> = {};
        for (const p of (partnerSessions ?? [])) {
          partnerCounts[p.user_id] = (partnerCounts[p.user_id] ?? 0) + 1;
        }
        const topId = Object.keys(partnerCounts).sort((a, b) => partnerCounts[b] - partnerCounts[a])[0];
        if (topId) {
          const { data: bp } = await supabase
            .from('profiles').select('username, avatar_url').eq('id', topId).maybeSingle();
          if (bp) bestBuddy = { username: bp.username ?? '?', avatarUrl: bp.avatar_url ?? null };
        }
      }

      setData({
        pauseCount, totalMinutes, avgMinutes, longestMinutes,
        topIntention, topIntentionEmoji,
        avatarUrl: profile?.avatar_url ?? null,
        sharedPauseCount, bestBuddy,
      });

      Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }).start();
    };
    load();
  }, [user?.id]);

  const saveInsight = async (text: string) => {
    if (!user?.id) return;
    setInsight(text);
    await supabase.from('profiles').update({ weekly_insight: text }).eq('id', user.id);
  };

  const clearInsight = async () => {
    if (!user?.id) return;
    setInsight('');
    await supabase.from('profiles').update({ weekly_insight: null }).eq('id', user.id);
  };

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems[0] != null) setActiveIndex(viewableItems[0].index ?? 0);
  }).current;

  const currentPage = PAGES[activeIndex] ?? PAGES[PAGES.length - 1];

  if (!data) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0f0f1a', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 16 }}>Laddar…</Text>
      </View>
    );
  }

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim, backgroundColor: currentPage.bg }]}>
      <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()} activeOpacity={0.7}>
        <FontAwesome5 name="times" size={18} color="rgba(255,255,255,0.5)" />
      </TouchableOpacity>

      <View style={[styles.chip, { borderColor: currentPage.accentColor + '66' }]}>
        <Text style={[styles.chipText, { color: currentPage.accentColor }]}>DIN VECKA</Text>
      </View>
      <FlatList
        data={PAGES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(_, i) => String(i)}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        renderItem={({ item }) => (
          <View style={{ width: SCREEN_WIDTH }}>
            {item.isInsightSlide ? (
              <InsightSlide
                initialInsight={insight}
                accentColor={item.accentColor}
                onSave={saveInsight}
                onClear={clearInsight}
              />
            ) : (
              item.render(data)
            )}
          </View>
        )}
      />

      <View style={styles.footer}>
        <Dots count={PAGES.length} activeIndex={activeIndex} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60 },
  closeBtn: {
    position: 'absolute',
    top: 56,
    right: 16,
    zIndex: 10,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  chipText: { fontSize: 12, fontWeight: '700', letterSpacing: 2 },
  page: {
    width: SCREEN_WIDTH,
    flex: 1,
    paddingHorizontal: 36,
    paddingTop: 40,
    gap: 20,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.3)',
    letterSpacing: 3,
  },
  bigNumber: {
    fontSize: 80,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: -2,
  },
  statement: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
    lineHeight: 34,
    letterSpacing: 0.2,
  },
  subtle: { fontSize: 15, color: 'rgba(255,255,255,0.4)' },
  barContainer: { width: '100%', gap: 16, marginTop: 8 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    width: 68,
  },
  barTrack: {
    flex: 1,
    height: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 7,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 7 },
  barPercent: { color: 'white', fontSize: 12, fontWeight: '600', width: 36, textAlign: 'right' },
  // Insight
  insightInputWrapper: {
    backgroundColor: 'rgba(162,155,254,0.06)',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 8,
    minHeight: 120,
  },
  insightInput: {
    color: 'white',
    fontSize: 16,
    lineHeight: 24,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  insightCharCount: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 11,
    textAlign: 'right',
  },
  insightBtn: {
    paddingVertical: 16,
    borderRadius: 32,
    alignItems: 'center',
  },
  insightBtnDone: {
    backgroundColor: '#27ae60',
    paddingVertical: 16,
    borderRadius: 32,
    alignItems: 'center',
  },
  insightBtnDisabled: {
    backgroundColor: 'rgba(162,155,254,0.15)',
    paddingVertical: 16,
    borderRadius: 32,
    alignItems: 'center',
  },
  insightBtnText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  insightNote: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 12,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  insightClearBtn: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 13,
    textAlign: 'center',
    textDecorationLine: 'underline',
    letterSpacing: 0.3,
  },
  // Footer
  footer: { paddingBottom: 72, alignItems: 'center', gap: 12 },
  dots: { flexDirection: 'row', gap: 6 },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  dotActive: {
    backgroundColor: 'rgba(255,255,255,0.8)',
    width: 18,
  },
  swipeHint: { fontSize: 13, color: 'rgba(255,255,255,0.3)', letterSpacing: 1 },
  weekLabel: { alignSelf: 'center', fontSize: 11, letterSpacing: 2, marginTop: -10, marginBottom: 4 },
  lastSlideAvatar: {
    width: 80, height: 80, borderRadius: 40,
    marginTop: 16,
    borderWidth: 2, borderColor: 'rgba(249,202,36,0.4)',
  },
  lastSlideAvatarFallback: {
    width: 80, height: 80, borderRadius: 40,
    marginTop: 16,
    backgroundColor: 'rgba(249,202,36,0.08)',
    borderWidth: 2, borderColor: 'rgba(249,202,36,0.2)',
  },
  buddyCard: {
    backgroundColor: 'rgba(91,168,245,0.08)',
    borderRadius: 16, borderWidth: 1, borderColor: 'rgba(91,168,245,0.2)',
    padding: 16, gap: 10, marginTop: 8,
  },
  buddyLabel: {
    fontSize: 10, fontWeight: '700' as const,
    color: 'rgba(91,168,245,0.6)', letterSpacing: 2,
  },
  buddyRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 },
  buddyAvatar: {
    width: 40, height: 40, borderRadius: 20,
    borderWidth: 2, borderColor: 'rgba(91,168,245,0.3)',
  },
  buddyAvatarFallback: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(91,168,245,0.1)',
    borderWidth: 2, borderColor: 'rgba(91,168,245,0.2)',
  },
  buddyName: { fontSize: 18, fontWeight: '700' as const, color: '#ffffff' },
});
