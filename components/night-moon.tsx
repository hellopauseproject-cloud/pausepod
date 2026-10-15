import { useId } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, Mask, RadialGradient, Rect, Stop } from 'react-native-svg';

/**
 * Månen på Hem i nattläge (app/(tabs)/index.tsx).
 *
 * Nattläget visar ingenting om natten som gått — inga timmar, ingen urtavla,
 * inga uppvaknanden; det bor i statistiken. Sidan finns för en enda sak,
 * SLEEP-knappen, och månen är det som säger vilken sida man står på. Den
 * ersatte först en målring och sedan en urtavla.
 *
 * Fyra lager: en mjuk gloria, skivan, skuggan som gör den till en skära
 * (en mask, inte en cirkel i bakgrundens färg — bakgrunden är en toning och
 * en målad skugga hade synts som en fläck), och några stjärnor på fasta
 * platser. **Inget rör sig** — det här är en sida man lämnar för att lägga
 * ifrån sig telefonen.
 */

// Stjärnornas platser som andelar av rutan, och deras storlek. Fasta tal, så
// att himlen ser likadan ut varje kväll.
const STARS: [number, number, number][] = [
  [0.08, 0.18, 1.6], [0.2, 0.06, 1.1], [0.9, 0.12, 1.4], [0.82, 0.3, 1],
  [0.05, 0.62, 1.2], [0.94, 0.7, 1.5], [0.16, 0.9, 1], [0.78, 0.92, 1.2],
];

type Props = {
  size: number;
  /** Skivans ljus. */
  color: string;
  /** Glorians kulör — rummets `hue`. */
  glow: string;
};

export function NightMoon({ size, color, glow }: Props) {
  const id = useId().replace(/:/g, '');
  const mid = size / 2;
  const r = size * 0.3;

  return (
    <View style={{ width: size, height: size }} accessible accessibilityLabel="Moon">
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={`halo-${id}`} cx={mid} cy={mid} r={mid} gradientUnits="userSpaceOnUse">
            <Stop offset={`${(r / mid) * 100}%`} stopColor={glow} stopOpacity={0.28} />
            <Stop offset={`${((r * 1.35) / mid) * 100}%`} stopColor={glow} stopOpacity={0.1} />
            <Stop offset="100%" stopColor={glow} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id={`disc-${id}`} cx={mid - r * 0.3} cy={mid - r * 0.3} r={r * 1.4} gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor={color} stopOpacity={1} />
            <Stop offset="100%" stopColor={color} stopOpacity={0.82} />
          </RadialGradient>
          {/* Skäran: allt syns utom en förskjuten cirkel. */}
          <Mask id={`crescent-${id}`}>
            <Rect x="0" y="0" width={size} height={size} fill="#fff" />
            <Circle cx={mid + r * 0.55} cy={mid - r * 0.3} r={r * 0.92} fill="#000" />
          </Mask>
        </Defs>

        <Circle cx={mid} cy={mid} r={mid} fill={`url(#halo-${id})`} />

        {STARS.map(([x, y, s], i) => (
          <Circle key={i} cx={x * size} cy={y * size} r={s} fill={color} opacity={0.55} />
        ))}

        <Circle cx={mid} cy={mid} r={r} fill={`url(#disc-${id})`} mask={`url(#crescent-${id})`} />
      </Svg>
    </View>
  );
}
