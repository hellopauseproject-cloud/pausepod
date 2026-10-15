import { Kalam_400Regular, Kalam_700Bold } from '@expo-google-fonts/kalam';
import * as Font from 'expo-font';
import { useCallback, useEffect, useState } from 'react';
import { TextStyle } from 'react-native';

/**
 * Handstilen på att göra-listan — lappen på Hem, arket bakom den och kretsens
 * lappar. Bara punkterna själva, aldrig etiketter, knappar eller fotnoter:
 * det är det någon *skrivit* som ska se skrivet ut.
 *
 * Kalam: en lugn, vuxen hand med vanlig x-höjd, som går att läsa i liten
 * storlek. Caveat satt här först och valdes bort på begäran. De rundare
 * handstilarna (Patrick Hand, Gochi Hand, Shadows Into Light) läser som en
 * barnbok och ska inte heller in.
 *
 * `HAND_SCALE` räknar om, så att anroparen skriver storleken som om det vore
 * systemtypsnittet — och fallbacken innan typsnittet laddats blir samma
 * storlek som förut. Byts typsnittet måste talet prövas om: det beror helt
 * på typsnittets x-höjd.
 *
 * Ingen `fontFamily` förrän typsnittet faktiskt finns: ett namn som inte är
 * laddat ger en varning i dev och systemtypsnittet ändå.
 */
// Var 1.05 (16 → 17, 14 → 15, 13 → 14) och sänktes ett steg på begäran.
// Minsta handstilen är 13 här, så typskalans golv på 11 är långt borta.
const HAND_SCALE = 1;
const REGULAR = 'Kalam_400Regular';
const BOLD = 'Kalam_700Bold';

// En laddning för hela appen, startad när modulen importeras — inte en per
// komponent. Paketets egen `useFonts` laddade i varje anropare och svarade
// `false` tills just dess laddning landat; lappen på Hem, som monteras först,
// fastnade då i systemtypsnittet medan arket fick handstilen.
const loading: Promise<void> = Font.loadAsync({ [REGULAR]: Kalam_400Regular, [BOLD]: Kalam_700Bold })
  .catch(e => { console.warn('handFont: could not load Kalam', e); });

const isReady = () => Font.isLoaded(REGULAR) && Font.isLoaded(BOLD);

export function useHand() {
  const [loaded, setLoaded] = useState(isReady);
  useEffect(() => {
    if (loaded) return;
    let alive = true;
    loading.then(() => { if (alive) setLoaded(isReady()); });
    return () => { alive = false; };
  }, [loaded]);
  return useCallback((size: number, bold = false): TextStyle => loaded
    ? {
      fontFamily: bold ? BOLD : REGULAR,
      fontSize: Math.round(size * HAND_SCALE),
      // En vikt ovanpå en egen familj ger fel snitt på Android.
      fontWeight: 'normal',
    }
    : { fontSize: size }, [loaded]);
}
