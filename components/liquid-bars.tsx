import { useFocusEffect } from 'expo-router';
import { memo, useCallback, useEffect, useId, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { usePalette } from '../contexts/ThemeContext';

/**
 * Pausens två streck som fylls med vatten — appens förloppsform på Hem och i
 * Kretsen. Ett eller flera rundade lodräta streck, en vattenyta som stiger med
 * `fraction`, och två vågor ovanpå ytan.
 *
 * **Allt som rör sig är en transform på en View, inget är en svg-egenskap.**
 * Vågen ritas en gång som en statisk `Path`; nivån är en `translateY` och
 * driften en `translateX` på View-ar runt den, och klippningen är strecket
 * självt (`borderRadius` + `overflow: hidden`). Att animera svg-props hade
 * räknat om formen varje bildruta, och på Android är det den långsamma vägen —
 * med åtta streck i Kretsen hade det märkts. Så här animerar Reanimated bara
 * transformer på UI-tråden.
 *
 * **Vattnet flyter hela tiden** medan skärmen syns: de två vågorna går i var
 * sin oändliga slinga åt var sitt håll. Det stod still som förval en tid —
 * vågorna drev bara efter en ändring och lade sig sedan — och det ändrades på
 * begäran: strecken ska se ut som vatten, inte som en bild av vatten.
 * Slingorna startar när skärmen får fokus och stoppas när den tappar det:
 * flikar avmonteras inte, och åtta streck i Kretsen som flöt vidare bakom en
 * annan flik hade kostat batteri för ingenting. Med reducerad rörelse står
 * vågorna still, och nivån hoppar i stället för att glida — den uppdateras
 * ändå.
 *
 * Komponenten är dekorativ för skärmläsare: den som visar den äger
 * `accessibilityLabel` med siffrorna, precis som runt progress-ringen.
 */

// Vågornas form. Den främre är designreferensens (90 lång); den bakre är
// längre, högre och står lite över den främre. Två lika vågor ovanpå
// varandra läser som en kopia som glider; två olika läser som djup.
const FRONT_L = 90;
const FRONT_AMP = 3;
const BACK_L = 130;
const BACK_AMP = 4;
// Hur mycket högre den bakre vågens yta står än den främres.
const BACK_RISE = 2;
// Hur långt under strecket vattnet ligger vid 0 — så att vågtopparna inte
// sticker upp i botten av ett tomt streck.
const EMPTY_SINK = 12;
// Hur långt ner vattenkroppen når under vågen; måste täcka EMPTY_SINK plus
// vågens djup, annars syns en remsa av spåret under vattnet.
const BODY_EXTRA = 40;

// Hur lång tid ett varv tar för den främre respektive bakre vågen. De driver åt
// var sitt håll, och den bakre är svagare. Långsamt med flit: vatten i ett
// glas som står stilla på bordet, inte en ström. (Det fanns en stund också
// ett skvalp — ytan som gungade upp och ner — men det rörde sig för mycket
// och togs bort.)
const FRONT_LOOP_MS = 9000;
const BACK_LOOP_MS = 14000;
const BACK_OPACITY = 0.42;

// Djupet: vattnet mörknar mot botten, och en tunn ljus linje följer den
// främre vågens krön som en reflex. Båda ritas en gång och kostar ingenting
// per bildruta.
const DEPTH_SHADE = 0.22;
const SHINE_OPACITY = 0.45;

// Nivåns glid när värdet ändras. Kurvan är designreferensens
// cubic-bezier(.2,.7,.2,1) — snabb start, lång landning.
const LEVEL_MS = 1100;
const LEVEL_EASING = Easing.bezier(0.2, 0.7, 0.2, 1);


/** Bara kurvan: en sinusliknande yta över `width`, våglängd `l`. */
function waveCurve(width: number, l: number, amp: number): { d: string; end: number } {
  const half = l / 2;
  let d = `M0 ${amp} q ${l / 4} ${-amp} ${half} 0`;
  const segments = Math.ceil(width / half);
  for (let i = 1; i < segments; i++) d += ` t ${half} 0`;
  return { d, end: segments * half };
}

/** Vågytan fylld nedåt till `depth`. */
function wavePath(width: number, depth: number, l: number, amp: number): string {
  const { d, end } = waveCurve(width, l, amp);
  return `${d} L ${end} ${depth} L 0 ${depth} Z`;
}

/** En mörkare ton av en `#rrggbb`-kulör, för vattnets botten. */
function shade(color: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  const f = (c: number) => Math.round(c * (1 - amount));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// ── Glaset ────────────────────────────────────────────────────────────────
// Strecket ska läsa som ett glasrör med vatten i, inte som en färgad
// kapsel: en ljus kant runt om, mörkare sidor än mitt (rundning), och två
// reflexer — en lång mjuk till vänster och en kort svag till höger. Allt är
// statiskt och ritas en gång; ingenting här rör sig.
const GLASS_RIM = { light: 'rgba(255,255,255,0.65)', dark: 'rgba(255,255,255,0.18)' };
const GLASS_EDGE = { light: 0.1, dark: 0.22 };     // mörkning mot sidorna
const GLASS_HILITE = { light: 0.38, dark: 0.15 };  // reflexens starkaste punkt (sänkt en bit på begäran)

const GlassOverlay = memo(function GlassOverlay({
  width, height, id, dark,
}: { width: number; height: number; id: string; dark: boolean }) {
  const r = width / 2;
  const edge = dark ? GLASS_EDGE.dark : GLASS_EDGE.light;
  const hi = dark ? GLASS_HILITE.dark : GLASS_HILITE.light;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width={width} height={height}>
        <Defs>
          {/* Rundningen: mörkt i kanterna, genomskinligt i mitten. */}
          <LinearGradient id={`${id}e`} x1="0" y1="0" x2="1" y2="0">
            <Stop offset={0} stopColor="#000" stopOpacity={edge} />
            <Stop offset={0.28} stopColor="#000" stopOpacity={0} />
            <Stop offset={0.72} stopColor="#000" stopOpacity={0} />
            <Stop offset={1} stopColor="#000" stopOpacity={edge * 1.4} />
          </LinearGradient>
          {/* Reflexen: en mjuk vit strimma, starkast i sin egen mitt. */}
          <LinearGradient id={`${id}h`} x1="0" y1="0" x2="1" y2="0">
            <Stop offset={0} stopColor="#fff" stopOpacity={0} />
            <Stop offset={0.5} stopColor="#fff" stopOpacity={hi} />
            <Stop offset={1} stopColor="#fff" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} rx={r} fill={`url(#${id}e)`} />
        <Rect
          x={width * 0.14} y={height * 0.06} width={width * 0.18} height={height * 0.8}
          rx={width * 0.09} fill={`url(#${id}h)`}
        />
        <Rect
          x={width * 0.7} y={height * 0.1} width={width * 0.08} height={height * 0.3}
          rx={width * 0.04} fill={`url(#${id}h)`} opacity={0.55}
        />
      </Svg>
      <View
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: r, borderWidth: 1.5, borderColor: dark ? GLASS_RIM.dark : GLASS_RIM.light },
        ]}
      />
    </View>
  );
});

// ── Bubblorna ─────────────────────────────────────────────────────────────
// Små pärlor som stiger genom vattnet och tonar bort vid ytan. Hem har tre
// per streck; Kretsens smala streck får två (`bubbles={2}`), för åtta
// medlemmar gånger tre hade varit för mycket att både se och rita.
const BUBBLES_PER_BAR = 3;
const BUBBLE_BASE_MS = 5200;

const Bubble = memo(function Bubble({
  index, barIndex, barWidth, from, to,
}: { index: number; barIndex: number; barWidth: number; from: number; to: number }) {
  // Fasta, olika tal per bubbla i stället för `Math.random()`: ytan ska se
  // likadan ut när man kommer tillbaka till den, inte hoppa.
  const seed = index * 3 + barIndex * 5;
  const size = 3 + (seed % 3);
  const x = barWidth * (0.3 + ((seed * 0.17) % 0.45));
  const duration = BUBBLE_BASE_MS + (seed % 4) * 900;
  const delay = (seed % 5) * 1100;
  const p = useSharedValue(0);

  useFocusEffect(useCallback(() => {
    p.value = 0;
    p.value = withDelay(delay, withRepeat(
      withTiming(1, { duration, easing: Easing.inOut(Easing.quad) }), -1, false,
    ));
    return () => cancelAnimation(p);
  }, [delay, duration, p]));

  const style = useAnimatedStyle(() => ({
    opacity: p.value < 0.12 ? p.value / 0.12 * 0.7 : p.value > 0.85 ? (1 - p.value) / 0.15 * 0.7 : 0.7,
    transform: [
      { translateY: from + (to - from) * p.value },
      // En liten slingring i sidled, som en bubbla och inte en hiss.
      { translateX: Math.sin(p.value * Math.PI * 3) * 1.5 },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', top: 0, left: x, width: size, height: size, borderRadius: size / 2,
          backgroundColor: 'rgba(255,255,255,0.85)' },
        style,
      ]}
    />
  );
});

type Props = {
  /** 0–1. Värden utanför klämms. */
  fraction: number;
  /** Små bubblor som stiger i vattnet: `true` ger tre per streck, ett tal
   *  ger så många. */
  bubbles?: boolean | number;
  /** Antal streck — två för pausens symbol, ett per medlem i Kretsen. */
  count?: number;
  barWidth: number;
  height: number;
  /** Mellanrum mellan strecken. */
  gap?: number;
  /** Vattnets kulör. Förval: rummets `hue`. */
  color?: string;
  /** Det tomma strecket. Förval: rummets `hueTrack`. */
  trackColor?: string;
};

export const LiquidBars = memo(function LiquidBars({
  fraction,
  bubbles = false,
  count = 1,
  barWidth,
  height,
  gap = 0,
  color,
  trackColor,
}: Props) {
  const Palette = usePalette();
  const water = color ?? Palette.hue;
  const track = trackColor ?? Palette.hueTrack;
  const reduceMotion = useReducedMotion();

  // Vågen ritas bredare än strecket med två (av de längre) våglängderna, så
  // att den kan förskjutas en hel våglängd åt endera hållet utan att en kant
  // syns.
  const waveWidth = barWidth + BACK_L * 2;
  const depth = height + EMPTY_SINK + BODY_EXTRA;
  const frontPath = useMemo(() => wavePath(waveWidth, depth, FRONT_L, FRONT_AMP), [waveWidth, depth]);
  const backPath = useMemo(() => wavePath(waveWidth, depth, BACK_L, BACK_AMP), [waveWidth, depth]);
  const shinePath = useMemo(() => waveCurve(waveWidth, FRONT_L, FRONT_AMP).d, [waveWidth]);
  // Ett id per instans för toningen: flera streck-grupper på samma skärm får
  // inte dela ett svg-id. `useId` ger kolon, som inte duger i `url(#…)`.
  const gradId = `liquid${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const deep = useMemo(() => shade(water, DEPTH_SHADE), [water]);
  const bubbleCount = bubbles === true ? BUBBLES_PER_BAR : typeof bubbles === 'number' ? bubbles : 0;
  // Bubblornas takt ska skilja sig mellan instanserna — i Kretsen är varje
  // medlem en egen `LiquidBars` med ett enda streck, och utan det här hade
  // alla medlemmars bubblor stigit i exakt samma takt.
  const bubbleSeed = useMemo(
    () => gradId.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 7,
    [gradId],
  );
  const shineColor = Palette.mode === 'dark' ? `rgba(255,255,255,${SHINE_OPACITY * 0.7})` : `rgba(255,255,255,${SHINE_OPACITY})`;

  const level = useSharedValue(0);
  // Varje vågs fas i punkter, 0 → en våglängd och om igen. En egen slinga per
  // våg: en gemensam fas skalad med varvtidernas kvot hade hoppat när den
  // slog om, eftersom kvoten inte är ett helt tal.
  const frontPhase = useSharedValue(0);
  const backPhase = useSharedValue(0);

  const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));

  useEffect(() => {
    level.value = reduceMotion
      ? clamped
      : withTiming(clamped, { duration: LEVEL_MS, easing: LEVEL_EASING });
  }, [clamped, reduceMotion, level]);

  // Slingorna lever medan skärmen har fokus. Vågen är periodisk med en
  // våglängd, så att slå om från slutet till 0 syns inte.
  useFocusEffect(useCallback(() => {
    if (reduceMotion) return;
    frontPhase.value = 0;
    backPhase.value = 0;
    frontPhase.value = withRepeat(
      withTiming(FRONT_L, { duration: FRONT_LOOP_MS, easing: Easing.linear }), -1, false,
    );
    backPhase.value = withRepeat(
      withTiming(BACK_L, { duration: BACK_LOOP_MS, easing: Easing.linear }), -1, false,
    );
    return () => {
      cancelAnimation(frontPhase);
      cancelAnimation(backPhase);
    };
  }, [reduceMotion, frontPhase, backPhase]));

  const levelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (height + EMPTY_SINK) * (1 - level.value) }],
  }));

  // Den främre vågen driver åt vänster, den bakre åt höger och långsammare.
  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -FRONT_L - frontPhase.value }],
  }));
  const backStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -BACK_L + backPhase.value }, { translateY: -BACK_RISE }],
  }));

  const bars = [];
  for (let i = 0; i < count; i++) {
    bars.push(
      <View
        key={i}
        style={[
          styles.bar,
          {
            width: barWidth,
            height,
            borderRadius: barWidth / 2,
            backgroundColor: track,
            marginLeft: i === 0 ? 0 : gap,
          },
        ]}
      >
        <Animated.View style={[styles.water, { height: depth }, levelStyle]}>
          {/* Vågskikten är statiska bilder som bara flyttas, och därför
              cachas de som en färdig textur på grafikkretsen: flytten blir då
              en ren komposition i stället för en omritning av svg:n varje
              bildruta. Det var skillnaden mellan hackigt och jämnt på Android
              med åtta streck i Kretsen. */}
          <Animated.View
            style={[styles.wave, { width: waveWidth, opacity: BACK_OPACITY }, backStyle]}
            renderToHardwareTextureAndroid
            shouldRasterizeIOS
          >
            <Svg width={waveWidth} height={depth}>
              <Path d={backPath} fill={water} />
            </Svg>
          </Animated.View>
          <Animated.View
            style={[styles.wave, { width: waveWidth }, frontStyle]}
            renderToHardwareTextureAndroid
            shouldRasterizeIOS
          >
            <Svg width={waveWidth} height={depth}>
              <Defs>
                {/* Mörkare mot botten: toningen följer vattenkroppen, inte
                    strecket, så den ligger still i vattnet när det stiger. */}
                <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset={0} stopColor={water} />
                  <Stop offset={Math.min(1, height / depth)} stopColor={deep} />
                </LinearGradient>
              </Defs>
              <Path d={frontPath} fill={`url(#${gradId})`} />
              {/* Reflexen längs krönet, en halv linjebredd in i vattnet. */}
              <Path
                d={shinePath}
                fill="none"
                stroke={shineColor}
                strokeWidth={1.5}
                strokeLinecap="round"
                transform="translate(0, 0.75)"
              />
            </Svg>
          </Animated.View>
          {/* Bubblorna bor i vattnet: de följer med när nivån ändras, och
              klipps av strecket. De startar under strecket och stiger till
              strax under ytan. */}
          {!reduceMotion && Array.from({ length: bubbleCount }, (_, b) => (
            <Bubble
              key={b}
              index={b}
              barIndex={i + bubbleSeed}
              barWidth={barWidth}
              from={height + EMPTY_SINK}
              to={FRONT_AMP * 3}
            />
          ))}
        </Animated.View>
        {/* Glaset ligger ovanpå vattnet, så att reflexerna syns över det. */}
        <GlassOverlay width={barWidth} height={height} id={`${gradId}g`} dark={Palette.mode === 'dark'} />
      </View>,
    );
  }

  return (
    <View
      style={styles.row}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      {bars}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  // `overflow: hidden` med `borderRadius` är klippningen. Android klipper
  // barn mot en rundad förälder sedan länge, och det är just det beteendet
  // som gör att chattknappens prick måste ligga innanför sin kant.
  bar: { overflow: 'hidden' },
  water: { position: 'absolute', left: 0, right: 0, top: 0 },
  wave: { position: 'absolute', top: 0, left: 0 },
});
