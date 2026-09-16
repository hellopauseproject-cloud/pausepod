import { FontAwesome5 } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { clearPending, getPending } from '../lib/supportQueue';

export default function SupportViewTextScreen() {
  const pending = getPending();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();

    if (pending?.id) {
      const now = new Date().toISOString();
      supabase.from('support_responses').update({
        delivered_at: now,
        played_at: now,
      }).eq('id', pending.id).then(() => clearPending());
    }
  }, []);

  const handleClose = () => {
    clearPending();
    router.replace('/(tabs)');
  };

  const handlePause = () => {
    clearPending();
    router.push('/pause');
  };

  if (!pending || pending.responseType !== 'text') {
    return (
      <View style={s.container}>
        <TouchableOpacity onPress={handleClose} style={s.closeBtn}>
          <FontAwesome5 name="times" size={18} color="rgba(255,255,255,0.4)" />
        </TouchableOpacity>
        <Text style={s.fallback}>Inget meddelande att visa.</Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <TouchableOpacity onPress={handleClose} style={s.closeBtn} activeOpacity={0.7}>
        <FontAwesome5 name="times" size={18} color="rgba(255,255,255,0.4)" />
      </TouchableOpacity>

      <Animated.View style={[s.content, { opacity: fadeAnim }]}>
        <View style={s.senderRow}>
          <View style={s.senderAvatar}>
            <Text style={s.senderAvatarText}>
              {(pending.senderName[0] ?? '?').toUpperCase()}
            </Text>
          </View>
          <Text style={s.senderName}>{pending.senderName}</Text>
        </View>

        <View style={s.messageCard}>
          <Text style={s.messageLabel}>PEPP</Text>
          <Text style={s.messageText}>{pending.textContent}</Text>
        </View>

        <TouchableOpacity style={s.pauseBtn} onPress={handlePause} activeOpacity={0.85}>
          <FontAwesome5 name="pause" size={14} color="#fff" />
          <Text style={s.pauseBtnText}>Ta en paus nu</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleClose} activeOpacity={0.6} style={s.laterBtn}>
          <Text style={s.laterBtnText}>Inte just nu</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: '#0f0f1a',
    alignItems: 'center', justifyContent: 'center',
    padding: 32,
  },
  closeBtn: {
    position: 'absolute', top: 56, right: 16,
    width: 48, height: 48, alignItems: 'center', justifyContent: 'center',
  },
  content: { width: '100%', alignItems: 'center', gap: 32 },
  senderRow: { alignItems: 'center', gap: 12 },
  senderAvatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(162,155,254,0.15)',
    borderWidth: 1.5, borderColor: '#a29bfe',
    alignItems: 'center', justifyContent: 'center',
  },
  senderAvatarText: { fontSize: 28, fontWeight: '700', color: '#c4b5fd' },
  senderName: { fontSize: 22, fontWeight: '700', color: '#ffffff', letterSpacing: 0.2 },
  messageCard: {
    width: '100%', backgroundColor: 'rgba(162,155,254,0.07)',
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(162,155,254,0.2)',
    padding: 24, gap: 12,
  },
  messageLabel: {
    fontSize: 10, fontWeight: '700', color: '#a29bfe', letterSpacing: 3,
  },
  messageText: { fontSize: 20, color: '#ffffff', lineHeight: 30, fontWeight: '500' },
  pauseBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#a29bfe', paddingVertical: 16, paddingHorizontal: 40,
    borderRadius: 32, width: '100%', justifyContent: 'center',
    shadowColor: '#a29bfe', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 6,
  },
  pauseBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
  laterBtn: { paddingVertical: 8 },
  laterBtnText: { color: 'rgba(255,255,255,0.3)', fontSize: 14, letterSpacing: 0.2 },
  fallback: { color: 'rgba(255,255,255,0.3)', fontSize: 15 },
});
