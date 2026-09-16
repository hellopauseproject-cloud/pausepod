import { FontAwesome, MaterialIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useBLEControl } from '../context/BLEContext';
import { Category, getAllCategories, getSelectedCategories } from './pauseLogger';

type PauseMode = 'med-låda' | 'utan-låda' | null;

const DURATIONS = [5, 10, 15, 20, 25, 30];

export default function PauseScreen() {
  const { sharedSessionId, sharedWithName } = useLocalSearchParams<{
    sharedSessionId?: string;
    sharedWithName?: string;
  }>();

  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<PauseMode>(null);
  const [selection, setSelection] = useState<number | 'free' | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const { isConnected } = useBLEControl();

  useEffect(() => {
    getSelectedCategories().then(setCategories);
    getAllCategories().then(setAllCategories);
  }, []);

  const canCheckIn = selectedMode === 'med-låda' || (selectedMode === 'utan-låda' && selection !== null);

  const handleCheckIn = () => {
    if (!canCheckIn) return;

    if (selectedMode === 'med-låda' && !isConnected) {
      Alert.alert(
        'PAUSE POD ej ansluten',
        'Kontrollera att Bluetooth är påslaget på din telefon och att lådan är inom räckhåll.',
        [{ text: 'OK' }]
      );
      return;
    }

    if (selectedMode === 'med-låda') {
      // Ingen vald längd med låda — lådan äger start/slut, appen registrerar bara.
      const base = {
        mode: 'session',
        category: selectedCategory ?? '',
        withPod: 'true',
        pauseType: 'session',
        targetSeconds: '0',
      };
      if (sharedSessionId && sharedWithName) {
        router.push({ pathname: '/pausing', params: { ...base, sharedSessionId, sharedWithName } });
      } else {
        router.push({ pathname: '/placeinbox', params: { category: selectedCategory ?? '', withPod: 'true' } });
      }
      return;
    }

    const isRegulate = typeof selection === 'number';
    const base = {
      mode: 'session',
      category: selectedCategory ?? '',
      withPod: 'false',
      pauseType: isRegulate ? 'regulate' : 'session',
      targetSeconds: isRegulate ? String((selection as number) * 60) : '0',
    };

    if (sharedSessionId && sharedWithName) {
      router.push({ pathname: '/pausing', params: { ...base, sharedSessionId, sharedWithName } });
    } else {
      router.push({ pathname: '/pausing', params: base });
    }
  };

  return (
    <View style={styles.container}>
      <FontAwesome name="pause" size={40} color="#2e86de" />
      <Text style={styles.title}>Starta paus</Text>

      {/* ── SKAPA SESSION ──────────────────────── */}
      {/* Med låda finns ingen vald längd — lådan har inget tak och räknar uppåt. */}
      {selectedMode !== 'med-låda' && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SKAPA SESSION</Text>

          <TouchableOpacity
            style={[styles.freeTimeBtn, selection === 'free' && styles.freeTimeBtnSelected]}
            onPress={() => setSelection(selection === 'free' ? null : 'free')}
            activeOpacity={0.8}
          >
            <Text style={[styles.freeTimeText, selection === 'free' && styles.freeTimeTextSelected]}>
              FRI TID
            </Text>
            {selection === 'free' && (
              <View style={styles.freeCheckDot}>
                <FontAwesome name="check" size={9} color="white" />
              </View>
            )}
          </TouchableOpacity>

          <Text style={styles.orLabel}>ELLER VÄLJ TID</Text>

          <View style={styles.durationGrid}>
            {DURATIONS.map(min => (
              <TouchableOpacity
                key={min}
                style={[styles.durationChip, selection === min && styles.durationChipSelected]}
                onPress={() => setSelection(selection === min ? null : min)}
                activeOpacity={0.75}
              >
                <Text style={[styles.durationNum, selection === min && styles.durationNumSelected]}>
                  {min}
                </Text>
                <Text style={[styles.durationUnit, selection === min && styles.durationUnitSelected]}>
                  min
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* ── VÄLJ LÄGE ──────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>VÄLJ LÄGE</Text>
        <View style={styles.modeRow}>
          <TouchableOpacity
            style={[styles.modeButton, selectedMode === 'med-låda' && styles.modeButtonSelected]}
            onPress={() => setSelectedMode(selectedMode === 'med-låda' ? null : 'med-låda')}
          >
            <MaterialIcons
              name="pause-presentation"
              size={38}
              color={selectedMode === 'med-låda' ? '#2e86de' : '#555'}
            />
            <Text style={[styles.modeTitle, selectedMode === 'med-låda' && styles.modeTitleSelected]}>
              MED PAUSE POD
            </Text>
            <View style={[styles.bleRow, { opacity: selectedMode === 'med-låda' ? 1 : 0.3 }]}>
              <View style={[styles.bleDot, { backgroundColor: isConnected ? '#27ae60' : '#ffffff' }]} />
              <Text style={styles.bleSmallText}>{isConnected ? 'Redo' : 'Anslut'}</Text>
            </View>
            {selectedMode === 'med-låda' && (
              <View style={styles.checkDot}>
                <FontAwesome name="check" size={10} color="white" />
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.modeButton, selectedMode === 'utan-låda' && styles.modeButtonSelected]}
            onPress={() => setSelectedMode(selectedMode === 'utan-låda' ? null : 'utan-låda')}
          >
            <MaterialIcons
              name="cancel-presentation"
              size={38}
              color={selectedMode === 'utan-låda' ? '#2e86de' : '#555'}
            />
            <Text style={[styles.modeTitle, selectedMode === 'utan-låda' && styles.modeTitleSelected]}>
              UTAN PAUSE POD
            </Text>
            <View style={[styles.bleRow, { opacity: selectedMode === 'utan-låda' ? 1 : 0.3 }]}>
              <Text style={styles.bleSmallText}>Var som helst</Text>
            </View>
            {selectedMode === 'utan-låda' && (
              <View style={styles.checkDot}>
                <FontAwesome name="check" size={10} color="white" />
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* ── KATEGORI ───────────────────────────── */}
      <View style={styles.section}>
        <View style={styles.sectionLabelRow}>
          <Text style={styles.sectionLabel}>VAD SKA DU GÖRA? (VALFRITT)</Text>
          <TouchableOpacity style={styles.addIntentionBtn} onPress={() => setShowAddModal(true)}>
            <MaterialIcons name="add" size={16} color="#555" />
          </TouchableOpacity>
        </View>
        {categories.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryScroll}
          >
            {categories.map(cat => (
              <TouchableOpacity
                key={cat.id}
                style={[styles.categoryChip, selectedCategory === cat.id && styles.categoryChipSelected]}
                onPress={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
              >
                <Text style={styles.categoryEmoji}>{cat.emoji}</Text>
                <Text style={[styles.categoryText, selectedCategory === cat.id && styles.categoryTextSelected]}>
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>

      {/* ── Modal ──────────────────────────────── */}
      <Modal transparent animationType="fade" visible={showAddModal} onRequestClose={() => setShowAddModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowAddModal(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.addModalBox}>
            <Text style={styles.addModalTitle}>LÄGG TILL INTENTION</Text>
            <View style={styles.addModalGrid}>
              {allCategories
                .filter(cat => !categories.find(c => c.id === cat.id))
                .map(cat => (
                  <TouchableOpacity
                    key={cat.id}
                    style={styles.addModalChip}
                    onPress={() => {
                      setCategories(prev => [...prev, cat]);
                      setSelectedCategory(cat.id);
                      setShowAddModal(false);
                    }}
                  >
                    <Text style={styles.addModalEmoji}>{cat.emoji}</Text>
                    <Text style={styles.addModalLabel}>{cat.label}</Text>
                  </TouchableOpacity>
                ))}
            </View>
            {allCategories.filter(cat => !categories.find(c => c.id === cat.id)).length === 0 && (
              <Text style={styles.addModalEmpty}>Alla intentioner är redan tillagda.</Text>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Checka in ──────────────────────────── */}
      <TouchableOpacity
        style={[styles.checkInButton, !canCheckIn && styles.checkInButtonDisabled]}
        onPress={handleCheckIn}
        disabled={!canCheckIn}
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
    gap: 20,
    padding: 28,
    marginTop: -15,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: 'white',
    marginTop: -15,
  },
  section: { width: '100%' },
  sectionLabel: {
    color: '#555',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 2,
    marginBottom: 12,
  },

  // ── Or label ──────────────────────────────
  orLabel: {
    color: '#333',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    textAlign: 'center',
    marginTop: 14,
    marginBottom: 10,
  },

  // ── Duration grid ─────────────────────────
  durationGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
  },
  durationChip: {
    width: '30%',
    paddingVertical: 9,
    backgroundColor: '#2a2a3e',
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#2a2a3e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationChipSelected: {
    borderColor: '#2e86de',
    backgroundColor: '#1a3a5e',
  },
  durationNum: {
    color: '#666',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 20,
  },
  durationNumSelected: { color: '#fff' },
  durationUnit: {
    color: '#444',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.5,
    marginTop: 1,
  },
  durationUnitSelected: { color: '#7ab8f5' },

  // ── Free time button ──────────────────────
  freeTimeBtn: {
    marginTop: 10,
    width: '100%',
    paddingVertical: 14,
    backgroundColor: '#2a2a3e',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#2a2a3e',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    position: 'relative',
  },
  freeTimeBtnSelected: {
    borderColor: '#2e86de',
    backgroundColor: '#1a3a5e',
  },
  freeTimeText: {
    color: '#555',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2.5,
  },
  freeTimeTextSelected: { color: '#fff' },
  freeCheckDot: {
    position: 'absolute',
    right: 14,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#2e86de',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Mode buttons ──────────────────────────
  modeRow: { flexDirection: 'row', gap: 14 },
  modeButton: {
    flex: 1,
    backgroundColor: '#2a2a3e',
    borderWidth: 2,
    borderColor: '#2a2a3e',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    position: 'relative',
    gap: 5,
  },
  modeButtonSelected: { borderColor: '#2e86de', backgroundColor: '#1a3a5e' },
  modeTitle: {
    color: '#aaa',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
    textAlign: 'center',
  },
  modeTitleSelected: { color: '#2e86de' },
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
  bleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  bleDot: { width: 7, height: 7, borderRadius: 4 },
  bleSmallText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    letterSpacing: 0.3,
    fontStyle: 'italic',
  },

  // ── Category ──────────────────────────────
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  addIntentionBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryScroll: { paddingHorizontal: 2, gap: 10, flexDirection: 'row' },
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
  categoryChipSelected: { borderColor: '#2e86de', backgroundColor: '#1a3a5e' },
  categoryEmoji: { fontSize: 16 },
  categoryText: { color: '#aaa', fontSize: 12, fontWeight: 'bold', letterSpacing: 1.5 },
  categoryTextSelected: { color: 'white' },

  // ── Modal ─────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addModalBox: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    padding: 24,
    width: '88%',
    maxHeight: '75%',
    borderWidth: 1,
    borderColor: '#2e86de33',
  },
  addModalTitle: {
    color: '#555',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 2,
    marginBottom: 16,
    textAlign: 'center',
  },
  addModalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-start' },
  addModalChip: {
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
  addModalEmoji: { fontSize: 16 },
  addModalLabel: { color: '#aaa', fontSize: 12, fontWeight: 'bold', letterSpacing: 1.5 },
  addModalEmpty: { color: '#555', fontSize: 13, textAlign: 'center', paddingVertical: 12 },

  // ── CTA ───────────────────────────────────
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
  checkInButtonDisabled: { backgroundColor: '#2a2a3e', shadowOpacity: 0, elevation: 0 },
  checkInText: { color: 'white', fontSize: 18, fontWeight: 'bold', letterSpacing: 3 },
  noButton: { paddingVertical: 10, paddingHorizontal: 32 },
  noText: { color: '#555', fontSize: 15 },
});
