import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { alpha, RoomName, roomPalette } from '../constants/appTheme';
import { usePalette, useTheme } from '../contexts/ThemeContext';
import { useHomeMode } from '../lib/homeMode';

/**
 * Flikraden, ritad av appen i stället för av react-navigation.
 *
 * Den byggdes för en enda sak som standardraden inte kan: **en markering som
 * glider** bakom den aktiva fliken, i rummets kulör, och en botten som tonar
 * över mellan rummen i stället för att byta på en bildruta. Allt annat är
 * oförändrat — samma tre flikar, samma ikoner och etiketter ur
 * `options` i app/(tabs)/_layout.tsx, samma brickor (`tabBarBadge`,
 * `tabBarBadgeStyle`) och samma mått, som skickas hit därifrån.
 *
 * Raden ligger kvar medan flikarna byts och kan därför inte ligga i någon
 * `RoomProvider`; rummet läses ur den aktiva rutten, samma princip som
 * `ROOM_BY_PATH` i layouten.
 *
 * Glidningen och tonen är Reanimated på UI-tråden. Med reducerad rörelse
 * hoppar båda direkt.
 */

const SLIDE_MS = 500;
const SLIDE_EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
// Hur långt in markeringen står från sin flikcell på varje sida.
const PILL_INSET = 8;

const ROOM_BY_ROUTE: Record<string, RoomName> = {
  index: 'pause',
  circle: 'circle',
  friends: 'friends',
};

type Props = BottomTabBarProps & {
  /** Höjd och bottenpaddning, uträknade i layouten (golv + lyft). */
  height: number;
  paddingBottom: number;
};

export function RoomTabBar({ state, descriptors, navigation, height, paddingBottom }: Props) {
  const Palette = usePalette();
  const { mode } = useTheme();
  const reduceMotion = useReducedMotion();
  // Hem i nattläge står i `night`-rummet (lib/homeMode.ts), och raden följer
  // med — annars stod en ljus flikrad under en nattblå skärm i ljust läge.
  const homeMode = useHomeMode();
  const routeName = state.routes[state.index]?.name;
  const room: RoomName = routeName === 'index' && homeMode === 'night'
    ? 'night'
    : ROOM_BY_ROUTE[routeName] ?? 'pause';
  const Room = roomPalette(mode, room);
  // Nattrummet är mörkt i båda lägena, så det inaktiva bläcket och
  // skiljelinjen måste också komma därifrån — appens ljusa bläck hade varit
  // plommonbrunt på marinblått.
  const Ink = room === 'night' ? Room : Palette;
  const styles = useMemo(() => makeStyles(), []);

  // Cellbredden mäts — raden är hela skärmen, men det är ytan inne i
  // paddningen som delas i tre.
  const [rowW, setRowW] = useState(0);
  const slotW = rowW / Math.max(1, state.routes.length);
  const onRowLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    setRowW(prev => (prev === w ? prev : w));
  };

  // Första placeringen hoppar: annars glider markeringen in från vänster
  // kant vid varje appstart.
  const x = useSharedValue(0);
  const placedRef = useRef(false);
  useEffect(() => {
    if (!slotW) return;
    const target = state.index * slotW;
    if (!placedRef.current || reduceMotion) {
      placedRef.current = true;
      x.value = target;
      return;
    }
    x.value = withTiming(target, { duration: SLIDE_MS, easing: SLIDE_EASING });
  }, [state.index, slotW, reduceMotion, x]);

  const pillColor = alpha(Room.hue, Room.mode === 'dark' ? 0.16 : 0.13);
  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
    backgroundColor: reduceMotion ? pillColor : withTiming(pillColor, { duration: SLIDE_MS }),
  }), [pillColor, reduceMotion]);
  const barStyle = useAnimatedStyle(() => ({
    backgroundColor: reduceMotion ? Room.bg : withTiming(Room.bg, { duration: SLIDE_MS }),
  }), [Room.bg, reduceMotion]);

  return (
    <Animated.View
      style={[
        styles.bar,
        { height, paddingBottom, borderTopColor: Ink.divider },
        barStyle,
      ]}
    >
      <View style={styles.row} onLayout={onRowLayout}>
        {slotW > 0 && (
          <Animated.View
            pointerEvents="none"
            style={[styles.pill, { width: slotW - PILL_INSET * 2 }, pillStyle]}
          />
        )}
        {state.routes.map((route, i) => {
          const { options } = descriptors[route.key];
          const focused = state.index === i;
          const color = focused ? Room.hue : Ink.textTertiary;
          const label = typeof options.title === 'string' ? options.title : route.name;
          const badge = options.tabBarBadge;

          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          };
          const onLongPress = () => navigation.emit({ type: 'tabLongPress', target: route.key });

          return (
            <Pressable
              key={route.key}
              style={styles.tab}
              onPress={onPress}
              onLongPress={onLongPress}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={badge !== undefined ? `${label}, ${badge} new` : label}
            >
              <View>
                {options.tabBarIcon?.({ focused, color, size: 20 })}
                {badge !== undefined && (
                  <View style={[styles.badge, options.tabBarBadgeStyle as object]}>
                    <Text style={[styles.badgeText, { color: Palette.onAccent }, options.tabBarBadgeStyle as object]}>
                      {String(badge)}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={[styles.label, { color }]} numberOfLines={1}>{label.toUpperCase()}</Text>
            </Pressable>
          );
        })}
      </View>
    </Animated.View>
  );
}

const makeStyles = () => StyleSheet.create({
  bar: { borderTopWidth: 1, paddingTop: 8 },
  row: { flex: 1, flexDirection: 'row' },
  pill: {
    position: 'absolute', top: 0, bottom: 0, left: PILL_INSET,
    borderRadius: 22,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  // Samma etikett som standardraden bar (12 / 1.5 / 700 / versaler).
  label: { fontSize: 12, letterSpacing: 1.5, fontWeight: '700', marginTop: 2 },
  // Brickan sitter i ikonens övre högra hörn, som i standardraden. Färg och
  // mått kommer ur `tabBarBadgeStyle` i layouten — de två brickorna delar
  // en stil där, och den ska fortsätta gälla.
  badge: {
    position: 'absolute', top: -6, right: -14,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 9,
  },
  badgeText: { fontWeight: '700', textAlign: 'center' },
});
