import { Entypo, FontAwesome, FontAwesome5 } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Category, DEFAULT_CATEGORIES, saveSelectedCategories } from './pauseLogger';

const STORAGE_PATH = FileSystem.documentDirectory + 'selectedBlocks.json';
const CATEGORIES_PATH = FileSystem.documentDirectory + 'selectedCategories.json';
const CUSTOM_CATEGORIES_PATH = FileSystem.documentDirectory + 'customCategories.json';

const TIME_BLOCKS = [
  { id: 'morning', label: '🌅 Morgon', time: '07:00-09:00', hour: 7 },
  { id: 'forenoon', label: '☕ Förmiddag', time: '09:00-12:00', hour: 9 },
  { id: 'lunch', label: '🌞 Lunch', time: '12:00-14:00', hour: 12 },
  { id: 'afternoon', label: '🌤 Eftermiddag', time: '14:00-17:00', hour: 14 },
  { id: 'early_evening', label: '🌆 Tidig kväll', time: '17:00-19:00', hour: 17 },
  { id: 'evening', label: '🌙 Kväll', time: '19:00-21:00', hour: 19 },
  { id: 'late_evening', label: '🌚 Sen kväll', time: '21:00-23:00', hour: 21 },
];

export default function SettingsScreen() {
  const [selectedBlocks, setSelectedBlocks] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [customCategories, setCustomCategories] = useState<Category[]>([]);
  const [newEmoji, setNewEmoji] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [saved, setSaved] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const originalBlocks = useRef<string[]>([]);
  const originalCategories = useRef<string[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const blocks = await FileSystem.readAsStringAsync(STORAGE_PATH);
        const parsed = JSON.parse(blocks);
        setSelectedBlocks(parsed);
        originalBlocks.current = parsed;
      } catch (e) {}
      try {
        const cats = await FileSystem.readAsStringAsync(CATEGORIES_PATH);
        const parsed = JSON.parse(cats);
        setSelectedCategories(parsed);
        originalCategories.current = parsed;
      } catch (e) {}
      try {
        const custom = await FileSystem.readAsStringAsync(CUSTOM_CATEGORIES_PATH);
        setCustomCategories(JSON.parse(custom));
      } catch (e) {}
    };
    load();
  }, []);

  const toggleBlock = (id: string) => {
    setSelectedBlocks(prev => {
      const next = prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id];
      setHasChanges(true);
      return next;
    });
  };

  const toggleCategory = (id: string) => {
    setSelectedCategories(prev => {
      const next = prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id];
      setHasChanges(true);
      return next;
    });
  };

  const addCustomCategory = async () => {
    if (!newEmoji.trim() || !newLabel.trim()) return;
    const newCat: Category = {
      id: 'custom_' + Date.now(),
      label: newLabel.trim().toUpperCase(),
      emoji: newEmoji.trim(),
    };
    const updated = [...customCategories, newCat];
    setCustomCategories(updated);
    setSelectedCategories(prev => [...prev, newCat.id]);
    await FileSystem.writeAsStringAsync(CUSTOM_CATEGORIES_PATH, JSON.stringify(updated));
    setNewEmoji('');
    setNewLabel('');
    setHasChanges(true);
  };

  const removeCustomCategory = async (id: string) => {
    const updated = customCategories.filter(c => c.id !== id);
    setCustomCategories(updated);
    setSelectedCategories(prev => prev.filter(c => c !== id));
    await FileSystem.writeAsStringAsync(CUSTOM_CATEGORIES_PATH, JSON.stringify(updated));
    setHasChanges(true);
  };

  const allCategories = [...DEFAULT_CATEGORIES, ...customCategories];

  const handleSave = async () => {
    await FileSystem.writeAsStringAsync(STORAGE_PATH, JSON.stringify(selectedBlocks));
    await saveSelectedCategories(selectedCategories);

    await Notifications.cancelAllScheduledNotificationsAsync();
    const blocks = TIME_BLOCKS.filter(b => selectedBlocks.includes(b.id));
    for (let day = 0; day < 14; day++) {
      for (const block of blocks) {
        const randomMinute = Math.floor(Math.random() * 60);
        const date = new Date();
        date.setDate(date.getDate() + day);
        date.setHours(block.hour, randomMinute, 0, 0);
        if (date > new Date()) {
          await Notifications.scheduleNotificationAsync({
            content: {
              title: 'Ring ring!📞 Samtal från dig själv.',
              body: 'Tryck för att svara',
              sound: true,
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date,
            },
          });
        }
      }
    }

    setSaved(true);
    setHasChanges(false);
    originalBlocks.current = selectedBlocks;
    originalCategories.current = selectedCategories;
    setTimeout(() => setSaved(false), 2500);
  };

  const handleBack = () => {
    if (hasChanges) {
      Alert.alert(
        'Spara ändringar?',
        'Du har osparade ändringar.',
        [
          { text: 'Avbryt', style: 'cancel' },
          { text: 'Lämna utan att spara', style: 'destructive', onPress: () => router.back() },
          { text: 'Spara', onPress: async () => { await handleSave(); router.back(); } },
        ]
      );
    } else {
      router.back();
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>

      {/* Topbar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <FontAwesome name="chevron-left" size={16} color="#2e86de" />
          <Text style={styles.backText}>Tillbaka</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.pageTitle}>Inställningar</Text>

      {/* TIDSBLOCK */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>När scrollar du mest?</Text>
        <Text style={styles.sectionSubtitle}>
          Välj minst 2 tidsblock — påminnelserna anpassas efter dig.
        </Text>
        <View style={styles.blocks}>
          {TIME_BLOCKS.map(block => (
            <TouchableOpacity
              key={block.id}
              style={[styles.block, selectedBlocks.includes(block.id) && styles.blockSelected]}
              onPress={() => toggleBlock(block.id)}
            >
              <Text style={[styles.blockLabel, selectedBlocks.includes(block.id) && styles.blockLabelSelected]}>
                {block.label}
              </Text>
              <Text style={[styles.blockTime, selectedBlocks.includes(block.id) && styles.blockTimeSelected]}>
                {block.time}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* KATEGORIER */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Vad gör du under pausen?</Text>
        <Text style={styles.sectionSubtitle}>
          Välj de aktiviteter som passar dig.
        </Text>
        <View style={styles.categoryGrid}>
          {allCategories.map(cat => (
            <TouchableOpacity
              key={cat.id}
              style={[styles.chip, selectedCategories.includes(cat.id) && styles.chipSelected]}
              onPress={() => toggleCategory(cat.id)}
            >
              <Text style={styles.chipEmoji}>{cat.emoji}</Text>
              <Text style={[styles.chipLabel, selectedCategories.includes(cat.id) && styles.chipLabelSelected]}>
                {cat.label}
              </Text>
              {customCategories.some(c => c.id === cat.id) && (
                <TouchableOpacity
                  onPress={() => removeCustomCategory(cat.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <FontAwesome5 name="times" size={10} color="#555" />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Lägg till egen kategori */}
        <View style={styles.addSection}>
          <Text style={styles.addTitle}>LÄGG TILL EGEN AKTIVITET:</Text>
          <View style={styles.addRow}>
            <View style={styles.emojiWrapper}>
              <TextInput
                style={styles.emojiInput}
                placeholder=""
                placeholderTextColor="#444"
                value={newEmoji}
                onChangeText={setNewEmoji}
                maxLength={2}
              />
              {!newEmoji && (
                <Entypo name="emoji-happy" size={22} color="#444" style={styles.emojiOverlay} />
              )}
            </View>
            <TextInput
              style={styles.labelInput}
              placeholder="Namn"
              placeholderTextColor="#444"
              value={newLabel}
              onChangeText={setNewLabel}
              autoCapitalize="words"
              maxLength={20}
            />
            <TouchableOpacity
              style={[styles.addButton, (!newEmoji.trim() || !newLabel.trim()) && styles.addButtonDisabled]}
              onPress={addCustomCategory}
              disabled={!newEmoji.trim() || !newLabel.trim()}
            >
              <FontAwesome5 name="plus" size={16} color="white" />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Spara-knapp */}
      <TouchableOpacity
        style={[styles.saveButton, selectedBlocks.length < 2 && styles.saveButtonDisabled, saved && styles.saveButtonDone]}
        onPress={handleSave}
        disabled={selectedBlocks.length < 2}
      >
        <Text style={styles.saveText}>
          {saved ? '✅ Sparat!' : selectedBlocks.length < 2 ? 'Välj minst 2 tidsblock' : 'Spara'}
        </Text>
      </TouchableOpacity>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#1a1a2e',
    padding: 24,
    paddingTop: 0,
    paddingBottom: 50,

  },
  topBar: {
    paddingTop: 40,
    marginBottom: 16,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
  },
  backText: {
    color: '#2e86de',
    fontSize: 16,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 32,
  },
  section: {
    marginBottom: 40,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 6,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#aaa',
    marginBottom: 16,
    lineHeight: 22,
  },
  blocks: {
    gap: 10,
  },
  block: {
    backgroundColor: '#2a2a3e',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  blockSelected: {
    borderColor: '#2e86de',
    backgroundColor: '#1a3a5e',
  },
  blockLabel: {
    fontSize: 17,
    color: '#aaa',
    fontWeight: 'bold',
  },
  blockLabelSelected: {
    color: 'white',
  },
  blockTime: {
    fontSize: 13,
    color: '#555',
  },
  blockTimeSelected: {
    color: '#7ab8f5',
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,

  },
  chip: {
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
  chipSelected: {
    borderColor: '#2e86de',
    backgroundColor: '#1a3a5e',
  },
  chipEmoji: {
    fontSize: 16,
  },
  chipLabel: {
    color: '#aaa',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1.5,
  },
  chipLabelSelected: {
    color: 'white',
  },
  addSection: {
    marginTop: 20,
    backgroundColor: '#2a2a3e',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  addTitle: {
    color: '#555',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 2,
    marginBottom: 12,
  },
  addRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  emojiWrapper: {
    position: 'relative',
    width: 52,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emojiInput: {
    position: 'absolute',
    width: 52,
    height: 48,
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    fontSize: 22,
    color: 'white',
    textAlign: 'center',
    borderWidth: 1.5,
    borderColor: '#333',
  },
  emojiOverlay: {
    pointerEvents: 'none',
  },
  labelInput: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: 'white',
    borderWidth: 1.5,
    borderColor: '#333',
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  addButton: {
    backgroundColor: '#2e86de',
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonDisabled: {
    backgroundColor: '#333',
  },
  saveButton: {
    backgroundColor: '#2e86de',
    paddingVertical: 16,
    borderRadius: 32,
    alignItems: 'center',
    marginTop: 0,
  },
  saveButtonDisabled: {
    backgroundColor: '#2a2a3e',
    
  },
  saveButtonDone: {
    backgroundColor: '#27ae60',
    
  },
  saveText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    
  },
});
