import { useId, useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { roomPalette } from '../constants/appTheme';
import { useTheme } from '../contexts/ThemeContext';

/**
 * Natthimlen bakom ett kort — nattkorten i statistikens lista
 * ([sleep-session-card.tsx](sleep-session-card.tsx)) och SLEEP-sektionens
 * sammanfattning (app/stats.tsx). Läggs som första barn i ett kort med
 * `overflow: 'hidden'` och en `borderRadius`; kortet klipper hörnen.
 *
 * **Himlen mäter sitt kort och ritas i pixlar.** Den ritades först som en
 * svg med `width="100%"` ovanpå `absoluteFill`, och procenten löstes inte upp
 * mot kortets verkliga höjd: toningen och stjärnorna slutade en bit ner och
 * himlen såg avklippt ut. Nu ritas ingenting förrän kortet har ett mått, och
 * då i exakt det måttet. Kortets egen `backgroundColor` (nattens `bg`) täcker
 * den första bildrutan.
 *
 * **Nattrummets färger i båda lägena** (`roomPalette(mode, 'night')`). Den
 * som lägger text på himlen måste läsa den ur samma palett — ljuslägets
 * bläck försvinner i marinblått.
 *
 * Stjärnorna står still och är desamma varje gång: platserna räknas ur
 * `seed`, inte ur `Math.random()`.
 */

const STAR_COUNT = 14;

// Liten deterministisk slump ur en sträng (mulberry32 på en enkel hash).
function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function NightSky({ seed }: { seed: string }) {
  const { mode } = useTheme();
  const Night = roomPalette(mode, 'night');
  const gradId = `sky${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [box, setBox] = useState({ w: 0, h: 0 });

  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    const h = Math.round(e.nativeEvent.layout.height);
    setBox(prev => (prev.w === w && prev.h === h ? prev : { w, h }));
  };

  // Andelar av rutan, så att samma seed ger samma himmel på ett högre kort.
  const stars = useMemo(() => {
    const rnd = seeded(seed);
    return Array.from({ length: STAR_COUNT }, () => ({
      x: 0.04 + rnd() * 0.92,
      y: 0.06 + rnd() * 0.88,
      r: 0.6 + rnd() * 1.1,
      o: 0.35 + rnd() * 0.55,
    }));
  }, [seed]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {box.w > 0 && box.h > 0 && (
        <Svg width={box.w} height={box.h}>
          <Defs>
            <LinearGradient id={gradId} x1="0" y1="0" x2={box.w * 0.35} y2={box.h} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={Night.sunken} />
              <Stop offset="0.55" stopColor={Night.bg} />
              <Stop offset="1" stopColor={Night.surfaceAlt} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={box.w} height={box.h} fill={`url(#${gradId})`} />
          {stars.map((s, i) => (
            <Circle key={i} cx={s.x * box.w} cy={s.y * box.h} r={s.r} fill="#ffffff" opacity={s.o} />
          ))}
        </Svg>
      )}
    </View>
  );
}
