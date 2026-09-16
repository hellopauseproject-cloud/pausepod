import { FontAwesome5, Octicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { DEMO_WRAPPED } from '../lib/demoFriends';
import { supabase } from '../lib/supabase';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Types ────────────────────────────────────────────────────────────────────

type WrappedData = {
  sessionCount: number;
  totalMinutes: number;
  avgMinutes: number;
  topIntention: string | null;
  topIntentionEmoji: string | null;
  friendInsight: string | null;
  avatarUrl: string | null;
  sharedPauseCount: number;
  bestBuddy: { username: string; avatarUrl: string | null } | null;
};

type PageConfig = {
  bg: string;
  accentColor: string;
  render: (data: WrappedData, username: string) => React.ReactNode;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}

// ─── Category lookup — keyed by both ID (old data) and label (new data) ───────

const CATEGORY_INFO: Record<string, { label: string; emoji: string }> = {
  // By ID
  focus:    { label: 'FOKUS',      emoji: '🎯' },
  walk:     { label: 'PROMENAD',   emoji: '🚶' },
  workout:  { label: 'TRÄNING',    emoji: '💪' },
  social:   { label: 'SOCIALT',    emoji: '💬' },
  clean:    { label: 'STÄDA',      emoji: '🧹' },
  meditate: { label: 'MEDITATION', emoji: '🧘' },
  read:     { label: 'LÄSNING',    emoji: '📖' },
  study:    { label: 'STUDIER',    emoji: '✏️' },
  rest:     { label: 'VILA',       emoji: '😴' },
  create:   { label: 'SKAPANDE',   emoji: '🎨' },
  music:    { label: 'MUSIK',      emoji: '🎵' },
  nature:   { label: 'NATUR',      emoji: '🌲' },
  // By label (new data stored with human-readable label)
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

// ─── Intention statements per category ───────────────────────────────────────

const INTENTION_STATEMENT: Record<string, (u: string) => string> = {
  FOKUS:      u => `${u} lade ner tid på djupt fokusarbete den här veckan.`,
  PROMENAD:   u => `${u} kom ut i friska luften och rörde på sig den här veckan.`,
  TRÄNING:    u => `${u} prioriterade kroppen och träningen den här veckan.`,
  SOCIALT:    u => `${u} spenderade tid med nära och kära den här veckan.`,
  STÄDA:      u => `${u} skapade ordning och reda runt sig den här veckan.`,
  MEDITATION: u => `${u} tog sig tid för stilla närvaro den här veckan.`,
  LÄSNING:    u => `${u} bytte scrollning mot riktiga berättelser den här veckan.`,
  STUDIER:    u => `${u} investerade tid i lärande den här veckan.`,
  VILA:       u => `${u} gav sig själv tillåtelse att vila ordentligt den här veckan.`,
  SKAPANDE:   u => `${u} lät kreativiteten flöda den här veckan.`,
  MUSIK:      u => `${u} fann ro i musiken den här veckan.`,
  NATUR:      u => `${u} hittade tillbaka till naturen den här veckan.`,
};

// ─── Page definitions ─────────────────────────────────────────────────────────

const BASE_PAGES: PageConfig[] = [
  {
    bg: '#0d1220',
    accentColor: '#2e86de',
    render: (data, username) => (
      <View style={styles.page}>
        <Text style={styles.pageEyebrow}>VECKANS SAMMANFATTNING</Text>
        <Text style={[styles.pageNumber, { color: '#2e86de' }]}>
          {data.sessionCount}
        </Text>
        <Text style={styles.pageStatement}>
          {username} tog {data.sessionCount === 1 ? 'en paus' : `${data.sessionCount} pauser`} den här veckan.
        </Text>
        {data.sessionCount === 0 && (
          <Text style={styles.pageSubtle}>Inga avslutade pauser de senaste 7 dagarna.</Text>
        )}
        {data.sessionCount >= 5 && (
          <Text style={styles.pageSubtle}>Det är riktigt bra.</Text>
        )}
      </View>
    ),
  },
  {
    bg: '#0a1a2a',
    accentColor: '#5ba8f5',
    render: (data, username) => (
      <View style={styles.page}>
        <Text style={styles.pageEyebrow}>GENOMSNITTSTID PER PAUS</Text>
        <Text style={[styles.pageNumber, { color: '#5ba8f5' }]}>
          {data.sessionCount > 0 ? formatMinutes(data.avgMinutes) : '—'}
        </Text>
        <Text style={styles.pageStatement}>
          {data.sessionCount > 0
            ? `Varje paus varade i snitt ${formatMinutes(data.avgMinutes)}.`
            : `${username} har inga avslutade pauser den här veckan ännu.`}
        </Text>
        {data.avgMinutes >= 20 && (
          <Text style={styles.pageSubtle}>Djup närvaro kräver tid. Bra.</Text>
        )}
      </View>
    ),
  },
  {
    bg: '#0d1a14',
    accentColor: '#2ecc71',
    render: (data, username) => (
      <View style={styles.page}>
        <Text style={styles.pageEyebrow}>VANLIGASTE INTENTION</Text>
        {data.topIntention ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <Text style={[styles.pageEmoji, { fontSize: 36 }]}>{data.topIntentionEmoji ?? '⏸'}</Text>
              <Text style={[styles.pageNumber, { color: '#2ecc71', fontSize: 36 }]}>
                {data.topIntention}
              </Text>
            </View>
            <Text style={styles.pageStatement}>
              {INTENTION_STATEMENT[data.topIntention]?.(username) ?? `${username} pausade med avsikt den här veckan.`}
            </Text>
          </>
        ) : (
          <Text style={styles.pageStatement}>
            {username} pausade utan en specifik intention den här veckan.
          </Text>
        )}
      </View>
    ),
  },
  {
    bg: '#150f20',
    accentColor: '#9b59b6',
    render: (data, username) => (
      <View style={styles.page}>
        <Text style={styles.pageEyebrow}>TOTALT DEN HÄR VECKAN</Text>
        <Text style={[styles.pageNumber, { color: '#9b59b6' }]}>
          {data.sessionCount > 0 ? formatMinutes(data.totalMinutes) : '0 min'}
        </Text>
        <Text style={styles.pageStatement}>
          {data.sessionCount > 0
            ? `${username} var frånkopplad i ${formatMinutes(data.totalMinutes)} den här veckan.`
            : `${username} är på väg — varje liten paus räknas.`}
        </Text>
        <Text style={[styles.pageSubtle, { marginTop: 8 }]}>
          Det är tid som bygger något, lite i taget.
        </Text>
      </View>
    ),
  },
  {
    bg: '#0d1a2a',
    accentColor: '#5ba8f5',
    render: (data, username) => (
      <View style={styles.page}>
        <Text style={styles.pageEyebrow}>PAUSADE TILLSAMMANS</Text>
        <Text style={[styles.pageNumber, { color: '#5ba8f5' }]}>{data.sharedPauseCount}</Text>
        <Text style={styles.pageStatement}>
          {data.sharedPauseCount === 0
            ? `${username} hade inga delade pauser den här veckan.`
            : data.sharedPauseCount === 1
            ? `${username} pausade med en vän den här veckan.`
            : `${username} pausade med vänner ${data.sharedPauseCount} gånger.`}
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
];

const INSIGHT_PAGE: PageConfig = {
  bg: '#0a0a18',
  accentColor: '#a29bfe',
  render: (data, username) => (
    <View style={styles.page}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Text style={styles.pageEyebrow}>{username.toUpperCase()} DELAR EN TANKE</Text>
        <Octicons name="north-star" size={10} color="rgba(255,255,255,0.3)" />
      </View>
      <Text style={{ fontSize: 64, color: 'rgba(162,155,254,0.2)', lineHeight: 64, marginBottom: -8 }}>"</Text>
      <Text style={[styles.pageStatement, { fontStyle: 'italic', fontSize: 20, lineHeight: 30, color: 'rgba(255,255,255,0.9)' }]}>
        {data.friendInsight}
      </Text>
      <Text style={{ fontSize: 64, color: 'rgba(162,155,254,0.2)', lineHeight: 64, textAlign: 'right', marginTop: -8 }}>"</Text>
      <View style={{ height: 1, backgroundColor: 'rgba(162,155,254,0.15)', marginTop: 4 }} />
    </View>
  ),
};

// ─── Dot indicator ────────────────────────────────────────────────────────────

function Dots({ count, activeIndex }: { count: number; activeIndex: number }) {
  return (
    <View style={styles.dots}>
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={[styles.dot, i === activeIndex && styles.dotActive]}
        />
      ))}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FriendWrappedScreen() {
  const { friendId, friendUsername } = useLocalSearchParams<{
    friendId: string;
    friendUsername: string;
  }>();

  const [data, setData] = useState<WrappedData | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    const load = async () => {
      if (!friendId) return;

      if (DEMO_WRAPPED[friendId]) {
        setData(DEMO_WRAPPED[friendId]);
        Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }).start();
        return;
      }

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [{ data: sessions }, { data: profile }] = await Promise.all([
        supabase
          .from('pause_sessions')
          .select('duration_seconds, intention, shared_session_id')
          .eq('user_id', friendId)
          .gte('started_at', sevenDaysAgo)
          .not('ended_at', 'is', null),
        supabase
          .from('profiles')
          .select('weekly_insight, avatar_url')
          .eq('id', friendId)
          .maybeSingle(),
      ]);

      const rows = sessions ?? [];
      const sessionCount = rows.length;
      const totalSeconds = rows.reduce((s, r) => s + (r.duration_seconds ?? 0), 0);
      const totalMinutes = totalSeconds / 60;
      const avgMinutes = sessionCount > 0 ? totalMinutes / sessionCount : 0;

      // Most common intention — translate raw IDs to labels, skip unresolvable custom_xxx
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
      const friendInsight = profile?.weekly_insight ?? null;

      const sharedRows = rows.filter(r => r.shared_session_id);
      const sharedPauseCount = sharedRows.length;
      let bestBuddy: { username: string; avatarUrl: string | null } | null = null;
      if (sharedRows.length > 0) {
        const sharedIds = sharedRows.map(r => r.shared_session_id!);
        const { data: partnerSessions } = await supabase
          .from('pause_sessions')
          .select('shared_session_id, user_id')
          .in('shared_session_id', sharedIds)
          .neq('user_id', friendId);
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

      setData({ sessionCount, totalMinutes, avgMinutes, topIntention, topIntentionEmoji, friendInsight, avatarUrl: profile?.avatar_url ?? null, sharedPauseCount, bestBuddy });

      Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }).start();
    };
    load();
  }, [friendId]);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems[0] != null) setActiveIndex(viewableItems[0].index ?? 0);
  }).current;

  const allPages = data?.friendInsight ? [...BASE_PAGES, INSIGHT_PAGE] : BASE_PAGES;
  const currentPage = allPages[activeIndex] ?? allPages[allPages.length - 1];

  if (!data) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={styles.loadingText}>Laddar…</Text>
      </View>
    );
  }

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim, backgroundColor: currentPage.bg }]}>
      {/* Close */}
      <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()} activeOpacity={0.7}>
        <FontAwesome5 name="times" size={18} color="rgba(255,255,255,0.5)" />
      </TouchableOpacity>

      {/* Name chip */}
      <View style={[styles.nameChip, { borderColor: currentPage.accentColor + '66' }]}>
        <Text style={[styles.nameChipText, { color: currentPage.accentColor }]}>
          {friendUsername ?? 'Vän'}
        </Text>
      </View>
      {/* Avatar */}
      {data.avatarUrl ? (
        <Image source={{ uri: data.avatarUrl }} style={styles.avatar} />
      ) : (
        <View style={styles.avatarFallback} />
      )}

      {/* Pages */}
      <FlatList
        ref={flatListRef}
        data={allPages}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(_, i) => String(i)}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        renderItem={({ item }) => (
          <View style={{ width: SCREEN_WIDTH }}>
            {item.render(data, friendUsername ?? 'Vän')}
          </View>
        )}
      />

      {/* Dots + swipe hint */}
      <View style={styles.footer}>
        <Dots count={allPages.length} activeIndex={activeIndex} />
      </View>
    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
  },
  loadingText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 16,
  },

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

  nameChip: {
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  nameChipText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },

  // Page
  page: {
    width: SCREEN_WIDTH,
    flex: 1,
    paddingHorizontal: 36,
    paddingTop: 40,
    gap: 20,
  },
  pageEyebrow: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.3)',
    letterSpacing: 3,
  },
  pageNumber: {
    fontSize: 80,
    fontWeight: '900',
    color: '#ffffff',
    lineHeight: 88,
    letterSpacing: -2,
  },
  pageEmoji: {
    fontSize: 56,
  },
  pageStatement: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
    lineHeight: 34,
    letterSpacing: 0.2,
  },
  pageSubtle: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.4)',
    lineHeight: 22,
  },

  // Footer
  footer: {
    paddingBottom: 72,
    paddingTop: 20,
    alignItems: 'center',
    gap: 12,
  },
  dots: {
    flexDirection: 'row',
    gap: 6,
  },
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
  swipeHint: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.3)',
    letterSpacing: 0.5,
  },
  weekLabel: {
    alignSelf: 'center',
    fontSize: 11,
    letterSpacing: 2,
    marginTop: -10,
    marginBottom: 4,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignSelf: 'center',
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  avatarFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignSelf: 'center',
    marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)',
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
