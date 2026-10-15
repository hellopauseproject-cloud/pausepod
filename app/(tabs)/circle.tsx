import { FontAwesome, FontAwesome5, MaterialIcons } from '@expo/vector-icons';
import { router, useNavigation } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Modal,
  Pressable, ScrollView, StyleSheet, Text, TouchableOpacity,
  useWindowDimensions, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CircleLevelBadge } from '../../components/circle-level-badge';
import { CircleRewardSheet } from '../../components/circle-reward-sheet';
import { CircleSettingsSheet } from '../../components/circle-settings-sheet';
import { RewardWreathIcon } from '../../components/reward-wreath-icon';
import { DurationWheel } from '../../components/duration-wheel';
import { LiquidBars } from '../../components/liquid-bars';
import { ProgressArc } from '../../components/progress-arc';
import { SegmentedPill } from '../../components/segmented-pill';
import { alpha, AppPalette, Radius, roomPalette, Spacing } from '../../constants/appTheme';
import { RoomProvider, usePalette, useTheme } from '../../contexts/ThemeContext';
import { roomShell, ScreenBackground } from '../../components/screen-background';
import { CircleTodoNotes, TodoSheet } from '../../components/todo-sheet';
import { useAuth } from '../../contexts/AuthContext';
import { track } from '../../lib/analytics';
import { countUnreadCircleMessages } from '../../lib/circleChat';
import { awaitsMyVote, CircleReward, getCircleReward } from '../../lib/circleRewards';
import {
  CIRCLE_LEVELS, circleLevelName, levelProgressFraction, secondsToNextLevel,
} from '../../lib/circleLevels';
import {
  CIRCLE_MAX_PER_USER, CircleSettings, formatActivitySegments, formatCountWindow, formatDuration,
  formatWeekRange, getCircleProgress,
  getMyCircles, getSelectedCircleId, GOAL_OPTIONS, MyCircle, nearestGoalIndex, setDailyGoal,
  setSelectedCircleId, takeRequestedCircleSelection,
} from '../../lib/circles';
import { applyPendingDailyGoal, getPendingCircleWelcome, setPendingCircleWelcome } from '../../lib/introPrefs';
import { enablePushNotifications } from '../../lib/notifications';
import { supabase } from '../../lib/supabase';
import { getCircleTodos, Todo } from '../../lib/todos';
import type { CircleMemberProgress, CircleProgress } from '../../types/database';

const MAX_MEMBERS = 10;
// Flödet hämtas 50 rader djupt men visas tio i taget. Tio räcker för att
// svara på 'vad har hänt sedan sist' utan att aktiviteten trycker ner resten
// av fliken — och den som vill läsa längre bak fäller ut den.
const ACTIVITY_PREVIEW = 10;

// Samma form som formatWeekRange ger sina ändpunkter ("MON 24"), så att de
// två rubrikerna ser ut att höra ihop när man drar mellan dem.
function formatToday(): string {
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const d = new Date();
  return `${days[d.getDay()]} ${d.getDate()}`;
}

type MemberRow = { id: string; username: string; avatar_url: string | null; role: 'owner' | 'member' };
type ActivityRow = {
  id: string; actor_id: string | null; type: string; metadata: any; created_at: string;
  actorName: string; actorAvatar: string | null;
};
type IncomingInvite = {
  id: string; circleId: string; circleName: string; inviterName: string; inviterAvatar: string | null; createdAt: string;
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function Avatar({ username, avatarUrl, size = 40 }: { username: string; avatarUrl?: string | null; size?: number }) {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  if (avatarUrl) {
    return <Image source={{ uri: avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarLetter, { fontSize: size * 0.4 }]}>{username[0]?.toUpperCase() ?? '?'}</Text>
    </View>
  );
}

/**
 * Kretsraden överst i fliken: en kapsel per krets och ett `+` så länge det
 * finns plats. Den står där också med en enda krets, så att det syns att det
 * går att ha fler, på platsen där de sedan hamnar. Den valda fylls i rummets
 * kulör (kapseln är ett val, samma undantag som periodvalet), med samma
 * textregel som `SegmentedPill`: vit i ljust läge, rummets mörka botten i
 * mörkt.
 *
 * En prick på en annan krets betyder olästa i dess chatt (den valda har
 * chattknappen); på `+` en inbjudan man har plats att tacka ja till. Med tre
 * kretsar finns inget `+`, och en rad under kapslarna säger att en inbjudan
 * väntar och att man måste lämna en krets.
 *
 * Den har varit en rubrik med ett `⌄` och en väljare bakom; kapslarna togs
 * tillbaka på begäran. Den valda kretsens namn står då två gånger — i
 * kapseln och i rubriken under — och det är priset.
 */
function CircleSwitcher({ circles, selectedId, adding, unread, canAdd, invites, onSelect, onAdd }: {
  circles: MyCircle[];
  selectedId: string | null;
  adding: boolean;
  unread: Record<string, number>;
  canAdd: boolean;
  invites: IncomingInvite[];
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  const onFill = Palette.mode === 'dark' ? Palette.bg : Palette.onAccent;
  return (
    <View style={styles.switcherWrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.switcherScroll}
        contentContainerStyle={styles.switcherRow}
      >
        {circles.map(c => {
          const on = !adding && c.id === selectedId;
          const dot = !on && (unread[c.id] ?? 0) > 0;
          return (
            <TouchableOpacity
              key={c.id}
              style={[styles.switcherPill, on && styles.switcherPillOn]}
              onPress={() => onSelect(c.id)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={dot ? `${c.name}. New messages.` : c.name}
            >
              <Text style={[styles.switcherText, on && { color: onFill }]} numberOfLines={1}>{c.name}</Text>
              {dot && <View style={styles.switcherDot} />}
            </TouchableOpacity>
          );
        })}
        {canAdd && (
          <TouchableOpacity
            style={[styles.switcherPill, styles.switcherAdd, adding && styles.switcherPillOn]}
            onPress={onAdd}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ selected: adding }}
            accessibilityLabel={invites.length > 0 ? 'Join or start another circle. Invites waiting.' : 'Join or start another circle'}
          >
            <FontAwesome5 name="plus" size={12} color={adding ? onFill : Palette.hue} />
            {invites.length > 0 && !adding && <View style={styles.switcherDot} />}
          </TouchableOpacity>
        )}
      </ScrollView>
      {/* Med tre kretsar syns inbjudningarna inte — men de är inte borta.
          Raden säger att de väntar och vad som krävs. */}
      {!canAdd && invites.length > 0 && (
        <Text style={styles.switcherHint}>
          {invites.length === 1 ? `An invite to "${invites[0].circleName}" is` : `${invites.length} invites are`} waiting. Leave a circle to join another.
        </Text>
      )}
    </View>
  );
}

/**
 * Rubriken: den valda kretsens namn. Ett tryck öppnar medlemslistan, och
 * chevronen visar att rubriken går att trycka på. Utan `onPress` (medan man
 * lägger till en krets) är den bara en rubrik.
 */
function CircleTitle({ title, onPress }: { title: string; onPress?: () => void }) {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  if (!onPress) return <Text style={styles.title} numberOfLines={1}>{title}</Text>;
  return (
    <TouchableOpacity
      style={styles.circleTitleBtn}
      onPress={onPress}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel={`${title}. See members.`}
    >
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      <FontAwesome5 name="chevron-right" size={14} color={Palette.hue} />
    </TouchableOpacity>
  );
}

/**
 * Skapa en krets eller tacka ja till en inbjudan. Tomvyn för den som inte är
 * med i någon, och samma sak bakom `+` i kretsraden för den som vill ha en
 * till — en väg in, oavsett hur många man redan har.
 */
function JoinOrCreate({ title, subtitle, invites, busy, onAccept, onDecline, compact }: {
  /** Utelämnas under kretsrubriken, som redan säger *Another circle*. */
  title?: string;
  subtitle: string;
  invites: IncomingInvite[];
  busy: boolean;
  onAccept: (inv: IncomingInvite) => void;
  onDecline: (inviteId: string) => void;
  /** Under kretsraden: ingen luft ovanför, den står redan högt nog. */
  compact?: boolean;
}) {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  return (
    <View>
      <View style={[styles.emptyState, compact && styles.emptyStateCompact]}>
        <View style={styles.emptyIcon}>
          <FontAwesome5 name="layer-group" size={28} color={Palette.hue} />
        </View>
        {!!title && <Text style={styles.emptyTitle}>{title}</Text>}
        <Text style={styles.emptySubtitle}>{subtitle}</Text>
        <TouchableOpacity style={styles.createBtn} onPress={() => router.push('/circle-create' as any)} activeOpacity={0.85}>
          <Text style={styles.createBtnText}>Create a circle</Text>
        </TouchableOpacity>
      </View>

      {invites.length > 0 && (
        <View style={[styles.invitesSection, compact && styles.invitesSectionCompact]}>
          <Text style={styles.sectionLabel}>Invites</Text>
          {invites.map(inv => (
            <View key={inv.id} style={styles.inviteRow}>
              <Avatar username={inv.inviterName} avatarUrl={inv.inviterAvatar} />
              <View style={{ flex: 1 }}>
                <Text style={styles.inviteText}>
                  <Text style={{ fontWeight: '700' }}>{inv.inviterName}</Text> invited you to {`"${inv.circleName}"`}
                </Text>
                <Text style={styles.inviteTime}>{timeAgo(inv.createdAt)}</Text>
              </View>
              <TouchableOpacity style={styles.acceptBtn} onPress={() => onAccept(inv)} disabled={busy}>
                <FontAwesome name="check" size={14} color={Palette.onAccent} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.declineBtn} onPress={() => onDecline(inv.id)} disabled={busy}>
                <FontAwesome name="times" size={14} color={Palette.textSecondary} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

type PotMode = 'week' | 'day';

/**
 * **Ringvyn.** Kretsens överdel byggd av ringar i stället för vätskestreck:
 * en stor ring för hela kretsen (allas minuter mot allas mål), och en liten
 * ring per medlem under den. `false` ger tillbaka streckvyn som den var.
 * Totalkortet (*See everyone*) och flödet under är desamma i båda.
 */
const CIRCLE_RINGS_VIEW = true;

// Ringvyns mått.
const HERO_RING = 210;
const HERO_STROKE = 14;
const TILE_RING = 60;
const TILE_STROKE = 4;
const TILE_STROKE_ON = 5.5;   // den valda brickan: en aning tjockare ring
const TILE_AVATAR = 44;
const HERO_AVATAR = 34;   // ansiktet överst i den stora ringen när en person är vald
const TILES_PER_ROW = 5;

/** Tid på en bricka: `4h 12`, `2h`, `40min`, `0min` — kort nog för 68 px. */
function tileTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h ${m}`;
}

// Pottens kapsel — det enda periodvalet på sidan. Heron (den egna veckan i
// två streck) är borttagen: man är själv det första strecket i potten, valt
// som förval, och raden under strecken säger ens siffror.
const POT_PILL: [{ key: PotMode; label: string }, { key: PotMode; label: string }] = [
  { key: 'week', label: 'This week' }, { key: 'day', label: 'Today' },
];
const PILL_W_POT = 220;

/** Pottens tal för en period. Dagens räknas här, se `PotPanel`. */
function potTotals(progress: CircleProgress | null, isDay: boolean) {
  const members = progress?.members ?? [];
  return {
    progress: isDay ? members.reduce((a, m) => a + m.today_seconds, 0) : (progress?.pot_progress_seconds ?? 0),
    target: isDay ? members.reduce((a, m) => a + (m.daily_target_seconds ?? 0), 0) : (progress?.pot_target_seconds ?? 0),
  };
}

// `formatDuration(0)` säger "0s", som läses som ett fel och inte som en tom
// dag.
const dur = (s: number) => (s < 60 ? '0 min' : formatDuration(s));

// Pottens streck, ett per medlem. Höjden är fast; bredden räknas ur hur
// många som ska rymmas (se `memberBarLayout`), mellan golvet och designens 44.
const MEMBER_BAR_H = 150;
const MEMBER_BAR_MAX_W = 44;
const MEMBER_BAR_MIN_W = 18;
// Markeringsringen runt det valda strecket: 2 luft + 2 kant på varje sida.
const MEMBER_RING_INSET = 4;

function memberBarLayout(available: number, count: number): { width: number; gap: number } {
  const gap = count > 5 ? 8 : 14;
  const slot = (available - gap * Math.max(0, count - 1)) / Math.max(1, count);
  const width = Math.max(MEMBER_BAR_MIN_W, Math.min(MEMBER_BAR_MAX_W, Math.floor(slot - MEMBER_RING_INSET * 2)));
  return { width, gap };
}

/**
 * Potten för en period. Samma panel ritas två gånger — en för veckan och en
 * för dagen — och ligger sida vid sida i en horisontell pager.
 *
 * **Dagens siffror räknas här, inte i SQL.** `get_circle_progress()` skickar
 * redan varje medlems `today_seconds` och `daily_target_seconds`, så dagens
 * pott är summan av delar som redan finns i svaret. Ingen RPC behövde ändras.
 *
 * **Dagen låser aldrig upp något.** Veckan har `goal_reached` med
 * `circle_goal_achievements` bakom sig; dygnsgränsen är däremot lokal per
 * klient (se `p_tz_offset_minutes` i circles.sql), och något som beror på
 * var man råkar befinna sig får inte avgöra en bedrift. Dagsidan visar
 * därför aldrig trofén — den räknar bara.
 */
/**
 * Ett streck i potten — en medlem. Memoiserad: `load()` kör var fjärde
 * sekund och ritar om skärmen, men ett streck vars tal inte ändrats ska inte
 * röras (och vågorna ska inte knuffas).
 */
const MemberBar = memo(function MemberBar({
  id, label, a11yLabel, fraction, muted, selected, barWidth, slotWidth, onSelect,
}: {
  id: string;
  label: string;
  a11yLabel: string;
  fraction: number;
  muted: boolean;
  selected: boolean;
  barWidth: number;
  slotWidth: number;
  onSelect: (id: string) => void;
}) {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  // Vattnet är pausens blå, samma som strecken på Hem — inte rummets gröna.
  // Strecken är pausens symbol och ska se likadana ut var de än står; rummet
  // syns i allt runt omkring (markeringsringen, namnet, kapseln).
  const { mode } = useTheme();
  const pauseHue = roomPalette(mode, 'pause').hue;
  return (
    <Pressable
      onPress={() => onSelect(id)}
      style={[styles.memberBarSlot, { width: slotWidth }]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={a11yLabel}
    >
      <View style={[styles.memberBarRing, selected && { borderColor: Palette.hue }]}>
        <LiquidBars
          fraction={fraction}
          barWidth={barWidth}
          height={MEMBER_BAR_H}
          color={pauseHue}
          trackColor={muted ? Palette.ink07 : alpha(pauseHue, 0.15)}
        />
      </View>
      <Text
        style={[styles.memberBarName, selected && { color: Palette.hue }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
});

/** En medlems tal och mål för perioden — samma källa som allt annat här. */
function memberValue(byUser: Map<string, CircleMemberProgress>, id: string, isDay: boolean) {
  const p = byUser.get(id);
  return {
    target: (isDay ? p?.daily_target_seconds : p?.target_seconds) ?? 0,
    value: (isDay ? p?.today_seconds : p?.progress_seconds) ?? 0,
  };
}

/**
 * Pottens streck, ett per medlem, direkt på bakgrunden.
 *
 * I kretsens egen ordning (`members`, som `load()` hämtar i medlemsordning)
 * och **ALDRIG sorterade efter tal**: potten är en summa, inte en topplista.
 * Fyllnaden är medlemmens tal mot sitt eget mål för perioden — samma tal som
 * raderna under *See everyone*. Det finns en uppsättning streck och inte en
 * per period: byts perioden glider varje streck till sin nya nivå.
 */
function PotBars({
  mode, width, members, byUser, meId, selectedId, onSelectMember,
}: {
  mode: PotMode;
  width: number;
  members: MemberRow[];
  byUser: Map<string, CircleMemberProgress>;
  meId: string;
  selectedId: string;
  onSelectMember: (id: string) => void;
}) {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  const isDay = mode === 'day';
  const period = isDay ? 'today' : 'this week';
  const barLayout = memberBarLayout(width, members.length);
  const slotWidth = barLayout.width + MEMBER_RING_INSET * 2;
  // Man själv står först — det är ens eget streck man letar efter, och det
  // är valt som förval. Resten i kretsens ordning. Ordningen beror fortfarande
  // aldrig på talen.
  const ordered = useMemo(
    () => [...members.filter(m => m.id === meId), ...members.filter(m => m.id !== meId)],
    [members, meId],
  );

  return (
    <View style={[styles.memberBarsRow, { gap: barLayout.gap, width }]}>
      {ordered.map(m => {
        const { target, value } = memberValue(byUser, m.id, isDay);
        const name = m.id === meId ? 'You' : m.username;
        return (
          <MemberBar
            key={m.id}
            id={m.id}
            label={name}
            a11yLabel={target
              ? `${name}: ${dur(value)} of ${formatDuration(target)} ${period}`
              : `${name}: no goal yet`}
            fraction={target ? value / target : 0}
            muted={!target}
            selected={m.id === selectedId}
            barWidth={barLayout.width}
            slotWidth={slotWidth}
            onSelect={onSelectMember}
          />
        );
      })}
    </View>
  );
}

/**
 * Den valda medlemmen i ord, under strecken. Andelen är av potten som den
 * står — vad var och en bidragit med — och inte av målet, som strecket redan
 * visar.
 *
 * **Länken till höger, *Set your goal ›*, finns bara när ens eget mål
 * saknas** — och gäller då alltid en själv, vem som än är vald. Uppmaningen
 * får inte gömmas: `evaluate_circle_goals()` kräver
 * `goals_set_count = member_count`, så en medlem utan mål blockerar veckans
 * bedrift för hela kretsen. (När ett mål finns stod här förr *Your goal: 6h a
 * day ›*; den är borttagen på begäran.)
 */
function PotReadout({
  mode, progress, members, byUser, meId, selectedId, onOpenGoal,
}: {
  mode: PotMode;
  progress: CircleProgress | null;
  members: MemberRow[];
  byUser: Map<string, CircleMemberProgress>;
  meId: string;
  selectedId: string;
  onOpenGoal: () => void;
}) {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  const isDay = mode === 'day';
  const period = isDay ? 'today' : 'this week';
  const selected = members.find(m => m.id === selectedId) ?? members.find(m => m.id === meId);
  if (!selected) return null;
  const { target, value } = memberValue(byUser, selected.id, isDay);
  const potProgress = potTotals(progress, isDay).progress;
  const myGoal = byUser.get(meId)?.daily_target_seconds ?? 0;

  return (
    <View style={styles.memberReadout} accessibilityLiveRegion="polite">
      <View style={styles.memberReadoutHead}>
        <Text style={styles.memberReadoutName} numberOfLines={1}>
          {selected.id === meId ? 'You' : selected.username}
        </Text>
        {/* Bara uppmaningen, och bara när målet saknas. *Your goal: 6h a
            day* som stod här när ett mål fanns är borttagen på begäran —
            målet ändras på Hem (`− +`) eller i den egna raden under *See
            everyone*. */}
        {!myGoal && (
          <TouchableOpacity
            onPress={onOpenGoal}
            activeOpacity={0.6}
            hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Set your daily goal"
          >
            <Text style={styles.goalLinkStrong}>Set your goal ›</Text>
          </TouchableOpacity>
        )}
      </View>
      <Text style={styles.memberReadoutLine} numberOfLines={1}>
        {dur(value)} {period}
        {' · '}
        {/* Andelen av potten står där även för den som nått sitt mål — det
            är vad raden är till för. Att målet är nått syns på strecket och
            i raden under *See everyone*, inte här. */}
        {!target
          ? 'no goal yet'
          : `${potProgress > 0 ? Math.round((value / potProgress) * 100) : 0}% of the pot`}
      </Text>
    </View>
  );
}

/**
 * En medlem som ring: avataren mitt i en liten ring som fylls mot medlemmens
 * eget mål för perioden, namnet under och tiden under det. Ingen procent på
 * brickan. Den valda får en aning tjockare ring och fetare namn.
 *
 * Memoiserad: `load()` kör var fjärde sekund, och en bricka vars tal inte
 * ändrats ska inte ritas om.
 */
const MemberRingTile = memo(function MemberRingTile({
  id, name, username, avatarUrl, time, fraction, selected, dimmed, width, a11yLabel, replayKey, onPress,
}: {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  time: string;
  fraction: number;
  selected: boolean;
  /** Någon annan är vald — brickan tonas bak, så att den valda står i fokus. */
  dimmed: boolean;
  width: number;
  a11yLabel: string;
  replayKey: string;
  onPress: (id: string) => void;
}) {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  return (
    // Hela brickan är träffytan (≥ 44 px åt båda håll).
    <Pressable
      onPress={() => onPress(id)}
      style={[styles.ringTile, { width }, dimmed && styles.ringTileDimmed]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={a11yLabel}
    >
      <ProgressArc
        fraction={fraction}
        size={TILE_RING}
        stroke={selected ? TILE_STROKE_ON : TILE_STROKE}
        color={Palette.hue}
        trackColor={Palette.hueTrack}
        replayKey={replayKey}
      >
        <Avatar username={username} avatarUrl={avatarUrl} size={TILE_AVATAR} />
      </ProgressArc>
      <Text style={[styles.ringTileName, selected && styles.ringTileNameOn]} numberOfLines={1}>
        {name}
      </Text>
      <Text style={styles.ringTileTime} numberOfLines={1}>{time}</Text>
    </Pressable>
  );
});

/**
 * Den stora ringen: en etikett överst (kretsen, eller en persons ansikte och
 * namn), tiden stort och målet under. Samma ring visar kretsen eller den
 * medlem man tryckt på — se `CircleRings`.
 */
function HeroRing({
  mode, value, target, sub, met, label,
}: {
  mode: PotMode;
  value: number;
  target: number;
  sub: string;
  met: boolean;
  label: React.ReactNode;
}) {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  const big = splitUnit(dur(value));
  return (
    <ProgressArc
      fraction={target > 0 ? value / target : 0}
      size={HERO_RING}
      stroke={HERO_STROKE}
      color={Palette.hue}
      trackColor={Palette.hueTrack}
      replayKey={mode}
      glow
    >
      <View style={styles.heroCenter}>
        {label}
        {/* En rad, och krymper hellre än bryts: "125h 30min" ska rymmas
            innanför ringen. */}
        <Text style={styles.heroBig} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          {big.value}{!!big.unit && <Text style={styles.heroBigUnit}>{big.unit}</Text>}
        </Text>
        <View style={styles.heroSubRow}>
          <Text style={styles.heroSub} numberOfLines={2}>{sub}</Text>
          {met && <FontAwesome5 name="check" size={11} color={Palette.hue} />}
        </View>
      </View>
    </ProgressArc>
  );
}

/**
 * Ringvyns överdel: den stora ringen, kretsens statusrad, en ring per medlem.
 * Talen är desamma som streckvyn och totalkortet använder (`potTotals`,
 * `memberValue`) — ingenting räknas nytt.
 *
 * **Den stora ringen visar den valda.** Utan val står `EVERYONE` överst och
 * ringen visar hela kretsen. Ett tryck på en medlem låter ringen visa hen
 * (ansiktet, namnet, tiden och målet, och bågen glider till hens andel av
 * sitt eget mål) och tonar de andra brickorna bak. Ett tryck till på samma
 * medlem, eller på ringen, går tillbaka till `EVERYONE`.
 */
function CircleRings({
  mode, width, progress, members, byUser, meId, selectedId, onSelect, onOpenGoal, statusLine,
}: {
  /** `N OF M GOALS SET` när målen inte är satta — samma rad totalkortet bar. */
  statusLine: string;
  mode: PotMode;
  width: number;
  progress: CircleProgress | null;
  members: MemberRow[];
  byUser: Map<string, CircleMemberProgress>;
  meId: string;
  /** Den medlem den stora ringen visar, eller `null` för hela kretsen. */
  selectedId: string | null;
  /** Ett tryck på en bricka; samma id igen (eller `null`) går tillbaka. */
  onSelect: (id: string | null) => void;
  onOpenGoal: () => void;
}) {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  const isDay = mode === 'day';
  const { progress: total, target: totalTarget } = potTotals(progress, isDay);

  // Man själv först, resten i kretsens ordning — aldrig efter tal.
  const ordered = useMemo(
    () => [...members.filter(m => m.id === meId), ...members.filter(m => m.id !== meId)],
    [members, meId],
  );
  const tileW = Math.floor(width / TILES_PER_ROW);
  const myGoal = byUser.get(meId)?.daily_target_seconds ?? 0;
  const period = isDay ? 'today' : 'this week';

  const person = selectedId ? members.find(m => m.id === selectedId) ?? null : null;
  const pv = person ? memberValue(byUser, person.id, isDay) : null;
  const personName = person ? (person.id === meId ? 'You' : person.username) : '';

  return (
    <View style={styles.ringsBlock}>
      <View style={styles.heroRow}>
        {/* Med en medlem vald är ringen själv vägen tillbaka till EVERYONE. */}
        <Pressable
          onPress={() => { if (person) onSelect(null); }}
          disabled={!person}
          accessibilityRole={person ? 'button' : undefined}
          accessibilityHint={person ? 'Shows everyone again.' : undefined}
          accessibilityLabel={person
            ? `${personName}, ${dur(pv!.value)}${pv!.target ? ` of ${dur(pv!.target)} goal` : ', no goal yet'} ${period}`
            : `Everyone, ${dur(total)} of ${dur(totalTarget)} together ${period}`}
        >
          {person && pv ? (
            <HeroRing
              mode={mode}
              value={pv.value}
              target={pv.target}
              sub={pv.target ? `of ${dur(pv.target)}` : 'no goal yet'}
              met={pv.target > 0 && pv.value >= pv.target}
              label={
                <>
                  <Avatar username={person.username} avatarUrl={person.avatar_url} size={HERO_AVATAR} />
                  <Text style={styles.heroName} numberOfLines={1}>{personName}</Text>
                </>
              }
            />
          ) : (
            <HeroRing
              mode={mode}
              value={total}
              target={totalTarget}
              sub={`of ${dur(totalTarget)} together`}
              met={false}
              label={<Text style={styles.heroCircleLabel}>EVERYONE</Text>}
            />
          )}
        </Pressable>
      </View>

      {/* Det enda som blev kvar av totalkortet: kretsens läge i en rad. Nått
          veckomål (bedriften, se `circle_goal_achievements`) eller att alla
          mål inte är satta — då kan veckan inte vinnas, och utan raden ser
          det ut som en bugg. Dagen låser aldrig upp något och visar ingen
          trofé. */}
      {!isDay && progress?.goal_reached ? (
        <View style={styles.heroStatus}>
          <FontAwesome5 name="trophy" size={11} color={Palette.accent} />
          <Text style={styles.heroStatusText}>
            GOAL REACHED · {progress.achievements_count === 1 ? 'YOUR FIRST WEEK' : `WEEK ${progress.achievements_count}`}
          </Text>
        </View>
      ) : statusLine ? (
        <View style={styles.heroStatus}>
          <Text style={styles.heroStatusText}>{statusLine}</Text>
        </View>
      ) : null}

      {/* En bricka per medlem. Den man tryckt på visas i den stora ringen och
          de andra tonas bak; ett tryck till går tillbaka till EVERYONE. */}
      <View style={styles.ringGrid}>
        {ordered.map(m => {
          const { target, value } = memberValue(byUser, m.id, isDay);
          const name = m.id === meId ? 'You' : m.username;
          return (
            <MemberRingTile
              key={m.id}
              id={m.id}
              name={name}
              username={m.username}
              avatarUrl={m.avatar_url}
              time={tileTime(value)}
              fraction={target ? value / target : 0}
              selected={m.id === selectedId}
              dimmed={!!selectedId && m.id !== selectedId}
              width={tileW}
              a11yLabel={target
                ? `${name}, ${dur(value)} of ${dur(target)} goal`
                : `${name}, ${dur(value)}, no goal yet`}
              replayKey={mode}
              onPress={onSelect}
            />
          );
        })}
      </View>

      {/* Uppmaningen när det egna målet saknas står kvar — utan mål kan
          kretsens vecka inte låsas upp, se `PotReadout`. */}
      {!myGoal && (
        <TouchableOpacity
          onPress={onOpenGoal}
          activeOpacity={0.6}
          hitSlop={10}
          accessibilityRole="button"
          style={styles.setGoalRow}
        >
          <Text style={styles.goalLinkStrong}>Set your goal ›</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

/** Talet stort, `min` litet — samma hierarki som siffran på Hem. */
function splitUnit(text: string): { value: string; unit: string } {
  return text.endsWith('min') ? { value: text.slice(0, -3).trimEnd(), unit: 'min' } : { value: text, unit: '' };
}

/**
 * Pottens summa: ett kort under strecken med den stora siffran, målet
 * tillsammans, en tunn mätare och *See everyone*.
 */
function PotPanel({
  mode,
  width,
  progress,
  members,
  byUser,
  meId,
  expanded,
  onToggleExpanded,
  onOpenGoal,
  remainingLine,
  allGoalsSet,
}: {
  mode: PotMode;
  width: number;
  progress: CircleProgress | null;
  members: MemberRow[];
  byUser: Map<string, CircleMemberProgress>;
  meId: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  onOpenGoal: () => void;
  remainingLine: string;
  allGoalsSet: boolean;
}) {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  const isDay = mode === 'day';

  const { progress: potProgress, target: potTarget } = potTotals(progress, isDay);
  const fraction = potTarget > 0 ? potProgress / potTarget : 0;

  const showAchievement = !isDay && !!progress?.goal_reached;
  const big = splitUnit(dur(showAchievement ? progress!.pot_progress_seconds : potProgress));

  return (
    // Skuggan på ett yttre skal och klippningen på det inre: `overflow:
    // hidden` (som låter raderna nå kanten) klipper annars bort kortets
    // egen skugga på iOS.
    <View style={[styles.potCardShadow, { width }]}>
    <View style={[styles.panel, styles.potCard]}>
      <Pressable onPress={onToggleExpanded} style={styles.potCardBody}>
        {showAchievement ? (
          <>
            <View style={styles.badgeRow}>
              <FontAwesome5 name="trophy" size={11} color={Palette.accent} />
              <Text style={styles.badgeText}>GOAL REACHED</Text>
            </View>
            <Text style={styles.potBig}>
              {big.value}{!!big.unit && <Text style={styles.potBigUnit}>{big.unit}</Text>}
            </Text>
            <Text style={styles.potSub}>
              Everyone hit their own goal. {progress!.achievements_count === 1
                ? 'Your first week together.'
                : `Week ${progress!.achievements_count} you have done it.`}
            </Text>
            <Bar fraction={1} />
          </>
        ) : (
          <>
            {!!remainingLine && <Text style={styles.statusPillText}>{remainingLine}</Text>}
            <Text style={styles.potBig}>
              {big.value}{!!big.unit && <Text style={styles.potBigUnit}>{big.unit}</Text>}
            </Text>
            <Text style={styles.potSub}>
              of {formatDuration(potTarget)} together
            </Text>
            <Bar fraction={fraction} tone={allGoalsSet ? 'accent' : 'muted'} />
          </>
        )}
      </Pressable>

      {expanded && members.map(m => {
        const p = byUser.get(m.id);
        const isMe = m.id === meId;
        const target = (isDay ? p?.daily_target_seconds : p?.target_seconds) ?? 0;
        const value = (isDay ? p?.today_seconds : p?.progress_seconds) ?? 0;
        const met = target > 0 && value >= target;
        const frac = target > 0 ? value / target : 0;
        return (
          <TouchableOpacity
            key={m.id}
            // Linje ovanför varje rad: den första skiljs från
            // sammanfattningen, resten från raden före.
            style={[styles.memberRow, styles.rowDividerTop]}
            activeOpacity={isMe ? 0.7 : 1}
            onPress={() => { if (isMe) onOpenGoal(); }}
          >
            <Avatar username={m.username} avatarUrl={m.avatar_url} size={30} />
            <View style={{ flex: 1, gap: 6 }}>
              <View style={styles.memberRowTop}>
                <Text style={styles.memberRowName} numberOfLines={1}>{isMe ? 'You' : m.username}</Text>
                {/* Även den som klarat sitt visar sitt mål (`14h 10min / 6h`),
                    i rummets gröna med en bock — på begäran, så att man ser
                    vad hen satte och inte bara att hen kom dit. Målet är
                    periodens, alltså samma tal som de andra raderna visar. */}
                {!target ? (
                  <Text style={styles.goalNoneText}>{isMe ? 'Set a goal' : 'No goal yet'}</Text>
                ) : met ? (
                  <View style={styles.metRow}>
                    <Text style={styles.goalNumsMet}>
                      {formatDuration(value)} / {formatDuration(target)}
                    </Text>
                    <FontAwesome name="check" size={11} color={Palette.hue} />
                  </View>
                ) : (
                  <Text style={styles.goalNums}>
                    {formatDuration(value)} / {formatDuration(target)}
                  </Text>
                )}
              </View>
              <Bar fraction={frac} tone={target ? 'accent' : 'muted'} />
            </View>
          </TouchableOpacity>
        );
      })}

      <Pressable onPress={onToggleExpanded} style={styles.panelFoot}>
        <Text style={styles.panelFootText}>{expanded ? 'Hide everyone' : 'See everyone'}</Text>
        <FontAwesome5 name={expanded ? 'chevron-up' : 'chevron-down'} size={9} color={Palette.hue} />
      </Pressable>
    </View>
    </View>
  );
}

function Bar({ fraction, tone = 'accent' }: { fraction: number; tone?: 'accent' | 'muted' }) {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  const pct: `${number}%` = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: pct }, tone === 'muted' && styles.barFillMuted]} />
    </View>
  );
}

/** Se HomeRoom i app/(tabs)/index.tsx — en komponent kan inte läsa sin egen
 *  provider, så rummet ligger i ett skal runt skärmen. */
export default function CircleRoom() {
  return (
    <RoomProvider room="circle">
      <View style={roomShell}>
        <ScreenBackground room="circle" />
        <CircleScreen />
      </View>
    </RoomProvider>
  );
}

function CircleScreen() {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  // Kommer man tillbaka till fliken från en annan börjar sidan överst.
  // Flikar avmonteras inte, så utan det stod man kvar där man scrollat sist.
  // Det sker på flikens tryck och inte på fokus: fokus kommer också när man
  // stänger chatten eller en annan skärm ovanpå, och där ska man stå kvar.
  // Trycker man på fliken man redan står i rullar den upp mjukt, som i
  // andra appar. Samma ref på båda grenarnas ScrollView — bara en åt gången
  // är monterad.
  const navigation = useNavigation();
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    return navigation.addListener('tabPress' as never, () => {
      scrollRef.current?.scrollTo({ y: 0, animated: navigation.isFocused() });
    });
  }, [navigation]);

  const [loading, setLoading] = useState(true);
  // Alla kretsar man är med i (högst tre), och vilken av dem fliken visar.
  // Valet bor också i en ref, så att load() — som kör var fjärde sekund —
  // kan läsa det utan att få det som beroende, och kan se om användaren
  // hunnit byta krets medan en hämtning var på väg.
  const [myCircles, setMyCircles] = useState<MyCircle[]>([]);
  const [selectedCircle, setSelectedCircle] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  // `+` i kretsraden: skapa eller tacka ja i stället för att visa en krets.
  const [adding, setAdding] = useState(false);
  // Olästa per krets, för pricken på kretsraden.
  const [unreadByCircle, setUnreadByCircle] = useState<Record<string, number>>({});
  const [circle, setCircle] = useState<{ id: string; name: string; settings: CircleSettings } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [members, setMembers] = useState<MemberRow[]>([]);
  // Rollen bor på medlemsraden och följer med i load(); ägarskapet kan
  // flytta över till en annan medan man tittar (leave_circle lämnar över
  // det), så det härleds ur listan i stället för att sparas separat.
  const iAmOwner = members.some(m => m.id === user?.id && m.role === 'owner');
  const [progress, setProgress] = useState<CircleProgress | null>(null);
  /** Se upplockningen av introduktionens parkerade dagsmål i load(). */
  const pendingGoalCheckedRef = useRef(false);
  /** Se välkomstsidan för nya medlemmar i load(). Ett försök per montering. */
  const welcomeCheckedRef = useRef(false);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  // Medlemmarnas att göra-listor, för lapparna. Hämtas i load() så att en
  // bock hos någon annan syns inom fyra sekunder, precis som flödet.
  const [todos, setTodos] = useState<Todo[]>([]);
  const [showMyTodos, setShowMyTodos] = useState(false);
  const [incomingInvites, setIncomingInvites] = useState<IncomingInvite[]>([]);
  // Olästa i chatten. Bara ett tal, och det visas som en prick och inte som
  // en siffra: hur många som skrivits sedan sist är inte en uppgift man ska
  // behöva förhålla sig till, bara att någon sagt något.
  const [unreadChat, setUnreadChat] = useState(0);
  // Kretsens belöning (supabase/circle_rewards.sql). Hämtas i load() som
  // resten, så att ett nytt förslag eller ett avgörande syns inom fyra
  // sekunder — och pricken på knappen med det.
  const [reward, setReward] = useState<CircleReward | null>(null);
  const [showRewardModal, setShowRewardModal] = useState(false);

  // Namnfältet bodde förr här, i en modal bakom "Create a circle". Det steget
  // är flyttat till /circle-create, som säger vad en krets är innan den finns
  // — reglerna (en krets åt gången, veckan som vinns först när alla klarat
  // sitt) syns annars ingenstans förrän de biter.


  // Hopfälld som förval: sammanfattningen på kortet räcker för att veta hur
  // veckan står, och åtta rader ovanför stegen och flödet trycker ner allt
  // annat. Den som vill veta vem som saknas trycker på kortet.
  const { width: windowWidth } = useWindowDimensions();
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [showLadderModal, setShowLadderModal] = useState(false);
  const [potMode, setPotMode] = useState<PotMode>('week');
  // Strecket som är valt i potten. Står kvar när perioden byts, så att man
  // tittar på samma person i veckan och i dagen. Null = en själv.
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);

  // Vänskapsläget hämtas när medlemslistan öppnas, inte i load() — den kör
  // var fjärde sekund och relationerna ändras inte i den takten.
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [friendStatus, setFriendStatus] = useState<Record<string, 'accepted' | 'pending'>>({});
  const [addingFriendId, setAddingFriendId] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

  const [showGoalModal, setShowGoalModal] = useState(false);
  const [goalIndex, setGoalIndex] = useState(() => nearestGoalIndex(3600));
  const [savingGoal, setSavingGoal] = useState(false);

  const [busyAction, setBusyAction] = useState(false);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // load() kör var fjärde sekund och skriver över textfälten med det som står
  // i databasen. Står plan-modalen öppen skulle det radera det
  // användaren just skrivit mitt i meningen — en ref, inte ett state, för att
  // load() ska kunna läsa den utan att få modalen som beroende.

  const load = useCallback(async () => {
    if (!user) return;

    // `chat_read_at` och `joined_at` följer med för olästräknaren nedan: den
    // som aldrig öppnat chatten mäts från sitt inträde, inte från kretsens
    // första meddelande.
    const [mine, { data: invites }] = await Promise.all([
      getMyCircles(user.id),
      // Inbjudningarna hämtas alltid: de står i tomvyn, bakom `+`, och som
      // en rad under kretsraden när man redan är med i tre.
      supabase
        .from('circle_invites')
        .select('id, circle_id, created_at, circle:circles!circle_id(name), inviter:profiles!inviter_id(username, avatar_url)')
        .eq('invitee_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),
    ]);

    setMyCircles(mine);
    const mineIds = new Set(mine.map(c => c.id));
    setIncomingInvites((invites ?? [])
      .filter((i: any) => !mineIds.has(i.circle_id))
      .map((i: any) => ({
        id: i.id,
        circleId: i.circle_id,
        circleName: i.circle?.name ?? 'A circle',
        inviterName: i.inviter?.username ?? 'Someone',
        inviterAvatar: i.inviter?.avatar_url ?? null,
        createdAt: i.created_at,
      })));

    if (mine.length === 0) {
      setCircle(null);
      setProgress(null);
      setUnreadChat(0);
      setUnreadByCircle({});
      setReward(null);
      setAdding(false);
      setLoading(false);
      return;
    }

    // Den som nyss accepterat en inbjudan har aldrig läst vad en krets är —
    // den genomgången ligger i /circle-create och ser bara den som skapar en.
    // Flaggan sattes vid bocken och rivs först när sidan kvitteras, så den
    // som stängde appen mitt i får den igen här. Kretsen den gäller blir
    // också den fliken visar.
    //
    // Guarden gör det till ett försök per montering (och per accepterande,
    // se handleAcceptInvite): `load()` kör var fjärde sekund, och en
    // navigering som upprepas så ofta vore en fälla och inte en sida.
    let welcomeFor: MyCircle | null = null;
    if (!welcomeCheckedRef.current) {
      welcomeCheckedRef.current = true;
      const pending = await getPendingCircleWelcome();
      welcomeFor = mine.find(c => c.id === pending) ?? null;
      if (welcomeFor) selectedRef.current = welcomeFor.id;
    }

    // Vilken krets: den man valt i den här sessionen, annars den man stod i
    // senast på den här enheten, annars den man gick med i först. Är man
    // inte längre med i den valda (lämnat, borttagen) faller man tillbaka.
    // En nyss skapad krets (circle-create) går före allt annat.
    const requested = takeRequestedCircleSelection();
    if (requested && mine.some(c => c.id === requested)) {
      selectedRef.current = requested;
      setAdding(false);
    }
    if (!selectedRef.current) selectedRef.current = await getSelectedCircleId();
    const active = mine.find(c => c.id === selectedRef.current) ?? mine[0];
    selectedRef.current = active.id;
    setSelectedCircle(active.id);
    const circleId = active.id;

    // get_circle_progress gör mer än att läsa: den utvärderar veckan, flyttar
    // fram parkerade mål vid veckoskifte och skriver firandet om alla
    // klarat sitt. Att öppna fliken är alltså en av vägarna som får
    // veckoskiftet att ske — därför inget schemalagt jobb.
    const [{ data: memberRows }, { data: activityRows }, progressRow, unreadCounts, rewardRow] =
      await Promise.all([
        supabase.from('circle_members').select('user_id, role, profile:profiles!user_id(id, username, avatar_url)').eq('circle_id', circleId).order('joined_at', { ascending: true }),
        supabase.from('circle_activity').select('id, actor_id, type, metadata, created_at, actor:profiles!actor_id(username, avatar_url)').eq('circle_id', circleId).order('created_at', { ascending: false }).limit(50),
        getCircleProgress(circleId),
        Promise.all(mine.map(c => countUnreadCircleMessages(c.id, c.chat_read_at ?? c.joined_at, user.id))),
        getCircleReward(circleId),
      ]);

    // Byttes kretsen medan svaren var på väg hör de till fel krets.
    if (selectedRef.current !== circleId) return;

    const unreadMap: Record<string, number> = {};
    mine.forEach((c, i) => { unreadMap[c.id] = unreadCounts[i]; });
    setUnreadByCircle(unreadMap);
    setCircle({ id: active.id, name: active.name, settings: active.settings });
    setUnreadChat(unreadMap[circleId] ?? 0);
    setReward(rewardRow);
    setProgress(progressRow);

    if (welcomeFor) {
      setAdding(false);
      router.push({
        pathname: '/circle-welcome',
        params: { circleName: welcomeFor.name },
      } as never);
    }

    // Dagsmålet som valdes i introduktionen kunde inte sparas då: målet bor på
    // medlemsraden i en krets, och den som just skapat sitt konto är inte med
    // i någon. Nu finns det en, så den parkerade siffran plockas upp här.
    //
    // Guarden gör det till ett försök per montering. `load()` kör var fjärde
    // sekund, och det här är inte en fråga som mår bra av att ställas så ofta.
    if (!pendingGoalCheckedRef.current) {
      pendingGoalCheckedRef.current = true;
      const myRow = (progressRow?.members ?? []).find(m => m.user_id === user.id);
      if (await applyPendingDailyGoal(myRow?.daily_target_seconds ?? null)) {
        setProgress(await getCircleProgress(circleId));
      }
    }

    const memberList: MemberRow[] = (memberRows ?? []).map((m: any) => ({
      id: m.user_id, username: m.profile?.username ?? 'Unknown', avatar_url: m.profile?.avatar_url ?? null, role: m.role,
    }));
    setMembers(memberList);

    // Listorna kräver medlemmarnas id:n och väntas därför inte in: lapparna
    // fylls ett ögonblick efter resten. Ett fel lämnar förra svaret kvar.
    getCircleTodos(memberList.map(m => m.id)).then(setTodos).catch(() => {});

    setActivity((activityRows ?? []).map((a: any) => ({
      id: a.id, actor_id: a.actor_id, type: a.type, metadata: a.metadata ?? {}, created_at: a.created_at,
      actorName: a.actor?.username ?? 'Someone', actorAvatar: a.actor?.avatar_url ?? null,
    })));

    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!user) return;
    const poll = setInterval(load, 4000);
    return () => clearInterval(poll);
  }, [user, load]);

  useEffect(() => {
    if (!user) return;
    if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
    // circle_pause_ledger saknar grants med flit (se circles.sql), så veckans
    // siffror kommer inte den här vägen — pollen ovan hämtar dem.
    const channel = supabase
      .channel(`circle-tab-${user.id}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'circle_members' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'circle_invites' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'circle_activity' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'circle_messages' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'circle_goal_achievements' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'circle_level_ups' }, load)
      .subscribe();
    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); channelRef.current = null; };
  }, [user, load]);

  // ── Actions ─────────────────────────────────────────────────────────────

  const handleAcceptInvite = async (inv: IncomingInvite) => {
    setBusyAction(true);
    const { error } = await supabase.rpc('accept_circle_invite', { p_invite_id: inv.id });
    setBusyAction(false);
    if (error) { Alert.alert('Could not join circle', error.message); return; }
    // Den som kommer in via bocken får ingen genomgång (se Circles i
    // CLAUDE.md), så det är den här raden mot circle_created som visar hur
    // många medlemmar som aldrig sett reglerna.
    track('circle_invite_accepted');
    // Kretsnotisen handlar om de andras dagsmål, så frågan om behörighet hör
    // till just det här ögonblicket: man har precis fått de personer notisen
    // skulle handla om. Den som aldrig satt ett eget dagsmål blir annars
    // aldrig tillfrågad — målsparningen är den andra ingången, och den gäller
    // bara dagspåminnelsen. Väntas inte in: dialogen får inte stå i vägen för
    // navigeringen till välkomstsidan.
    enablePushNotifications().catch(() => {});
    // Flaggan sätts här och rivs först när välkomstsidan kvitteras — se
    // lib/introPrefs. Själva navigeringen sköter load() nedan, så att vägen
    // till sidan är en och samma oavsett om man kom hit via bocken eller via
    // en app som stängdes mitt i.
    await setPendingCircleWelcome(inv.circleId);
    // Den nya kretsen är den fliken visar härnäst, och välkomstsidan får ett
    // nytt försök — guarden i load() hade annars redan förbrukats av kretsen
    // man stod i.
    welcomeCheckedRef.current = false;
    selectedRef.current = inv.circleId;
    setSelectedCircleId(inv.circleId);
    setAdding(false);
    load();
  };

  // Byter krets. Det som visas av den förra töms direkt, så att den nya
  // kretsens namn aldrig står ovanför den förras siffror medan load() hämtar.
  const selectCircle = (id: string) => {
    setAdding(false);
    if (id === selectedRef.current) return;
    selectedRef.current = id;
    setSelectedCircle(id);
    setSelectedCircleId(id);
    const next = myCircles.find(c => c.id === id);
    setCircle(next ? { id: next.id, name: next.name, settings: next.settings } : null);
    setProgress(null);
    setMembers([]);
    setActivity([]);
    setTodos([]);
    setReward(null);
    setUnreadChat(unreadByCircle[id] ?? 0);
    setSelectedMemberId(null);
    setShowAllActivity(false);
    setShowBreakdown(false);
    track('circle_switched', { circles: myCircles.length });
    load();
  };

  const handleDeclineInvite = async (inviteId: string) => {
    setBusyAction(true);
    await supabase.rpc('decline_circle_invite', { p_invite_id: inviteId });
    track('circle_invite_declined');
    setBusyAction(false);
    load();
  };

  const handleLeave = () => {
    if (!circle) return;
    Alert.alert(
      'Leave circle?',
      `You'll leave "${circle.name}". You can be invited back later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave', style: 'destructive', onPress: async () => {
            setBusyAction(true);
            const { error } = await supabase.rpc('leave_circle', { p_circle_id: circle.id });
            setBusyAction(false);
            if (error) { Alert.alert('Error', error.message); return; }
            track('circle_left');
            // Knappen sitter i medlemslistan. Stängs den inte här står
            // flaggan kvar och listan öppnar sig själv nästa gång en krets
            // laddas.
            setShowMembersModal(false);
            load();
          },
        },
      ]
    );
  };

  const openMembersModal = async () => {
    setShowMembersModal(true);
    if (!user) return;
    // Alla relationer jag är part i, oavsett riktning — en vänskap kan vara
    // registrerad åt båda hållen beroende på vem som frågade först.
    const { data, error } = await supabase
      .from('friendships')
      .select('requester_id, receiver_id, status')
      .or(`requester_id.eq.${user.id},receiver_id.eq.${user.id}`);

    if (error) { console.log('[circle] friendships fetch error:', error.message); return; }

    const map: Record<string, 'accepted' | 'pending'> = {};
    for (const rel of data ?? []) {
      const other = rel.requester_id === user.id ? rel.receiver_id : rel.requester_id;
      map[other] = rel.status === 'accepted' ? 'accepted' : 'pending';
    }
    setFriendStatus(map);
  };

  const handleAddFriend = async (targetId: string) => {
    if (!user || addingFriendId) return;
    setAddingFriendId(targetId);
    const { error } = await supabase.from('friendships').insert({
      requester_id: user.id,
      receiver_id: targetId,
      status: 'pending',
    });
    setAddingFriendId(null);
    if (error) { Alert.alert('Could not send request', error.message); return; }
    setFriendStatus(prev => ({ ...prev, [targetId]: 'pending' }));
  };

  // Ägarens motsvarighet till handleLeave. Samma sorts bekräftelse och samma
  // formulering om att vägen tillbaka finns — "Remove" är ett tillräckligt
  // hårt ord i sig, texten under behöver inte göra det hårdare.
  const handleRemoveMember = (member: MemberRow) => {
    if (!circle) return;
    Alert.alert(
      `Remove ${member.username}?`,
      `${member.username} will leave "${circle.name}". You can invite them back later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive', onPress: async () => {
            setRemovingMemberId(member.id);
            const { error } = await supabase.rpc('remove_circle_member', { p_user_id: member.id, p_circle_id: circle.id });
            setRemovingMemberId(null);
            if (error) { Alert.alert('Could not remove', error.message); return; }
            // Egen händelse här, till skillnad från flödesraden som säger
            // `member_left` för båda — flödet ska inte hänga ut vem som tog
            // bort vem, men händelseloggen är bara din och får skilja dem.
            track('circle_member_removed');
            load();
          },
        },
      ]
    );
  };

  const openGoalModal = () => {
    // DAGSmålet, inte `target_seconds` — det senare är veckans ribba, alltså
    // samma tal gånger sju, och GOAL_OPTIONS är dagstal. Ratten öppnade
    // därför på översta steget för var och en som redan satt ett mål.
    const current = progress?.members.find(m => m.user_id === user?.id)?.daily_target_seconds;
    // Utan mål än: ratten öppnar på en timme i stället för på understa
    // steget, så det första man ser är ett rimligt förslag och inte 15 min.
    setGoalIndex(nearestGoalIndex(current ?? 3600));
    setShowGoalModal(true);
  };

  const handleSaveGoal = async () => {
    if (savingGoal) return;
    setSavingGoal(true);
    try {
      // Ingen dialog: ändringen gäller genast och syns direkt i ringen.
      await setDailyGoal(GOAL_OPTIONS[goalIndex]);
      setShowGoalModal(false);
      load();
    } catch (e: any) {
      Alert.alert('Could not save goal', e.message);
    } finally {
      setSavingGoal(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────

  // Utloggning, eller en sessionsförnyelse som fallit: `user` blir null medan
  // fliken står kvar monterad (flikarna avmonteras inte när man byter flik),
  // och `circle` ligger kvar från förra `load()`. Utan den här grinden faller
  // renderingen igenom till `user.id` längre ner och kraschar innan grinden i
  // app/_layout.tsx hunnit routa till inloggningen.
  //
  // Den står före `loading` med flit: `load()` returnerar tidigt utan
  // användare och skulle aldrig sätta `loading` till false igen.
  if (loading || !user) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={Palette.accent} size="large" />
      </View>
    );
  }

  if (myCircles.length === 0) {
    return (
      <View style={styles.container}>
        <JoinOrCreate
          title="No circle yet"
          subtitle="Create a small circle with friends to share goals and cheer each other on."
          invites={incomingInvites}
          busy={busyAction}
          onAccept={handleAcceptInvite}
          onDecline={handleDeclineInvite}
        />
      </View>
    );
  }

  const canAddCircle = myCircles.length < CIRCLE_MAX_PER_USER;
  // I en egen View: i läggavyn står den direkt i rullningen, vars `gap`
  // (36) annars hade hamnat mellan kapslarna och rubriken.
  const switcher = (
    <View style={styles.header}>
      <CircleSwitcher
        circles={myCircles}
        selectedId={selectedCircle}
        adding={adding}
        unread={unreadByCircle}
        canAdd={canAddCircle}
        invites={incomingInvites}
        onSelect={selectCircle}
        onAdd={() => setAdding(true)}
      />
      <CircleTitle
        title={adding ? 'Another circle' : (circle?.name ?? '')}
        onPress={adding || !circle ? undefined : openMembersModal}
      />
    </View>
  );

  if (adding || !circle) {
    return (
      <View style={styles.container}>
        <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scrollContent, { paddingTop: Math.max(60, insets.top + 8) }]}>
          {switcher}
          {adding ? (
            <JoinOrCreate
              compact
              subtitle={`You can be in up to ${CIRCLE_MAX_PER_USER} circles. Every pause you take counts in all of them, and your daily goal is the same in each.`}
              invites={incomingInvites}
              busy={busyAction}
              onAccept={handleAcceptInvite}
              onDecline={handleDeclineInvite}
            />
          ) : (
            <ActivityIndicator color={Palette.accent} size="large" />
          )}
        </ScrollView>
      </View>
    );
  }

  const byUser = new Map((progress?.members ?? []).map(m => [m.user_id, m]));
  const allGoalsSet = !!progress && progress.member_count > 0 && progress.goals_set_count === progress.member_count;

  // Hur många som ännu inte klarat sitt står inte här. Det var en siffra som
  // bara gick att förstå genom att fälla ut listan ändå, och listan säger det
  // bättre: där står var och en med sitt eget mål. Kvar blir raden som
  // rapporterar ett annat läge — att målen inte ens är satta — för då är
  // potten ofullständig och stapeln dämpad, och utan raden ser det ut som en
  // bugg i stället för ett tomrum någon kan fylla.
  // Nivån kommer från servern (`circle_level_for_seconds()`); lib/circleLevels
  // bidrar bara med namnet och listan.
  // Panelen är skärmen minus sidornas padding. Mäts ur fönstret i stället
  // för att hårdkodas, så att en vriden eller delad skärm inte ger en sida
  // som snäpper snett.
  const pageWidth = windowWidth - Spacing.xl * 2;

  const circleLevel = progress?.level ?? 1;
  const lifetimeSeconds = progress?.lifetime_seconds ?? 0;

  let remainingLine = '';
  if (!progress || progress.goal_reached) remainingLine = '';
  else if (!allGoalsSet) remainingLine = `${progress.goals_set_count} OF ${progress.member_count} GOALS SET`;

  // Chatten och veckan: i rubriken i streckvyn, bredvid kretsens ring i
  // ringvyn. Samma två knappar på båda ställena.
  const chatButton = (
    <TouchableOpacity
      style={styles.chatBtn}
      onPress={() => router.push({ pathname: '/circle-chat', params: { circleId: circle.id, name: circle.name } } as any)}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={unreadChat > 0 ? 'Open circle chat. New messages.' : 'Open circle chat'}
    >
      <FontAwesome5 name="comment" size={18} color={Palette.hue} solid />
      {unreadChat > 0 && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );
  // Ramen och bottnen är desamma som "See the week that passed" i den egna
  // statistiken — ändras ytan i den ena måste den ändras i den andra.
  const weekButton = (
    <TouchableOpacity
      style={styles.wrappedBtn}
      onPress={() => router.push({ pathname: '/circle-wrapped', params: { circleId: circle.id } } as any)}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel="See the week that passed"
    >
      <MaterialIcons name="insights" size={20} color={Palette.hue} />
    </TouchableOpacity>
  );

  // Belöningen: en stjärna i en lagerkrans, fylld när kretsen har en
  // belöning. Pricken betyder samma sak som chattens — något väntar på en
  // själv — och här är det att man inte lagt sin röst än. Ingen siffra, av
  // samma skäl som chatten.
  const awaitingReward = awaitsMyVote(reward, user.id);
  const rewardButton = (
    <TouchableOpacity
      style={styles.wrappedBtn}
      onPress={() => setShowRewardModal(true)}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={awaitingReward ? 'Open the circle reward. New suggestions.' : 'Open the circle reward'}
    >
      <RewardWreathIcon size={28} color={Palette.hue} filled={!!reward?.current} />
      {awaitingReward && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );

  // Ringvyn: ett tryck på en bricka visar den medlemmen i den stora ringen;
  // ett tryck till på samma bricka (eller på ringen, som skickar `null`) går
  // tillbaka till hela kretsen. Förvalet är ingen vald — ringen visar kretsen.
  // (Streckvyn läser samma tillstånd men faller tillbaka på en själv.)
  const selectTile = (id: string | null) =>
    setSelectedMemberId(prev => (id === null || prev === id ? null : id));

  return (
    <View style={styles.container}>
      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scrollContent, { paddingTop: Math.max(60, insets.top + 8) }]}>

        {/* Rubriken är kretsraden (se CircleTitleStrip): den valda kretsens
            namn stort, de andra bredvid. Under den nivån till vänster och
            kretsens tre knappar till höger — belöningen, veckan, chatten.
            Knapparna stod förr bredvid namnet, men där behöver namnen nu
            bredden (prövat igen och flyttat tillbaka). */}
        <View style={styles.header}>
          {switcher}
          <View style={styles.levelActionsRow}>
            {/* Märket först och nivån bredvid, på samma rad. Namnet står
                bara i stegen-modalen — raden är en ingång, inte en rubrik.
                Chevronen efter LEVEL är borttagen på begäran; märket är
                tryckytan och visar det själv. */}
            <TouchableOpacity
              onPress={() => setShowLadderModal(true)}
              activeOpacity={0.6}
              style={styles.levelBadgeBtn}
              accessibilityRole="button"
              accessibilityLabel={`Level ${circleLevel}, ${circleLevelName(circleLevel)}. Open the ladder.`}
            >
              <CircleLevelBadge level={circleLevel} size={46} />
              <View style={styles.levelBadgeRow}>
                <Text style={styles.levelBadge} numberOfLines={1}>
                  LEVEL {circleLevel}
                </Text>
              </View>
            </TouchableOpacity>
            <View style={styles.headerActions}>
              {/* Belöningen är valfri per krets (ägarens val), och knappen
                  finns bara när den är på. */}
              {circle.settings.rewards_enabled && rewardButton}
              {weekButton}
              {chatButton}
            </View>
          </View>
        </View>

        {/* Potten — sidans huvudsak: kapseln, raden med periodens datum,
            strecken, den valda medlemmen i ord, och summan i ett kort under.

            Heron som stod här (den egna veckan i två streck, med egen kapsel)
            är borttagen: den visade samma person två gånger på samma skärm.
            Man är själv det första strecket, valt som förval.

            Pagern är också borta. Det finns EN uppsättning streck och ett
            kort, och kapseln byter period — strecken glider då till sina nya
            nivåer i stället för att en annan sida dras in. */}
        {CIRCLE_RINGS_VIEW ? (
        <View style={styles.section}>
          {/* Ett periodval för hela överdelen, centrerat över ringen, med
              periodens datum strax under. */}
          <View style={styles.periodBlock}>
            <View style={styles.periodPill}>
              <SegmentedPill
                options={POT_PILL}
                value={potMode}
                onChange={setPotMode}
                width={PILL_W_POT}
              />
            </View>
            {progress && (
              <Text style={styles.weekRange} numberOfLines={1}>
                {potMode === 'day' ? formatToday() : formatWeekRange(progress.week_start, circle.settings.count_workdays)}
              </Text>
            )}
          </View>

          <CircleRings
            mode={potMode}
            width={pageWidth}
            progress={progress}
            members={members}
            byUser={byUser}
            meId={user.id}
            selectedId={selectedMemberId}
            onSelect={selectTile}
            onOpenGoal={openGoalModal}
            statusLine={remainingLine}
          />
          {/* Totalkortet (summan, mätaren och *See everyone*) står inte i
              ringvyn: summan står i ringen, och varje medlems tal står på
              hens bricka. Kortets statusrad flyttade upp under ringen. */}
        </View>
        ) : (
        <View style={styles.section}>
          <SegmentedPill
            options={POT_PILL}
            value={potMode}
            onChange={setPotMode}
            width={PILL_W_POT}
          />

          <View style={styles.sectionHeadRow}>
            <Text style={styles.sectionLabel}>Your circle</Text>
            {progress && (
              <Text style={styles.weekRange} numberOfLines={1}>
                {potMode === 'day' ? formatToday() : formatWeekRange(progress.week_start, circle.settings.count_workdays)}
              </Text>
            )}
          </View>

          {/* Strecken har hela bredden sedan chatten och veckan flyttade upp
              i rubriken. */}
          <PotBars
            mode={potMode}
            width={pageWidth}
            members={members}
            byUser={byUser}
            meId={user.id}
            selectedId={selectedMemberId ?? user.id}
            onSelectMember={setSelectedMemberId}
          />

          <PotReadout
            mode={potMode}
            progress={progress}
            members={members}
            byUser={byUser}
            meId={user.id}
            selectedId={selectedMemberId ?? user.id}
            onOpenGoal={openGoalModal}
          />

          <PotPanel
            mode={potMode}
            width={pageWidth}
            progress={progress}
            members={members}
            byUser={byUser}
            meId={user.id}
            expanded={showBreakdown}
            onToggleExpanded={() => setShowBreakdown(v => !v)}
            onOpenGoal={openGoalModal}
            remainingLine={remainingLine}
            allGoalsSet={allGoalsSet}
          />
        </View>
        )}

        {/* Att göra — en lapp per medlem, mellan ringen och flödet: under
            talen kretsen delar, ovanför det som redan hänt. Väljs någon i
            ringen kommer hens lapp fram, som brickan. Den egna lappen öppnar
            samma ark som lappen på Hem; de andras går bara att läsa. */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>To do</Text>
          <View style={styles.notesBleed}>
            <CircleTodoNotes
              members={members}
              todos={todos}
              meId={user.id}
              selectedId={CIRCLE_RINGS_VIEW ? selectedMemberId : null}
              onOpenMine={() => setShowMyTodos(true)}
            />
          </View>
        </View>

        {/* Activity */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Activity</Text>
          <View style={styles.panel}>
            {activity.length === 0 ? (
              <View style={styles.panelBody}>
                <Text style={styles.emptyActivity}>Nothing has happened here yet.</Text>
              </View>
            ) : (
              activity.slice(0, showAllActivity ? activity.length : ACTIVITY_PREVIEW).map((item, i) => {
                // goal_reached och level_up har ingen aktör — de är cirkelns
                // händelser, inte någons. Avatar hade blivit ett frågetecken.
                const isMilestone = item.actor_id === null;
                // Att någon går med är den enda raden som är en nyhet om
                // gruppen själv, inte om vad någon gjort — den får stå i
                // vitt medan resten av flödet ligger i grått.
                const bright = item.type === 'member_joined';
                return (
                  <View key={item.id} style={[styles.activityRow, i > 0 && styles.rowDividerTop]}>
                    {isMilestone ? (
                      <View style={styles.milestoneIcon}>
                        <FontAwesome5 name={item.type === 'level_up' ? 'angle-double-up' : 'trophy'} size={13} color={Palette.hue} />
                      </View>
                    ) : (
                      <Avatar username={item.actorName} avatarUrl={item.actorAvatar} size={30} />
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={[
                        styles.activityText,
                        bright && styles.activityTextBright,
                        isMilestone && styles.activityTextMilestone,
                      ]}>
                        {formatActivitySegments(item as any, item.actorName).map((seg, si) => (
                          <Text key={si} style={seg.em && styles.activityEm}>{seg.text}</Text>
                        ))}
                      </Text>
                      <Text style={styles.activityTime}>{timeAgo(item.created_at)}</Text>
                    </View>
                  </View>
                );
              })
            )}

            {/* Samma fot som veckopanelens 'See everyone' — två utfällningar
                på samma flik ska inte se ut som två olika sorters knapp. */}
            {activity.length > ACTIVITY_PREVIEW && (
              <Pressable onPress={() => setShowAllActivity(v => !v)} style={styles.panelFoot}>
                <Text style={styles.panelFootText}>{showAllActivity ? 'Show less' : 'Show more'}</Text>
                <FontAwesome5 name={showAllActivity ? 'chevron-up' : 'chevron-down'} size={9} color={Palette.hue} />
              </Pressable>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Den egna listan. Ändringar läggs in i kretsens lista direkt, så att
          den egna lappen följer med utan att vänta på nästa load(). */}
      <TodoSheet
        visible={showMyTodos}
        userId={user.id}
        inCircle
        circleCount={myCircles.length}
        onClose={() => setShowMyTodos(false)}
        onChanged={mine => setTodos(all => [...all.filter(t => t.user_id !== user.id), ...mine])}
      />

      {/* Members */}
      {/* Stegen. Hela listan, inte bara nuvarande steg: poängen med en stege
          är att se var man står i förhållande till resten av den. */}
      <Modal visible={showLadderModal} transparent animationType="fade" onRequestClose={() => setShowLadderModal(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowLadderModal(false)} />
          <View style={[styles.card, styles.ladderCard]}>
            <Text style={styles.cardTitle}>The ladder</Text>

            {/* Hjältemärket: det man har just nu, stort nog att vara värt
                något. Namnet står under det och nivånumret under namnet —
                märket är rubriken här, inte texten. */}
            <View style={styles.ladderHero}>
              <CircleLevelBadge level={circleLevel} size={104} />
              <Text style={styles.ladderHeroName}>{circleLevelName(circleLevel)}</Text>
              <Text style={styles.ladderHeroLevel}>LEVEL {circleLevel}</Text>
            </View>

            {/* Hur långt in på steget cirkeln är. Nedräkningen mot nästa nivå
                stod här förut men står redan på sin egen rad i listan under —
                samma tal två gånger på samma skärm sa inget nytt andra
                gången. Kvar blir totalen, som mätaren behöver en etikett för. */}
            <View style={styles.ladderNext}>
              <Bar fraction={levelProgressFraction(lifetimeSeconds, circleLevel)} />
              <Text style={styles.ladderNextText}>
                {formatDuration(lifetimeSeconds)} together
              </Text>
            </View>

            <ScrollView style={styles.ladderList} showsVerticalScrollIndicator={false}>
              <View style={styles.panel}>
                {CIRCLE_LEVELS.map((lvl, i) => {
                  const n = i + 1;
                  const reached = n < circleLevel;
                  const current = n === circleLevel;
                  // Bara steget närmast ovanför räknar ner. Längre upp står
                  // tröskeln ensam: ett "1448h to go" på nivå tio är inget
                  // man kan sikta mot, och nio sådana rader i följd läser
                  // som en skuld i stället för som en stege.
                  const next = n === circleLevel + 1;
                  const toGo = secondsToNextLevel(lifetimeSeconds, n - 1);
                  return (
                    <View
                      key={lvl.name}
                      style={[
                        styles.ladderRow,
                        i > 0 && styles.rowDividerTop,
                        current && styles.ladderRowCurrent,
                      ]}
                    >
                      {/* Låsta märken ritas i grått men med samma form: man
                          ska kunna se vad man är på väg mot, inte bara att
                          något saknas. */}
                      <CircleLevelBadge level={n} size={38} locked={!reached && !current} />

                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.ladderName,
                            reached && styles.ladderNameReached,
                            current && styles.ladderNameCurrent,
                          ]}
                          numberOfLines={1}
                        >
                          {lvl.name}
                        </Text>
                        <Text style={styles.ladderHours}>
                          {current || reached
                            ? `Level ${n} · ${lvl.hoursRequired} h`
                            : next
                              ? `${formatDuration(toGo ?? 0)} to go`
                              : `Level ${n}`}
                        </Text>
                      </View>

                      {reached ? (
                        <FontAwesome name="check" size={12} color={Palette.accent} />
                      ) : current ? (
                        <Text style={styles.ladderYouAreHere}>NOW</Text>
                      ) : (
                        <Text style={styles.ladderLockedNum}>{lvl.hoursRequired} h</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            </ScrollView>

            <TouchableOpacity onPress={() => setShowLadderModal(false)} style={styles.cancelLink}>
              <Text style={styles.cancelLinkText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>


      <Modal visible={showMembersModal} transparent animationType="fade" onRequestClose={() => setShowMembersModal(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowMembersModal(false)} />
          <View style={styles.card}>
            {/* Inbjudan är en ikon uppe till höger: den hör till vilka som är
                med, men en hel rad ovanför utgången var för mycket. Full krets
                ger en grå ikon som inte går att trycka på — varför står i
                accessibilityLabel. */}
            <TouchableOpacity
              onPress={() => {
                setShowMembersModal(false);
                router.push({ pathname: '/circle-invite', params: { circleId: circle.id } } as any);
              }}
              style={styles.inviteMembersBtn}
              disabled={members.length >= MAX_MEMBERS}
              activeOpacity={0.7}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityState={{ disabled: members.length >= MAX_MEMBERS }}
              accessibilityLabel={members.length >= MAX_MEMBERS ? 'The circle is full' : 'Invite a friend to the circle'}
            >
              <FontAwesome5 name="user-plus" size={13} color={members.length >= MAX_MEMBERS ? Palette.textDisabled : Palette.hue} />
            </TouchableOpacity>
            <Text style={styles.cardTitle}>{circle.name}</Text>
            <Text style={styles.hintText}>Group members</Text>

            {/* Kretsens inställningar i en rad: vad som räknas och om det
                finns en belöning. Ägaren trycker för att ändra; för andra är
                raden bara information. Medlemslistan stängs innan rutan
                öppnas — två modaler ovanpå varandra fungerar inte på iOS. */}
            <TouchableOpacity
              style={styles.settingsRow}
              disabled={!iAmOwner}
              onPress={() => { setShowMembersModal(false); setShowSettings(true); }}
              activeOpacity={0.7}
              accessibilityRole={iAmOwner ? 'button' : 'text'}
              accessibilityLabel={`Counts ${formatCountWindow(circle.settings)}. Rewards ${circle.settings.rewards_enabled ? 'on' : 'off'}.${iAmOwner ? ' Change settings.' : ''}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.settingsRowText}>Counts {formatCountWindow(circle.settings).toLowerCase()}</Text>
                <Text style={styles.settingsRowMeta}>
                  Rewards {circle.settings.rewards_enabled ? 'on' : 'off'}
                  {circle.settings.pending ? ` · From next week: ${formatCountWindow(circle.settings.pending).toLowerCase()}` : ''}
                </Text>
              </View>
              {iAmOwner && <FontAwesome5 name="sliders-h" size={14} color={Palette.hue} />}
            </TouchableOpacity>

            <ScrollView style={styles.memberList} showsVerticalScrollIndicator={false}>
              {members.map(m => {
                const isMe = m.id === user.id;
                const status = friendStatus[m.id];
                // Bara ägaren ser knappen, och aldrig på sin egen rad — den
                // som vill ut själv använder Leave circle längre ner.
                const canRemove = iAmOwner && !isMe;
                return (
                  <View key={m.id} style={styles.memberListRow}>
                    <Avatar username={m.username} avatarUrl={m.avatar_url} size={38} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberListName} numberOfLines={1}>
                        {m.username}{isMe ? ' (you)' : ''}
                      </Text>
                      {m.role === 'owner' && <Text style={styles.memberListRole}>Owner</Text>}
                    </View>

                    {/* Ingen knapp för en själv. "Pending" utan riktning är
                        med flit: en väntande förfrågan kan gå åt båda hållen,
                        och "Requested" hade ljugit när det var de som frågat
                        dig. Själva svarandet hör hemma i vänner-fliken. */}
                    {isMe ? null : status === 'accepted' ? (
                      <Text style={styles.memberListMuted}>Friends</Text>
                    ) : status === 'pending' ? (
                      <Text style={styles.memberListMuted}>Pending</Text>
                    ) : (
                      <TouchableOpacity
                        style={styles.addFriendBtn}
                        onPress={() => handleAddFriend(m.id)}
                        disabled={addingFriendId === m.id}
                        activeOpacity={0.7}
                      >
                        <FontAwesome5 name="user-plus" size={11} color={Palette.hue} />
                        <Text style={styles.addFriendText}>
                          {addingFriendId === m.id ? 'Sending…' : 'Add friend'}
                        </Text>
                      </TouchableOpacity>
                    )}

                    {/* Ikon utan text: raden bär redan namn, roll och
                        vän-knapp, och ett fjärde ord hade trängt ut dem på en
                        smal skärm. Bekräftelsedialogen skriver ut vad den gör,
                        och accessibilityLabel bär meningen — samma lösning som
                        veckoknappen på märkesraden. */}
                    {canRemove && (
                      <TouchableOpacity
                        style={styles.removeMemberBtn}
                        onPress={() => handleRemoveMember(m)}
                        disabled={removingMemberId === m.id}
                        activeOpacity={0.7}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${m.username} from circle`}
                      >
                        {removingMemberId === m.id
                          ? <ActivityIndicator size="small" color={Palette.danger} />
                          : <FontAwesome5 name="user-times" size={12} color={Palette.danger} />}
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </ScrollView>

            {/* Utgången bor här, under listan och skild från den med en
                linje: det egna medlemskapet är en del av listan, men att
                lämna ska inte gå att träffa av misstag medan man bläddrar.
                Samma `handleLeave` och samma bekräftelse som förut. */}
            <TouchableOpacity
              onPress={handleLeave}
              style={styles.leaveBtn}
              disabled={busyAction}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Leave ${circle.name}`}
            >
              <FontAwesome5 name="sign-out-alt" size={13} color={Palette.danger} />
              <Text style={styles.leaveBtnText}>Leave circle</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setShowMembersModal(false)} style={styles.cancelLink}>
              <Text style={styles.cancelLinkText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <CircleSettingsSheet
        visible={showSettings}
        circleId={circle.id}
        settings={circle.settings}
        onClose={() => setShowSettings(false)}
        onSaved={load}
      />

      <CircleRewardSheet
        visible={showRewardModal && circle.settings.rewards_enabled}
        circleId={circle.id}
        reward={reward}
        meId={user.id}
        onClose={() => setShowRewardModal(false)}
        onChanged={async () => { setReward(await getCircleReward(circle.id)); load(); }}
      />

      {/* Set daily goal */}
      <Modal visible={showGoalModal} transparent animationType="fade" onRequestClose={() => setShowGoalModal(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowGoalModal(false)} />
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Your daily goal</Text>
            <Text style={styles.hintText}>
             
            </Text>

            <DurationWheel index={goalIndex} onIndexChange={setGoalIndex} />

            <TouchableOpacity style={styles.primaryBtn} onPress={handleSaveGoal} disabled={savingGoal}>
              <Text style={styles.primaryBtnText}>{savingGoal ? 'Saving…' : 'Set goal'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowGoalModal(false)} style={styles.cancelLink}>
              <Text style={styles.cancelLinkText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (Palette: AppPalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  centered: { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  // Luft mellan sektioner, tajt inuti dem: det är kontrasten mellan de två
  // som gör att ögat ser grupper i stället för en enda ström.
  scrollContent: { padding: Spacing.xl, paddingTop: 60, paddingBottom: 72, gap: 36 },

  header: { gap: 6 },
  title: { fontSize: 30, fontWeight: '900', color: Palette.textPrimary, letterSpacing: -0.3, flexShrink: 1 },
  headerActions: { flexDirection: 'row', gap: Spacing.sm },  // Samma geometri OCH samma botten som wrappedBtn; det är ramen och ikonen
  // som bär accent i stället för accentSoft, så de är jämbördiga i form och
  // inte i tyngd. Ändras måtten i den ena måste de ändras i den andra,
  // annars blir stapeln ojämn.
  //
  // Bottnen är `surface` och inte en tonad accent: i ljust läge lade den
  // tonen en blågrå skugga över en vit sida, vilket läste som en intryckt
  // knapp. Samma yta som hemskärmens `iconButton`, och tvillingen i
  // stats.tsx måste följa med.
  chatBtn: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Palette.surface,
    borderRadius: 12, borderWidth: 1, borderColor: alpha(Palette.hue, 0.25),
    width: 44, height: 44,
  },
  // Pricken ligger i knappens övre hörn med en ring i sidans botten runt
  // sig, så den syns mot ikonen under utan att behöva bli större.
  //
  // INNANFÖR knappen och inte utanför: Android klipper absolut placerade
  // barn mot förälderns kant när den har `borderRadius`, så ett negativt
  // `top`/`right` hade gett en prick som syns på iOS och saknas på Android.
  // `Palette.surface` och inte `bg` — knappens botten är ogenomskinlig
  // (vit i ljust läge), så det är knappen och inte sidan bakom den som
  // ringen ska smälta in i.
  unreadDot: {
    position: 'absolute', top: 4, right: 4,
    width: 11, height: 11, borderRadius: 5.5,
    backgroundColor: Palette.accent,
    borderWidth: 2, borderColor: Palette.surface,
  },
  // Samma yta som "See the week that passed" i stats.tsx — tonad botten, ram
  // och radie — men kvadratisk, eftersom texten är borta och bara ikonen står
  // kvar. Ändras tonen i den ena bör den ändras i den andra.
  wrappedBtn: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Palette.surface,
    borderRadius: 12, borderWidth: 1, borderColor: alpha(Palette.hue, 0.2),
    width: 44, height: 44,
  },
  levelBadgeBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingVertical: 2, flexShrink: 1 },
  levelBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },

  // ── Kretsrubriken och väljaren ──
  circleTitleBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 10, maxWidth: '100%', paddingVertical: 2 },
  // Kretsraden: kapslar som går att rulla i sidled, kant i kant med sidan
  // (negativ marginal + samma padding), så att det syns att den rullar.
  switcherWrap: { gap: 8, marginBottom: 10 },
  switcherScroll: { marginHorizontal: -Spacing.xl, flexGrow: 0 },
  switcherRow: { gap: 8, paddingHorizontal: Spacing.xl, alignItems: 'center' },
  switcherPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 34, paddingHorizontal: 14, borderRadius: Radius.pill,
    backgroundColor: Palette.hueTint, maxWidth: 200,
  },
  switcherPillOn: { backgroundColor: Palette.hue },
  switcherAdd: { width: 34, paddingHorizontal: 0, justifyContent: 'center' },
  switcherText: { fontSize: 14, fontWeight: '800', color: Palette.hue, flexShrink: 1 },
  // Olästa i en annan krets, eller en inbjudan bakom `+`. Innanför kapseln
  // och utan negativa mått: Android klipper barn utanför föräldern.
  switcherDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Palette.accent },
  switcherHint: { fontSize: 13, lineHeight: 18, color: Palette.textTertiary },
  levelActionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },

  memberList: { maxHeight: 340, marginHorizontal: -Spacing.xs },
  memberListRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  memberListName: { fontSize: 15, fontWeight: '700', color: Palette.textPrimary },
  memberListRole: { fontSize: 12, color: Palette.textTertiary, marginTop: 1 },
  memberListMuted: { fontSize: 13, color: Palette.textTertiary },
  addFriendBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 7, paddingHorizontal: 12,
    borderRadius: Radius.pill, backgroundColor: Palette.hueTint,
  },
  addFriendText: { fontSize: 13, fontWeight: '700', color: Palette.hue },
  // Utgången i medlemslistan: linje ovanför, text i `danger` — samma kulör
  // som ägarens *Remove*, för båda tar en person ur kretsen.
  leaveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, marginTop: Spacing.sm,
    borderTopWidth: 1, borderTopColor: Palette.surfaceBorder,
  },
  leaveBtnText: { fontSize: 15, fontWeight: '700', color: Palette.danger },
  // Inställningsraden överst i medlemslistan: en tonad yta, inte en ram.
  settingsRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Palette.hueTint,
  },
  settingsRowText: { fontSize: 14, fontWeight: '700', color: Palette.textPrimary },
  settingsRowMeta: { fontSize: 12, color: Palette.textTertiary, marginTop: 2 },
  // Inbjudan i medlemslistan: en rund ikon i kortets övre högra hörn, i
  // rummets kulör. Ligger ovanpå rubrikens rad, som är centrerad och har
  // plats på sidorna.
  inviteMembersBtn: {
    position: 'absolute', top: Spacing.lg, right: Spacing.lg, zIndex: 1,
    width: 36, height: 36, borderRadius: Radius.pill,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Palette.hueTint,
  },
  removeMemberBtn: {
    width: 30, height: 30, borderRadius: Radius.pill,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: alpha(Palette.danger, 0.12),
  },

  section: { gap: Spacing.md },
  sectionLabel: { ...Palette.eyebrow },
  // Lapparnas rad går kant i kant; raden själv drar in sitt innehåll igen.
  notesBleed: { marginHorizontal: -Spacing.xl },
  sectionHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  // ── Pottens streck ──
  // Vänsterställda som i designen: kolumnen till höger tar den andra kanten.
  memberBarsRow: { flexDirection: 'row', justifyContent: 'flex-start' },
  memberBarSlot: { alignItems: 'center', gap: 6 },
  // Ringen runt det valda strecket. Kanten finns alltid men är genomskinlig
  // när strecket inte är valt — annars hoppar strecken i sidled vid ett val.
  memberBarRing: {
    padding: 2, borderWidth: 2, borderColor: 'transparent',
    borderRadius: MEMBER_BAR_MAX_W,
  },
  memberBarName: { fontSize: 11, lineHeight: 14, fontWeight: '700', color: Palette.textSecondary, maxWidth: '100%' },
  memberReadout: { gap: 2, minHeight: 42, marginTop: Spacing.xs },
  memberReadoutHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  memberReadoutName: { flexShrink: 1, fontSize: 17, fontWeight: '700', color: Palette.textPrimary },
  memberReadoutLine: { fontSize: 14, color: Palette.textSecondary },
  // Uppmaningen när det egna målet saknas — i rummets kulör och fet, för det
  // är den som blockerar veckan.
  goalLinkStrong: { fontSize: 13, fontWeight: '800', color: Palette.hue },

  // ── Ringvyn ──
  // Platta färger: inga toningar, skuggor eller glöd i ringarna.
  ringsBlock: { gap: Spacing.lg },
  // Periodvalet lyfts en bit närmare rubriken (`periodPill`); datumet
  // står kvar där det stod, därav det större gapet.
  periodBlock: { alignItems: 'center', gap: 14 },
  periodPill: { marginTop: -10 },
  // Luft över och under ringen, så att den står fritt och inte klämd mellan
  // periodvalet och brickorna.
  heroRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginVertical: Spacing.lg },
  // Texten hålls innanför ringens insida (ringen minus två streck och lite
  // luft), så att `of 45h 30min together` bryts inuti i stället för att
  // sticka ut.
  heroCenter: { alignItems: 'center', width: HERO_RING - 2 * (HERO_STROKE + 10) },
  heroBig: { fontSize: 34, lineHeight: 40, fontWeight: '900', color: Palette.textPrimary, letterSpacing: -0.5 },
  heroBigUnit: { fontSize: 17, fontWeight: '700', color: Palette.textSecondary, letterSpacing: 0 },
  heroSub: { fontSize: 14, lineHeight: 18, color: Palette.textSecondary, textAlign: 'center' },
  // Fem i bredd, rader under varandra. Centrerad, så att en krets med två
  // medlemmar inte hänger i vänsterkanten.
  ringGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', rowGap: Spacing.lg },
  ringTile: { alignItems: 'center', gap: 4, minHeight: 44 },
  ringTileName: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: Palette.textSecondary, marginTop: 4, maxWidth: '100%' },
  ringTileNameOn: { fontWeight: '900', color: Palette.textPrimary },
  ringTileTime: { fontSize: 11, lineHeight: 14, color: Palette.textTertiary },
  // Namnet överst i ringen när en medlem är vald — i rummets kulör, så att
  // det syns att ringen just nu visar en person och inte kretsen.
  heroName: { fontSize: 13, lineHeight: 17, fontWeight: '800', color: Palette.hue, letterSpacing: 0.4, marginTop: 3 },
  // Kretsens etikett i ringen — samma versala ögonbrynsstil som rubrikerna.
  heroCircleLabel: { fontSize: 11, lineHeight: 15, fontWeight: '800', color: Palette.hue, letterSpacing: 1.6, marginBottom: 2 },
  // De andra brickorna när någon är vald: bak i bilden, men läsbara.
  ringTileDimmed: { opacity: 0.38 },
  heroSubRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  setGoalRow: { alignSelf: 'center', paddingVertical: 4 },
  heroStatus: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: -4 },
  heroStatusText: { fontSize: 12, fontWeight: '900', color: Palette.hue, letterSpacing: 1.3 },
  weekRange: { flexShrink: 1, fontSize: 12, fontWeight: '700', color: Palette.textTertiary, letterSpacing: 1.2 },

  // ── Panelen ───────────────────────────────────────────────────────────────
  // En yta för allt innehåll på sidan. `overflow: hidden` är det som låter
  // raderna inuti gå ända ut i kanten utan att kliva utanför hörnradien, och
  // det är därför avdelarna kan vara hårfina linjer i stället för mellanrum.
  //
  // Ingen ram: ytan skiljer sig redan från bakgrunden, och en kantlinje
  // ovanpå det blir en andra gräns för samma kant. Det var summan av alla
  // sådana linjer som gjorde sidan rörig.
  panel: {
    backgroundColor: Palette.surface, borderRadius: Radius.lg, overflow: 'hidden',
  },
  panelBody: { padding: Spacing.lg, gap: Spacing.md },
  panelFoot: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: Spacing.md,
    borderTopWidth: 1, borderTopColor: Palette.surfaceBorder,
    backgroundColor: Palette.ink02,
  },
  panelFootText: { fontSize: 12, fontWeight: '700', color: Palette.hue, letterSpacing: 0.6 },
  rowDividerTop: { borderTopWidth: 1, borderTopColor: Palette.surfaceBorder },

  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badgeText: { fontSize: 12, fontWeight: '900', color: Palette.hue, letterSpacing: 1.5 },

  barTrack: { height: 10, borderRadius: Radius.pill, backgroundColor: Palette.hueTrack, overflow: 'hidden' },
  barFill: { height: 10, borderRadius: Radius.pill, backgroundColor: Palette.hue },
  barFillMuted: { backgroundColor: Palette.ink18 },

  // Summakortet: större radie och ett eget lyft, så att det läses som
  // summan av strecken ovanför och inte som ännu en panel i flödet.
  // `cardShadow` kräver en ogenomskinlig botten på ytan den ligger på (se
  // appTheme.ts), därför har skalet samma botten och radie som kortet.
  potCardShadow: { borderRadius: 28, backgroundColor: Palette.surface, ...Palette.cardShadow },
  potCard: { borderRadius: 28 },
  potCardBody: { paddingTop: 20, paddingHorizontal: 22, paddingBottom: 22, gap: 10 },
  // Siffran först och stor, målet under i mindre — samma hierarki som på
  // Hem, så de två läses på samma sätt.
  potBig: { fontSize: 42, lineHeight: 48, fontWeight: '900', color: Palette.textPrimary, letterSpacing: -0.5 },
  potBigUnit: { fontSize: 22, fontWeight: '700', color: Palette.textSecondary, letterSpacing: 0 },
  potSub: { fontSize: 16, color: Palette.textSecondary, marginTop: -4, marginBottom: 4 },
  // Versal accenttext, ingen kapsel. En pill runt tre tecken är ytterligare
  // en liten rektangel på en sida som redan hade för många.
  statusPillText: { fontSize: 12, fontWeight: '900', color: Palette.hue, letterSpacing: 1.3 },

  // Raderna sitter inuti panelen och bär ingen egen ram — avdelaren räcker.
  memberRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg,
  },
  memberRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  memberRowName: { flex: 1, fontSize: 14, fontWeight: '700', color: Palette.textPrimary },
  metRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  goalNums: { fontSize: 13, color: Palette.textSecondary },
  // Nått mål i rummets gröna — ett medvetet undantag från grönregeln, se
  // CLAUDE.md under *Design*.
  goalNumsMet: { fontSize: 14, fontWeight: '800', color: Palette.hue },
  goalNoneText: { fontSize: 13, color: Palette.textTertiary, fontStyle: 'italic' },

  // Titelraden: namnet krymper, brickan gör det aldrig.
  // `lineHeight` står utskriven så att raden har samma höjd på båda
  // plattformarna. (Den var förr en term i `headerStack`s `marginTop`; sedan
  // texten flyttade bredvid emblemet är den inte det längre.)
  levelBadge: { fontSize: 12, lineHeight: 15, fontWeight: '900', color: Palette.hue, letterSpacing: 2, flexShrink: 1 },

  ladderHero: { alignItems: 'center', gap: 6, paddingTop: Spacing.sm, paddingBottom: Spacing.xs },
  ladderHeroName: { fontSize: 20, fontWeight: '900', color: Palette.textPrimary, letterSpacing: -0.2, textAlign: 'center' },
  ladderHeroLevel: { fontSize: 12, fontWeight: '900', color: Palette.hue, letterSpacing: 1.4 },
  ladderNext: { gap: 8, paddingBottom: Spacing.xs },
  ladderNextText: { fontSize: 12, color: Palette.textTertiary, flexShrink: 1 },
  ladderYouAreHere: { fontSize: 11, fontWeight: '900', color: Palette.hue, letterSpacing: 1.2 },
  // Egen takhöjd: med märke, mätare och tio rader är den här modalen den
  // högsta i fliken, och listan måste få krympa innan kortet gör det —
  // annars trycks Close-länken utanför skärmen på en liten telefon.
  ladderCard: { maxHeight: '88%' },
  ladderList: { flexShrink: 1, maxHeight: 320 },
  ladderRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: 11, paddingHorizontal: Spacing.md,
  },
  // Den nuvarande nivån markeras med en tonad yta, inte med en ram: panelen
  // har redan en kant, och en andra runt en rad hade blivit en ruta i rutan.
  ladderRowCurrent: { backgroundColor: Palette.hueTint },
  ladderName: { fontSize: 14, fontWeight: '600', color: Palette.textTertiary },
  ladderNameReached: { color: Palette.textSecondary },
  ladderNameCurrent: { color: Palette.hue, fontWeight: '900' },
  ladderHours: { fontSize: 12, color: Palette.textTertiary, marginTop: 2 },
  ladderLockedNum: { fontSize: 12, fontWeight: '700', color: Palette.textDisabled },

  levelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  levelBadgeText: { fontSize: 15, fontWeight: '900', color: Palette.hue, letterSpacing: 1.2 },
  levelTotal: { fontSize: 14, fontWeight: '700', color: Palette.textPrimary },
  levelNext: { fontSize: 13, color: Palette.textTertiary },

  emptyActivity: { color: Palette.textTertiary, fontSize: 14 },
  activityRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg,
  },
  // Grått, inte vitt: flödet är sidans bakgrundsbrus, inte dess rubriker.
  activityText: { fontSize: 14, color: Palette.textSecondary, lineHeight: 19 },
  // Blått på det som varierar rad till rad — siffran, saken, nivån. Det är
  // det ögat letar efter när man skummar flödet; meningen omkring är samma
  // varje gång och kan ligga kvar i grått.
  activityEm: { fontStyle: 'italic', color: Palette.hue },
  activityTextBright: { color: Palette.textPrimary },
  activityTextMilestone: { fontWeight: '700' },
  activityTime: { fontSize: 12, color: Palette.textTertiary, marginTop: 2 },
  milestoneIcon: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: Palette.hueTint,
    alignItems: 'center', justifyContent: 'center',
  },

  emptyState: { alignItems: 'center', gap: Spacing.md, paddingTop: 120, paddingHorizontal: Spacing.xl },
  emptyStateCompact: { paddingTop: Spacing.lg, paddingHorizontal: 0 },
  emptyIcon: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: Palette.hueTint,
    // Ramen följer tonen och inte accenten: en blå ring runt en grön yta är
    // två kulörer om samma kant.
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: alpha(Palette.hue, 0.5),
  },
  emptyTitle: { fontSize: 22, fontWeight: '800', color: Palette.textPrimary },
  emptySubtitle: { fontSize: 14, color: Palette.textSecondary, textAlign: 'center', lineHeight: 20, paddingHorizontal: Spacing.lg },
  createBtn: { backgroundColor: Palette.accent, paddingVertical: 14, paddingHorizontal: 32, borderRadius: Radius.pill, marginTop: Spacing.sm, ...Palette.cardShadow },
  createBtnText: { color: Palette.onAccent, fontSize: 15, fontWeight: '700' },

  invitesSection: { paddingHorizontal: Spacing.xl, marginTop: Spacing.xxl, gap: Spacing.sm },
  invitesSectionCompact: { paddingHorizontal: 0 },
  inviteRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Palette.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Palette.surfaceBorder,
    padding: Spacing.md,
  },
  inviteText: { fontSize: 14, color: Palette.textPrimary },
  inviteTime: { fontSize: 12, color: Palette.textTertiary, marginTop: 2 },
  acceptBtn: { width: 32, height: 32, borderRadius: Radius.pill, backgroundColor: Palette.accent, alignItems: 'center', justifyContent: 'center' },
  declineBtn: { width: 32, height: 32, borderRadius: Radius.pill, backgroundColor: Palette.surfaceAlt, alignItems: 'center', justifyContent: 'center' },

  backdrop: { flex: 1, backgroundColor: Palette.scrim, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  card: {
    width: '100%', backgroundColor: Palette.modalSurface, borderRadius: Radius.xl, padding: Spacing.xl, gap: Spacing.md,
    borderWidth: 1, borderColor: Palette.modalBorder,
  },
  cardTitle: { fontSize: 18, fontWeight: '700', color: Palette.textPrimary, textAlign: 'center' },
  textInput: {
    backgroundColor: Palette.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Palette.surfaceBorder,
    padding: 14, fontSize: 15, color: Palette.textPrimary,
  },
  hintText: { fontSize: 13, color: Palette.textTertiary, lineHeight: 18 },

  primaryBtn: { backgroundColor: Palette.accent, paddingVertical: 14, borderRadius: Radius.pill, alignItems: 'center' },
  primaryBtnText: { color: Palette.onAccent, fontSize: 15, fontWeight: '700' },
  cancelLink: { alignItems: 'center', paddingVertical: 6 },
  cancelLinkText: { color: Palette.textTertiary, fontSize: 14 },

  avatarFallback: { backgroundColor: Palette.surfaceAlt, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Palette.surfaceBorder },
  avatarLetter: { color: Palette.textSecondary, fontWeight: '700' },
});
