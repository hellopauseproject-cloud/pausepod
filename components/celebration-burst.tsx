import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, {
  Easing, SharedValue, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming,
} from 'react-native-reanimated';

import { usePalette } from '../contexts/ThemeContext';

/**
 * En kort konfettiskur — belöningen när man kommer tillbaka från en paus
 * (ringen på Hem) och när man taggat vad man gjorde (taggkortet).
 *
 * - **Kulörerna är wrapped-spektrumet** (`slideAccent`) plus guldet och
 *   accenten: färger som redan läses som fest i appen. **Inget grönt** —
 *   grönt som bekräftelse hör lådan till (CLAUDE.md, *Design*), så
 *   `slideAccent.green` står med flit utanför.
 * - **Fasta tal, inget `Math.random()`**, samma linje som bubblorna i
 *   liquid-bars: skuren ser likadan ut varje gång, och ingenting hoppar vid
 *   en omrendering.
 * - **Ingenting med reducerad rörelse.** Siffran och haptiken bär
 *   belöningen då.
 * - Ritas i en ruta på `size` × `size` centrerad där föräldern ställer den,
 *   med `pointerEvents="none"` — den får aldrig äta ett tryck.
 *
 * Skuren går när `burstKey` byter värde (0 = aldrig).
 */
const BURST_MS = 1300;
// Ett snabbt utbrott som bromsar in, och en tyngd som drar ner bitarna mot
// slutet — det är skillnaden mellan konfetti och en explosion.
const OUT = Easing.out(Easing.cubic);

type Piece = { angle: number; dist: number; size: number; color: number; rect: boolean; spin: number; delay: number };

/** `count` bitar runt hela varvet, med fast men ojämn spridning. */
function makePieces(count: number): Piece[] {
  return Array.from({ length: count }, (_, i) => {
    // Gyllene vinkeln ger en jämn men inte rutnätsaktig spridning.
    const angle = i * 2.39996 + (i % 3) * 0.17;
    const wobble = ((i * 37) % 23) / 23; // 0–1, fast per bit
    return {
      angle,
      dist: 0.55 + wobble * 0.45,
      size: 6 + ((i * 5) % 5),
      color: i,
      rect: i % 3 !== 0,
      spin: (i % 2 ? 1 : -1) * (180 + ((i * 53) % 270)),
      delay: ((i * 7) % 5) * 0.02,
    };
  });
}

function BurstPiece({ piece, t, radius, color }: {
  piece: Piece; t: SharedValue<number>; radius: number; color: string;
}) {
  const style = useAnimatedStyle(() => {
    const local = Math.max(0, Math.min(1, (t.value - piece.delay) / (1 - piece.delay)));
    if (local <= 0 || local >= 1) return { opacity: 0 };
    const out = OUT(local);
    const d = radius * piece.dist * out;
    // Tyngden: bitarna sjunker mer ju längre skuren gått.
    const fall = radius * 0.35 * local * local;
    return {
      opacity: local < 0.7 ? 1 : 1 - (local - 0.7) / 0.3,
      transform: [
        { translateX: Math.cos(piece.angle) * d },
        { translateY: Math.sin(piece.angle) * d + fall },
        { rotate: `${piece.spin * local}deg` },
        { scale: local < 0.15 ? local / 0.15 : 1 },
      ],
    };
  });
  return (
    <Reanimated.View
      style={[
        styles.piece,
        {
          width: piece.rect ? piece.size * 0.6 : piece.size,
          height: piece.rect ? piece.size * 1.4 : piece.size,
          borderRadius: piece.rect ? 1.5 : piece.size / 2,
          backgroundColor: color,
          marginLeft: -piece.size / 2,
          marginTop: -piece.size / 2,
        },
        style,
      ]}
    />
  );
}

export function CelebrationBurst({ burstKey, size, count = 22 }: {
  burstKey: number;
  /** Hur långt bitarna når: skurens diameter. */
  size: number;
  count?: number;
}) {
  const Palette = usePalette();
  const reduceMotion = useReducedMotion();
  const t = useSharedValue(0);
  const pieces = useMemo(() => makePieces(count), [count]);
  const colors = useMemo(() => [
    Palette.highlight,
    Palette.slideAccent.rose,
    Palette.slideAccent.teal,
    Palette.slideAccent.orchid,
    Palette.accent,
    Palette.slideAccent.violet,
    Palette.dangerSoft,
  ], [Palette]);

  useEffect(() => {
    if (!burstKey || reduceMotion) return;
    t.value = 0;
    t.value = withTiming(1, { duration: BURST_MS, easing: Easing.linear });
  }, [burstKey, reduceMotion, t]);

  if (reduceMotion) return null;

  return (
    <View pointerEvents="none" style={[styles.box, { width: size, height: size }]}>
      {pieces.map((p, i) => (
        <BurstPiece key={i} piece={p} t={t} radius={size / 2} color={colors[p.color % colors.length]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'visible' },
  piece: { position: 'absolute', left: '50%', top: '50%' },
});
