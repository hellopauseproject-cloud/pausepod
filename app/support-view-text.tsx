import { FontAwesome5 } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openPauseStart } from '../lib/pauseFlow';
import { supabase } from '../lib/supabase';
import { clearPending, getPending } from '../lib/supportQueue';
import { AppPalette, alpha } from '../constants/appTheme';
import { RoomProvider, usePalette } from '../contexts/ThemeContext';
import { roomShell, ScreenBackground } from '../components/screen-background';

/**
 * Hör till **friends-rummet**. Rummet följer ärendet och inte filträdet — se
 * ROOMS i [constants/appTheme.ts](../constants/appTheme.ts). Skalet är
 * identiskt med de andra rummens: en komponent kan inte läsa sin egen
 * provider, och en bakgrund i skalet täcker varje gren skärmen returnerar.
 */
export default function SupportViewTextRoom() {
  return (
    <RoomProvider room="friends">
      <View style={roomShell}>
        <ScreenBackground room="friends" />
        <SupportViewTextScreen />
      </View>
    </RoomProvider>
  );
}

function SupportViewTextScreen() {
  const Palette = usePalette();
  const s = useMemo(() => makeS(Palette), [Palette]);
  const insets = useSafeAreaInsets();
  const closeTop = { top: Math.max(56, insets.top + 4) };
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
    openPauseStart('push');
  };

  if (!pending || pending.responseType !== 'text') {
    return (
      <View style={s.container}>
        <TouchableOpacity onPress={handleClose} style={[s.closeBtn, closeTop]}>
          <FontAwesome5 name="times" size={18} color={Palette.ink40} />
        </TouchableOpacity>
        <Text style={s.fallback}>Inget meddelande att visa.</Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <TouchableOpacity onPress={handleClose} style={[s.closeBtn, closeTop]} activeOpacity={0.7}>
        <FontAwesome5 name="times" size={18} color={Palette.ink40} />
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
          <Text style={s.messageLabel}>SUPPORT</Text>
          <Text style={s.messageText}>{pending.textContent}</Text>
        </View>

        <TouchableOpacity style={s.pauseBtn} onPress={handlePause} activeOpacity={0.85}>
          <FontAwesome5 name="pause" size={14} color={Palette.onAccent} />
          <Text style={s.pauseBtnText}>Ta en paus nu</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleClose} activeOpacity={0.6} style={s.laterBtn}>
          <Text style={s.laterBtnText}>Inte just nu</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const makeS = (Palette: AppPalette) => StyleSheet.create({
  container: {
    flex: 1, backgroundColor: 'transparent',
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
    backgroundColor: Palette.communityTint,
    borderWidth: 1.5, borderColor: Palette.community,
    alignItems: 'center', justifyContent: 'center',
  },
  senderAvatarText: { fontSize: 28, fontWeight: '700', color: Palette.communitySoft },
  senderName: { fontSize: 22, fontWeight: '700', color: Palette.textPrimary, letterSpacing: 0.2 },
  messageCard: {
    width: '100%', backgroundColor: alpha(Palette.community, 0.07),
    borderRadius: 20, borderWidth: 1, borderColor: alpha(Palette.community, 0.2),
    padding: 24, gap: 12,
  },
  messageLabel: {
    fontSize: 12, fontWeight: '700', color: Palette.community, letterSpacing: 3,
  },
  messageText: { fontSize: 20, color: Palette.textPrimary, lineHeight: 30, fontWeight: '500' },
  pauseBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Palette.community, paddingVertical: 16, paddingHorizontal: 40,
    borderRadius: 32, width: '100%', justifyContent: 'center',
    shadowColor: Palette.community, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 6,
  },
  pauseBtnText: { color: Palette.onAccent, fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
  laterBtn: { paddingVertical: 8 },
  laterBtnText: { color: Palette.ink30, fontSize: 14, letterSpacing: 0.2 },
  fallback: { color: Palette.ink30, fontSize: 15 },
});
