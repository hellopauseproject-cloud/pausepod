import { FontAwesome5 } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { alpha, AppPalette, Radius, Spacing } from '../constants/appTheme';
import { usePalette } from '../contexts/ThemeContext';
import { track } from '../lib/analytics';
import {
  fetchInvitableFriends, getPauseInviteSelection, InvitableFriend, MAX_PAUSE_INVITEES,
  setPauseInviteSelection, usePauseInviteSelection,
} from '../lib/pauseInvites';

/**
 * Raden ovanför PAUSE på Hem: vilka vänner som bjuds in när pausen startar
 * (lib/pauseInvites.ts). Utan val är den en enda länk, *Invite friends*;
 * med val visar den ansiktena och namnen, och ett tryck öppnar väljaren igen.
 *
 * **Höjden är fast (`PAUSE_INVITE_ROW_H`)**, för heronens räkning på Hem
 * lägger den till i sina extras — en rad som växte med antalet namn hade ätit
 * golvet under PAUSE. Därför står namnen på en rad och kapas, och ansiktena
 * slutar vid tre.
 */
export const PAUSE_INVITE_ROW_H = 36;

const FACE = 26;
const FACES_SHOWN = 3;

export function PauseInviteRow({ userId }: { userId: string }) {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  const selection = usePauseInviteSelection();
  const [open, setOpen] = useState(false);

  const names = selection.map(f => f.username);
  const label = names.length === 0
    ? 'Invite friends'
    : names.length <= 2
      ? `With ${names.join(' & ')}`
      : `With ${names[0]}, ${names[1]} +${names.length - 2}`;

  return (
    <>
      <TouchableOpacity
        style={[styles.row, selection.length > 0 && styles.rowSelected]}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={selection.length === 0
          ? 'Invite friends to your pause'
          : `Inviting ${names.join(', ')} when your pause starts. Change.`}
      >
        {selection.length === 0 ? (
          <FontAwesome5 name="user-plus" size={12} color={Palette.hue} />
        ) : (
          <View style={[styles.faces, { width: FACE + (Math.min(selection.length, FACES_SHOWN) - 1) * (FACE * 0.62) }]}>
            {selection.slice(0, FACES_SHOWN).map((f, i) => (
              <View key={f.id} style={[styles.faceRing, { left: i * FACE * 0.62, zIndex: FACES_SHOWN - i }]}>
                <Face friend={f} size={FACE} />
              </View>
            ))}
          </View>
        )}
        <Text style={styles.rowText} numberOfLines={1}>{label}</Text>
        {selection.length > 0 && <FontAwesome5 name="pen" size={9} color={Palette.textTertiary} />}
      </TouchableOpacity>

      <InvitePicker visible={open} userId={userId} onClose={() => setOpen(false)} />
    </>
  );
}

function Face({ friend, size }: { friend: Pick<InvitableFriend, 'username' | 'avatar_url'>; size: number }) {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  if (friend.avatar_url) {
    return <Image source={{ uri: friend.avatar_url }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={[styles.faceFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.faceLetter, { fontSize: Math.max(11, Math.round(size * 0.42)) }]}>
        {friend.username[0]?.toUpperCase() ?? '?'}
      </Text>
    </View>
  );
}

/**
 * Väljaren. Vänlistan hämtas när arket öppnas — flikar avmonteras inte, och
 * "pausar redan" är bara sant just nu.
 *
 * **En vän som redan pausar syns, men går inte att välja.** Raden står kvar
 * nedtonad med *Anna is already pausing…*: att den fattas hade sett ut som
 * att vännen försvunnit ur listan. Är hen redan vald när arket öppnas tas hen
 * bort ur valet — en inbjudan till någon som pausar kan ändå inte besvaras.
 */
function InvitePicker({ visible, userId, onClose }: { visible: boolean; userId: string; onClose: () => void }) {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  const insets = useSafeAreaInsets();
  const [friends, setFriends] = useState<InvitableFriend[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setFailed(false);
    // Valet läses ur butiken i det ögonblick arket öppnas, inte ur en
    // renderings värde: genvägen i Friends lägger till vänner medan Hem står
    // monterad, och en fångad kopia hade varit den tomma från första
    // renderingen — de valda stod då oikryssade här.
    const current = getPauseInviteSelection();
    setPicked(new Set(current.map(f => f.id)));
    try {
      const list = await fetchInvitableFriends(userId);
      setFriends(list);
      // Valet följer med in i arket, utom den som börjat pausa sedan dess.
      const pausing = new Set(list.filter(f => f.is_pausing).map(f => f.id));
      setPicked(new Set(current.map(f => f.id).filter(id => !pausing.has(id))));
    } catch {
      setFailed(true);
    }
  }, [userId]);

  useEffect(() => {
    if (visible) { setFriends(null); load(); }
  }, [visible, load]);

  const toggle = (f: InvitableFriend) => {
    if (f.is_pausing) return;
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(f.id)) next.delete(f.id);
      else if (next.size < MAX_PAUSE_INVITEES) next.add(f.id);
      return next;
    });
  };

  const done = () => {
    const chosen = (friends ?? []).filter(f => picked.has(f.id) && !f.is_pausing);
    setPauseInviteSelection(chosen);
    if (chosen.length > 0) track('pause_invitees_selected', { count: chosen.length });
    onClose();
  };

  const full = picked.size >= MAX_PAUSE_INVITEES;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: Spacing.lg + insets.bottom }]}>
          <View style={styles.grab} />
          <View style={styles.titleRow}>
            <Text style={styles.title}>Pause together</Text>
            {/* Bara när någon är ikryssad — en knapp som inte kan göra
                något är brus. Valet sparas först med knappen nedan, så
                det går att ångra genom att stänga arket. */}
            {picked.size > 0 && (
              <TouchableOpacity
                onPress={() => setPicked(new Set())}
                activeOpacity={0.6}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Unmark everyone"
              >
                <Text style={styles.clearText}>Unmark all</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={styles.sub}>
            They get an invite when you start, and can join while you pause.
          </Text>

          {friends === null && !failed && (
            <ActivityIndicator color={Palette.hue} style={{ marginVertical: 32 }} />
          )}

          {failed && (
            <TouchableOpacity onPress={load} style={styles.empty} activeOpacity={0.7}>
              <Text style={styles.emptyText}>Couldn&apos;t load your friends. Tap to try again.</Text>
            </TouchableOpacity>
          )}

          {friends !== null && friends.length === 0 && (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No friends to invite yet.</Text>
              <TouchableOpacity
                onPress={() => { onClose(); router.push('/add-friend' as never); }}
                activeOpacity={0.7}
              >
                <Text style={styles.emptyLink}>Add a friend →</Text>
              </TouchableOpacity>
            </View>
          )}

          {friends !== null && friends.length > 0 && (
            <ScrollView style={styles.list} contentContainerStyle={{ paddingVertical: 4 }}>
              {friends.map(f => {
                const on = picked.has(f.id);
                const blocked = f.is_pausing || (full && !on);
                return (
                  <TouchableOpacity
                    key={f.id}
                    style={[styles.friendRow, f.is_pausing && styles.friendRowPausing]}
                    onPress={() => toggle(f)}
                    disabled={blocked}
                    activeOpacity={0.7}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled: blocked }}
                    accessibilityLabel={f.is_pausing ? `${f.username} is already pausing` : f.username}
                  >
                    <Face friend={f} size={40} />
                    <Text
                      style={[styles.friendName, f.is_pausing && styles.friendNamePausing]}
                      numberOfLines={1}
                    >
                      {f.is_pausing ? `${f.username} is already pausing…` : f.username}
                    </Text>
                    {!f.is_pausing && (
                      <View style={[styles.check, on && styles.checkOn, blocked && { opacity: 0.4 }]}>
                        {on && <FontAwesome5 name="check" size={11} color={Palette.onAccent} />}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {full && <Text style={styles.fullNote}>Up to {MAX_PAUSE_INVITEES} friends per pause.</Text>}

          <TouchableOpacity style={styles.primary} onPress={done} activeOpacity={0.85} disabled={friends === null && !failed}>
            <Text style={styles.primaryText}>
              {picked.size === 0 ? 'Done' : picked.size === 1 ? 'Invite 1 friend' : `Invite ${picked.size} friends`}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (Palette: AppPalette) => StyleSheet.create({
  // ── Raden ovanför PAUSE ──
  row: {
    height: PAUSE_INVITE_ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    maxWidth: '86%',
  },
  // Med val får raden en ton, så att den läses som ett val och inte som en
  // länk — men ingen fyllning: fyllt är accentens, och knappen under är den.
  rowSelected: {
    backgroundColor: Palette.hueTint,
    borderWidth: 1,
    borderColor: alpha(Palette.hue, 0.3),
    paddingLeft: 5,
  },
  rowText: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: Palette.hue },
  faces: { height: FACE, position: 'relative' },
  faceRing: {
    position: 'absolute', top: 0,
    borderRadius: FACE / 2, borderWidth: 1.5, borderColor: Palette.bg,
    marginTop: -1.5, marginLeft: -1.5,
  },
  faceFallback: {
    backgroundColor: Palette.surfaceAlt, alignItems: 'center', justifyContent: 'center',
  },
  faceLetter: { color: Palette.textSecondary, fontWeight: '700' },

  // ── Väljaren ──
  overlay: { flex: 1, backgroundColor: Palette.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Palette.modalSurface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: Palette.modalBorder,
    paddingHorizontal: Spacing.xl,
    paddingTop: 10,
    gap: 10,
    maxHeight: '82%',
  },
  grab: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: Palette.ink20, marginBottom: 6,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { fontSize: 20, fontWeight: '900', color: Palette.textPrimary },
  clearText: { fontSize: 14, fontWeight: '600', color: Palette.hue },
  sub: { fontSize: 14, lineHeight: 20, color: Palette.textSecondary },
  list: { flexGrow: 0 },
  friendRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 9,
  },
  friendRowPausing: { opacity: 0.55 },
  friendName: { flex: 1, fontSize: 15, fontWeight: '600', color: Palette.textPrimary },
  // Grå och kursiv, men ur textskalan: en etikett under 0.30 försvinner
  // (CLAUDE.md, *Grå text har ett kontrastgolv*).
  friendNamePausing: { fontWeight: '500', fontStyle: 'italic', color: Palette.textTertiary },
  check: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 1.5, borderColor: Palette.ink30,
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: Palette.accent, borderColor: Palette.accent },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 24 },
  emptyText: { fontSize: 14, color: Palette.textSecondary, textAlign: 'center' },
  emptyLink: { fontSize: 14, fontWeight: '700', color: Palette.hue },
  fullNote: { fontSize: 13, color: Palette.textTertiary, textAlign: 'center' },
  primary: {
    backgroundColor: Palette.accent, paddingVertical: 14, borderRadius: Radius.pill,
    alignItems: 'center', marginTop: 4,
  },
  primaryText: { color: Palette.onAccent, fontSize: 15, fontWeight: '700' },
});
