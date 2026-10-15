import { useEffect, useMemo, useState } from 'react';
import { Keyboard, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AppPalette, Radius, Spacing } from '../../constants/appTheme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePalette } from '../../contexts/ThemeContext';

/**
 * Den gemensamma ramen kring introduktionens steg.
 *
 * Alla steg har samma skelett — rubrik, underrubrik, en kropp, en primärknapp
 * och en bakåtlänk — och det skelettet ska inte finnas i sju kopior som
 * långsamt glider isär. Stilarna byggs ur paletten på samma sätt som varje
 * skärm i appen gör det (`StyleSheet.create` fryser sina värden, så en palett
 * som byter läge måste gå genom en makeStyles), men delas mellan stegen i
 * stället för att skrivas av en gång per fil.
 */
export function useIntroStyles() {
  const Palette = usePalette();
  return useMemo(() => ({ Palette, styles: makeIntroStyles(Palette) }), [Palette]);
}

/**
 * Tangentbordets höjd, 0 när det är nere.
 *
 * `keyboardWillShow` på iOS och `keyboardDidShow` på Android: iOS skickar
 * sin händelse innan animationen börjar, Android har ingen `will`-variant
 * alls. Att be om `will` på Android ger en lyssnare som aldrig fyrar.
 *
 * Returnerar 0 när `enabled` är false, och registrerar då ingen lyssnare —
 * stegen utan textfält ska inte betala för det här.
 */
function useKeyboardHeight(enabled: boolean): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!enabled) { setHeight(0); return; }
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, e => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, [enabled]);

  return height;
}

/** Fotens avstånd till underkanten när tangentbordet är nere. */
const FOOT_REST_LIFT = 24;

export function IntroStep({
  title,
  titleSmall,
  titleGap,
  subtitle,
  hint,
  children,
  scroll,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  secondaryLabel,
  onSecondary,
  onBack,
  footLift,
}: {
  title: string;
  /**
   * Mindre rubrik. Finns för steg vars kropp behöver varenda pixel — lådan
   * har en illustration och fyra rader under sig, och rubriken är det enda
   * som går att ta av utan att något faller bort.
   */
  titleSmall?: boolean;
  /**
   * Extra luft under rubriken. För steg vars kropp är en enda kompakt kontroll
   * (målratten): utan den klumpar rubrik, underrubrik och val ihop sig högst
   * upp på skärmen, och med den hamnar valet närmare mitten där handen är.
   */
  titleGap?: boolean;
  subtitle?: string;
  hint?: string;
  children?: React.ReactNode;
  /** Steg med mycket innehåll (kategorierna) behöver rulla; de centrerade gör inte det. */
  scroll?: boolean;
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  /** "Skip for now" och liknande — text, inte en andra fylld knapp. */
  secondaryLabel?: string;
  onSecondary?: () => void;
  /**
   * Håller primärknappen ovanför tangentbordet, och en bit från underkanten
   * även när det är nere.
   *
   * Finns för steg vars kropp är ett textfält. `KeyboardAvoidingView` räckte
   * inte: `behavior` är `undefined` på Android i hela det här projektet, och
   * då gör komponenten ingenting alls — fönstret förväntas resiza i stället.
   * Med `edgeToEdgeEnabled` i app.json gör det inte det, så knappen blev
   * liggande under tangentbordet på just det steg där den behövs mest.
   *
   * Lyftet mäts därför ur `Keyboard`-händelserna i stället. Ingen ny
   * beroendekedja — samma linje som progressringen och nivåmärkena, som
   * ritas för hand för att slippa en native-modul och en ny dev-build.
   *
   * Steg som sätter den får alltså **inte** också ligga i en
   * `KeyboardAvoidingView` som faktiskt lyfter (iOS `padding`): då räknas
   * tangentbordet två gånger och knappen skjuts ut genom skärmens överkant.
   *
   * Den bryter medvetet mot regeln vid `footLinks` — att foten ska stå still
   * mellan steg — och ska därför användas sparsamt: står den på ett steg i
   * ett flöde och inte på det före, flyttar sig primärknappen under fingret
   * när man går framåt. Sätt den på alla steg i ett flöde eller på inget.
   */
  footLift?: boolean;
  onBack?: () => void;
}) {
  const { styles } = useIntroStyles();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight(!!footLift);

  // Tangentbordets höjd mäts från skärmens underkant, men foten står redan
  // `insets.bottom` ovanför den — skärmen som bär steget paddar för det. Utan
  // avdraget lyfts knappen ett gest-streck för högt.
  const footLiftPx = footLift
    ? FOOT_REST_LIFT + Math.max(0, keyboardHeight - insets.bottom)
    : 0;

  const head = (
    <>
      <Text style={[styles.title, titleSmall && styles.titleSmall]}>{title}</Text>
      {!!subtitle && (
        <Text style={[styles.subtitle, titleGap && styles.subtitleGap]}>{subtitle}</Text>
      )}
      {!!hint && <Text style={styles.hint}>{hint}</Text>}
    </>
  );

  return (
    <View style={styles.root}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollBody}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {head}
          {children}
        </ScrollView>
      ) : (
        <View style={styles.centeredBody}>
          {head}
          {children}
        </View>
      )}

      <View style={[styles.foot, { marginBottom: footLiftPx }]}>
        <TouchableOpacity
          style={[styles.primary, primaryDisabled && styles.primaryOff]}
          onPress={onPrimary}
          disabled={primaryDisabled}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryText}>{primaryLabel}</Text>
        </TouchableOpacity>

        {/* Raden är alltid renderad, även tom: annars hoppar primärknappen
            uppåt mellan de steg som har en sekundärlänk och de som inte har
            det, och knappen flyttar sig under fingret mitt i flödet.

            Uppdelningen vänster/höger finns för att två länkar delar raden —
            bakåt hör till kanten man kom ifrån, hoppet till den andra. Är
            sekundärlänken ensam finns ingen sådan spänning att uttrycka, och
            då centreras den i stället för att klistras mot högerkanten av en
            utfyllnad som inte fyller ut något. Det gäller i praktiken första
            steget, som inte har något att backa till. */}
        <View style={[styles.footLinks, !onBack && styles.footLinksLone]}>
          {!!onBack && (
            <>
              <TouchableOpacity onPress={onBack} style={styles.link} hitSlop={8}>
                <Text style={styles.linkText}>← Back</Text>
              </TouchableOpacity>
              <View style={{ flex: 1 }} />
            </>
          )}
          {!!secondaryLabel && !!onSecondary && (
            <TouchableOpacity onPress={onSecondary} style={styles.link} hitSlop={8}>
              <Text style={styles.linkText}>{secondaryLabel}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}


/**
 * En rubrik och en mening — samma typografi som de numrerade raderna, men
 * utan siffran. Numret hör till en lista av regler; det här är roller, och en
 * numrering hade antytt en ordning som inte finns.
 *
 * Den bodde först inne i [app/circle-create.tsx](../../app/circle-create.tsx)
 * och flyttade hit när [app/circle-welcome.tsx](../../app/circle-welcome.tsx)
 * fick samma tre block. Två kopior av YOU / THE CIRCLE / TOGETHER hade glidit
 * isär, och hela poängen med mottagarens sida är att den ska vara igenkännbar
 * som skaparens — samma skäl som `duration-wheel.tsx` finns för.
 *
 * Texten är en prop och inte ett JSX-barn, av samma skäl som stegen här under
 * lägger sin copy i strängar: en apostrof i en JSX-textnod är ett lint-fel, i
 * en sträng är den bara en apostrof.
 */
export function IntroPart({ title, text }: { title: string; text: string }) {
  const { styles } = useIntroStyles();
  // Egen behållare i stället för `styles.beatBody`: den är skriven för att
  // ligga bredvid en siffra och bär `flex: 1`, vilket i en kolumn utan egen
  // höjd kan trycka ihop stycket till ingenting.
  return (
    <View style={styles.part}>
      <Text style={styles.beatTitle}>{title}</Text>
      <Text style={styles.beatText}>{text}</Text>
    </View>
  );
}
export const makeIntroStyles = (Palette: AppPalette) => StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
  },
  centeredBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxl,
    gap: Spacing.xl,
  },
  scrollBody: {
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: Spacing.xxl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xl,
    gap: Spacing.lg,
  },
  title: {
    fontSize: 30,
    fontWeight: '900',
    color: Palette.textPrimary,
    textAlign: 'center',
    lineHeight: 38,
  },
  // `lineHeight` följer med sin `fontSize` lika många punkter ner, annars blir
  // raderna trängre ju mindre texten blir.
  titleSmall: {
    fontSize: 24,
    lineHeight: 32,
  },
  subtitle: {
    fontSize: 16,
    color: Palette.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  // Ovanpå kroppens vanliga `gap`, inte i stället för den: rubriken lyfts
  // isär från resten så att kontrollen under hamnar närmare mitten.
  subtitleGap: {
    marginTop: 48,
  },
  hint: {
    fontSize: 13,
    color: Palette.textTertiary,
    textAlign: 'center',
    lineHeight: 20,
  },

  // ── Foten ─────────────────────────────────────────────────────────────────
  foot: {
    paddingHorizontal: Spacing.xxl,
    paddingTop: Spacing.lg,
  },
  primary: {
    backgroundColor: Palette.accent,
    paddingVertical: 16,
    borderRadius: Radius.pill,
    alignItems: 'center',
    width: '100%',
  },
  primaryOff: {
    backgroundColor: Palette.ink12,
  },
  primaryText: {
    color: Palette.onAccent,
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  footLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  footLinksLone: {
    justifyContent: 'center',
  },
  link: {
    paddingVertical: 12,
  },
  linkText: {
    fontSize: 14,
    color: Palette.textTertiary,
  },

  // ── Delade byggstenar ute i stegen ────────────────────────────────────────
  /** Numrerad rad: en siffra i en cirkel, en rubrik och en mening. */
  beat: {
    flexDirection: 'row',
    gap: Spacing.lg,
    alignItems: 'flex-start',
    width: '100%',
  },
  beatMark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Palette.accentTint,
    borderWidth: 1,
    borderColor: Palette.accentBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  beatMarkText: {
    fontSize: 13,
    fontWeight: '900',
    color: Palette.accent,
  },
  beatBody: {
    flex: 1,
    gap: 4,
  },
  beatTitle: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.5,
    color: Palette.textPrimary,
    textTransform: 'uppercase',
  },
  beatText: {
    fontSize: 14,
    lineHeight: 21,
    color: Palette.textSecondary,
  },
  /** Rubrik + mening, utan siffra. Buren av `IntroPart` ovan. */
  part: {
    width: '100%',
    gap: 4,
  },
  /** Yta för grupperat innehåll — samma språk som panelerna i Kretsen. */
  panel: {
    width: '100%',
    backgroundColor: Palette.surface,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    gap: Spacing.xl,
    overflow: 'hidden',
  },
});
