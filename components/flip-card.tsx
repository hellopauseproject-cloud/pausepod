import * as Haptics from 'expo-haptics';
import { ReactNode, useEffect, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Reanimated, {
  Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming,
} from 'react-native-reanimated';

/**
 * Ett kort som vänds när man trycker på det — pausens kort i statistiken,
 * med *vad tiden blev* på baksidan (lib/pauseFacts.ts).
 *
 * - **Framsidan står i flödet, baksidan ovanpå den.** Kortet blir lika högt
 *   som den högsta av dem: baksidans innehåll mäts, och framsidan får det
 *   som `minHeight`. Annars hade listan hoppat vid varje vändning, eller
 *   baksidan klippts.
 * - **Sidorna byts vid 90°** med opacitet, inte med `backfaceVisibility`:
 *   den är opålitlig på Android när vyn har skugga eller elevation.
 * - Knappar på framsidan (taggen, kuvertet) tar sina egna tryck; resten av
 *   kortet vänder det. Den sida som inte syns tar inga tryck.
 * - **Med reducerad rörelse tonar sidorna över** i stället för att snurra.
 */
const FLIP_MS = 420;
const FADE_MS = 200;
const EASE = Easing.inOut(Easing.cubic);
// Baksidans inre luft. Komponenten äger den, eftersom höjden räknas på den.
const BACK_PAD = 16;

export function FlipCard({
  flipped, onToggle, front, back, backStyle, backTint, accessibilityLabel,
}: {
  flipped: boolean;
  onToggle: () => void;
  /** Hela framsidan, med sin egen kortstil. */
  front: ReactNode;
  /** Baksidans innehåll. Ytan (färg, kant, radie) kommer ur `backStyle`. */
  back: ReactNode;
  backStyle: StyleProp<ViewStyle>;
  /** En ton ovanpå baksidans yta — eget lager, eftersom en vy bara har en bakgrund. */
  backTint?: string;
  accessibilityLabel: string;
}) {
  const reduceMotion = useReducedMotion();
  const p = useSharedValue(flipped ? 1 : 0);
  const [backH, setBackH] = useState(0);

  useEffect(() => {
    p.value = withTiming(flipped ? 1 : 0, {
      duration: reduceMotion ? FADE_MS : FLIP_MS,
      easing: EASE,
    });
  }, [flipped, reduceMotion, p]);

  const frontStyle = useAnimatedStyle(() => reduceMotion
    ? { opacity: 1 - p.value }
    : {
        opacity: p.value < 0.5 ? 1 : 0,
        transform: [{ perspective: 900 }, { rotateY: `${p.value * 180}deg` }],
      });
  const backAnim = useAnimatedStyle(() => reduceMotion
    ? { opacity: p.value }
    : {
        opacity: p.value >= 0.5 ? 1 : 0,
        transform: [{ perspective: 900 }, { rotateY: `${p.value * 180 - 180}deg` }],
      });

  const toggle = () => {
    Haptics.selectionAsync().catch(() => {});
    onToggle();
  };

  return (
    <View>
      <Reanimated.View style={frontStyle} pointerEvents={flipped ? 'none' : 'auto'}>
        <Pressable
          onPress={toggle}
          style={{ minHeight: backH }}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint="Flips the card."
          accessibilityElementsHidden={flipped}
          importantForAccessibility={flipped ? 'no-hide-descendants' : 'auto'}
        >
          {front}
        </Pressable>
      </Reanimated.View>
      <Reanimated.View
        style={[styles.back, backAnim]}
        pointerEvents={flipped ? 'auto' : 'none'}
        accessibilityElementsHidden={!flipped}
        importantForAccessibility={flipped ? 'auto' : 'no-hide-descendants'}
      >
        <Pressable
          onPress={toggle}
          style={[styles.backFill, backStyle]}
          accessibilityRole="button"
          accessibilityHint="Flips the card back."
        >
          {backTint && <View pointerEvents="none" style={[styles.tint, { backgroundColor: backTint }]} />}
          <View
            onLayout={(e: LayoutChangeEvent) => {
              const h = Math.ceil(e.nativeEvent.layout.height) + 2 * BACK_PAD + 2;
              setBackH(prev => (Math.abs(prev - h) > 1 ? h : prev));
            }}
          >
            {back}
          </View>
        </Pressable>
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Baksidan täcker framsidans yta exakt. Framsidans kort får därför ingen
  // marginal — listans luft ligger utanför FlipCard, annars hade baksidan
  // täckt den också.
  back: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  backFill: { flex: 1, justifyContent: 'center', padding: BACK_PAD },
  // Följer kortets rundning; `borderRadius` ärvs inte, så den sätts i
  // stats via `backStyle` och tonen klipps med `overflow` där.
  tint: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
});
