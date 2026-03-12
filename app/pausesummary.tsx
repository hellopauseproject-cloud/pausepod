import { FontAwesome5 } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getSelectedCategories } from './pauseLogger';

const MESSAGES: Record<string, string> = {
  focus:    'Du gav hjärnan ro att landa. Det är fokus på riktigt.',
  walk:     'Rörelse nollställer. Bra val.',
  workout:  'Kroppen och hjärnan tackar dig.',
  social:   'Närvaro med andra är aldrig bortkastd tid.',
  clean:    'Ett städat hem ger ett städat inre.',
  meditate: 'Stilla sinne, starkare tankar.',
  read:     'Du bytte scrollning mot berättelser. Bra swap.',
  study:    'Lärande är investering i dig själv.',
  rest:     'Vila är inte lathet — det är återhämtning.',
  create:   'Kreativitet föds ofta i pausen.',
  music:    'Musik helar på sätt ord inte kan.',
  nature:   'Naturen påminner oss om vad som är på riktigt.',
};

const DEFAULT_MESSAGE = 'Varje paus är ett steg mot mer närvaro.';

export default function PauseSummaryScreen() {
  const { duration, mode, category } = useLocalSearchParams<{
    duration: string;
    mode: string;
    category: string;
  }>();

  const seconds = parseInt(duration ?? '0');
  const isRegulate = mode === 'regulate';
  const [cat, setCat] = useState<{ id: string; emoji: string; label: string } | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!category) return;
      const allCats = await getSelectedCategories();
      const found = allCats.find(c => c.id === category);
      setCat(found ?? null);
    };
    load();
  }, [category]);

  const message = cat ? MESSAGES[cat.id] ?? DEFAULT_MESSAGE : DEFAULT_MESSAGE;

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;
  const scaleAnim = useRef(new Animated.Value(0.7)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, friction: 5, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
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
    <View style={styles.container}>

      <Animated.View style={[styles.iconContainer, { transform: [{ scale: scaleAnim }] }]}>
        <FontAwesome5 name="check" size={32} color="white" />
      </Animated.View>

      <Animated.View style={{ opacity: fadeAnim, alignItems: 'center', width: '100%', gap: 20 }}>

        <Text style={styles.title}>Paus klar</Text>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>DU PAUSADE I</Text>
          <Text style={styles.cardTime}>{formatTime(seconds)}</Text>

          <View style={styles.divider} />

          <View style={styles.modePill}>
            <Text style={styles.modePillText}>
              {isRegulate ? '⏱ REGULATE · 12 min' : '⏱ SESSION · fri tid'}
            </Text>
          </View>

          {cat && (
            <View style={styles.categoryBlock}>
              <Text style={styles.categoryEmoji}>{cat.emoji}</Text>
              <Text style={styles.categoryLabel}>{cat.label}</Text>
            </View>
          )}
        </View>

        <Animated.Text style={[styles.message, { transform: [{ translateY: slideAnim }] }]}>
          "{message}"
        </Animated.Text>

        <TouchableOpacity
          style={styles.doneButton}
          onPress={() => router.replace('/(tabs)')}
        >
          <Text style={styles.doneText}>Tillbaka till start</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.statsLink}
          onPress={() => router.replace('/stats')}
        >
          <Text style={styles.statsLinkText}>Se din statistik →</Text>
        </TouchableOpacity>

      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 4,
    marginBottom: 40,
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#27ae60',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    shadowColor: '#27ae60',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 12,
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
    gap: 16,
    shadowColor: '#27ae60',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
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
  modePill: {
    backgroundColor: 'rgba(46,134,222,0.12)',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(46,134,222,0.3)',
  },
  modePillText: {
    color: '#7ab8f5',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1.5,
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
  statsLink: {
    padding: 10,
    marginBottom: 25,
  },
  statsLinkText: {
    color: '#2e86de',
    fontSize: 15,
  },
});
