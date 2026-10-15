import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IntroPart, IntroStep, useIntroStyles } from '../components/intro/intro-chrome';
import { AppPalette } from '../constants/appTheme';
import { RoomProvider, usePalette } from '../contexts/ThemeContext';
import { roomShell, ScreenBackground } from '../components/screen-background';
import { clearPendingCircleWelcome } from '../lib/introPrefs';

/**
 * Det den som *bjudits in* till en krets aldrig fick höra.
 *
 * Den som skapar en krets läser YOU / THE CIRCLE / TOGETHER i
 * [app/circle-create.tsx](./circle-create.tsx) innan kretsen ens finns. Den
 * som bjuds in tryckte på bocken i kretsflikens `invitesSection` och stod i
 * kretsen utan ett ord — och eftersom de flesta medlemmar kommer in just den
 * vägen nådde reglerna aldrig dem. Det var en känd lucka, och det här är
 * sidan som stänger den.
 *
 * **Samma tre block, samma ordning, samma komponent.** Texterna är skrivna
 * inifrån i stället för framför: kretsen finns redan och bär sitt namn, så
 * rubriken säger vilken det är i stället för vad en krets är i allmänhet.
 * Blocken delar `IntroPart` med skaparens sida — den flyttade till
 * [components/intro/intro-chrome.tsx](../components/intro/intro-chrome.tsx)
 * när den fick två läsare — för hela poängen är igenkänningen: den som ser
 * den här sidan och senare själv skapar en krets ska möta samma sida, inte en
 * variant.
 *
 * **Ett steg, inte tre.** Mottagaren är otåligare än skaparen: hen har redan
 * tryckt ja och vill in. Men stegen står kvar i TOGETHER-blocket trots det —
 * nivåraden ligger direkt under kretsens namn på fliken hen är på väg till,
 * och nämns den inte här är den en siffra utan förklaring.
 *
 * **Ingen bakåtlänk.** `IntroStep` ritar den bara när den fått en `onBack`,
 * och det finns ingenstans att backa till: kretsen är redan accepterad när
 * sidan visas. `Got it` är hela foten.
 *
 * Flaggan som för hit rivs i `dismiss()` och inte vid montering — se
 * [lib/introPrefs.ts](../lib/introPrefs.ts). Stängs appen mitt i sidan kommer
 * den tillbaka.
 *
 * Hör till **circle-rummet** — rummet följer ärendet och inte filträdet,
 * se ROOMS i [constants/appTheme.ts](../constants/appTheme.ts). Skalet nedan
 * är identiskt med de andra rummens: en komponent kan inte läsa sin egen
 * provider, och en bakgrund i skalet täcker varje gren skärmen returnerar.
 */
export default function CircleWelcomeRoom() {
  return (
    <RoomProvider room="circle">
      <View style={roomShell}>
        <ScreenBackground room="circle" />
        <CircleWelcomeScreen />
      </View>
    </RoomProvider>
  );
}

function CircleWelcomeScreen() {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  const insets = useSafeAreaInsets();
  const { circleName } = useLocalSearchParams<{ circleName?: string }>();
  const { styles: introStyles } = useIntroStyles();

  const name = (circleName ?? '').trim();

  const dismiss = async () => {
    await clearPendingCircleWelcome();
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/circle' as never);
  };

  // Rubriken bär kretsens namn på egen rad. Ett långt namn får den mindre
  // vikten i stället för att svämma över tre rader och trycka ner panelen:
  // namnet har inget tak i databasen, och 30 punkter på fyra ord fyller en
  // iPhone SE helt själv. Talet är räknat på den skärmen.
  const title = name ? `You're in\n${name}` : "You're in";

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      <IntroStep
        scroll
        title={title}
        titleSmall={name.length > 18}
        subtitle="Here's how it works."
        primaryLabel="Got it"
        onPrimary={dismiss}
      >
        <View style={introStyles.panel}>
          <IntroPart
            title="You"
            // Hårt mellanslag mellan de två sista orden — se samma rad i
            // circle-create.tsx. Blocken ska vara ordagrant lika.
            text={"Pick a daily goal. Take your pauses. That's\u00A0it."}
          />
          <IntroPart
            title="The circle"
            text="Everyone here has their own goal."
          />
          <IntroPart
            title="Together"
            text="Climb the ladder and win the week when everyone has reached their goal."
          />
        </View>
      </IntroStep>
    </View>
  );
}

const makeStyles = (Palette: AppPalette) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
