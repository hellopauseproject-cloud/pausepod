import { useFocusEffect } from 'expo-router';
import { ReactNode, useCallback, useEffect, useId, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

/**
 * En progressring ritad med react-native-svg: en hel cirkel som spår och en
 * båge ovanpå som börjar klockan tolv och fylls medurs (`strokeDasharray` +
 * `strokeDashoffset`, rundade ändar).
 *
 * Syskon till [progress-ring.tsx](progress-ring.tsx), inte en ersättare: den
 * ritar sin ring av View-ar och kan inte animera, och Hem använder den inte
 * längre men den står kvar. Den här finns för Kretsens ringar, som ska fyllas
 * från tomt när skärmen öppnas och när perioden byts.
 *
 * **Rörelsen:** från tomt till värdet på ~0,9 s när skärmen får fokus och när
 * `replayKey` byts (perioden). Ändras bara värdet — `load()` hämtar om var
 * fjärde sekund — glider bågen dit från där den står, utan att börja om. Med
 * reducerad rörelse hoppar den direkt.
 *
 * Bara `strokeDashoffset` animeras, på UI-tråden; cirkeln ritas inte om.
 */

const FILL_MS = 900;
const UPDATE_MS = 600;
const EASE = Easing.out(Easing.cubic);

// Glödens halva bredd som gånger strecket (den når alltså `GLOW_HALF - 0.5`
// streck utanför kanten), och dess styrka mitt på strecket.
const GLOW_HALF = 1.15;
const GLOW_PEAK = 0.55;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function ProgressArc({
  fraction, size, stroke, color, trackColor, replayKey, glow = false, children,
}: {
  fraction: number;
  size: number;
  stroke: number;
  color: string;
  trackColor: string;
  /** Byts det här (perioden) fylls ringen om från tomt. */
  replayKey?: string;
  /** En mjuk glöd runt det ifyllda — för de stora ringarna, inte brickorna. */
  glow?: boolean;
  children?: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  const p = useSharedValue(0);
  const fRef = useRef(f);
  fRef.current = f;

  const replay = useCallback(() => {
    if (reduceMotion) { p.value = fRef.current; return; }
    p.value = 0;
    p.value = withTiming(fRef.current, { duration: FILL_MS, easing: EASE });
  }, [reduceMotion, p]);

  // När skärmen öppnas (och när man kommer tillbaka till fliken).
  useFocusEffect(replay);

  // När perioden byts.
  const keyRef = useRef(replayKey);
  useEffect(() => {
    if (keyRef.current === replayKey) return;
    keyRef.current = replayKey;
    replay();
  }, [replayKey, replay]);

  // När bara värdet ändras: glid dit, börja inte om.
  const firstRef = useRef(true);
  useEffect(() => {
    if (firstRef.current) { firstRef.current = false; return; }
    p.value = reduceMotion ? f : withTiming(f, { duration: UPDATE_MS, easing: EASE });
  }, [f, reduceMotion, p]);

  // Vid noll döljs bågen helt: en båge med längden noll och rundade ändar
  // ritas annars som en prick klockan tolv, och en tom ring ska vara tom.
  const arcProps = useAnimatedProps(() => ({
    strokeDashoffset: c * (1 - p.value),
    strokeOpacity: p.value < 0.002 ? 0 : 1,
  }));
  // Glöden: en bred båge under den skarpa, målad med en radiell toning som
  // är starkast mitt på strecket och tonar till inget ut och in. Toningen
  // ritas per bildpunkt, så den har inga steg (tre lager i olika styrka gav
  // synliga trappsteg). Inga svg-filter: Androids suddning byggs om för
  // varje bildruta medan bågen fylls.
  //
  // Bågen är förskjuten och kortad med `trim` i varje ände, så att dess
  // rundade ändar slutar där den skarpa bågens gör — annars sticker en
  // hård halvcirkel av glöd ut förbi ändarna.
  const halo = stroke * GLOW_HALF;
  const trim = Math.max(0, halo - stroke / 2);
  const glowProps = useAnimatedProps(() => {
    const len = p.value >= 0.999 ? c : c * p.value - 2 * trim;
    return {
      strokeDashoffset: c - Math.max(0, len),
      strokeOpacity: len <= 0 ? 0 : 1,
    };
  });
  const gradId = useId().replace(/:/g, '');
  const pad = glow ? Math.ceil(trim) + 1 : 0;
  const box = size + 2 * pad;
  const mid = box / 2;
  const outer = r + halo;
  const at = (d: number) => `${((r + d * halo) / outer) * 100}%`;

  return (
    <View style={{ width: size, height: size }}>
      {/* Vriden −90°, så att bågen börjar klockan tolv. */}
      <Svg
        width={box} height={box}
        style={[styles.rotated, pad ? { position: 'absolute', left: -pad, top: -pad } : null]}
      >
        <Circle
          cx={mid} cy={mid} r={r}
          stroke={trackColor} strokeWidth={stroke} fill="none"
        />
        {glow && (
          <>
            <Defs>
              {/* Mjuk kurva och inte en rak lutning: nästan full nära
                  strecket, sedan en lång svans ut i inget. */}
              <RadialGradient id={gradId} cx={mid} cy={mid} r={outer} gradientUnits="userSpaceOnUse">
                <Stop offset={at(-1)} stopColor={color} stopOpacity={0} />
                <Stop offset={at(-0.6)} stopColor={color} stopOpacity={GLOW_PEAK * 0.18} />
                <Stop offset={at(-0.3)} stopColor={color} stopOpacity={GLOW_PEAK * 0.6} />
                <Stop offset={at(0)} stopColor={color} stopOpacity={GLOW_PEAK} />
                <Stop offset={at(0.3)} stopColor={color} stopOpacity={GLOW_PEAK * 0.6} />
                <Stop offset={at(0.6)} stopColor={color} stopOpacity={GLOW_PEAK * 0.18} />
                <Stop offset="100%" stopColor={color} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <AnimatedCircle
              cx={mid} cy={mid} r={r}
              stroke={`url(#${gradId})`} strokeWidth={2 * halo} fill="none"
              strokeLinecap="round"
              strokeDasharray={`${c} ${c}`}
              transform={`rotate(${(trim / c) * 360} ${mid} ${mid})`}
              animatedProps={glowProps}
            />
          </>
        )}
        <AnimatedCircle
          cx={mid} cy={mid} r={r}
          stroke={color} strokeWidth={stroke} fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          animatedProps={arcProps}
        />
      </Svg>
      {children ? <View style={styles.center}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rotated: { transform: [{ rotate: '-90deg' }] },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
