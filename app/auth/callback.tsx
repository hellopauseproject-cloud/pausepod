import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { AppPalette } from '../../constants/appTheme';
import { usePalette } from '../../contexts/ThemeContext';
import { supabase } from '../../lib/supabase';

/**
 * Landningsplatsen för `pauseapp://auth/callback`.
 *
 * Normalt syns den aldrig: [lib/googleAuth.ts](../../lib/googleAuth.ts) ger
 * samma adress till `WebBrowser.openAuthSessionAsync`, som fångar
 * omdirigeringen inne i sin egen flik och växlar koden mot en session utan att
 * någon länk lämnar webbläsaren.
 *
 * Men den fångsten är inte garanterad. Går omdirigeringen i stället till
 * systemet — flikens session hann stängas, eller länken öppnades ur ett
 * mejl — levererar Android/iOS `pauseapp://auth/callback` till appen som en
 * vanlig djuplänk. Utan en fil på den sökvägen svarade expo-router med sin
 * **Unmatched Route**-sida, och i kallstartsfallet var inloggningen dessutom
 * förlorad: ingen hade växlat koden, så grinden i `app/_layout.tsx` såg ingen
 * användare och skickade tillbaka till inloggningen.
 *
 * Skärmen är alltså inte en sida utan en växel: den tar emot, avslutar
 * inloggningen om den inte redan är avslutad, och lämnar över.
 *
 * **Den måste tåla att köras efter att `googleAuth.ts` redan gjort jobbet.**
 * En kod går bara att växla en gång, så ett andra försök svarar med ett fel
 * som inte betyder att något gått sönder. Därför frågas alltid sessionen
 * först, och en gång till innan ett fel får betyda något.
 */
export default function AuthCallbackScreen() {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);

  // Hela adressen, inte `useLocalSearchParams`: det implicita flödet lägger
  // sina tokens i fragmentet efter `#`, och det är inte sökparametrar — de
  // finns helt enkelt inte bland routerns params.
  const url = Linking.useURL();

  /** En körning räcker. `useURL` kan ge samma adress igen vid omrendering. */
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;

    (async () => {
      // Har sessionen redan landat (det vanliga fallet: googleAuth.ts hann
      // först) finns ingenting att göra. Grinden i app/_layout.tsx ser
      // användaren och routar vidare av sig själv.
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        handled.current = true;
        return;
      }

      // Ingen session än, och ingen adress att läsa ur: vänta. `useURL`
      // levererar den strax, och kroken kör om när den gör det.
      if (!url) return;
      handled.current = true;

      const parsed = new URL(url);

      // Användaren avbröt, eller leverantören svarade med ett fel. Det är
      // inget haveri — tillbaka till inloggningen utan larm.
      if (parsed.searchParams.get('error')) {
        router.replace('/auth/login' as never);
        return;
      }

      // PKCE: koden ligger som sökparameter.
      const code = parsed.searchParams.get('code');
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) await bailUnlessSignedIn();
        return;
      }

      // Implicit flöde: tokens i fragmentet — och det är det flödet som
      // gäller, eftersom `lib/supabase.ts` inte sätter `flowType`.
      //
      // Fragmentet klipps ur strängen och inte ur `parsed.hash`: React
      // Natives egna URL läser hashen med `/#([^/]*)/` och skär alltså av vid
      // första snedstrecket. Base64url-tokens innehåller inga, men en
      // `provider_token` kan göra det, och då vore avklippet omöjligt att se.
      const fragment = new URLSearchParams(url.split('#')[1] ?? '');
      const access_token = fragment.get('access_token');
      const refresh_token = fragment.get('refresh_token');
      if (access_token && refresh_token) {
        const { error } = await supabase.auth.setSession({ access_token, refresh_token });
        if (error) await bailUnlessSignedIn();
        return;
      }

      // Varken kod eller tokens — adressen bär ingen inloggning alls.
      router.replace('/auth/login' as never);
    })();
  }, [url]);

  // Grinden i app/_layout.tsx låter den här skärmen stå kvar utan användare,
  // just för att växlingen ska hinna bli klar. Priset är att ingen annan
  // räddar den om adressen aldrig kommer eller nätet dör mitt i — därav en
  // bortre gräns. Hellre inloggningsskärmen än en snurra utan slut.
  useEffect(() => {
    const timer = setTimeout(async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) router.replace('/auth/login' as never);
    }, 15000);
    return () => clearTimeout(timer);
  }, []);

  // Lyckas växlingen behöver den här skärmen inte navigera: `AuthContext`
  // sätter användaren, och grinden i app/_layout.tsx skickar vidare till
  // introduktionen eller flikarna beroende på `onboarding_completed`. Den
  // vägen är redan skriven, och två som routar samtidigt blir en kapplöpning.
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={Palette.accent} size="large" />
    </View>
  );
}

/**
 * Ett misslyckat utbyte betyder oftast bara att koden redan var använd —
 * `googleAuth.ts` hann före. Är sessionen uppe är allt som det ska; är den
 * det inte gick inloggningen verkligen förlorad.
 */
async function bailUnlessSignedIn() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) router.replace('/auth/login' as never);
}

const makeStyles = (Palette: AppPalette) => StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.bg,
  },
});
