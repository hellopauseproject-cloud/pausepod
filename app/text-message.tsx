import { FontAwesome5 } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openPauseStart } from '../lib/pauseFlow';
import { supabase } from '../lib/supabase';
import { AppPalette, Radius } from '../constants/appTheme';
import { RoomProvider, usePalette } from '../contexts/ThemeContext';
import { roomShell, ScreenBackground } from '../components/screen-background';

/**
 * Hör till **friends-rummet**. Rummet följer ärendet och inte filträdet — se
 * ROOMS i [constants/appTheme.ts](../constants/appTheme.ts). Skalet är
 * identiskt med de andra rummens: en komponent kan inte läsa sin egen
 * provider, och en bakgrund i skalet täcker varje gren skärmen returnerar.
 */
export default function TextMessageRoom() {
  return (
    <RoomProvider room="friends">
      <View style={roomShell}>
        <ScreenBackground room="friends" />
        <TextMessageScreen />
      </View>
    </RoomProvider>
  );
}

function TextMessageScreen() {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  const insets = useSafeAreaInsets();
  const { messageId, textContent, senderName, senderAvatarUrl, isSupport } =
    useLocalSearchParams<{
      messageId?: string;
      textContent?: string;
      senderName?: string;
      senderAvatarUrl?: string;
      isSupport?: string;
    }>();

  const [isSending, setIsSending] = useState(false);
  const sendProgress = useRef(new Animated.Value(0)).current;

  const translateY = sendProgress.interpolate({ inputRange: [0, 1], outputRange: [0, -240] });
  const translateX = sendProgress.interpolate({ inputRange: [0, 1], outputRange: [0, 60] });
  const scale = sendProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.15] });
  const acceptOpacity = sendProgress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 0.5, 0] });
  const declineOpacity = sendProgress.interpolate({ inputRange: [0, 0.35, 1], outputRange: [1, 0, 0] });

  const timeStr = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const markDelivered = async () => {
    if (isSupport === 'true' && messageId) {
      const ts = new Date().toISOString();
      await supabase
        .from('support_responses')
        .update({ delivered_at: ts, played_at: ts })
        .eq('id', messageId);
    }
  };

  useEffect(() => {
    if (isSupport === 'true' && messageId) {
      markDelivered();
    }
  }, []);

  const handleAccept = () => {
    if (isSending) return;
    setIsSending(true);
    markDelivered();
    Animated.timing(sendProgress, {
      toValue: 1,
      duration: 550,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      openPauseStart('replace');
    });
  };

  const handleDecline = async () => {
    await markDelivered();
    router.replace('/(tabs)');
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={styles.headerBack} onPress={() => router.back()}>
          <FontAwesome5 name="chevron-left" size={15} color={Palette.onAccent} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          {senderAvatarUrl ? (
            <Image source={{ uri: senderAvatarUrl }} style={styles.headerAvatar} />
          ) : (
            <View style={styles.headerAvatarPlaceholder}>
              <FontAwesome5 name="user" size={16} color={Palette.accent} />
            </View>
          )}
          <Text style={styles.headerName}>{senderName ?? 'Unknown'}</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      {/* Meddelandebubbla */}
      <View style={styles.messageArea}>
        <View style={styles.bubble}>
          <Text style={styles.bubbleText}>{textContent}</Text>
          <Text style={styles.bubbleTime}>{timeStr}</Text>
        </View>
      </View>

      {/* Handlingsval */}
      <View style={[styles.actions, { paddingBottom: insets.bottom + 32 }]}>
        <Animated.View style={{ opacity: acceptOpacity, transform: [{ translateY }, { translateX }, { scale }] }}>
          <TouchableOpacity style={styles.acceptBtn} onPress={handleAccept} activeOpacity={0.85} disabled={isSending}>
            <FontAwesome5 name="pause" size={13} color={Palette.onAccent} />
            <Text style={styles.acceptText}>I'll take a pause</Text>
          </TouchableOpacity>
        </Animated.View>
        <Animated.View style={{ opacity: declineOpacity }}>
          <TouchableOpacity style={styles.declineBtn} onPress={handleDecline} activeOpacity={0.8} disabled={isSending}>
            <Text style={styles.declineText}>Not a good time</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </View>
  );
}

const makeStyles = (Palette: AppPalette) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  header: {
    backgroundColor: Palette.surface,
    paddingHorizontal: 16,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: Palette.surfaceBorder,
  },
  headerBack: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: Palette.accent,
  },
  headerAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Palette.surfaceAlt,
    borderWidth: 2,
    borderColor: Palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerName: {
    color: Palette.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  messageArea: {
    flex: 1,
    paddingLeft: 10,
    paddingRight: 20,
    paddingTop: 36,
  },
  bubble: {
    alignSelf: 'flex-start',
    backgroundColor: Palette.surfaceAlt,
    borderRadius: Radius.lg,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: '82%',
    gap: 6,
  },
  bubbleText: {
    color: Palette.textPrimary,
    fontSize: 16,
    lineHeight: 25,
  },
  bubbleTime: {
    color: Palette.textTertiary,
    fontSize: 12,
    alignSelf: 'flex-end',
  },
  actions: {
    paddingHorizontal: 24,
    paddingTop: 8,
    gap: 4,
  },
  acceptBtn: {
    backgroundColor: Palette.accent,
    paddingVertical: 16,
    borderRadius: Radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 4,
    ...Palette.cardShadow,
  },
  acceptText: {
    color: Palette.onAccent,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  declineBtn: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  declineText: {
    color: Palette.textSecondary,
    fontSize: 15,
  },
});
