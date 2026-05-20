import { FontAwesome } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useBLE } from '../context/BLEContext';
import { isInboxActive } from '../lib/inboxGuard';
import { Category, getSelectedCategories } from './pauseLogger';

export default function PauseScreen() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<'regulate' | 'session' | null>(null);
  const { bleMessage, isConnected, isScanning } = useBLE();

  useEffect(() => {
    const load = async () => {
      const cats = await getSelectedCategories();
      setCategories(cats);
    };
    load();
  }, []);

  // När TOUCH_START kommer från lådan — checka in automatiskt
  useEffect(() => {
    if (bleMessage === 'TOUCH_START' && selectedMode && !isInboxActive()) {
      handleCheckIn();
    }
  }, [bleMessage]);

  const handleCheckIn = () => {
    if (!selectedMode) return;
    const mode = selectedMode;
    setSelectedMode(null); // förhindra att TOUCH_START triggar igen från bakgrunden
    router.push({
      pathname: '/placeinbox',
      params: {
        mode,
        category: selectedCategory ?? '',
      },
    });
  };

  const bleStatus = () => {
    if (isScanning) return '🔍 Söker PausePod...';
    if (isConnected) return '🟢 PausePod ansluten';
    return '⚪ PausePod ej ansluten';
  };

  return (
    <View style={styles.container}>
      <FontAwesome name="pause" size={40} color="#2e86de" />
      <Text style={styles.title}>Starta paus</Text>

      {/* BLE-status */}
      <Text style={styles.bleStatus}>{bleStatus()}</Text>

      {/* Lägesval */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>VÄLJ LÄGE</Text>
        <View style={styles.modeRow}>
          <TouchableOpacity
            style={[styles.modeButton, selectedMode === 'regulate' && styles.modeButtonSelected]}
            onPress={() => setSelectedMode('regulate')}
          >
            <Text style={[styles.modeTitle, selectedMode === 'regulate' && styles.modeTitleSelected]}>
              REGULATE
            </Text>
            <Text style={[styles.modeSubtitle, selectedMode === 'regulate' && styles.modeSubtitleSelected]}>
              12 min
            </Text>
            {selectedMode === 'regulate' && (
              <View style={styles.checkDot}>
                <FontAwesome name="check" size={10} color="white" />
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.modeButton, selectedMode === 'session' && styles.modeButtonSelected]}
            onPress={() => setSelectedMode('session')}
          >
            <Text style={[styles.modeTitle, selectedMode === 'session' && styles.modeTitleSelected]}>
              SESSION
            </Text>
            <Text style={[styles.modeSubtitle, selectedMode === 'session' && styles.modeSubtitleSelected]}>
              Din egen tid
            </Text>
            {selectedMode === 'session' && (
              <View style={styles.checkDot}>
                <FontAwesome name="check" size={10} color="white" />
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Kategori */}
      {categories.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>VAD SKA DU GÖRA? (VALFRITT)</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryScroll}
          >
            {categories.map(cat => (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.categoryChip,
                  selectedCategory === cat.id && styles.categoryChipSelected,
                ]}
                onPress={() =>
                  setSelectedCategory(selectedCategory === cat.id ? null : cat.id)
                }
              >
                <Text style={styles.categoryEmoji}>{cat.emoji}</Text>
                <Text style={[
                  styles.categoryText,
                  selectedCategory === cat.id && styles.categoryTextSelected,
                ]}>
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Checka in-knapp */}
      <TouchableOpacity
        style={[styles.checkInButton, !selectedMode && styles.checkInButtonDisabled]}
        onPress={handleCheckIn}
        disabled={!selectedMode}
      >
        <FontAwesome name="check" size={18} color="white" style={{ marginRight: 10 }} />
        <Text style={styles.checkInText}>CHECKA IN</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.noButton} onPress={() => router.back()}>
        <Text style={styles.noText}>Inte nu</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    padding: 32,
    marginTop: -15,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: 'white',
    marginTop: -15
  },
  bleStatus: {
    color: '#888',
    fontSize: 12,
    letterSpacing: 1,
  },
  section: {
    width: '100%',
  },
  sectionLabel: {
    color: '#555',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 2,
    marginBottom: 12,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 14,
  },
  modeButton: {
    flex: 1,
    backgroundColor: '#2a2a3e',
    borderWidth: 2,
    borderColor: '#2a2a3e',
    borderRadius: 20,
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
    position: 'relative',
  },
  modeButtonSelected: {
    borderColor: '#2e86de',
    backgroundColor: '#1a3a5e',
  },
  modeTitle: {
    color: '#aaa',
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 2,
    marginBottom: 8,
  },
  modeTitleSelected: {
    color: '#2e86de',
  },
  modeSubtitle: {
    color: '#555',
    fontSize: 13,
    fontStyle: 'italic',
  },
  modeSubtitleSelected: {
    color: 'white',
  },
  checkDot: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#2e86de',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryScroll: {
    paddingHorizontal: 2,
    gap: 10,
    flexDirection: 'row',
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#2a2a3e',
    borderWidth: 1.5,
    borderColor: '#2a2a3e',
    borderRadius: 32,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  categoryChipSelected: {
    borderColor: '#2e86de',
    backgroundColor: '#1a3a5e',
  },
  categoryEmoji: {
    fontSize: 16,
  },
  categoryText: {
    color: '#aaa',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1.5,
  },
  categoryTextSelected: {
    color: 'white',
  },
  checkInButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2e86de',
    paddingVertical: 18,
    paddingHorizontal: 48,
    borderRadius: 32,
    width: '100%',
    shadowColor: '#2e86de',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  checkInButtonDisabled: {
    backgroundColor: '#2a2a3e',
    shadowOpacity: 0,
    elevation: 0,
  },
  checkInText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 3,
  },
  noButton: {
    paddingVertical: 10,
    paddingHorizontal: 32,
  },
  noText: {
    color: '#555',
    fontSize: 15,
  },
});