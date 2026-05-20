import * as FileSystem from 'expo-file-system/legacy';

const LOG_PATH = FileSystem.documentDirectory + 'pauseLogs.json';
const CATEGORIES_PATH = FileSystem.documentDirectory + 'selectedCategories.json';

export const DEFAULT_CATEGORIES = [
{ id: 'focus', label: 'FOKUS', emoji: '🎯' },
{ id: 'walk', label: 'PROMENAD', emoji: '🚶' },
{ id: 'workout', label: 'TRÄNING', emoji: '💪' },
{ id: 'social', label: 'SOCIALT', emoji: '💬' },
{ id: 'clean', label: 'STÄDA', emoji: '🧹' },
{ id: 'meditate', label: 'MEDITATION', emoji: '🧘' },
{ id: 'read', label: 'LÄSNING', emoji: '📖' },
{ id: 'study', label: 'STUDIER', emoji: '✏️' },
{ id: 'rest', label: 'VILA', emoji: '😴' },
{ id: 'create', label: 'SKAPANDE', emoji: '🎨' },
{ id: 'music', label: 'MUSIK', emoji: '🎵' },
{ id: 'nature', label: 'NATUR', emoji: '🌲' },
];

export interface Category {
  id: string;
  label: string;
  emoji: string;
}

export interface Interruption {
  timestamp: string;                       // ISO – när appen lämnade förgrunden
  durationMs: number;                      // avbrottets längd i ms
  resumedOrEnded: 'resumed' | 'ended';     // vad användaren valde
}

export interface PauseLog {
  date: string;
  duration: number;
  mode: 'regulate' | 'session';
  category?: string;
  interruptions?: Interruption[];
  totalInterruptionMs?: number;
  netPauseDurationMs?: number;
}

export const saveSelectedCategories = async (categoryIds: string[]) => {
  try {
    await FileSystem.writeAsStringAsync(CATEGORIES_PATH, JSON.stringify(categoryIds));
  } catch (e) {}
};

const CUSTOM_CATEGORIES_PATH = FileSystem.documentDirectory + 'customCategories.json';

export const getSelectedCategories = async (): Promise<Category[]> => {
  try {
    const saved = await FileSystem.readAsStringAsync(CATEGORIES_PATH);
    const ids: string[] = JSON.parse(saved);

    let customCats: Category[] = [];
    try {
      const custom = await FileSystem.readAsStringAsync(CUSTOM_CATEGORIES_PATH);
      customCats = JSON.parse(custom);
    } catch (e) {}

    const allCategories = [...DEFAULT_CATEGORIES, ...customCats];
    return allCategories.filter(c => ids.includes(c.id));
  } catch (e) {
    return [];
  }
};

export const logPause = async (
  duration: number,
  mode: 'regulate' | 'session',
  category?: string,
  interruptions?: Interruption[],
) => {
  try {
    let logs: PauseLog[] = [];
    try {
      const existing = await FileSystem.readAsStringAsync(LOG_PATH);
      logs = JSON.parse(existing);
    } catch (e) {}

    const newLog: PauseLog = {
      date: new Date().toISOString(),
      duration,
      mode,
      category,
    };

    if (interruptions && interruptions.length > 0) {
      const totalInterruptionMs = interruptions.reduce((sum, i) => sum + i.durationMs, 0);
      newLog.interruptions = interruptions;
      newLog.totalInterruptionMs = totalInterruptionMs;
      newLog.netPauseDurationMs = duration * 1000 - totalInterruptionMs;
    }

    logs.push(newLog);
    await FileSystem.writeAsStringAsync(LOG_PATH, JSON.stringify(logs));
  } catch (e) {}
};

export const getLogs = async (): Promise<PauseLog[]> => {
  try {
    const existing = await FileSystem.readAsStringAsync(LOG_PATH);
    return JSON.parse(existing);
  } catch (e) {
    return [];
  }
};

const NOTIFICATION_SETTINGS_LOG_PATH = FileSystem.documentDirectory + 'notificationSettingsLog.json';

export const logNotificationSettingsChange = async (settings: {
  timesPerDay: number;
  timeSlots: { id: string; label: string; time: string }[];
}) => {
  try {
    let logs: { timesPerDay: number; timeSlots: { id: string; label: string; time: string }[]; changedAt: string }[] = [];
    try {
      const existing = await FileSystem.readAsStringAsync(NOTIFICATION_SETTINGS_LOG_PATH);
      logs = JSON.parse(existing);
    } catch (e) {}
    logs.push({ ...settings, changedAt: new Date().toISOString() });
    await FileSystem.writeAsStringAsync(NOTIFICATION_SETTINGS_LOG_PATH, JSON.stringify(logs));
  } catch (e) {}
};
