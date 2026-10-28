import { Platform } from 'react-native';

/**
 * Golv för botteninsetet på Android.
 *
 * Flera Samsung-användare rapporterade att systemets egna knappar låg ovanpå
 * flikraden. `insets.bottom` ensamt räckte inte: på en del Android-skal
 * kommer den tillbaka som 0 eller några få punkter trots att navigeringsfältet
 * eller gest-strecket faktiskt ritas där — och då hamnar etiketterna under
 * dem. Golvet gör att raden alltid har något att stå på, och på en telefon
 * som rapporterar rätt (48 för tre knappar) ändrar `Math.max` ingenting.
 *
 * iOS får 0: där stämmer insetet, och ett golv hade bara lyft raden i onödan.
 *
 * Bor här och inte i flikarnas layout för att fler skärmar än flikraden
 * behöver det — en skärm som når nederkanten ska använda det här golvet, inte
 * ett eget tal.
 */
export const ANDROID_INSET_FLOOR = Platform.OS === 'android' ? 24 : 0;

/** Botteninsetet med Android-golvet. */
export function safeBottom(insetBottom: number): number {
  return Math.max(insetBottom, ANDROID_INSET_FLOOR);
}
