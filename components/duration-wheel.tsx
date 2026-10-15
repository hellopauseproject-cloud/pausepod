import * as Haptics from 'expo-haptics';
import { useMemo, useRef } from 'react';
import {
  NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { AppPalette, Radius } from '../constants/appTheme';
import { usePalette } from '../contexts/ThemeContext';
import { GOAL_OPTIONS, formatDuration } from '../lib/circles';

const WHEEL_ITEM_H = 44;
const WHEEL_VISIBLE = 5; // udda tal, annars finns ingen mittrad att markera

/**
 * Ridån man väljer dagsmål med. En ScrollView som snäpper per rad i stället
 * för ett native-picker: `@react-native-picker/picker` är en native-modul och
 * hade tvingat fram en ny dev-build för den här enda kontrollen — samma skäl
 * som [progress-ring.tsx](progress-ring.tsx) ritar sin ring för hand.
 *
 * Värdet uppdateras medan man drar, inte först när ratten stannat — annars
 * står siffran under ratten och släpar efter fingret. Haptiken per detent är
 * det som gör att den känns som en ratt och inte som en lista.
 *
 * Ligger i en egen fil för att både Kretsen och Hem öppnar samma ratt på samma
 * tal. Den bodde inne i `app/(tabs)/circle.tsx` medan kretsen var enda vägen
 * till målet; en andra kopia på Hem hade blivit två rattar som långsamt glider
 * isär, precis som `intro-chrome.tsx` finns för att stegen inte ska bli sju
 * skelett.
 */
export function DurationWheel({
  index,
  onIndexChange,
}: {
  index: number;
  onIndexChange: (i: number) => void;
}) {
  const options = GOAL_OPTIONS;
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  const ref = useRef<ScrollView>(null);
  const settled = useRef(false);
  const lastIndex = useRef(index);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.max(0, Math.min(options.length - 1,
      Math.round(e.nativeEvent.contentOffset.y / WHEEL_ITEM_H)));
    if (i !== lastIndex.current) {
      lastIndex.current = i;
      Haptics.selectionAsync();
      onIndexChange(i);
    }
  };

  return (
    <View style={styles.wheel}>
      {/* Markeringsfönstret ligger under listan och fångar inga tryck. */}
      <View pointerEvents="none" style={styles.wheelWindow} />
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_H}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={handleScroll}
        // scrollTo före första layouten gör ingenting, så startpositionen
        // sätts när innehållet fått sin höjd — en gång, annars skulle ratten
        // hoppa tillbaka till utgångsläget mitt under ett drag.
        onContentSizeChange={() => {
          if (settled.current) return;
          settled.current = true;
          ref.current?.scrollTo({ y: index * WHEEL_ITEM_H, animated: false });
        }}
        contentContainerStyle={{ paddingVertical: WHEEL_ITEM_H * Math.floor(WHEEL_VISIBLE / 2) }}
      >
        {options.map((sec, i) => {
          const distance = Math.abs(i - index);
          return (
            <View key={sec} style={styles.wheelItem}>
              <Text
                style={[
                  styles.wheelItemText,
                  distance === 0 && styles.wheelItemTextOn,
                  // Mjuk uttoning mot kanterna, utan expo-linear-gradient.
                  distance > 0 && { opacity: Math.max(0.18, 0.62 - (distance - 1) * 0.18) },
                ]}
              >
                {formatDuration(sec)}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const makeStyles = (Palette: AppPalette) => StyleSheet.create({
  wheel: { height: WHEEL_ITEM_H * WHEEL_VISIBLE, justifyContent: 'center' },
  wheelWindow: {
    position: 'absolute', left: 0, right: 0, height: WHEEL_ITEM_H,
    top: WHEEL_ITEM_H * Math.floor(WHEEL_VISIBLE / 2),
    backgroundColor: Palette.accentTint, borderRadius: Radius.md,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: Palette.accentBorder,
  },
  wheelItem: { height: WHEEL_ITEM_H, alignItems: 'center', justifyContent: 'center' },
  wheelItemText: { fontSize: 19, fontWeight: '700', color: Palette.textSecondary },
  wheelItemTextOn: { fontSize: 22, fontWeight: '900', color: Palette.textPrimary, letterSpacing: 0.5 },
});
