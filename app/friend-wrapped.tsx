import { FontAwesome5 } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { AppPalette, alpha } from '../constants/appTheme';
import { usePalette } from '../contexts/ThemeContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Types ────────────────────────────────────────────────────────────────────

type WrappedData = {
  sessionCount: number;
  totalMinutes: number;
  avgMinutes: number;
  topIntention: string | null;
  topIntentionEmoji: string | null;
  avatarUrl: string | null;
  sharedPauseCount: number;
  bestBuddy: { username: string; avatarUrl: string | null } | null;
};

type PageConfig = {
  bg: string;
  accentColor: string;
  render: (data: WrappedData, username: string) => React.ReactNode;
};

// Sidlistan är modulnivå-data med render-callbacks i sig, och kan därför inte
// hämta paletten ur en krok. Den byggs i stället av skärmen, som skickar in
// både paletten och sina färdiga stilar.
type WrappedStyles = ReturnType<typeof makeStyles>;

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
  focus:    { label: 'FOCUS',      emoji: '🎯' },
  walk:     { label: 'WALK',       emoji: '🚶' },
  workout:  { label: 'WORKOUT',    emoji: '💪' },
  social:   { label: 'SOCIAL',     emoji: '💬' },
  clean:    { label: 'CLEAN',      emoji: '🧹' },
  meditate: { label: 'MEDITATION', emoji: '🧘' },
  read:     { label: 'READING',    emoji: '📖' },
  study:    { label: 'STUDY',      emoji: '✏️' },
  rest:     { label: 'REST',       emoji: '😴' },
  create:   { label: 'CREATE',     emoji: '🎨' },
  music:    { label: 'MUSIC',      emoji: '🎵' },
  nature:   { label: 'NATURE',     emoji: '🌲' },
  // By label (new data stored with human-readable label)
  FOCUS:      { label: 'FOCUS',      emoji: '🎯' },
  WALK:       { label: 'WALK',       emoji: '🚶' },
  WORKOUT:    { label: 'WORKOUT',    emoji: '💪' },
  SOCIAL:     { label: 'SOCIAL',     emoji: '💬' },
  CLEAN:      { label: 'CLEAN',      emoji: '🧹' },
  MEDITATION: { label: 'MEDITATION', emoji: '🧘' },
  READING:    { label: 'READING',    emoji: '📖' },
  STUDY:      { label: 'STUDY',      emoji: '✏️' },
  REST:       { label: 'REST',       emoji: '😴' },
  CREATE:     { label: 'CREATE',     emoji: '🎨' },
  MUSIC:      { label: 'MUSIC',      emoji: '🎵' },
  NATURE:     { label: 'NATURE',     emoji: '🌲' },
};

// ─── Intention statements per category ───────────────────────────────────────

const INTENTION_STATEMENT: Record<string, (u: string) => string> = {
  FOCUS:      u => `${u} spent time on deep focus work this week.`,
  WALK:       u => `${u} got out for fresh air and moved this week.`,
  WORKOUT:    u => `${u} prioritized their body and exercise this week.`,
  SOCIAL:     u => `${u} spent time with loved ones this week.`,
  CLEAN:      u => `${u} created order around themselves this week.`,
  MEDITATION: u => `${u} made time for quiet presence this week.`,
  READING:    u => `${u} traded scrolling for real stories this week.`,
  STUDY:      u => `${u} invested time in learning this week.`,
  REST:       u => `${u} gave themselves permission to rest properly this week.`,
  CREATE:     u => `${u} let creativity flow this week.`,
  MUSIC:      u => `${u} found peace in music this week.`,
  NATURE:     u => `${u} found their way back to nature this week.`,
};

// ─── Page definitions ─────────────────────────────────────────────────────────

const makePages = (Palette: AppPalette, styles: WrappedStyles): PageConfig[] => [
  {
    bg: Palette.tintBlue,
    accentColor: Palette.accent,
    render: (data, username) => (
      <View style={styles.page}>
        <Text style={styles.pageEyebrow}>WEEKLY SUMMARY</Text>
        <Text style={[styles.pageNumber, { color: Palette.accent }]}>
          {data.sessionCount}
        </Text>
        <Text style={styles.pageStatement}>
          {username} took {data.sessionCount === 1 ? 'one pause' : `${data.sessionCount} pauses`} this week.
        </Text>
        {data.sessionCount === 0 && (
          <Text style={styles.pageSubtle}>No completed pauses in the last 7 days.</Text>
        )}
        {data.sessionCount >= 5 && (
          <Text style={styles.pageSubtle}>That's really great.</Text>
        )}
      </View>
    ),
  },
  {
    bg: Palette.tintBlue,
    accentColor: Palette.accentSoft,
    render: (data, username) => (
      <View style={styles.page}>
        <Text style={styles.pageEyebrow}>AVERAGE TIME PER PAUSE</Text>
        <Text style={[styles.pageNumber, { color: Palette.accentSoft }]}>
          {data.sessionCount > 0 ? formatMinutes(data.avgMinutes) : '—'}
        </Text>
        <Text style={styles.pageStatement}>
          {data.sessionCount > 0
            ? `Each pause lasted an average of ${formatMinutes(data.avgMinutes)}.`
            : `${username} has no completed pauses this week yet.`}
        </Text>
        {data.avgMinutes >= 20 && (
          <Text style={styles.pageSubtle}>Deep presence takes time. Nice.</Text>
        )}
      </View>
    ),
  },
  {
    bg: Palette.tintGreen,
    accentColor: Palette.slideAccent.green,
    render: (data, username) => (
      <View style={styles.page}>
        <Text style={styles.pageEyebrow}>MOST COMMON INTENTION</Text>
        {data.topIntention ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <Text style={[styles.pageEmoji, { fontSize: 36 }]}>{data.topIntentionEmoji ?? '⏸'}</Text>
              <Text style={[styles.pageNumber, { color: Palette.slideAccent.green, fontSize: 36 }]}>
                {data.topIntention}
              </Text>
            </View>
            <Text style={styles.pageStatement}>
              {INTENTION_STATEMENT[data.topIntention]?.(username) ?? `${username} paused with intention this week.`}
            </Text>
          </>
        ) : (
          <Text style={styles.pageStatement}>
            {username} paused without a specific intention this week.
          </Text>
        )}
      </View>
    ),
  },
  {
    bg: Palette.tintPurple,
    accentColor: Palette.slideAccent.violet,
    render: (data, username) => (
      <View style={styles.page}>
        <Text style={styles.pageEyebrow}>TOTAL THIS WEEK</Text>
        <Text style={[styles.pageNumber, { color: Palette.slideAccent.violet }]}>
          {data.sessionCount > 0 ? formatMinutes(data.totalMinutes) : '0 min'}
        </Text>
        <Text style={styles.pageStatement}>
          {data.sessionCount > 0
            ? `${username} was disconnected for ${formatMinutes(data.totalMinutes)} this week.`
            : `${username} is on their way — every little pause counts.`}
        </Text>
        <Text style={[styles.pageSubtle, { marginTop: 8 }]}>
          It's time that builds something, little by little.
        </Text>
      </View>
    ),
  },
  {
    bg: Palette.tintBlue,
    accentColor: Palette.accentSoft,
    render: (data, username) => (
      <View style={styles.page}>
        <Text style={styles.pageEyebrow}>PAUSED TOGETHER</Text>
        <Text style={[styles.pageNumber, { color: Palette.accentSoft }]}>{data.sharedPauseCount}</Text>
        <Text style={styles.pageStatement}>
          {data.sharedPauseCount === 0
            ? `${username} had no shared pauses this week.`
            : data.sharedPauseCount === 1
            ? `${username} paused with a friend this week.`
            : `${username} paused with friends ${data.sharedPauseCount} times.`}
        </Text>
        {data.bestBuddy && (
          <View style={styles.buddyCard}>
            <Text style={styles.buddyLabel}>FAVORITE PAUSE BUDDY</Text>
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

// ─── Dot indicator ────────────────────────────────────────────────────────────

function Dots({ count, activeIndex }: { count: number; activeIndex: number }) {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
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
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  const insets = useSafeAreaInsets();
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

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [{ data: sessions }, { data: profile }] = await Promise.all([
        supabase
          .from('pause_sessions')
          .select('duration_seconds, intention, shared_session_id')
          .eq('user_id', friendId)
          // RLS släpper redan bara igenom vänners pauser (supabase/sleep.sql);
          // filtret gör frågan sann även om policyn någon gång skrivs om.
          .eq('kind', 'pause')
          .gte('started_at', sevenDaysAgo)
          .not('ended_at', 'is', null),
        supabase
          .from('profiles')
          .select('avatar_url')
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

      setData({ sessionCount, totalMinutes, avgMinutes, topIntention, topIntentionEmoji, avatarUrl: profile?.avatar_url ?? null, sharedPauseCount, bestBuddy });

      Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }).start();
    };
    load();
  }, [friendId]);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems[0] != null) setActiveIndex(viewableItems[0].index ?? 0);
  }).current;

  const allPages = useMemo(() => makePages(Palette, styles), [Palette, styles]);
  const currentPage = allPages[activeIndex] ?? allPages[allPages.length - 1];

  if (!data) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim, backgroundColor: currentPage.bg, paddingTop: Math.max(60, insets.top + 8) }]}>
      {/* Close */}
      <TouchableOpacity style={[styles.closeBtn, { top: Math.max(56, insets.top + 4) }]} onPress={() => router.back()} activeOpacity={0.7}>
        <FontAwesome5 name="times" size={18} color={Palette.textSecondary} />
      </TouchableOpacity>

      {/* Name chip */}
      <View style={[styles.nameChip, { borderColor: currentPage.accentColor + '66' }]}>
        <Text style={[styles.nameChipText, { color: currentPage.accentColor }]}>
          {friendUsername ?? 'Friend'}
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
            {item.render(data, friendUsername ?? 'Friend')}
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

const makeStyles = (Palette: AppPalette) => StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
  },
  loadingText: {
    color: Palette.textSecondary,
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
    fontSize: 13,
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
    fontSize: 12,
    fontWeight: '700',
    color: Palette.ink30,
    letterSpacing: 3,
  },
  pageNumber: {
    fontSize: 80,
    fontWeight: '900',
    color: Palette.textPrimary,
    lineHeight: 88,
    letterSpacing: -2,
  },
  pageEmoji: {
    fontSize: 56,
  },
  pageStatement: {
    fontSize: 24,
    fontWeight: '700',
    color: Palette.textPrimary,
    lineHeight: 34,
    letterSpacing: 0.2,
  },
  pageSubtle: {
    fontSize: 15,
    color: Palette.ink40,
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
    backgroundColor: Palette.ink20,
  },
  dotActive: {
    backgroundColor: Palette.ink80,
    width: 18,
  },
  swipeHint: {
    fontSize: 14,
    color: Palette.ink30,
    letterSpacing: 0.5,
  },
  weekLabel: {
    alignSelf: 'center',
    fontSize: 12,
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
    borderColor: Palette.ink15,
  },
  avatarFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignSelf: 'center',
    marginBottom: 12,
    backgroundColor: Palette.ink06,
    borderWidth: 2,
    borderColor: Palette.ink10,
  },
  buddyCard: {
    backgroundColor: alpha(Palette.accentSoft, 0.08),
    borderRadius: 16, borderWidth: 1, borderColor: Palette.accentSoftTint,
    padding: 16, gap: 10, marginTop: 8,
  },
  buddyLabel: {
    fontSize: 12, fontWeight: '700' as const,
    color: alpha(Palette.accentSoft, 0.6), letterSpacing: 2,
  },
  buddyRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 },
  buddyAvatar: {
    width: 40, height: 40, borderRadius: 20,
    borderWidth: 2, borderColor: alpha(Palette.accentSoft, 0.3),
  },
  buddyAvatarFallback: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: alpha(Palette.accentSoft, 0.1),
    borderWidth: 2, borderColor: Palette.accentSoftTint,
  },
  buddyName: { fontSize: 18, fontWeight: '700' as const, color: Palette.textPrimary },
});
