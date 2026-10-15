import { useIsFocused } from '@react-navigation/native';
import { createContext, ReactNode, useEffect } from 'react';
import { Platform } from 'react-native';
import {
  SensorType,
  SharedValue,
  useAnimatedReaction,
  useAnimatedSensor,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

/**
 * **AVSTÄNGD — används inte just nu.** Lutningen togs bort ur appen på
 * begäran, men filen står kvar så att den kan kopplas in igen. Det som krävs
 * då: `<LiquidTiltProvider>` runt skärmen i app/(tabs)/index.tsx och
 * app/(tabs)/circle.tsx, och i components/liquid-bars.tsx
 * `useContext(LiquidTiltContext)` plus `{ rotate: `${tilt.value}rad` }` efter
 * nivåns `translateY` i `levelStyle`, med `transformOrigin: 'top'` på
 * `styles.water`.
 *
 * Lutningen som vattnet i strecken följer.
 *
 * Telefonens gravitationssensor läses av Reanimated och hamnar direkt på
 * UI-tråden — ingen JS-tråd per mätning. Vinkeln är den som håller ytan
 * vågrät i världen: lutar man telefonen åt höger lutar vattnet åt vänster i
 * röret, med en fjäder så att det skvalpar till och lägger sig.
 *
 * **En sensor per skärm, inte per streck.** Providern ligger runt Hem och
 * Kretsen, och alla streck på skärmen läser samma vinkel ur kontexten —
 * åtta medlemmar i Kretsen är åtta läsare av ett tal, inte åtta sensorer.
 *
 * **Sensorn lever bara medan skärmen har fokus.** Flikar avmonteras inte, så
 * utan det hade gravitationssensorn gått i bakgrunden hela tiden appen var
 * öppen. Med reducerad rörelse startas den inte alls, och vattnet står rakt.
 */

// Hur långt vattnet får luta, i radianer (~25°). Mer än så och ytan hade
// rest sig ur röret på de smala strecken.
const MAX_TILT = 0.44;
// Under den här delen av tyngdkraften i skärmens plan ligger telefonen
// nästan platt, och vinkeln blir brus — då står vattnet rakt i stället.
const FLAT_THRESHOLD = 2.5; // m/s²
// Fjädern: lätt underdämpad, så att ytan svänger förbi en aning och lägger
// sig, som vatten och inte som en visare.
const SLOSH = { damping: 9, stiffness: 55, mass: 1 };
// Sensorns takt: ~30 Hz räcker för en fjäder som ändå jämnar ut.
const SENSOR_INTERVAL_MS = 33;
// iOS och Android rapporterar tyngdkraften med motsatt tecken (samma
// skillnad som `isFaceDown` i lib/tilt.ts hanterar för z). Står vattnet åt
// fel håll på en av plattformarna är det det här talet som ska vändas.
const GRAVITY_SIGN = Platform.OS === 'ios' ? -1 : 1;

export const LiquidTiltContext = createContext<SharedValue<number> | null>(null);

function TiltSensor({ angle }: { angle: SharedValue<number> }) {
  const sensor = useAnimatedSensor(SensorType.GRAVITY, { interval: SENSOR_INTERVAL_MS });

  useAnimatedReaction(
    () => sensor.sensor.value,
    g => {
      const gx = g.x * GRAVITY_SIGN;
      const gy = g.y * GRAVITY_SIGN;
      const inPlane = Math.sqrt(gx * gx + gy * gy);
      // Telefonens lutning i skärmens plan är atan2(gx, gy); vattnet vrids
      // lika mycket åt andra hållet relativt skärmen, så det står still i
      // världen. Tecknet bakas in i `rotate` direkt: positivt = medurs.
      const target = inPlane < FLAT_THRESHOLD
        ? 0
        : Math.max(-MAX_TILT, Math.min(MAX_TILT, Math.atan2(gx, gy)));
      angle.value = withSpring(target, SLOSH);
    },
  );

  // Lämnas skärmen glider vattnet tillbaka till rakt i stället för att frysa
  // snett.
  useEffect(() => () => { angle.value = withSpring(0, SLOSH); }, [angle]);

  return null;
}

export function LiquidTiltProvider({ children }: { children: ReactNode }) {
  const angle = useSharedValue(0);
  const focused = useIsFocused();
  const reduceMotion = useReducedMotion();
  return (
    <LiquidTiltContext.Provider value={angle}>
      {focused && !reduceMotion && <TiltSensor angle={angle} />}
      {children}
    </LiquidTiltContext.Provider>
  );
}
