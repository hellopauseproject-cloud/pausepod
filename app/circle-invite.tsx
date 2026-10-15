import { FontAwesome5 } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { track } from '../lib/analytics';
import { supabase } from '../lib/supabase';
import { AppPalette, Radius, Spacing } from '../constants/appTheme';
import { RoomProvider, usePalette } from '../contexts/ThemeContext';
import { roomShell, ScreenBackground } from '../components/screen-background';

type FriendRow = { id: string; username: string; avatar_url: string | null };

function Avatar({ username, avatarUrl, size = 42 }: { username: string; avatarUrl?: string | null; size?: number }) {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  if (avatarUrl) {
    return <Image source={{ uri: avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarLetter, { fontSize: size * 0.38 }]}>
        {username[0]?.toUpperCase() ?? '?'}
      </Text>
    </View>
  );
}

/**
 * Hör till **circle-rummet**. Rummet följer ärendet och inte filträdet — se
 * ROOMS i [constants/appTheme.ts](../constants/appTheme.ts). Skalet är
 * identiskt med de andra rummens: en komponent kan inte läsa sin egen
 * provider, och en bakgrund i skalet täcker varje gren skärmen returnerar.
 */
export default function CircleInviteRoom() {
  return (
    <RoomProvider room="circle">
      <View style={roomShell}>
        <ScreenBackground room="circle" />
        <CircleInviteScreen />
      </View>
    </RoomProvider>
  );
}

function CircleInviteScreen() {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  // `from=create` betyder att skärmen är sista steget i /circle-create, inte
  // ett besök från en krets som redan lever. Skillnaden är vägen ut: där bakåt
  // annars betyder "tillbaka till kretsen" skulle den efter ett skapande läsas
  // som ett ångrande — kretsen finns ju redan. Därför en egen avslutsknapp.
  const { circleId, from } = useLocalSearchParams<{ circleId: string; from?: string }>();
  const justCreated = from === 'create';

  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [unavailableIds, setUnavailableIds] = useState<Set<string>>(new Set());
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [errorText, setErrorText] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user || !circleId) return;
    setLoading(true);

    const { data: friendData } = await supabase
      .from('friendships')
      .select(`
        requester_id, receiver_id,
        requester:profiles!requester_id(id, username, avatar_url),
        receiver:profiles!receiver_id(id, username, avatar_url)
      `)
      .or(`requester_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .eq('status', 'accepted');

    const friendList: FriendRow[] = (friendData ?? [])
      .map((f: any) => (f.requester_id === user.id ? f.receiver : f.requester))
      .filter(Boolean);
    setFriends(friendList);

    const [{ data: members }, { data: pendingInvites }] = await Promise.all([
      supabase.from('circle_members').select('user_id').eq('circle_id', circleId),
      supabase.from('circle_invites').select('invitee_id').eq('circle_id', circleId).eq('status', 'pending'),
    ]);

    setUnavailableIds(new Set([
      ...(members ?? []).map((m: any) => m.user_id),
      ...(pendingInvites ?? []).map((i: any) => i.invitee_id),
    ]));

    setLoading(false);
  }, [user, circleId]);

  useEffect(() => { load(); }, [load]);

  const handleInvite = async (friend: FriendRow) => {
    if (!circleId || sendingId) return;
    setSendingId(friend.id);
    setErrorText('');

    const { error } = await supabase.rpc('invite_to_circle', {
      p_circle_id: circleId,
      p_invitee_id: friend.id,
    });

    setSendingId(null);

    if (error) {
      setErrorText(error.message);
      return;
    }

    track('circle_invite_sent');
    setSentIds(prev => new Set(prev).add(friend.id));
    setUnavailableIds(prev => new Set(prev).add(friend.id));
  };

  return (
    <View style={[styles.container, { paddingTop: Math.max(70, insets.top + 8) }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <FontAwesome5 name="arrow-left" size={16} color={Palette.accent} />
        </TouchableOpacity>
        <Text style={styles.title}>{justCreated ? 'Circle created.' : 'Invite to circle.'}</Text>
        <Text style={styles.subtitle}>
          {justCreated ? 'Now invite the people who belong in it.' : 'Choose from your friends.'}
        </Text>
      </View>

      {!!errorText && <Text style={styles.errorText}>{errorText}</Text>}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.results}
        showsVerticalScrollIndicator={false}
      >
        {!loading && friends.length === 0 && (
          <Text style={styles.noResults}>You don't have any friends to invite yet.</Text>
        )}

        {friends.map(friend => {
          const sent = sentIds.has(friend.id);
          const unavailable = unavailableIds.has(friend.id) && !sent;
          return (
            <View key={friend.id} style={styles.resultRow}>
              <Avatar username={friend.username} avatarUrl={friend.avatar_url} />
              <Text style={styles.resultUsername}>{friend.username}</Text>
              <TouchableOpacity
                style={[styles.sendBtn, (sent || unavailable) && styles.sendBtnSent]}
                onPress={() => handleInvite(friend)}
                disabled={sent || unavailable || sendingId === friend.id}
                activeOpacity={0.8}
              >
                <Text style={[styles.sendBtnText, (sent || unavailable) && styles.sendBtnTextSent]}>
                  {sent ? 'Sent' : unavailable ? 'In circle' : sendingId === friend.id ? 'Sending…' : 'Invite'}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>

      {justCreated && (
        <View style={[styles.foot, { paddingBottom: insets.bottom + Spacing.xl }]}>
          <TouchableOpacity style={styles.doneBtn} onPress={() => router.back()} activeOpacity={0.85}>
            <Text style={styles.doneBtnText}>
              {sentIds.size > 0 ? 'Go to your circle' : 'Invite someone later'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const makeStyles = (Palette: AppPalette) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingHorizontal: Spacing.xl,
    paddingTop: 70,
  },

  header: { gap: 8, marginBottom: 28 },
  backBtn: { alignSelf: 'flex-start', paddingVertical: 12, paddingHorizontal: 12, marginBottom: 4 },
  title: { fontSize: 36, fontWeight: '800', color: Palette.textPrimary, letterSpacing: 0.2, lineHeight: 44 },
  subtitle: { fontSize: 15, color: Palette.textSecondary, letterSpacing: 0.2 },

  errorText: { color: Palette.danger, fontSize: 14, marginBottom: 16 },

  scroll: { flex: 1 },
  results: { gap: 8, paddingBottom: Spacing.lg },

  // Foten står utanför rullningen: knappen ska ligga kvar även för den som har
  // fler vänner än vad som ryms på en skärm.
  //
  // Undersidans luft sätts i JSX av `insets.bottom`, inte här: ett fast tal
  // räcker på en skärm utan systemfält men hamnar under gestpinnen eller
  // Androids tre knappar på alla andra. Värdet här är bara golvet för en
  // enhet som inte har något sådant fält alls.
  foot: { paddingTop: Spacing.lg, paddingBottom: Spacing.xl },
  doneBtn: {
    backgroundColor: Palette.accent,
    paddingVertical: 16,
    borderRadius: Radius.pill,
    alignItems: 'center',
  },
  doneBtnText: { color: Palette.onAccent, fontSize: 17, fontWeight: '900', letterSpacing: 0.5 },

  noResults: { color: Palette.textTertiary, fontSize: 14, textAlign: 'center', paddingTop: 24 },
  resultRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 16,
    backgroundColor: Palette.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Palette.surfaceBorder,
  },
  resultUsername: { flex: 1, fontSize: 15, fontWeight: '600', color: Palette.textPrimary, letterSpacing: 0.2 },
  sendBtn: { backgroundColor: Palette.accent, paddingVertical: 7, paddingHorizontal: 16, borderRadius: Radius.pill },
  sendBtnSent: { backgroundColor: 'transparent', borderWidth: 1, borderColor: Palette.surfaceBorder },
  sendBtnText: { color: Palette.onAccent, fontSize: 14, fontWeight: '600' },
  sendBtnTextSent: { color: Palette.textTertiary },

  avatarFallback: {
    backgroundColor: Palette.surfaceAlt, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Palette.surfaceBorder,
  },
  avatarLetter: { color: Palette.textSecondary, fontWeight: '700' },
});
