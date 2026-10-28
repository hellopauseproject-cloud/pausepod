import { FontAwesome, FontAwesome5 } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, Dimensions, FlatList, Image, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppPalette } from '../constants/appTheme';
import { usePalette } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { formatDuration, formatWeekRange } from '../lib/circles';
import { track } from '../lib/analytics';
import { safeBottom } from '../lib/bottomInset';
import { supabase } from '../lib/supabase';

const SCREEN_WIDTH = Dimensions.get('window').width;

type WrappedMember = {
  user_id: string;
  username: string;
  avatar_url: string | null;
  seconds: number;
  met: boolean;
};

type LongestPause = {
  user_id: string;
  username: string;
  avatar_url: string | null;
  seconds: number;
  started_at: string;
  ended_at: string;
};

type WrappedData = {
  circle_id: string;
  circle_name: string;
  week_start: string;
  members: WrappedMember[];
  pot_target_seconds: number;
  pot_progress_seconds: number;
  session_count: number;
  goal_reached: boolean;
  weeks_reached: number;
  streak_weeks: number;
  hearts: string[];
  // null när veckan saknar en paus att visa. Saknas helt mot en databas där
  // circles.sql inte körts om — sidan visar då samma tomvy.
  longest_pause?: LongestPause | null;
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function clock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// I tittarens lokala tid. Samma dag: "Saturday, 06:00 – 20:00". Över
// midnatt behövs båda dagarna, annars läses en natt som en eftermiddag:
// "Fri 23:10 – Sat 08:05".
function formatPauseSpan(startedAt: string, endedAt: string): string {
  const start = new Date(startedAt);
  const end = new Date(endedAt);
  if (start.toDateString() === end.toDateString()) {
    return `${WEEKDAYS[start.getDay()]}, ${clock(start)} – ${clock(end)}`;
  }
  const short = (d: Date) => WEEKDAYS[d.getDay()].slice(0, 3);
  return `${short(start)} ${clock(start)} – ${short(end)} ${clock(end)}`;
}

function Face({ url, name, size = 54 }: { url: string | null; name: string; size?: number }) {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  if (url) {
    return <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={[styles.faceFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={{ color: Palette.textSecondary, fontWeight: '700', fontSize: size * 0.38 }}>
        {name[0]?.toUpperCase() ?? '?'}
      </Text>
    </View>
  );
}

function Dots({ count, activeIndex }: { count: number; activeIndex: number }) {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  return (
    <View style={styles.dotsRow}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[styles.dot, i === activeIndex && styles.dotActive]} />
      ))}
    </View>
  );
}

export default function CircleWrappedScreen() {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [data, setData] = useState<WrappedData | null>(null);
  // Utan det här läget fastnade skärmen på "Loading…" för alltid så fort
  // RPC:n small — felet syntes bara i konsolen, aldrig för den som tittade.
  const [failed, setFailed] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hearts, setHearts] = useState<string[]>([]);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const heartScale = useRef(new Animated.Value(1)).current;

  // Vilken av ens kretsar (upp till tre). Utan id svarar servern med den man
  // gick med i först — samma reserv som resten av kretsens RPC:er.
  const { circleId } = useLocalSearchParams<{ circleId?: string }>();
  const circleParam = circleId ? circleId : null;

  useEffect(() => {
    (async () => {
      const { data: d, error } = await supabase.rpc('get_circle_wrapped', { p_circle_id: circleParam });
      if (error) { console.log('[wrapped] error:', error.message); setFailed(error.message); return; }
      if (!d) { setFailed('You are not in a circle yet.'); return; }
      setData(d as WrappedData);
      setHearts(((d as WrappedData).hearts ?? []));
      Animated.timing(fadeAnim, { toValue: 1, duration: 700, useNativeDriver: true }).start();
    })();
  }, [fadeAnim, circleParam]);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems[0] != null) setActiveIndex(viewableItems[0].index ?? 0);
  }).current;

  const hearted = !!user && hearts.includes(user.id);

  const toggleHeart = async () => {
    if (!user) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Optimistiskt: hjärtat ska svara på trycket, inte på nätverket.
    setHearts(prev => (prev.includes(user.id) ? prev.filter(id => id !== user.id) : [...prev, user.id]));
    Animated.sequence([
      Animated.timing(heartScale, { toValue: 1.35, duration: 120, useNativeDriver: true }),
      Animated.spring(heartScale, { toValue: 1, friction: 3, useNativeDriver: true }),
    ]).start();

    const { data: nowOn, error } = await supabase.rpc('toggle_wrapped_heart', { p_circle_id: circleParam });
    if (error) {
      // Servern vann: rulla tillbaka i stället för att ljuga om läget.
      setHearts(prev => (prev.includes(user.id) ? prev.filter(id => id !== user.id) : [...prev, user.id]));
      return;
    }
    track('wrapped_heart_toggled', { on: !!nowOn });
    setHearts(prev => (nowOn ? (prev.includes(user.id) ? prev : [...prev, user.id])
                             : prev.filter(id => id !== user.id)));
  };

  if (failed) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.failedText}>{failed}</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.failedBtn} activeOpacity={0.7}>
          <Text style={styles.failedBtnText}>Close</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!data) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  const top = data.members[0];
  const potFraction = data.pot_target_seconds > 0
    ? data.pot_progress_seconds / data.pot_target_seconds
    : 0;
  const metCount = data.members.filter(m => m.met).length;
  const longest = data.longest_pause ?? null;

  const pages: { bg: string; accent: string; render: () => React.ReactNode }[] = [
    // 1. Omslaget — vems vecka det här är, med allas ansikten.
    {
      bg: Palette.tintBlue,
      accent: Palette.accent,
      render: () => (
        <View style={styles.page}>
          <Text style={styles.eyebrow}>Weekly summary for</Text>
          <Text style={styles.coverName}>{data.circle_name}</Text>
          <Text style={styles.weekRange}>{formatWeekRange(data.week_start)}</Text>
          <View style={styles.faceRow}>
            {data.members.map(m => (
              <View key={m.user_id} style={styles.faceWrap}>
                <Face url={m.avatar_url} name={m.username} />
              </View>
            ))}
          </View>
          <Text style={styles.statement}>
            {data.members.length} {data.members.length === 1 ? 'person' : 'people'}, one week.
          </Text>
        </View>
      ),
    },
    // 2. Potten.
    {
      bg: Palette.tintBlue,
      accent: Palette.accentSoft,
      render: () => (
        <View style={styles.page}>
          <Text style={styles.eyebrow}>Paused together</Text>
          <Text style={[styles.bigNumber, { color: Palette.accentSoft }]}>
            {formatDuration(data.pot_progress_seconds)}
          </Text>
          <Text style={styles.statement}>
            {data.pot_target_seconds > 0
              ? `Out of ${formatDuration(data.pot_target_seconds)} you set out to reach.`
              : 'Nobody has set a goal yet — this is pure, unmeasured rest.'}
          </Text>
          {potFraction >= 1 && <Text style={styles.subtle}>You went past it. All of it.</Text>}
          {potFraction >= 0.5 && potFraction < 1 && (
            <Text style={styles.subtle}>More than halfway there together.</Text>
          )}
        </View>
      ),
    },
    // 3. Vem som pausade mest.
    {
      bg: Palette.tintPurple,
      accent: Palette.community,
      render: () => (
        <View style={styles.page}>
          <Text style={styles.eyebrow}>Paused the most</Text>
          {top && top.seconds > 0 ? (
            <>
              <Face url={top.avatar_url} name={top.username} size={92} />
              <Text style={[styles.bigName, { color: Palette.community }]}>{top.username}</Text>
              <Text style={styles.statement}>
                {formatDuration(top.seconds)} pause this week.
              </Text>
              <Text style={styles.subtle}>Someone has to lead. This week it was {top.username}.</Text>
            </>
          ) : (
            <Text style={styles.statement}>Nobody paused this week. There is always next week.</Text>
          )}
        </View>
      ),
    },
    // 4. Veckans längsta paus, med när den låg. Tidsspannet är poängen: en
    // skärmfri dag syns som en dag, och en natt med en vanlig paus igång
    // syns som en natt — se get_circle_wrapped().
    {
      bg: Palette.tintNeutral,
      accent: Palette.highlight,
      render: () => (
        <View style={styles.page}>
          <Text style={styles.eyebrow}>Longest pause</Text>
          {longest && longest.seconds > 0 ? (
            <>
              <Face url={longest.avatar_url} name={longest.username} size={92} />
              <Text style={[styles.bigName, { color: Palette.highlight }]}>{longest.username}</Text>
              <Text style={[styles.bigNumber, { color: Palette.highlight }]}>
                {formatDuration(longest.seconds)}
              </Text>
              <Text style={styles.statement}>
                {formatPauseSpan(longest.started_at, longest.ended_at)}
              </Text>
            </>
          ) : (
            <Text style={styles.statement}>No pauses this week yet.</Text>
          )}
        </View>
      ),
    },
    // 5. Hur många som klarade sitt.
    {
      bg: Palette.tintGreen,
      accent: Palette.slideAccent.teal,
      render: () => (
        <View style={styles.page}>
          <Text style={styles.eyebrow}>Reached their own goal</Text>
          <Text style={[styles.bigNumber, { color: Palette.slideAccent.teal }]}>
            {metCount} of {data.members.length}
          </Text>
          <Text style={styles.statement}>
            {data.goal_reached
              ? 'Everyone got there. The whole circle.'
              : metCount === 0
                ? 'Nobody got all the way this week — and that is allowed.'
                : `${metCount === 1 ? 'One of you' : `${metCount} of you`} made it the whole way.`}
          </Text>
          {data.goal_reached && <Text style={styles.subtle}>That is the hard one to do.</Text>}
        </View>
      ),
    },
    // 6. Sviten.
    {
      bg: Palette.tintPurple,
      accent: Palette.slideAccent.orchid,
      render: () => (
        <View style={styles.page}>
          <Text style={styles.eyebrow}>Weeks in a row</Text>
          <Text style={[styles.bigNumber, { color: Palette.slideAccent.orchid }]}>{data.streak_weeks}</Text>
          <Text style={styles.statement}>
            {data.streak_weeks === 0
              ? 'No streak yet. A week counts when all of you reach your own goal.'
              : data.streak_weeks === 1
                ? 'One week where every single one of you made it.'
                : `${data.streak_weeks} weeks running where all of you made it.`}
          </Text>
          {data.weeks_reached > data.streak_weeks && (
            <Text style={styles.subtle}>
              {data.weeks_reached} winning weeks in total since you started.
            </Text>
          )}
        </View>
      ),
    },
    // 7. Hjärtat.
    {
      bg: Palette.tintBlue,
      accent: Palette.accent,
      render: () => (
        <View style={styles.page}>
          <Text style={styles.eyebrow}>Seen it?</Text>
          <TouchableOpacity onPress={toggleHeart} activeOpacity={0.8} style={styles.heartBtn}>
            <Animated.View style={{ transform: [{ scale: heartScale }] }}>
              <FontAwesome
                name={hearted ? 'heart' : 'heart-o'}
                size={64}
                color={hearted ? Palette.slideAccent.rose : Palette.ink25}
              />
            </Animated.View>
          </TouchableOpacity>
          <Text style={styles.statement}>
            {hearted ? 'You left a heart on this week.' : 'Tap the heart to say you have seen it.'}
          </Text>

          {/* Vilka som redan sett den. Ansikten, inte namn i en lista — man
              känner igen sin krets på bilderna snabbare än på texten. */}
          {hearts.length > 0 && (
            <View style={styles.heartFaces}>
              {data.members
                .filter(m => hearts.includes(m.user_id))
                .map(m => (
                  <View key={m.user_id} style={styles.faceWrap}>
                    <Face url={m.avatar_url} name={m.username} size={38} />
                  </View>
                ))}
            </View>
          )}
          <Text style={styles.subtle}>
            {hearts.length === 0
              ? 'Nobody has yet.'
              : hearts.length === data.members.length
                ? 'Everyone has seen it.'
                : `${hearts.length} of ${data.members.length} have seen it.`}
          </Text>
        </View>
      ),
    },
  ];

  const current = pages[activeIndex] ?? pages[0];

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim, backgroundColor: current.bg, paddingTop: Math.max(60, insets.top + 8) }]}>
      <TouchableOpacity style={[styles.closeBtn, { top: Math.max(56, insets.top + 4) }]} onPress={() => router.back()} activeOpacity={0.7}>
        <FontAwesome5 name="times" size={18} color={Palette.textSecondary} />
      </TouchableOpacity>

      <FlatList
        data={pages}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(_, i) => String(i)}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        renderItem={({ item }) => <View style={{ width: SCREEN_WIDTH }}>{item.render()}</View>}
      />

      {/* Prickarna står ovanför systemets knappar: insetet med Android-golvet
          plus luft. Ett fast tal (44) lade dem under Samsungs tre knappar. */}
      <View style={[styles.footer, { paddingBottom: safeBottom(insets.bottom) + 24 }]}>
        <Dots count={pages.length} activeIndex={activeIndex} />
      </View>
    </Animated.View>
  );
}

const makeStyles = (Palette: AppPalette) => StyleSheet.create({
  container: { flex: 1, paddingTop: 60 },
  centered: { alignItems: 'center', justifyContent: 'center', backgroundColor: Palette.bg },
  loadingText: { color: Palette.textSecondary, fontSize: 15 },
  failedText: {
    color: Palette.textSecondary, fontSize: 15,
    textAlign: 'center', paddingHorizontal: 40, lineHeight: 22,
  },
  failedBtn: { marginTop: 20, paddingVertical: 10, paddingHorizontal: 24 },
  failedBtnText: { color: Palette.accent, fontSize: 14, fontWeight: '700' },
  closeBtn: { position: 'absolute', top: 56, right: 20, zIndex: 10, padding: 10 },

  page: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, gap: 14 },
  eyebrow: {
    fontSize: 12, fontWeight: '700', letterSpacing: 2,
    textTransform: 'uppercase', color: Palette.ink40,
  },
  coverName: { fontSize: 34, fontWeight: '900', color: Palette.textPrimary, textAlign: 'center', letterSpacing: -0.5 },
  weekRange: { fontSize: 13, fontWeight: '700', letterSpacing: 1.2, color: Palette.ink35 },
  bigNumber: { fontSize: 56, fontWeight: '900', letterSpacing: -2 },
  bigName: { fontSize: 32, fontWeight: '900', letterSpacing: -0.5 },
  statement: { fontSize: 17, color: Palette.ink85, textAlign: 'center', lineHeight: 25 },
  subtle: { fontSize: 14, color: Palette.ink40, textAlign: 'center', lineHeight: 20 },

  // Ansiktena överlappar varandra som en hög foton på ett bord.
  faceRow: { flexDirection: 'row', justifyContent: 'center', marginVertical: 8 },
  faceWrap: { marginLeft: -10 },
  faceFallback: {
    backgroundColor: Palette.surfaceAlt, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Palette.tintBlue,
  },
  heartBtn: { paddingVertical: 12 },
  heartFaces: { flexDirection: 'row', justifyContent: 'center', marginTop: 4 },

  footer: { alignItems: 'center' },
  dotsRow: { flexDirection: 'row', gap: 7 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Palette.ink20 },
  dotActive: { backgroundColor: Palette.textPrimary },
});
