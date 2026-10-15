import { Entypo, FontAwesome, FontAwesome5 } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { router, useNavigation } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { AppPalette, Radius, Spacing, alpha, darkPalette, lightPalette } from '../constants/appTheme';
import { RoomProvider, ThemePreference, usePalette, useTheme } from '../contexts/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { roomShell, ScreenBackground } from '../components/screen-background';
import { track } from '../lib/analytics';
import DismissKeyboardView from './components/DismissKeyboardView';
import { Category, DEFAULT_CATEGORIES, saveSelectedCategories } from './pauseLogger';

type ThemeOption = {
  value: ThemePreference;
  label: string;
  /** Vänster (eller enda) halva av förhandsrutan. */
  left: typeof darkPalette;
  /** Satt bara för 'system', som visar båda lägena i samma ruta. */
  right?: typeof darkPalette;
};

const THEME_OPTIONS: ThemeOption[] = [
  { value: 'light', label: 'Light', left: lightPalette },
  { value: 'dark', label: 'Dark', left: darkPalette },
  { value: 'system', label: 'System', left: lightPalette, right: darkPalette },
];

const CATEGORIES_PATH = FileSystem.documentDirectory + 'selectedCategories.json';
const CUSTOM_CATEGORIES_PATH = FileSystem.documentDirectory + 'customCategories.json';

function ThemeSwatchHalf({ palette }: { palette: typeof darkPalette }) {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  return (
    <View style={[styles.themeSwatchHalf, { backgroundColor: palette.bg }]}>
      <View style={[styles.themeSwatchDot, { backgroundColor: palette.accent }]} />
      <View style={[styles.themeSwatchLine, { backgroundColor: palette.ink30 }]} />
      <View style={[styles.themeSwatchLine, { backgroundColor: palette.ink15, width: '60%' }]} />
    </View>
  );
}

/**
 * Hör till **study-rummet** — Pause-rummet en trappa djupare in. Se ROOMS i
 * [constants/appTheme.ts](../constants/appTheme.ts) för varför de tre
 * skärmarna bakom Hems topbar-ikoner delar ett eget, mörkare rum.
 */
export default function SettingsRoom() {
  return (
    <RoomProvider room="study">
      <View style={roomShell}>
        <ScreenBackground room="study" />
        <SettingsScreen />
      </View>
    </RoomProvider>
  );
}

function SettingsScreen() {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  const insets = useSafeAreaInsets();
  // Utseendet sparas direkt när man trycker och har ingenting med
  // Spara-knappen längst ned att göra — den hör till kategorierna, och ett
  // val man ser slå igenom på en gång vill ingen behöva bekräfta.
  const { preference, setPreference } = useTheme();
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [customCategories, setCustomCategories] = useState<Category[]>([]);
  const [newEmoji, setNewEmoji] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [saved, setSaved] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [unsavedAction, setUnsavedAction] = useState<any>(null);
  const navigation = useNavigation();

  const originalCategories = useRef<string[]>([]);

  useEffect(() => {
    const load = async () => {
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
    await saveSelectedCategories(
      allCategories.filter(c => selectedCategories.includes(c.id)).map(c => c.id)
    );

    // Antalet, inte vilka. Vilka kategorier som används syns redan i
    // analytics.category_mix, och där betyder de något — en vald kategori som
    // ingen pausar i är bara en kryssruta.
    track('categories_saved', { count: selectedCategories.length, custom: customCategories.length });

    setSaved(true);
    setHasChanges(false);
    originalCategories.current = selectedCategories;
    setTimeout(() => setSaved(false), 2500);
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      if (!hasChanges) return;
      e.preventDefault();
      setUnsavedAction(e.data.action);
    });
    return unsubscribe;
  }, [hasChanges, navigation]);

  const handleBack = () => {
    if (hasChanges) setUnsavedAction('back');
    else router.back();
  };

  const handleUnsavedDiscard = () => {
    const action = unsavedAction;
    setUnsavedAction(null);
    if (action === 'back') router.back();
    else navigation.dispatch(action);
  };

  const handleUnsavedSave = async () => {
    const action = unsavedAction;
    setUnsavedAction(null);
    await handleSave();
    if (action === 'back') router.back();
    else navigation.dispatch(action);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
    <DismissKeyboardView>

      {/* Topbar */}
      <View style={[styles.topBar, { paddingTop: Math.max(40, insets.top + 8) }]}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <FontAwesome name="chevron-left" size={16} color={Palette.accent} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.pageTitle}>Settings</Text>

      {/* APPEARANCE */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Appearance</Text>
        <Text style={styles.sectionSubtitle}>
          Change theme.
        </Text>
        <View style={styles.themeRow}>
          {THEME_OPTIONS.map(opt => {
            const on = preference === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.themeOption, on && styles.themeOptionOn]}
                onPress={() => setPreference(opt.value)}
                activeOpacity={0.85}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
              >
                <View style={styles.themeSwatch}>
                  <ThemeSwatchHalf palette={opt.left} />
                  {opt.right && <ThemeSwatchHalf palette={opt.right} />}
                </View>
                <Text style={[styles.themeLabel, on && styles.themeLabelOn]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {preference === 'system' && (
          <Text style={styles.themeHint}>Follows your phone&apos;s light and dark setting.</Text>
        )}
      </View>

      {/* CATEGORIES */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>What do you do during your pause?</Text>
        <Text style={styles.sectionSubtitle}>
          Choose the activities that suit you.
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
                  <FontAwesome5 name="times" size={10} color={Palette.textFaint} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Add custom category */}
        <View style={styles.addSection}>
          <Text style={styles.addTitle}>ADD YOUR OWN ACTIVITY:</Text>
          <View style={styles.addRow}>
            <View style={styles.emojiWrapper}>
              <TextInput
                style={styles.emojiInput}
                placeholder=""
                placeholderTextColor={Palette.textDisabled}
                value={newEmoji}
                onChangeText={setNewEmoji}
                maxLength={2}
                returnKeyType="done"
                onSubmitEditing={() => Keyboard.dismiss()}
              />
              {!newEmoji && (
                <Entypo name="emoji-happy" size={22} color={Palette.textDisabled} style={styles.emojiOverlay} />
              )}
            </View>
            <TextInput
              style={styles.labelInput}
              placeholder="Activity name"
              placeholderTextColor={Palette.textDisabled}
              value={newLabel}
              onChangeText={setNewLabel}
              autoCapitalize="words"
              maxLength={20}
              returnKeyType="done"
              onSubmitEditing={addCustomCategory}
            />
            <TouchableOpacity
              style={[styles.addButton, (!newEmoji.trim() || !newLabel.trim()) && styles.addButtonDisabled]}
              onPress={addCustomCategory}
              disabled={!newEmoji.trim() || !newLabel.trim()}
            >
              <FontAwesome5 name="plus" size={16} color={Palette.onAccent} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Save button */}
      <TouchableOpacity
        style={[styles.saveButton, saved && styles.saveButtonDone]}
        onPress={handleSave}
      >
        <Text style={styles.saveText}>
          {saved ? 'Saved!' : 'Save'}
        </Text>
      </TouchableOpacity>

      <Modal visible={!!unsavedAction} transparent animationType="fade" onRequestClose={() => setUnsavedAction(null)}>
        <View style={styles.unsavedOverlay}>
          <View style={styles.unsavedSheet}>
            <Text style={styles.unsavedTitle}>Unsaved changes</Text>
            <Text style={styles.unsavedBody}>Do you want to save your changes before leaving?</Text>
            <TouchableOpacity style={styles.unsavedBtnSave} onPress={handleUnsavedSave}>
              <Text style={styles.unsavedBtnSaveText}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.unsavedBtnDiscard} onPress={handleUnsavedDiscard}>
              <Text style={styles.unsavedBtnDiscardText}>Leave without saving</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.unsavedBtnCancel} onPress={() => setUnsavedAction(null)}>
              <Text style={styles.unsavedBtnCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </DismissKeyboardView>
    </ScrollView>
  </KeyboardAvoidingView>
  );
}

const makeStyles = (Palette: AppPalette) => StyleSheet.create({
  container: {
    flexGrow: 1,
    // Botten ritas av <ScreenBackground> i skalet ovan.
    backgroundColor: 'transparent',
    padding: Spacing.xl,
    paddingTop: 0,
    paddingBottom: 70,

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
    paddingVertical: 10,
    paddingRight: 16,
  },
  backText: {
    color: Palette.accent,
    fontSize: 16,
  },
  pageTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: Palette.textPrimary,
    marginBottom: 32,
  },
  section: {
    backgroundColor: Palette.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.surfaceBorder,
    padding: Spacing.lg,
    marginBottom: 40,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Palette.textPrimary,
    marginBottom: 6,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: Palette.textSecondary,
    marginBottom: 16,
    lineHeight: 22,
  },
  themeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  themeOption: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Palette.surfaceAlt,
    backgroundColor: Palette.surfaceAlt,
  },
  themeOptionOn: {
    borderColor: Palette.hue,
    backgroundColor: Palette.hueTint,
  },
  // Rutan är en miniatyr av läget den erbjuder: botten, en blå prick och två
  // textrader. 'System' lägger två halvor kant i kant i samma ruta.
  themeSwatch: {
    flexDirection: 'row',
    width: 58,
    height: 42,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Palette.surfaceBorder,
  },
  themeSwatchHalf: {
    flex: 1,
    padding: 5,
    gap: 3,
  },
  themeSwatchDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginBottom: 2,
  },
  themeSwatchLine: {
    height: 3,
    borderRadius: 2,
    width: '85%',
  },
  themeLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: Palette.textSecondary,
  },
  themeLabelOn: {
    color: Palette.accent,
  },
  themeHint: {
    fontSize: 13,
    color: Palette.textTertiary,
    marginTop: 12,
    lineHeight: 19,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Palette.surfaceAlt,
    borderWidth: 1.5,
    borderColor: Palette.surfaceAlt,
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  chipSelected: {
    borderColor: Palette.hue,
    backgroundColor: Palette.hueTint,
  },
  chipEmoji: {
    fontSize: 14,
  },
  chipLabel: {
    color: Palette.textSecondary,
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  chipLabelSelected: {
    color: Palette.textPrimary,
  },
  addSection: {
    marginTop: 20,
    backgroundColor: Palette.surfaceAlt,
    borderRadius: Radius.xl,
    padding: 16,
    borderWidth: 1,
    borderColor: Palette.surfaceBorder,
  },
  addTitle: {
    ...Palette.eyebrow,
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
    backgroundColor: Palette.bg,
    borderRadius: Radius.sm,
    fontSize: 22,
    color: Palette.textPrimary,
    textAlign: 'center',
    borderWidth: 1.5,
    borderColor: Palette.surfaceBorder,
  },
  emojiOverlay: {
    pointerEvents: 'none',
  },
  labelInput: {
    flex: 1,
    backgroundColor: Palette.bg,
    borderRadius: Radius.sm,
    padding: 12,
    fontSize: 14,
    color: Palette.textPrimary,
    borderWidth: 1.5,
    borderColor: Palette.surfaceBorder,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  addButton: {
    backgroundColor: Palette.accent,
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonDisabled: {
    backgroundColor: Palette.surfaceAlt,
  },
  saveButton: {
    backgroundColor: Palette.accent,
    paddingVertical: 16,
    borderRadius: Radius.pill,
    alignItems: 'center',
    marginTop: 0,
  },
  saveButtonDone: {
    backgroundColor: Palette.success,

  },
  saveText: {
    color: Palette.onAccent,
    fontSize: 18,
    fontWeight: 'bold',
  },
  unsavedOverlay: {
    flex: 1,
    backgroundColor: Palette.scrim,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  unsavedSheet: {
    backgroundColor: Palette.modalSurface,
    borderRadius: Radius.xl,
    padding: 28,
    width: '100%',
    gap: 12,
    borderWidth: 1,
    borderColor: Palette.modalBorder,
  },
  unsavedTitle: {
    color: Palette.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 2,
  },
  unsavedBody: {
    color: Palette.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 8,
  },
  unsavedBtnSave: {
    backgroundColor: Palette.accent,
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  unsavedBtnSaveText: {
    color: Palette.onAccent,
    fontSize: 15,
    fontWeight: '700',
  },
  unsavedBtnDiscard: {
    backgroundColor: Palette.ink05,
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  unsavedBtnDiscardText: {
    color: alpha(Palette.dangerSoft, 0.85),
    fontSize: 15,
    fontWeight: '500',
  },
  unsavedBtnCancel: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  unsavedBtnCancelText: {
    color: Palette.textTertiary,
    fontSize: 14,
  },
});
