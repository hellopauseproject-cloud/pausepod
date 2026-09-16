// Ren upplevelse-kosmetik för placeinbox-ritualen: dämpar skärmens
// ljusstyrka när telefonen läggs platt, återställer den igen. Rör aldrig
// pausflödet eller sessionReducer.
//
// getBrightnessAsync/setBrightnessAsync är app-scopade (ingen permission
// krävs) — på Android gäller det bara medan appen är i förgrunden, på iOS
// tills skärmen låses. Ingen inbyggd transition finns, så vi stegar värdet
// själva över DIM_DURATION_MS.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Brightness from 'expo-brightness';

const SAVED_BRIGHTNESS_KEY = 'saved_screen_brightness';
const DIM_TARGET_RATIO = 0.25;
const DIM_DURATION_MS = 800;
const DIM_STEPS = 16;

let animationTimer: ReturnType<typeof setInterval> | null = null;

function stopAnimation() {
  if (animationTimer) {
    clearInterval(animationTimer);
    animationTimer = null;
  }
}

export async function dimScreen(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(SAVED_BRIGHTNESS_KEY);
    let original: number;
    if (saved !== null) {
      original = Number(saved);
    } else {
      original = await Brightness.getBrightnessAsync();
      await AsyncStorage.setItem(SAVED_BRIGHTNESS_KEY, String(original));
    }

    stopAnimation();
    const start = await Brightness.getBrightnessAsync();
    const target = original * DIM_TARGET_RATIO;
    const stepMs = DIM_DURATION_MS / DIM_STEPS;
    let step = 0;

    animationTimer = setInterval(async () => {
      step += 1;
      const t = Math.min(1, step / DIM_STEPS);
      const value = start + (target - start) * t;
      try {
        await Brightness.setBrightnessAsync(value);
      } catch {}
      if (t >= 1) stopAnimation();
    }, stepMs);
  } catch {}
}

/** Idempotent — no-op om inget är dämpat. Säker att anropa från flera ställen. */
export async function restoreScreenBrightness(): Promise<void> {
  stopAnimation();
  try {
    const saved = await AsyncStorage.getItem(SAVED_BRIGHTNESS_KEY);
    if (saved === null) return;
    await AsyncStorage.removeItem(SAVED_BRIGHTNESS_KEY);
    await Brightness.setBrightnessAsync(Number(saved));
  } catch {}
}
