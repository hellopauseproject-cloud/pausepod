import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance } from 'react-native';

import { AppPalette, palettes, RoomName, roomPalette, ThemeMode } from '../constants/appTheme';
import { track } from '../lib/analytics';

// Valet är enhetens, inte kontots: det följer skärmen man tittar på och ska
// gälla redan innan någon loggat in, så det ligger i AsyncStorage och inte i
// `profiles`. Loggar man ut byter appen inte utseende.
const STORAGE_KEY = 'pausepod.themeMode';

// 'system' är ett val om *var* läget kommer ifrån, inte ett tredje utseende —
// därför är det skilt från ThemeMode, som bara känner till dark/light.
export type ThemePreference = ThemeMode | 'system';

type ThemeContextValue = {
  /** Det läge som faktiskt renderas just nu. Aldrig 'system'. */
  mode: ThemeMode;
  /** Vad användaren valt. 'system' betyder "följ telefonen". */
  preference: ThemePreference;
  palette: AppPalette;
  setPreference: (next: ThemePreference) => void;
  /** Vippar mellan dark och light och låser därmed upp sig från 'system'. */
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const resolve = (pref: ThemePreference, system: ThemeMode): ThemeMode =>
  pref === 'system' ? system : pref;

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('dark');
  const [systemMode, setSystemMode] = useState<ThemeMode>(
    Appearance.getColorScheme() === 'light' ? 'light' : 'dark',
  );

  // Läs det sparade valet en gång vid start. Fram tills det kommit renderar
  // appen mörkt — förvalet — så att första framen aldrig blinkar vit på en
  // användare som valt mörkt.
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then(saved => {
        if (!alive) return;
        if (saved === 'dark' || saved === 'light' || saved === 'system') {
          setPreferenceState(saved);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Lyssnaren körs alltid, inte bara när preference === 'system'. Byter man
  // telefonens läge medan appen ligger i bakgrunden vill vi ha rätt värde
  // redo om användaren sedan väljer att följa systemet.
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemMode(colorScheme === 'light' ? 'light' : 'dark');
    });
    return () => sub.remove();
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    // Här och inte i Settings: `toggle` går också genom den här funktionen,
    // och valet sparas per enhet och inte i `profiles` — händelseloggen är
    // det enda stället där en fördelning över användare går att läsa.
    track('theme_preference_set', { preference: next });
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const mode = resolve(preference, systemMode);

  const toggle = useCallback(() => {
    setPreference(mode === 'dark' ? 'light' : 'dark');
  }, [mode, setPreference]);

  // Identiteten på value måste vara stabil så länge läget är det: varje skärms
  // styles byggs med useMemo på paletten, och ett nytt objekt per render hade
  // gjort om varenda StyleSheet i appen vid varje omrendering.
  const value = useMemo<ThemeContextValue>(
    () => ({ mode, preference, palette: palettes[mode], setPreference, toggle }),
    [mode, preference, setPreference, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// ---------------------------------------------------------------------------
// Rummet
//
// Varje flik har sin egen kulör (se ROOMS i constants/appTheme.ts), och
// `usePalette()` ska svara med rummets palett utan att skärmen behöver fråga
// efter den. Det är därför rummet är en **provider** och inte ett argument
// till `usePalette(room)`: `app/(tabs)/circle.tsx` och
// `app/(tabs)/friends.tsx` har ett tiotal egna komponenter var på modulnivå
// som anropar `usePalette()` själva, och ett argument hade missat varenda en
// av dem — rubriker och paneler hade stannat i basens blå medan omgivningen
// bytt rum.
//
// Förvalet är null, alltså basens palett: `hue` är accenten där, så varje
// skärm utanför flikarna ser ut precis som förut.
// ---------------------------------------------------------------------------

const RoomContext = createContext<RoomName | null>(null);

export function RoomProvider({ room, children }: { room: RoomName; children: React.ReactNode }) {
  return <RoomContext.Provider value={room}>{children}</RoomContext.Provider>;
}

/** Vilket rum som gäller här, eller null utanför flikarna. */
export function useRoom(): RoomName | null {
  return useContext(RoomContext);
}

function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme måste användas inuti en AppThemeProvider');
  }
  return ctx;
}

export const useTheme = useThemeContext;

/**
 * Den enda kroken skärmarna behöver. Returnerar paletten för det aktiva läget
 * och heter `Palette` på anropsstället, så att `Palette.accent` ute i JSX
 * betyder samma sak som förr — fast temaberoende.
 *
 * Ligger anropet inuti en `RoomProvider` kommer rummets palett i stället:
 * samma nycklar, men `hue`, `bg` och `surface` är flikens egna.
 * `roomPalette` cachar per `mode:room`, så identiteten är stabil så länge
 * läget och rummet är det — vilket varje `useMemo(() => makeStyles(Palette))`
 * i appen hänger på.
 */
export function usePalette(): AppPalette {
  const { mode, palette } = useThemeContext();
  const room = useRoom();
  return room ? roomPalette(mode, room) : palette;
}
