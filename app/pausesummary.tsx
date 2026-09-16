import { FontAwesome5 } from '@expo/vector-icons';
import { useAudioPlayer } from 'expo-audio';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { getSelectedCategories } from './pauseLogger';


export default function PauseSummaryScreen() {
  const { user } = useAuth();
  const { duration, category, sharedWithName, sharedSessionId } = useLocalSearchParams<{
    duration: string;
    category: string;
    sharedWithName: string;
    sharedSessionId: string;
  }>();

  const seconds = parseInt(duration ?? '0');
  const bellPlayer = useAudioPlayer(require('../assets/images/Bell.mp3'));

  useEffect(() => { bellPlayer.play(); }, []);

  const [cat, setCat] = useState<{ id: string; emoji: string; label: string } | null>(null);
  const [partnerStatus, setPartnerStatus] = useState<{ stillPausing: boolean; durationSecs: number } | null>(null);

  // Greeting state
  const [greetingText, setGreetingText]     = useState('');
  const [showGreeting, setShowGreeting]     = useState(!!sharedWithName);
  const [greetingSending, setGreetingSending] = useState(false);
  const [greetingSent, setGreetingSent]     = useState(false);
  const sentOpacity = useRef(new Animated.Value(0)).current;

  const sendGreeting = async () => {
    if (!greetingText.trim() || greetingSending || !user?.id || !sharedSessionId) return;
    setGreetingSending(true);

    const { data: partner } = await supabase
      .from('pause_sessions')
      .select('id, user_id')
      .eq('shared_session_id', sharedSessionId)
      .neq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (partner) {
      await supabase.from('pause_messages').insert({
        sender_id: user.id,
        receiver_id: partner.user_id,
        session_id: partner.id,
        message_type: 'text',
        text_content: greetingText.trim(),
        delivered: false,
      });
    }

    setGreetingSending(false);
    setGreetingSent(true);
    sentOpacity.setValue(0);
    Animated.sequence([
      Animated.timing(sentOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.delay(1800),
      Animated.timing(sentOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start(() => setShowGreeting(false));
  };

  useEffect(() => {
    const load = async () => {
      if (!category) return;
      const allCats = await getSelectedCategories();
      const found = allCats.find(c => c.id === category);
      setCat(found ?? null);
    };
    load();
  }, [category]);

  useEffect(() => {
    if (!sharedSessionId || !user?.id) return;
    supabase
      .rpc('get_partner_session_status', { p_shared_id: sharedSessionId, p_my_id: user.id })
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) console.error('[Summary] partner fetch error:', error.message);
        const d = data as { ended_at: string | null; duration_seconds: number | null } | null;
        if (d) setPartnerStatus({ stillPausing: !d.ended_at, durationSecs: d.duration_seconds ?? 0 });
      });
  }, [sharedSessionId, user?.id]);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
  }, []);

  const formatTime = (secs: number) => {
    if (secs < 60) return `${secs} sek`;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}h ${m}min`;
    if (s === 0) return `${m} min`;
    return `${m} min ${s} sek`;
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >

      <Animated.View style={{ opacity: fadeAnim, alignItems: 'center', width: '100%', gap: 20 }}>

        <Text style={styles.title}>Paus klar</Text>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>DU PAUSADE I</Text>
          <Text style={styles.cardTime}>{formatTime(seconds)}</Text>

          <View style={styles.divider} />

          {cat && (
            <View style={styles.categoryBlock}>
              <Text style={styles.categoryEmoji}>{cat.emoji}</Text>
              <Text style={styles.categoryLabel}>{cat.label}</Text>
            </View>
          )}

          {!!sharedWithName && (
            <View style={styles.sharedRow}>
              <FontAwesome5 name="user-friends" size={13} color="#2e86de" />
              <Text style={styles.sharedText}>Du pausade med {sharedWithName}</Text>
            </View>
          )}

          {!!sharedWithName && partnerStatus && (
            <Text style={styles.partnerStatusText}>
              {partnerStatus.stillPausing
                ? `${sharedWithName} pausar fortfarande.`
                : `${sharedWithName} pausade i ${formatTime(partnerStatus.durationSecs)}.`}
            </Text>
          )}
        </View>

        {showGreeting && (
          <View style={styles.greetingSection}>
            {greetingSent ? (
              <Animated.View style={[styles.greetingSentWrap, { opacity: sentOpacity }]}>
                <View style={styles.greetingSentIcon}>
                  <FontAwesome5 name="check" size={18} color="white" />
                </View>
                <Text style={styles.greetingSentText}>Hälsningen skickad!</Text>
                <Text style={styles.greetingSentSub}>
                  {sharedWithName} får den när de öppnar appen.
                </Text>
              </Animated.View>
            ) : (
              <>
                <Text style={styles.greetingTitle}>
                  Skicka en hälsning till {sharedWithName}?
                </Text>
                <View style={styles.greetingInputWrap}>
                  <TextInput
                    style={styles.greetingInput}
                    value={greetingText}
                    onChangeText={t => { if (t.length <= 200) setGreetingText(t); }}
                    placeholder="Skriv något…"
                    placeholderTextColor="rgba(255,255,255,0.2)"
                    multiline
                    maxLength={200}
                  />
                  <Text style={styles.greetingCount}>{200 - greetingText.length}</Text>
                </View>
                <View style={styles.greetingActions}>
                  <TouchableOpacity
                    style={[styles.greetingSendBtn, (!greetingText.trim() || greetingSending) && styles.greetingSendBtnDisabled]}
                    onPress={sendGreeting}
                    disabled={!greetingText.trim() || greetingSending}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.greetingSendTxt}>
                      {greetingSending ? 'Skickar…' : 'Skicka'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setShowGreeting(false)} activeOpacity={0.6}>
                    <Text style={styles.greetingSkipTxt}>Inte den här gången</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        )}

        <TouchableOpacity
          style={styles.doneButton}
          onPress={() => router.replace('/(tabs)')}
        >
          <Text style={styles.doneText}>Tillbaka till start</Text>
        </TouchableOpacity>

      </Animated.View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#0f0f1a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
    paddingBottom: 48,
  },
  title: {
    fontSize: 38,
    fontWeight: 'bold',
    color: 'white',
    letterSpacing: 1,
  },
  card: {
    backgroundColor: '#1a1a2e',
    borderRadius: 28,
    padding: 32,
    alignItems: 'center',
    width: '100%',
    borderWidth: 1,
     borderColor: '#27ae60',
         shadowColor: '#27ae60',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    gap: 16,
  },
  cardLabel: {
    fontSize: 11,
    color: '#555',
    fontWeight: 'bold',
    letterSpacing: 3,
  },
  cardTime: {
    fontSize: 60,
    fontWeight: 'bold',
    color: 'white',
    letterSpacing: 2,
  },
  divider: {
    width: '50%',
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  categoryBlock: {
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  categoryEmoji: {
    fontSize: 36,
  },
  categoryLabel: {
    color: '#27ae60',
    fontSize: 13,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  message: {
    fontSize: 17,
    color: '#7ab8f5',
    textAlign: 'center',
    lineHeight: 28,
    fontStyle: 'italic',
    paddingHorizontal: 8,
  },
  doneButton: {
    backgroundColor: '#27ae60',
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 32,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#27ae60',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 8,
    marginTop: 8,
  },
  doneText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1,
  },

  partnerStatusText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.35)',
    textAlign: 'center',
    fontStyle: 'italic',
    letterSpacing: 0.2,
  },

  sharedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(46,134,222,0.1)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(46,134,222,0.25)',
  },
  sharedText: {
    color: '#7ab8f5',
    fontSize: 13,
    fontWeight: '600',
  },

  // Greeting sent confirmation
  greetingSentWrap: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  greetingSentIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#27ae60',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#27ae60',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  greetingSentSub: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },

  // Greeting section
  greetingSection: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 20,
    gap: 16,
  },
  greetingSentText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  greetingTitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    letterSpacing: 0.2,
    lineHeight: 22,
  },
  greetingInputWrap: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 14,
    gap: 8,
  },
  greetingInput: {
    color: '#ffffff',
    fontSize: 15,
    lineHeight: 22,
    minHeight: 60,
  },
  greetingCount: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: 11,
    textAlign: 'right',
    letterSpacing: 0.5,
  },
  greetingActions: {
    alignItems: 'center',
    gap: 12,
  },
  greetingSendBtn: {
    backgroundColor: '#2e86de',
    paddingVertical: 12,
    alignSelf: 'stretch',
    alignItems: 'center',
    borderRadius: 24,
  },
  greetingSendBtnDisabled: {
    backgroundColor: 'rgba(46,134,222,0.25)',
  },
  greetingSendTxt: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  greetingSkipTxt: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 13,
    letterSpacing: 0.2,
  },
});
