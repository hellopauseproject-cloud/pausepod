import { FontAwesome, FontAwesome5, MaterialIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Animated, Modal, Pressable, ScrollView, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { DEFAULT_CATEGORIES, getSelectedCategories } from './pauseLogger';

const MONTHS = ['jan','feb','mar','apr','maj','jun','jul','aug','sep','okt','nov','dec'];

function fmtDate(iso: string) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} · ${hh}:${mm}`;
}

function fmtDur(secs: number) {
  if (secs < 60) return `${secs}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

function fmtTotal(secs: number) {
  if (secs === 0) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtIntention(raw: string | null, categoryMap: Record<string, string>) {
  if (!raw) return '—';
  if (categoryMap[raw]) return categoryMap[raw];
  const builtIn: Record<string, string> = {
    focus: 'Fokus', walk: 'Promenad', workout: 'Träning', social: 'Socialt',
    clean: 'Städa', meditate: 'Meditation', read: 'Läsning', study: 'Studier',
    rest: 'Vila', create: 'Skapande', music: 'Musik', nature: 'Natur',
  };
  if (builtIn[raw]) return builtIn[raw];
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

type MsgData = {
  id: string; senderId: string; senderName: string;
  text: string; delivered: boolean; createdAt: string;
};

type SessionItem = {
  id: string; durationSecs: number; intention: string | null;
  startedAt: string; sharedSessionId: string | null;
  friendName: string | null; msg: MsgData | null;
  withPod: boolean | null;
};

// Modul-nivå — överlever remount inom samma app-session
const _readIds = new Set<string>();

export default function StatsScreen() {
  const { user } = useAuth();
  const [totalPauses, setTotalPauses] = useState(0);
  const [totalSecs, setTotalSecs]     = useState(0);
  const [avgSecs, setAvgSecs]         = useState(0);
  const [sessions, setSessions]       = useState<SessionItem[]>([]);
  const [visibleCount, setVisibleCount] = useState(10);
  const [selectedMsg, setSelectedMsg] = useState<MsgData | null>(null);
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
  const fadeAnim     = useRef(new Animated.Value(0)).current;
  const dataFadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    getSelectedCategories().then(cats => {
      const all = [...DEFAULT_CATEGORIES, ...cats];
      const map: Record<string, string> = {};
      all.forEach(c => { map[c.id] = c.label; });
      setCategoryMap(map);
    });
  }, []);

  useFocusEffect(useCallback(() => {
    if (!user?.id) return;
    setVisibleCount(10);
    fadeAnim.setValue(0);
    dataFadeAnim.setValue(0);
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();

    (async () => {
      const { data: all } = await supabase
        .from('pause_sessions')
        .select('id, duration_seconds, intention, started_at, shared_session_id, with_pod')
        .eq('user_id', user.id)
        .not('ended_at', 'is', null)
        .order('started_at', { ascending: false });

      const rows = all ?? [];
      const total   = rows.length;
      const totSec  = rows.reduce((s, r) => s + (r.duration_seconds ?? 0), 0);
      setTotalPauses(total);
      setTotalSecs(totSec);
      setAvgSecs(total > 0 ? Math.round(totSec / total) : 0);

      const recent = rows;
      const ids    = recent.map(r => r.id);

      // Messages where I am receiver
      let msgMap: Record<string, MsgData> = {};
      if (ids.length > 0) {
        const { data: msgs } = await supabase
          .from('pause_messages')
          .select('id, sender_id, session_id, text_content, delivered, created_at')
          .eq('receiver_id', user.id)
          .eq('message_type', 'text')
          .in('session_id', ids);

        const sIds = [...new Set((msgs ?? []).map(m => m.sender_id))];
        let sMap: Record<string, string> = {};
        if (sIds.length > 0) {
          const { data: ps } = await supabase.from('profiles').select('id, username').in('id', sIds);
          sMap = Object.fromEntries((ps ?? []).map(p => [p.id, p.username ?? '?']));
        }
        for (const m of (msgs ?? [])) {
          msgMap[m.session_id] = {
            id: m.id, senderId: m.sender_id, senderName: sMap[m.sender_id] ?? '?',
            text: m.text_content ?? '', delivered: m.delivered ?? false, createdAt: m.created_at,
          };
        }
      }

      // Friend names for shared sessions
      const sharedIds = recent.filter(r => r.shared_session_id).map(r => r.shared_session_id!);
      let friendMap: Record<string, string> = {};
      if (sharedIds.length > 0) {
        const { data: partners } = await supabase
          .from('pause_sessions')
          .select('shared_session_id, user_id')
          .in('shared_session_id', sharedIds)
          .neq('user_id', user.id);
        const pIds = [...new Set((partners ?? []).map(p => p.user_id))];
        if (pIds.length > 0) {
          const { data: profs } = await supabase.from('profiles').select('id, username').in('id', pIds);
          const pNameMap = Object.fromEntries((profs ?? []).map(p => [p.id, p.username ?? '?']));
          for (const p of (partners ?? [])) {
            if (p.shared_session_id) friendMap[p.shared_session_id] = pNameMap[p.user_id] ?? '?';
          }
        }
      }

      setSessions(recent.map(r => ({
        id: r.id,
        durationSecs: r.duration_seconds ?? 0,
        intention: r.intention,
        startedAt: r.started_at ?? '',
        sharedSessionId: r.shared_session_id,
        friendName: r.shared_session_id ? (friendMap[r.shared_session_id] ?? null) : null,
        msg: msgMap[r.id] ?? null,
        withPod: r.with_pod ?? null,
      })));

      Animated.timing(dataFadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    })();
  }, [user?.id]));

  const deleteSession = async (id: string) => {
    await supabase.from('pause_sessions').delete().eq('id', id).eq('user_id', user!.id);
    setSessions(prev => prev.filter(s => s.id !== id));
    const { data } = await supabase
      .from('pause_sessions')
      .select('duration_seconds')
      .eq('user_id', user!.id)
      .not('ended_at', 'is', null);
    const rows = data ?? [];
    const total = rows.length;
    const totSec = rows.reduce((s, r) => s + (r.duration_seconds ?? 0), 0);
    setTotalPauses(total);
    setTotalSecs(totSec);
    setAvgSecs(total > 0 ? Math.round(totSec / total) : 0);
  };

  const confirmDelete = (id: string) => {
    Alert.alert('Radera paus', 'Vill du radera den här pausen?', [
      { text: 'Avbryt', style: 'cancel' },
      { text: 'Radera', style: 'destructive', onPress: () => deleteSession(id) },
    ]);
  };

  const openMsg = async (msg: MsgData) => {
    setSelectedMsg(msg);
    if (!msg.delivered && !_readIds.has(msg.id)) {
      _readIds.add(msg.id);
      setSessions(prev =>
        prev.map(s =>
          s.msg?.id === msg.id ? { ...s, msg: { ...s.msg!, delivered: true } } : s
        )
      );
      const { error } = await supabase
        .from('pause_messages')
        .update({ delivered: true })
        .eq('id', msg.id)
        .eq('receiver_id', user!.id);
      if (error) _readIds.delete(msg.id);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

      {/* Back */}
      <Animated.View style={{ opacity: fadeAnim }}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <FontAwesome name="chevron-left" size={14} color="#2e86de" />
          <Text style={styles.backText}>Tillbaka</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* Summary card */}
      <Animated.View style={[styles.summaryCard, { opacity: dataFadeAnim }]}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNum}>{totalPauses}</Text>
          <Text style={styles.summaryLbl}>pauser</Text>
        </View>
        <View style={styles.summaryDiv} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNum}>{fmtTotal(totalSecs)}</Text>
          <Text style={styles.summaryLbl}>total tid</Text>
        </View>
        <View style={styles.summaryDiv} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNum}>{avgSecs > 0 ? fmtDur(avgSecs) : '—'}</Text>
          <Text style={styles.summaryLbl}>snitt</Text>
        </View>
      </Animated.View>

      {/* Wrapped */}
      <Animated.View style={{ opacity: fadeAnim }}>
        <TouchableOpacity style={styles.wrappedBtn} onPress={() => router.push('/my-wrapped' as never)} activeOpacity={0.8}>
          <MaterialIcons name="insights" size={14} color="#5ba8f5" />
          <Text style={styles.wrappedBtnText}>Se veckan som gått</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* Section label */}
      <Text style={styles.sectionLabel}>SENASTE PAUSER</Text>

      {/* Session cards */}
      {sessions.length === 0 ? (
        <Animated.Text style={[styles.empty, { opacity: dataFadeAnim }]}>Inga pauser ännu.</Animated.Text>
      ) : sessions.slice(0, visibleCount).map((s, i) => {
        const isUnread = !!s.msg && !s.msg.delivered && !_readIds.has(s.msg.id);
        return (
          <Animated.View key={s.id} style={{ opacity: dataFadeAnim }}>
            <Swipeable
              renderRightActions={() => (
                <TouchableOpacity style={styles.deleteAction} onPress={() => confirmDelete(s.id)} activeOpacity={0.85}>
                  <FontAwesome5 name="trash" size={14} color="#fff" />
                </TouchableOpacity>
              )}
            >
              <View style={styles.sessionCard}>
                <View style={styles.sessionCardTop}>
                  <Text style={styles.sessionDur}>{fmtDur(s.durationSecs)}</Text>
                  <View style={styles.sessionCardRight}>
                    <Text style={styles.sessionDate}>{s.startedAt ? fmtDate(s.startedAt) : '—'}</Text>
                    {s.msg && (
                      <TouchableOpacity style={styles.mailBtn} onPress={() => openMsg(s.msg!)} activeOpacity={0.65}>
                        <FontAwesome5 name="envelope" size={13} color={isUnread ? '#5ba8f5' : 'rgba(255,255,255,0.2)'} />
                        {isUnread && <View style={styles.unreadDot} />}
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
                <View style={styles.sessionTags}>
                  {s.friendName ? (
                    <View style={styles.tagFriend}>
                      <FontAwesome5 name="user-friends" size={9} color="#5ba8f5" />
                      <Text style={styles.tagFriendText}>{s.friendName}</Text>
                    </View>
                  ) : (
                    <View style={styles.tagSolo}>
                      <Text style={styles.tagSoloText}>Egen paus</Text>
                    </View>
                  )}
                  {s.intention && (
                    <View style={styles.tagIntention}>
                      <Text style={styles.tagIntentionText}>{fmtIntention(s.intention, categoryMap)}</Text>
                    </View>
                  )}
                  {s.withPod !== null && (
                    <View style={[styles.tagPod, s.withPod && styles.tagPodActive]}>
                      {s.withPod ? (
                        <FontAwesome name="pause" size={9} color="rgba(91,168,245,0.7)" />
                      ) : (
                        <MaterialIcons name="cancel-presentation" size={14} color="rgba(255,255,255,0.25)" />
                      )}
                    </View>
                  )}
                </View>
              </View>
            </Swipeable>
          </Animated.View>
        );
      })}

      {/* Visa mer */}
      {sessions.length > visibleCount && (
        <TouchableOpacity style={styles.loadMoreBtn} onPress={() => setVisibleCount(v => v + 10)} activeOpacity={0.75}>
          <Text style={styles.loadMoreText}>Visa mer</Text>
        </TouchableOpacity>
      )}

      {/* Message modal */}
      <Modal visible={!!selectedMsg} transparent animationType="fade" onRequestClose={() => setSelectedMsg(null)}>
        <Pressable style={styles.overlay} onPress={() => setSelectedMsg(null)}>
          <Pressable style={styles.msgCard} onPress={() => {}}>
            <Text style={styles.msgSender}>{selectedMsg?.senderName}</Text>
            <Text style={styles.msgText}>{selectedMsg?.text}</Text>
            <Text style={styles.msgDate}>skickat {selectedMsg ? fmtDate(selectedMsg.createdAt) : ''}</Text>
            <TouchableOpacity style={styles.msgCloseBtn} onPress={() => setSelectedMsg(null)} activeOpacity={0.7}>
              <Text style={styles.msgCloseTxt}>Stäng</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1, backgroundColor: '#0f0f1a',
    padding: 24, paddingTop: 10,
  },
  backBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 28, marginTop: 30, alignSelf: 'flex-start',
    paddingVertical: 10, paddingHorizontal: 4,
  },
  backText: { color: '#2e86de', fontSize: 15 },

  // Summary
  summaryCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 20, borderWidth: 1, borderColor: '#1e2a3a',
    paddingVertical: 24, paddingHorizontal: 8,
    marginBottom: 10,
  },
  summaryItem: { flex: 1, alignItems: 'center', gap: 6 },
  summaryNum: { fontSize: 32, fontWeight: '900', color: '#ffffff', letterSpacing: -1 },
  summaryLbl: { fontSize: 10, color: 'rgba(255,255,255,0.3)', letterSpacing: 2, textTransform: 'uppercase' },
  summaryDiv: { width: 1, height: 40, backgroundColor: 'rgba(255,255,255,0.07)' },

  // Section label
  sectionLabel: {
    fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.3)',
    letterSpacing: 3, textTransform: 'uppercase',
    marginBottom: 12, marginTop: 4,
  },

  empty: { color: 'rgba(255,255,255,0.25)', fontSize: 14, paddingVertical: 16 },

  deleteAction: {
    backgroundColor: '#c0392b', justifyContent: 'center', alignItems: 'center',
    width: 60, borderRadius: 16, marginBottom: 10,
  },

  // Session card
  sessionCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16, borderWidth: 1, borderColor: '#1e2a3a',
    padding: 16, marginBottom: 10, gap: 10,
  },
  sessionCardTop: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
  },
  sessionCardRight: { alignItems: 'flex-end', gap: 6 },
  sessionDur: { fontSize: 28, fontWeight: '800', color: '#ffffff', letterSpacing: -0.5 },
  sessionDate: { fontSize: 11, color: 'rgba(255,255,255,0.28)', letterSpacing: 0.3 },
  sessionTags: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },

  tagFriend: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(91,168,245,0.1)', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(91,168,245,0.2)',
  },
  tagFriendText: { fontSize: 11, color: '#5ba8f5', fontWeight: '600' },
  tagSolo: {
    backgroundColor: 'rgba(122,170,138,0.1)', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(122,170,138,0.2)',
  },
  tagSoloText: { fontSize: 11, color: '#7aaa8a', fontWeight: '500' },
  tagPod: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  tagPodActive: {
    backgroundColor: 'rgba(91,168,245,0.08)',
    borderColor: 'rgba(91,168,245,0.25)',
  },
  tagIntention: {
    backgroundColor: 'rgba(196,181,253,0.08)', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(196,181,253,0.18)',
  },
  tagIntentionText: { fontSize: 11, color: '#c4b5fd', fontWeight: '600' },

  mailBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  unreadDot: {
    position: 'absolute', top: 6, right: 6,
    width: 6, height: 6, borderRadius: 3, backgroundColor: '#5ba8f5',
  },

  loadMoreBtn: {
    alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 28,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    marginTop: 4, marginBottom: 16,
  },
  loadMoreText: { color: 'rgba(255,255,255,0.45)', fontSize: 13, letterSpacing: 0.8 },

  // Wrapped
  wrappedBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: 'rgba(91,168,245,0.08)',
    borderRadius: 12, borderWidth: 1, borderColor: 'rgba(91,168,245,0.2)',
    paddingVertical: 10, paddingHorizontal: 16,
    alignSelf: 'center', marginBottom: 20,
  },
  wrappedBtnText: { color: '#5ba8f5', fontSize: 12, fontWeight: '600', letterSpacing: 0.6 },

  // Message modal
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center', alignItems: 'center', padding: 28,
  },
  msgCard: {
    backgroundColor: '#13131f', borderRadius: 24, padding: 28,
    width: '100%', gap: 16, borderWidth: 1, borderColor: 'rgba(91,168,245,0.12)',
  },
  msgSender: { fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: 2, textTransform: 'uppercase' },
  msgText: { fontSize: 18, color: '#ffffff', lineHeight: 28, fontWeight: '500' },
  msgDate: { fontSize: 11, color: 'rgba(255,255,255,0.22)', letterSpacing: 0.4 },
  msgCloseBtn: {
    alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 20,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', marginTop: 4,
  },
  msgCloseTxt: { color: 'rgba(255,255,255,0.45)', fontSize: 13, letterSpacing: 0.8 },
});
