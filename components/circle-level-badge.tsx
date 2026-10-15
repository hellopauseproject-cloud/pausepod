import { FontAwesome5 } from '@expo/vector-icons';
import { View } from 'react-native';

import { alpha, AppPalette } from '../constants/appTheme';
import { usePalette } from '../contexts/ThemeContext';
import { MAX_CIRCLE_LEVEL } from '../lib/circleLevels';

/**
 * Cirkelns nivåmärke — ett riktigt emblem, inte en siffra i en ruta.
 *
 * **Ritat utan `react-native-svg`**, av samma skäl som
 * [progress-ring.tsx](progress-ring.tsx): det är en native-modul och hade
 * krävt en ny dev-build. Det finns ingen gradient-modul i projektet heller,
 * så varje effekt här är byggd av vanliga `View`-ar:
 *
 * - **Stjärnan** är N kvadrater lagda på varandra och vridna `90 / N` grader
 *   emellan — en kvadrat ger fyra uddar, två ger åtta, fyra ger sexton. En
 *   kvadrat med sidan `0.66 × size` har hörnen `0.47 × size` från mitten
 *   medan skivan bara når `0.34`, och det glappet *är* uddarna. Ändrar man
 *   skivans storlek måste kvadraternas följa med, annars slukas stjärnan
 *   eller spretar utanför.
 * - **Regnbågsringen** på sista steget utnyttjar att React Native färgar
 *   varje kant för sig och byter färg längs kvadratens diagonaler — samma
 *   egenhet som progressringen bygger på. En rund `View` med fyra olika
 *   `border*Color` blir alltså fyra bågar. Två sådana ringar, den yttre
 *   vriden 45°, ger åtta bågar och därmed en hel regnbåge utan gradient.
 *
 * Märkena trappas upp medvetet: alla har färg, men tonen vandrar uppför
 * spektrumet (mossgrön → grön → turkos → blå → lila → orkidé → rosa → guld)
 * medan stjärnan växer, ringen blir dubbel och glöden tänds. Steg 10 ska se
 * orimligt mycket häftigare ut än steg 1 när man ser dem bredvid varandra.
 */

type Tone =
  | 'moss'
  | 'green'
  | 'teal'
  | 'blue'
  | 'sky'
  | 'violet'
  | 'orchid'
  | 'rose'
  | 'gold'
  | 'rainbow';

type BadgeSpec = {
  icon: React.ComponentProps<typeof FontAwesome5>['name'];
  tone: Tone;
  /** Antal kvadrater i stjärnan bakom. 0 = ingen stjärna, 4 = sexton uddar. */
  rays: number;
  /** 1 = kant runt skivan, 2 = dessutom en yttre ring. */
  ring: 1 | 2;
  /** Fylld skiva (ikonen blir vit) eller tonad (ikonen får tonens färg). */
  filled: boolean;
  /** Slagskugga i tonens färg. Sparad åt de tre sista stegen. */
  glow?: boolean;
};

/**
 * De åtta hårdkodade regnbågsfärgerna. Till skillnad från allt annat i appen
 * är de *inte* palettnycklar och byter inte med ljust/mörkt läge: en regnbåge
 * är samma regnbåge oavsett bakgrund, och en temaberoende sådan vore ingen
 * regnbåge. De används bara av steg 10.
 */
const RAINBOW = [
  '#e74c3c',
  '#f39c12',
  '#f9ca24',
  '#2ecc71',
  '#1abc9c',
  '#3498db',
  '#5b5bd6',
  '#9b59b6',
];

/** Index 0 är nivå 1. Samma ordning och längd som `CIRCLE_LEVELS`. */
const BADGE_SPECS: readonly BadgeSpec[] = [
  { icon: 'seedling', tone: 'moss', rays: 0, ring: 1, filled: false },
  { icon: 'leaf', tone: 'green', rays: 0, ring: 1, filled: false },
  { icon: 'shoe-prints', tone: 'teal', rays: 0, ring: 1, filled: true },
  // Ingen stjärna: en ensam kvadrat är inga uddar utan en ruta bakom skivan.
  { icon: 'fire', tone: 'blue', rays: 0, ring: 1, filled: true },
  { icon: 'bolt', tone: 'sky', rays: 2, ring: 1, filled: true },
  { icon: 'shield-alt', tone: 'violet', rays: 2, ring: 2, filled: true },
  { icon: 'medal', tone: 'orchid', rays: 3, ring: 2, filled: true },
  { icon: 'trophy', tone: 'rose', rays: 3, ring: 2, filled: true, glow: true },
  { icon: 'crown', tone: 'gold', rays: 4, ring: 2, filled: true, glow: true },
  { icon: 'gem', tone: 'rainbow', rays: 4, ring: 2, filled: true, glow: true },
];

function toneColor(tone: Tone, Palette: AppPalette): string {
  switch (tone) {
    case 'moss':
      return Palette.peer;
    case 'green':
      return Palette.slideAccent.green;
    case 'teal':
      return Palette.slideAccent.teal;
    case 'blue':
      return Palette.accent;
    case 'sky':
      return Palette.accentSoft;
    case 'violet':
      // `Palette.slideAccent.violet` och inte `Palette.community`.
      // Steget lånade stödets kulör, vilket gick bra så länge den var lila —
      // men `community` är varm kakao sedan Friends-rummet blev varmt, och
      // ett brunt steg mellan ljusblått och orkidé bryter spektrumet stegen
      // är byggda av. Den här nyckeln *är* en lila och ändras inte av vad
      // stödet råkar ha för färg.
      return Palette.slideAccent.violet;
    case 'orchid':
      return Palette.slideAccent.orchid;
    case 'rose':
      return Palette.slideAccent.rose;
    case 'gold':
      return Palette.highlight;
    case 'rainbow':
      // Regnbågen ritas av egna lager; den här färgen bär bara skivan och
      // glöden under dem.
      return RAINBOW[7];
  }
}

export function CircleLevelBadge({
  level,
  size = 40,
  /** Låst nivå: samma form, all färg borta. Gör listan läsbar på en blick. */
  locked = false,
}: {
  level: number;
  size?: number;
  locked?: boolean;
}) {
  const Palette = usePalette();
  const i = Math.max(1, Math.min(MAX_CIRCLE_LEVEL, Math.round(level))) - 1;
  const spec = BADGE_SPECS[i];
  const rainbow = spec.tone === 'rainbow' && !locked;

  const tint = locked ? Palette.textDisabled : toneColor(spec.tone, Palette);
  const disc = size * 0.68;
  const ray = size * 0.66;
  const iconSize = size * 0.3;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Stjärnan. I regnbågsläget får varannan kvadrat sin egen kulör, så
          att uddarna skiftar i stället för att vara enfärgade. */}
      {!locked &&
        Array.from({ length: spec.rays }).map((_, r) => (
          <View
            key={r}
            style={{
              position: 'absolute',
              width: ray,
              height: ray,
              borderRadius: size * 0.07,
              backgroundColor: alpha(
                rainbow ? RAINBOW[(r * 2) % RAINBOW.length] : tint,
                spec.glow ? 0.3 : 0.22,
              ),
              transform: [{ rotate: `${(90 / spec.rays) * r}deg` }],
            }}
          />
        ))}

      {/* Yttre ringen. I regnbågsläget blir den två ringar med fyra kanter
          var — den andra vriden 45° — vilket ger åtta bågar hela varvet. */}
      {spec.ring === 2 &&
        (rainbow ? (
          [0, 45].map((deg, k) => (
            <View
              key={deg}
              style={{
                position: 'absolute',
                width: size * 0.94,
                height: size * 0.94,
                borderRadius: size * 0.47,
                borderWidth: 2,
                borderTopColor: RAINBOW[k],
                borderRightColor: RAINBOW[k + 2],
                borderBottomColor: RAINBOW[k + 4],
                borderLeftColor: RAINBOW[k + 6],
                transform: [{ rotate: `${deg}deg` }],
              }}
            />
          ))
        ) : (
          <View
            style={{
              position: 'absolute',
              width: size * 0.94,
              height: size * 0.94,
              borderRadius: size * 0.47,
              borderWidth: 1,
              borderColor: alpha(tint, 0.5),
            }}
          />
        ))}

      {/* Skivan. Glöden ligger här och inte på behållaren, annars lyser den
          runt stjärnans hörn i stället för runt märket. */}
      <View
        style={[
          {
            width: disc,
            height: disc,
            borderRadius: disc / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: locked
              ? Palette.ink07
              : spec.filled
                ? tint
                : alpha(tint, 0.16),
            borderWidth: 1.5,
            borderColor: alpha(tint, spec.filled ? 0.9 : 0.55),
          },
          spec.glow && !locked
            ? {
                shadowColor: tint,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.75,
                shadowRadius: size * 0.18,
                elevation: 8,
              }
            : null,
        ]}
      >
        <FontAwesome5
          name={spec.icon}
          size={iconSize}
          solid
          color={locked ? Palette.textDisabled : spec.filled ? Palette.onAccent : tint}
        />
      </View>
    </View>
  );
}
