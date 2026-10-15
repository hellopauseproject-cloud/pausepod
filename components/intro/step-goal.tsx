import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Radius, Spacing } from '../../constants/appTheme';
import { GOAL_OPTIONS, formatDuration } from '../../lib/circles';
import { IntroStep, useIntroStyles } from './intro-chrome';

/**
 * Löftet uttrycks per dag, för det är i den takten vanan lever, men mäts per
 * vecka: kretsens ribba per person är det här talet gånger sju, och en missad
 * tisdag kostar ingenting så länge veckan går ihop.
 *
 * Siffran parkeras lokalt (se lib/introPrefs.ts) och plockas upp av första
 * skärmen som ser att den saknas — Hem eller kretsfliken. Det var förr ett
 * tvång: målet bodde på medlemsraden i en krets, och den som just skapat ett
 * konto är inte med i någon. Nu är det bara samma ordning som resten av
 * introduktionen håller, att lokalt skrivs före servern.
 *
 * **Den förklaringen står på kvittot, inte här.** Steget hade förut fyra
 * stycken text: hur potten fungerar, att varje medlem måste klara sitt eget,
 * och när målet börjar räknas. Allt tre var sant och inget av det behövdes för
 * att välja en siffra — det är kretsflikens kunskap, och den som ännu inte är
 * med i en krets har ingenstans att lägga den. Kvar står frågan, ratten, och
 * vad valet blir på en vecka. Att målet börjar räknas först i en krets säger
 * `step-done` i stället, där det faktiskt spelar roll.
 *
 * Underrubriken är den enda meningen som överlevde, och den bär det som
 * annars är lättast att missförstå: att talet är ditt eget. En krets sätter
 * inte medlemmarnas mål och röstar inte om dem — potten är summan av sju
 * personliga löften, inte ett gemensamt som delas ut.
 */
export function StepGoal({
  goal, setGoal, onNext, onBack,
}: {
  goal: number | null;
  setGoal: (v: number | null) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const { Palette, styles } = useIntroStyles();

  return (
    <IntroStep
      scroll
      title={'How much of a pause\neach day?'}
      titleGap
      subtitle="This is your personal goal."
      primaryLabel="Next →"
      onPrimary={onNext}
      onBack={onBack}
      secondaryLabel={goal === null ? 'Skip for now' : undefined}
      onSecondary={goal === null ? onNext : undefined}
    >
      <View style={local.grid}>
        {GOAL_OPTIONS.map(sec => {
          const on = goal === sec;
          return (
            <TouchableOpacity
              key={sec}
              onPress={() => setGoal(on ? null : sec)}
              activeOpacity={0.8}
              style={[
                local.chip,
                { backgroundColor: Palette.surfaceAlt, borderColor: Palette.surfaceAlt },
                on && { backgroundColor: Palette.accentTint, borderColor: Palette.accent },
              ]}
            >
              <Text
                style={[
                  local.chipText,
                  { color: Palette.textSecondary },
                  on && { color: Palette.textPrimary },
                ]}
              >
                {formatDuration(sec)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {goal !== null && (
        <View style={[local.echo, { borderColor: Palette.surfaceBorder }]}>
          <Text style={[local.echoNumber, { color: Palette.accent }]}>
            {formatDuration(goal * 7)}
          </Text>
          <Text style={[local.echoLabel, { color: Palette.textTertiary }]}>A WEEK</Text>
        </View>
      )}

      <Text style={styles.hint}>Change it whenever you like.</Text>
    </IntroStep>
  );
}

const local = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
  },
  chip: {
    borderWidth: 1.5,
    borderRadius: Radius.pill,
    paddingVertical: 11,
    paddingHorizontal: 20,
    minWidth: 78,
    alignItems: 'center',
  },
  chipText: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  echo: {
    alignItems: 'center',
    gap: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.lg,
    width: '100%',
  },
  echoNumber: {
    fontSize: 30,
    fontWeight: '900',
  },
  echoLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
  },
});
