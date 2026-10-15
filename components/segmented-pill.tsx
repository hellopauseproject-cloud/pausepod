import { memo, useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { usePalette } from '../contexts/ThemeContext';

/**
 * Två lägen i en kapsel, med en markering som glider mellan dem.
 *
 * Ersätter `This week | Today`-raderna i Kretsen. De var versal text med ett
 * streck emellan, och läste som två rubriker snarare än som ett val.
 *
 * **Markeringen är fylld i rummets kulör** (designreferensen), och texten på
 * den byter efter läget: vit i ljust, rummets mörka botten i mörkt. Vit text
 * på mörklägets ljusa grönt (`#6cc99a`) går under 3:1, medan mörk botten på
 * samma grönt klarar det med god marginal. I ljust läge är det skälet att
 * Kretsens `hue` är `#23845a` och inte `#2e8b57`: vitt på den förra är 4.7:1,
 * på den senare 4.2:1 — under golvet för 12 px text. Den som lägger kapseln
 * i ett annat rum måste räkna om samma sak.
 *
 * Glidningen är en `translateX` på UI-tråden; med reducerad rörelse hoppar
 * den direkt.
 */

const SLIDE_MS = 450;
const SLIDE_EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
const PAD = 4;
const HEIGHT = 38;

type Option<K extends string> = { key: K; label: string };

type Props<K extends string> = {
  options: [Option<K>, Option<K>];
  value: K;
  onChange: (key: K) => void;
  /** Kapselns hela bredd. */
  width: number;
};

function SegmentedPillInner<K extends string>({ options, value, onChange, width }: Props<K>) {
  const Palette = usePalette();
  const reduceMotion = useReducedMotion();
  const half = (width - PAD * 2) / 2;
  const index = options[1].key === value ? 1 : 0;

  const x = useSharedValue(index * half);
  useEffect(() => {
    x.value = reduceMotion
      ? index * half
      : withTiming(index * half, { duration: SLIDE_MS, easing: SLIDE_EASING });
  }, [index, half, reduceMotion, x]);

  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const onThumb = Palette.mode === 'dark' ? Palette.bg : Palette.onAccent;

  return (
    <View
      style={[styles.track, { width, backgroundColor: Palette.surface }]}
      accessibilityRole="tablist"
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.thumb, { width: half, backgroundColor: Palette.hue }, thumbStyle]}
      />
      {options.map(o => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            style={[styles.segment, { width: half }]}
            onPress={() => { if (!on) onChange(o.key); }}
            hitSlop={{ top: 6, bottom: 6 }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
          >
            <Text
              style={[styles.label, { color: on ? onThumb : Palette.hue }]}
              numberOfLines={1}
            >
              {o.label.toUpperCase()}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export const SegmentedPill = memo(SegmentedPillInner) as typeof SegmentedPillInner;

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    height: HEIGHT,
    padding: PAD,
    borderRadius: HEIGHT / 2,
  },
  thumb: {
    position: 'absolute',
    top: PAD,
    left: PAD,
    bottom: PAD,
    borderRadius: (HEIGHT - PAD * 2) / 2,
  },
  segment: { alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 1.6 },
});
