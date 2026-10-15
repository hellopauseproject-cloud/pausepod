import { useSyncExternalStore } from 'react';

/**
 * Hems läge: dagen eller natten (Day / Night-kapseln ovanför ringen).
 *
 * En liten delad butik och inte state i skärmen, för TRE läsare måste vara
 * överens: Hem själv, flikraden ([components/room-tab-bar.tsx](../components/room-tab-bar.tsx))
 * och botten bakom scenerna i app/(tabs)/_layout.tsx. Nattläget flyttar Hem
 * till `night`-rummet, och en flikrad i dagens ljusblå under en nattblå skärm
 * hade sett ut som två appar.
 *
 * **Förvalet följer klockan** (natt från `NIGHT_FROM_HOUR` till
 * `NIGHT_UNTIL_HOUR`), men ett eget val står sig i `MANUAL_HOLD_MS` — annars
 * hade Hem hoppat tillbaka varje gång fliken fick fokus. Per app-session, i
 * minnet: läget är en vy, inte en inställning.
 */
export type HomeMode = 'day' | 'night';

const NIGHT_FROM_HOUR = 20;
const NIGHT_UNTIL_HOUR = 5;
const MANUAL_HOLD_MS = 4 * 3600 * 1000;

const autoMode = (): HomeMode => {
  const h = new Date().getHours();
  return h >= NIGHT_FROM_HOUR || h < NIGHT_UNTIL_HOUR ? 'night' : 'day';
};

let mode: HomeMode = autoMode();
let chosenAt = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export function getHomeMode(): HomeMode {
  return mode;
}

/** Ett val i kapseln — står sig i några timmar. */
export function chooseHomeMode(next: HomeMode) {
  chosenAt = Date.now();
  if (next === mode) return;
  mode = next;
  emit();
}

/** Vid fokus på Hem: klockans läge, om inget eget val är färskt. */
export function refreshHomeMode() {
  if (Date.now() - chosenAt < MANUAL_HOLD_MS) return;
  const next = autoMode();
  if (next === mode) return;
  mode = next;
  emit();
}

// ── Efter en natt ─────────────────────────────────────────────────────────
// Natten slutar på Hem (app/_layout.tsx), och då i DAGläge: det är morgon,
// och nattläget visar ändå ingenting om natten som gått (den står i
// statistiken). Som ett eget val, så att ett nattval från i går kväll inte
// står sig i fyra timmar till.
export function markNightEnded() {
  chooseHomeMode('day');
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useHomeMode(): HomeMode {
  return useSyncExternalStore(subscribe, getHomeMode, getHomeMode);
}
