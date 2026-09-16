import { FontAwesome5 } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

type SelfText = { id: string; text_content: string; created_at: string };

export default function TextMessageScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { messageId, textContent, senderName, senderAvatarUrl, isSupport, empty } =
    useLocalSearchParams<{
      messageId?: string;
      textContent?: string;
      senderName?: string;
      senderAvatarUrl?: string;
      isSupport?: string;
      empty?: string;
    }>();

  const isSelf = isSupport !== 'true';
  const [selfProfile, setSelfProfile] = useState<{ username: string; avatar_url: string | null } | null>(null);
  const [selfTexts, setSelfTexts] = useState<SelfText[]>([]);
  const [isSending, setIsSending] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const sendProgress = useRef(new Animated.Value(0)).current;

  const translateY = sendProgress.interpolate({ inputRange: [0, 1], outputRange: [0, -240] });
  const translateX = sendProgress.interpolate({ inputRange: [0, 1], outputRange: [0, 60] });
  const scale = sendProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.15] });
  const acceptOpacity = sendProgress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 0.5, 0] });
  const declineOpacity = sendProgress.interpolate({ inputRange: [0, 0.35, 1], outputRange: [1, 0, 0] });

  const timeStr = new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });

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

  useEffect(() => {
    if (isSelf && user?.id) {
      supabase
        .from('profiles')
        .select('username, avatar_url')
        .eq('id', user.id)
        .maybeSingle()
        .then(({ data }) => { if (data) setSelfProfile(data); });

      supabase
        .from('user_self_texts')
        .select('id, text_content, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .then(({ data }) => { if (data) setSelfTexts(data as SelfText[]); });
    }
  }, [isSelf, user?.id]);

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
      router.replace('/pause');
    });
  };

  const handleDecline = async () => {
    await markDelivered();
    router.replace('/(tabs)');
  };

  if (empty === 'true') {
    return (
      <View style={[styles.emptyContainer, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.emptyBack}>
          <FontAwesome5 name="chevron-left" size={15} color="#2e86de" />
        </TouchableOpacity>
        <View style={styles.emptyContent}>
          <FontAwesome5 name="comment-alt" size={40} color="#b0b0c8" />
          <Text style={styles.emptyTitle}>Inga textmeddelanden</Text>
          <Text style={styles.emptyHint}>
            Du kan skriva en hälsning till dig själv under "Min profil", eller be en vän att skicka stödjande meddelanden till dig. De kommer att dyka upp här när de skickats. 
          </Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/profile')}>
            <Text style={styles.emptyBtnText}>Gå till profilen</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={styles.headerBack} onPress={() => router.back()}>
          <FontAwesome5 name="chevron-left" size={15} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          {(() => {
            const avatarUri = isSelf ? selfProfile?.avatar_url : senderAvatarUrl;
            const name = isSelf ? (selfProfile?.username ?? '…') : (senderName ?? 'Okänd');
            return (
              <>
                {avatarUri ? (
                  <Image source={{ uri: avatarUri }} style={styles.headerAvatar} />
                ) : (
                  <View style={styles.headerAvatarPlaceholder}>
                    <FontAwesome5 name="user" size={16} color="#2e86de" />
                  </View>
                )}
                <Text style={styles.headerName}>{name}</Text>
              </>
            );
          })()}
        </View>
        <View style={{ width: 44 }} />
      </View>

      {/* Meddelandebubbla(r) */}
      {isSelf && selfTexts.length > 0 ? (
        <FlatList
          ref={flatListRef}
          data={selfTexts}
          keyExtractor={item => item.id}
          style={styles.messageArea}
          contentContainerStyle={{ paddingLeft: 10, paddingRight: 20, paddingTop: 36, paddingBottom: 20, gap: 12 }}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => (
            <View style={styles.bubble}>
              <Text style={styles.bubbleText}>{item.text_content}</Text>
              <Text style={styles.bubbleTime}>
                {new Date(item.created_at).toLocaleString('sv-SE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          )}
        />
      ) : (
        <View style={styles.messageArea}>
          <View style={styles.bubble}>
            <Text style={styles.bubbleText}>{textContent}</Text>
            <Text style={styles.bubbleTime}>{timeStr}</Text>
          </View>
        </View>
      )}

      {/* Handlingsval */}
      <View style={[styles.actions, { paddingBottom: insets.bottom + 32 }]}>
        <Animated.View style={{ opacity: acceptOpacity, transform: [{ translateY }, { translateX }, { scale }] }}>
          <TouchableOpacity style={styles.acceptBtn} onPress={handleAccept} activeOpacity={0.85} disabled={isSending}>
            <FontAwesome5 name="pause" size={13} color="#fff" />
            <Text style={styles.acceptText}>Jag tar en paus</Text>
          </TouchableOpacity>
        </Animated.View>
        <Animated.View style={{ opacity: declineOpacity }}>
          <TouchableOpacity style={styles.declineBtn} onPress={handleDecline} activeOpacity={0.8} disabled={isSending}>
            <Text style={styles.declineText}>Det passar inte just nu</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  header: {
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 16,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a3e',
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
    borderColor: '#2e86de',
  },
  headerAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2a2a3e',
    borderWidth: 2,
    borderColor: '#2e86de',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerName: {
    color: '#fff',
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
    backgroundColor: '#2a2a3e',
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: '82%',
    gap: 6,
  },
  bubbleText: {
    color: '#e8e8f8',
    fontSize: 16,
    lineHeight: 25,
  },
  bubbleTime: {
    color: '#5555aa',
    fontSize: 11,
    alignSelf: 'flex-end',
  },
  actions: {
    paddingHorizontal: 24,
    paddingTop: 8,
    gap: 4,
  },
  acceptBtn: {
    backgroundColor: '#2e86de',
    paddingVertical: 16,
    borderRadius: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: '#2e86de',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
    marginBottom: 4,
  },
  acceptText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  declineBtn: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  declineText: {
    color: '#8888a8',
    fontSize: 15,
  },
  emptyContainer: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 32,
  },
  emptyBack: {
    padding: 8,
    alignSelf: 'flex-start',
  },
  emptyContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyHint: {
    color: '#666',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 24,
  },
  emptyBtn: {
    marginTop: 8,
    borderWidth: 1.5,
    borderColor: '#2e86de',
    borderRadius: 32,
    paddingVertical: 12,
    paddingHorizontal: 28,
  },
  emptyBtnText: {
    color: '#2e86de',
    fontSize: 15,
  },
});
