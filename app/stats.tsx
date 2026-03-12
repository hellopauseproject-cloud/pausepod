import { FontAwesome, FontAwesome5 } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { DEFAULT_CATEGORIES, getLogs, getSelectedCategories, PauseLog } from './pauseLogger';

function FlipCard({ front, back, colorStyle }: {
  front: React.ReactNode;
  back: React.ReactNode;
  colorStyle: object;
}) {
  const flipAnim = useRef(new Animated.Value(0)).current;
  const [flipped, setFlipped] = useState(false);

  const flip = () => {
    Animated.spring(flipAnim, {
      toValue: flipped ? 0 : 1,
      useNativeDriver: true,
      friction: 8,
    }).start();
    setFlipped(!flipped);
  };

  const frontInterpolate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  const backInterpolate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['180deg', '360deg'],
  });

  return (
    <TouchableOpacity onPress={flip} activeOpacity={1} style={styles.flipContainer}>
      <Animated.View style={[styles.card, colorStyle, { transform: [{ rotateY: frontInterpolate }], backfaceVisibility: 'hidden' }]}>
        {front}
        <Text style={styles.flipHint}>Tryck för mer info</Text>
      </Animated.View>
      <Animated.View style={[styles.card, styles.cardBack, { transform: [{ rotateY: backInterpolate }], backfaceVisibility: 'hidden', position: 'absolute' }]}>
        {back}
      </Animated.View>
    </TouchableOpacity>
  );
}

export default function StatsScreen() {
  const [logs, setLogs] = useState<PauseLog[]>([]);
  const [allCategories, setAllCategories] = useState(DEFAULT_CATEGORIES);
  const fadeAnim = useState(new Animated.Value(0))[0];

  useEffect(() => {
    const load = async () => {
      const data = await getLogs();
      setLogs(data);

      // Hämta alla kategorier inkl. egna
      const selected = await getSelectedCategories();
      if (selected.length > 0) setAllCategories(selected);

      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }).start();
    };
    load();
  }, []);

  const totalPauses = logs.length;
  const totalSeconds = logs.reduce((sum, l) => sum + l.duration, 0);
  const averagePause = logs.length > 0 ? Math.round(totalSeconds / totalPauses) : 0;
  const regulateCount = logs.filter(l => l.mode === 'regulate').length;
  const sessionCount = logs.filter(l => l.mode === 'session').length;

  const today = new Date().toDateString();
  const todaySeconds = logs
    .filter(l => new Date(l.date).toDateString() === today)
    .reduce((sum, l) => sum + l.duration, 0);

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekSeconds = logs
    .filter(l => new Date(l.date) >= weekAgo)
    .reduce((sum, l) => sum + l.duration, 0);

  // Kategorier-statistik
  const categoryCounts = logs.reduce((acc, l) => {
    if (l.category) acc[l.category] = (acc[l.category] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const topCategories = allCategories
    .map(cat => ({ ...cat, count: categoryCounts[cat.id] ?? 0 }))
    .filter(cat => cat.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const maxCount = topCategories.length > 0 ? topCategories[0].count : 1;

  const formatTime = (secs: number) => {
    if (secs < 60) return `${secs} sek`;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (h > 0) return `${h}h ${m}min`;
    return `${m} min`;
  };

  const getTotalComment = (secs: number) => {
    if (secs === 0) return 'Dags att ta din första paus!';
    if (secs < 600) return 'Bra jobbat! ';
    if (secs < 3600) return 'Snyggt! ';
    if (secs < 7200) return 'Inspirerande!';
    return 'Du är en pausmästare! 🏆';
  };

  const regulatePercent = totalPauses > 0 ? Math.round((regulateCount / totalPauses) * 100) : 0;
  const sessionPercent = totalPauses > 0 ? Math.round((sessionCount / totalPauses) * 100) : 0;

  const getModeBackText = () => {
    if (regulateCount >= sessionCount) {
      return 'En kort paus från skärmen räcker för att förbättra upplevt välmående. Hjärnan behöver få en stund att landa från alla intryck. ';
    }
    return 'Autonomi är ett grundläggande psykologiskt behov. Att bestämma över din egen tid är inte en liten sak — det är faktiskt ganska stort. ';
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <FontAwesome name="chevron-left" size={16} color="#2e86de" />
        <Text style={styles.backText}>Tillbaka</Text>
      </TouchableOpacity>

      <Text style={styles.pageTitle}>DINA PAUSER</Text>

      {/* Kort 1: Antal pauser */}
      <Animated.View style={{ width: '100%', opacity: fadeAnim }}>
        <FlipCard
          colorStyle={styles.cardBlue}
          front={
            <>
              <Text style={styles.cardLabel}>Du har pausat</Text>
              <Text style={styles.cardNumber}>{totalPauses}</Text>
              <Text style={styles.cardUnit}>gånger</Text>
              {totalPauses === 0 && <Text style={styles.cardComment}>Ta din första paus idag!</Text>}
            </>
          }
          back={
            <>
              <FontAwesome5 name="brain" size={36} color="white" style={{ marginBottom: 16 }} />
              <Text style={styles.backText2}>Forskning visar att korta pauser förbättrar fokus och minskar mental utmattning.</Text>
            </>
          }
        />
      </Animated.View>

      {/* Kort 2: Total tid */}
      <Animated.View style={{ width: '100%', opacity: fadeAnim }}>
        <FlipCard
          colorStyle={styles.cardDark}
          front={
            <>
              <Text style={styles.cardLabel}>Total pausad tid</Text>
              <Text style={styles.cardNumber}>{formatTime(totalSeconds)}</Text>
              <Text style={styles.cardComment}>{getTotalComment(totalSeconds)}</Text>
            </>
          }
          back={
            <>
              <FontAwesome5 name="book-open" size={36} color="white" style={{ marginBottom: 16 }} />
              <Text style={styles.backText2}>Din hjärna behöver regelbunden vila för att bearbeta intryck och stärka minnet.</Text>
            </>
          }
        />
      </Animated.View>

      {/* Kort 3: Genomsnittlig paus */}
      <Animated.View style={{ width: '100%', opacity: fadeAnim }}>
        <FlipCard
          colorStyle={styles.cardGreen}
          front={
            <>
              <Text style={styles.cardLabel}>Genomsnittlig paus</Text>
              <Text style={styles.cardNumber}>{formatTime(averagePause)}</Text>
            </>
          }
          back={
            <>
              <FontAwesome5 name="heartbeat" size={36} color="white" style={{ marginBottom: 16 }} />
              <Text style={styles.backText2}>En paus på över 10 minuter ger kroppen tid att sänka kortisolnivåerna.</Text>
            </>
          }
        />
      </Animated.View>

      {/* Kort 4: Idag / Vecka */}
      <Animated.View style={{ width: '100%', opacity: fadeAnim }}>
        <FlipCard
          colorStyle={styles.cardPurple}
          front={
            <>
              <Text style={styles.cardLabel}>Din pausaktivitet</Text>
              <View style={styles.timeRow}>
                <View style={styles.timeBlock}>
                  <Text style={styles.timeLabel}>⏱ Idag</Text>
                  <Text style={styles.timeValue}>{formatTime(todaySeconds)}</Text>
                </View>
                <View style={styles.timeDivider} />
                <View style={styles.timeBlock}>
                  <Text style={styles.timeLabel}>Vecka</Text>
                  <Text style={styles.timeValue}>{formatTime(weekSeconds)}</Text>
                </View>
              </View>
            </>
          }
          back={
            <>
              <FontAwesome5 name="calendar-check" size={36} color="white" style={{ marginBottom: 16 }} />
              <Text style={styles.backText2}>Regelbundna pauser varje dag är mer effektivt än en lång paus ibland.</Text>
            </>
          }
        />
      </Animated.View>

      {/* Kort 5: Regulate vs Session */}
      {totalPauses > 0 && (
        <Animated.View style={{ width: '100%', opacity: fadeAnim }}>
          <FlipCard
            colorStyle={styles.cardDark}
            front={
              <>
                <Text style={styles.cardLabel}>Regulate vs Session</Text>
                <View style={styles.barContainer}>
                  <View style={styles.barRow}>
                    <Text style={styles.barLabel}>REGULATE</Text>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, styles.barBlue, { width: `${regulatePercent}%` }]} />
                    </View>
                    <Text style={styles.barPercent}>{regulatePercent}%</Text>
                  </View>
                  <View style={styles.barRow}>
                    <Text style={styles.barLabel}>SESSION</Text>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, styles.barGreen, { width: `${sessionPercent}%` }]} />
                    </View>
                    <Text style={styles.barPercent}>{sessionPercent}%</Text>
                  </View>
                </View>
              </>
            }
            back={
              <>
                <FontAwesome5 name="lightbulb" size={36} color="white" style={{ marginBottom: 16 }} />
                <Text style={styles.backText2}>{getModeBackText()}</Text>
              </>
            }
          />
        </Animated.View>
      )}

      {/* Kort 6: Topp-aktiviteter */}
      {topCategories.length > 0 && (
        <Animated.View style={{ width: '100%', opacity: fadeAnim }}>
          <FlipCard
            colorStyle={styles.cardTeal}
            front={
              <>
                <Text style={styles.cardLabel}>Dina pausaktiviteter</Text>
                <View style={styles.catContainer}>
                  {topCategories.map(cat => (
                    <View key={cat.id} style={styles.catRow}>
                      <Text style={styles.catEmoji}>{cat.emoji}</Text>
                      <Text style={styles.catName}>{cat.label}</Text>
                      <View style={styles.catTrack}>
                        <View style={[styles.catFill, { width: `${Math.round((cat.count / maxCount) * 100)}%` }]} />
                      </View>
                      <Text style={styles.catCount}>{cat.count}x</Text>
                    </View>
                  ))}
                </View>
              </>
            }
            back={
              <>
                <FontAwesome5 name="seedling" size={36} color="white" style={{ marginBottom: 16 }} />
                <Text style={styles.backText2}>Att välja vad du gör med din tid är en av de mest grundläggande formerna av självbestämmande. Varje intentionell paus är ett litet bevis på att du är mer än dina vanor.</Text>
              </>
            }
          />
        </Animated.View>
      )}

      <TouchableOpacity style={styles.homeButton} onPress={() => router.replace('/(tabs)')}>
        <Text style={styles.homeButtonText}>Tillbaka till start</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#1a1a2e',
    padding: 24,
    paddingTop: 10,
    alignItems: 'center',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    marginBottom: 24,
    marginTop: 30,
  },
  backText: {
    color: '#2e86de',
    fontSize: 16,
   
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
    letterSpacing: 4,
    marginBottom: 32,
  },
  flipContainer: {
    width: '100%',
    marginBottom: 20,
    height: 220,
  },
  card: {
    width: '100%',
    height: 220,
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBack: {
    backgroundColor: '#16213e',
    borderWidth: 1,
    borderColor: '#2e86de',
  },
  cardBlue: { backgroundColor: '#2e86de' },
  cardDark: { backgroundColor: '#2a2a3e' },
  cardGreen: { backgroundColor: '#27ae60' },
  cardPurple: { backgroundColor: '#6c3483' },
  cardTeal: { backgroundColor: '#1a6b72' },
  cardLabel: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.7)',
    marginBottom: 8,
    letterSpacing: 1,
  },
  cardNumber: {
    fontSize: 64,
    fontWeight: 'bold',
    color: 'white',
  },
  cardUnit: {
    fontSize: 18,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 4,
  },
  cardComment: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 12,
    textAlign: 'center',
  },
  flipHint: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 12,
    letterSpacing: 1,
  },
  backText2: {
    fontSize: 16,
    color: 'white',
    textAlign: 'center',
    lineHeight: 26,
    paddingHorizontal: 8,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    gap: 20,
  },
  timeBlock: { alignItems: 'center' },
  timeLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    marginBottom: 8,
  },
  timeValue: {
    color: 'white',
    fontSize: 28,
    fontWeight: 'bold',
  },
  timeDivider: {
    width: 1,
    height: 60,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  barContainer: {
    width: '100%',
    gap: 16,
    marginTop: 16,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  
  },
  barLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    width: 70,
    letterSpacing: 1,
  },
  barTrack: {
    flex: 1,
    height: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 6,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 6,
  },
  barBlue: { backgroundColor: '#2e86de' },
  barGreen: { backgroundColor: '#27ae60' },
  barPercent: {
    color: 'white',
    fontSize: 12,
    width: 35,
    textAlign: 'right',
  },
  // Kategori-kort
  catContainer: {
    width: '100%',
    gap: 10,
    marginTop: 12,
  },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  catEmoji: {
    fontSize: 16,
    width: 24,
  },
  catName: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 1,
    width: 72,
  },
  catTrack: {
    flex: 1,
    height: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 5,
    overflow: 'hidden',
  },
  catFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  catCount: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    width: 28,
    textAlign: 'right',
  },
  homeButton: {
    marginTop: 10,
    marginBottom: 40,
    backgroundColor: '#2a2a3e',
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 32,
  },
  homeButtonText: {
    color: '#aaa',
    fontSize: 16,
  },
});
