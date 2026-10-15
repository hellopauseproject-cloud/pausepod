import AsyncStorage from '@react-native-async-storage/async-storage';
import { readDoc, writeDoc } from '../lib/docStore';

const LOG_PATH = 'pauseLogs.json';
const CATEGORIES_PATH = 'selectedCategories.json';

const SESSION_CHECKPOINT_KEY = 'active_pause_session_checkpoint';

export interface SessionCheckpoint {
  startedAt: string;
  /** ISO — senaste gången appen bevisligen levde under pausen. Skrivs om med
   *  jämna mellanrum och en sista gång när appen lämnar förgrunden. Vid en
   *  tvångsstängning finns ingen kod kvar att köra, så det här är det enda
   *  vi vet om när pausen faktiskt tog slut. */
  lastAliveAt: string;
  /** Räknad pauslängd vid pulsslaget, i ms. Lagras i stället för att räknas
   *  ut ur tidsstämplarna vid återställning: klockan kan ha stått frusen
   *  (telefonen uppåtvänd) delar av tiden, och den tiden är inte paus. */
  elapsedMs: number;
  userId: string;
  category?: string;
  pauseType: 'session' | 'regulate' | 'sleep';
  targetSeconds?: number;
  sharedSessionId?: string;
  /** Värd (bjöd in) eller gäst (hängde på). Avgör om återställningen stänger
   *  inbjudningarna eller markerar den egna som slutförd
   *  (lib/pauseInvites.ts). */
  sharedRole?: 'host' | 'guest';
  // ── Bara en natt (pauseType 'sleep') ──
  /** ISO — första gången telefonen lades ner, läggdags. */
  firstRestAt?: string;
  wakeCount?: number;
  awakeMs?: number;
  /** Gick klockan när appen lämnades (nedåtvänd och still)? Då sov
   *  användaren vidare efter den sista pulsen, och återställningen räknar
   *  fram till att appen öppnades igen i stället för att stanna vid pulsen. */
  runningAtLeave?: boolean;
}

export const saveSessionCheckpoint = async (checkpoint: SessionCheckpoint): Promise<void> => {
  try {
    await AsyncStorage.setItem(SESSION_CHECKPOINT_KEY, JSON.stringify(checkpoint));
  } catch (e) {}
};

export const loadSessionCheckpoint = async (): Promise<SessionCheckpoint | null> => {
  try {
    const raw = await AsyncStorage.getItem(SESSION_CHECKPOINT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
};

export const clearSessionCheckpoint = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(SESSION_CHECKPOINT_KEY);
  } catch (e) {}
};

export const DEFAULT_CATEGORIES = [
{ id: 'focus', label: 'FOCUS', emoji: '🎯' },
{ id: 'walk', label: 'WALK', emoji: '🚶' },
{ id: 'workout', label: 'WORKOUT', emoji: '💪' },
{ id: 'social', label: 'SOCIAL', emoji: '💬' },
{ id: 'clean', label: 'CLEAN', emoji: '🧹' },
{ id: 'meditate', label: 'MEDITATION', emoji: '🧘' },
{ id: 'read', label: 'READING', emoji: '📖' },
{ id: 'study', label: 'STUDY', emoji: '✏️' },
{ id: 'rest', label: 'REST', emoji: '😴' },
{ id: 'create', label: 'CREATE', emoji: '🎨' },
{ id: 'music', label: 'MUSIC', emoji: '🎵' },
{ id: 'nature', label: 'NATURE', emoji: '🌲' },
];

export interface Category {
  id: string;
  label: string;
  emoji: string;
}

export interface PauseLog {
  date: string;
  duration: number;
  mode: 'session';
  category?: string;
}

export const saveSelectedCategories = async (categoryIds: string[]) => {
  try {
    await writeDoc(CATEGORIES_PATH, JSON.stringify(categoryIds));
  } catch (e) {}
};

const CUSTOM_CATEGORIES_PATH = 'customCategories.json';

export const getSelectedCategories = async (): Promise<Category[]> => {
  try {
    const saved = await readDoc(CATEGORIES_PATH);
    const ids: string[] = JSON.parse(saved);

    let customCats: Category[] = [];
    try {
      const custom = await readDoc(CUSTOM_CATEGORIES_PATH);
      customCats = JSON.parse(custom);
    } catch (e) {}

    const allCategories = [...DEFAULT_CATEGORIES, ...customCats];
    return allCategories.filter(c => ids.includes(c.id));
  } catch (e) {
    // Inget sparat val finns ännu — då gäller alla standardkategorier.
    //
    // Skillnaden mot att returnera [] är hela pausskärmens kategorirad:
    // introduktionen frågar inte längre om aktiviteter (se CLAUDE.md), så den
    // här grenen är numera vad *varje* ny användare möter. Tomt hade gett en
    // rubrik utan rad, och valet hade bara gått att nå via plusknappens modal.
    //
    // Att grenen sitter i catch och inte efter en längdkoll är poängen:
    // readDoc kastar när filen aldrig skrivits, medan ett sparat [] parsar
    // till en tom lista. Den som medvetet tömt sin lista i Settings behåller
    // alltså sitt val — bara den som aldrig valt får standarduppsättningen.
    return [...DEFAULT_CATEGORIES];
  }
};

export const getAllCategories = async (): Promise<Category[]> => {
  let customCats: Category[] = [];
  try {
    const custom = await readDoc(CUSTOM_CATEGORIES_PATH);
    customCats = JSON.parse(custom);
  } catch (e) {}
  return [...DEFAULT_CATEGORIES, ...customCats];
};

export const findCategoryById = async (id: string): Promise<Category | null> => {
  let customCats: Category[] = [];
  try {
    const custom = await readDoc(CUSTOM_CATEGORIES_PATH);
    customCats = JSON.parse(custom);
  } catch (e) {}
  return [...DEFAULT_CATEGORIES, ...customCats].find(c => c.id === id) ?? null;
};

export const logPause = async (
  duration: number,
  mode: 'session',
  category?: string,
) => {
  try {
    let logs: PauseLog[] = [];
    try {
      const existing = await readDoc(LOG_PATH);
      logs = JSON.parse(existing);
    } catch (e) {}

    const newLog: PauseLog = {
      date: new Date().toISOString(),
      duration,
      mode,
      category,
    };

    logs.push(newLog);
    await writeDoc(LOG_PATH, JSON.stringify(logs));
  } catch (e) {}
};

export const getLogs = async (): Promise<PauseLog[]> => {
  try {
    const existing = await readDoc(LOG_PATH);
    return JSON.parse(existing);
  } catch (e) {
    return [];
  }
};
