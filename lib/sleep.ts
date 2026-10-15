import { router } from 'expo-router';

import { track } from './analytics';
import { supabase } from './supabase';
import type { NightProgress, SleepNight } from '../types/database';

/**
 * Sömnläget — en natt med telefonen nedåt, som INTE är en paus.
 *
 * Skälet att det finns: en vanlig paus över natten fyllde morgonens dagsring,
 * kretsens pott och stege, och skickade kretsens dagsmålsnotis klockan sju.
 * En natt skrivs därför som `pause_sessions.kind = 'sleep'` och räknas
 * ingenstans där pauser räknas. Den är privat hela vägen — se
 * supabase/sleep.sql för var spärrarna sitter (dagsmålet, kretsens ledger,
 * vänners SELECT-policy, analysvyerna).
 *
 * Flödet är pausens eget ([app/pausing.tsx](../app/pausing.tsx)) med tre
 * skillnader: lyft räknas som uppvaknanden, natten tar slut av sig själv när
 * telefonen varit uppe en stund (`SLEEP_AUTO_END_MS`), och skärmen går inte
 * att backa ur — en övergiven paus kastas, och en kastad natt vore åtta
 * timmar borta.
 */

/**
 * **Det finns inget nattmål.** Det fanns ett en kort tid och det togs bort:
 * appen kan inte få någon att sova längre, bara påverka telefonen — när den
 * läggs ner och om den tas upp. Ett missat nattmål lästes som ett omdöme om
 * natten. Natten spåras i stället (läggdags, längd, uppvaknanden) och visas
 * bara i statistiken — Hem i nattläge är en måne och SLEEP-knappen
 * (components/night-moon.tsx).
 */

/**
 * Hur länge telefonen får vara uppe innan natten tar slut av sig själv.
 * Ett kortare lyft är ett uppvaknande (klockan fryser, och räknas om när
 * telefonen läggs ner); ett längre är morgonen. Natten slutar då vid
 * LYFTET, inte nu — de tjugo minuterna med telefonen i handen var ingen
 * sömn.
 *
 * Räknas bara medan appen är framme: en telefon som lyfts till en annan app
 * syns inte förrän Pause öppnas igen (sensorerna tystnar i bakgrunden), och
 * då räknas fristen därifrån. Se pausing.tsx.
 */
export const SLEEP_AUTO_END_MS = 20 * 60 * 1000;

/** Kortare än så sparas inte — en natt på fyra minuter är ett felstart. */
export const SLEEP_MIN_SECONDS = 5 * 60;

/** Ett tak mot en natt som "pågått" tills någon öppnade appen vid lunch. */
export const SLEEP_MAX_SECONDS = 16 * 3600;

const tzOffset = () => new Date().getTimezoneOffset();

export async function getNightProgress(): Promise<NightProgress | null> {
  const { data, error } = await supabase.rpc('get_night_progress', { p_tz_offset_minutes: tzOffset() });
  if (error) {
    console.log('[sleep] getNightProgress error:', error.message);
    return null;
  }
  return (data as NightProgress) ?? null;
}

export async function getSleepNights(limit = 30): Promise<SleepNight[]> {
  const { data, error } = await supabase.rpc('get_sleep_nights', {
    p_tz_offset_minutes: tzOffset(),
    p_limit: limit,
  });
  if (error) {
    console.log('[sleep] getSleepNights error:', error.message);
    return [];
  }
  return (data as SleepNight[]) ?? [];
}


/** Startar en natt. Samma skärm som en lådlös paus, med `pauseType: 'sleep'`. */
export function startSleep() {
  track('sleep_started');
  router.push({
    pathname: '/pausing',
    params: { mode: 'sleep', category: '', withPod: 'false', pauseType: 'sleep', targetSeconds: '0' },
  });
}

export type SleepRecord = {
  userId: string;
  /** Första gången telefonen lades ner. */
  startedAt: Date;
  /** Lyftet som avslutade natten. */
  endedAt: Date;
  /** Tiden telefonen låg ner. */
  durationSeconds: number;
  wakeCount: number;
  awakeSeconds: number;
};

/**
 * Den enda skrivningen av en sömnrad — från pausskärmen och från
 * krasch-återställningen i app/_layout.tsx. **Ingen `recordPauseInCircle`,
 * ingen `logPause`, ingen `is_pausing`**: natten är privat.
 *
 * Returnerar `false` när natten var för kort för att sparas eller inserten
 * föll; ingen av dem är något användaren kan göra något åt nu.
 */
export async function saveSleepSession(r: SleepRecord): Promise<boolean> {
  const duration = Math.min(SLEEP_MAX_SECONDS, Math.max(0, Math.round(r.durationSeconds)));
  if (duration < SLEEP_MIN_SECONDS) {
    track('sleep_discarded', { duration_seconds: duration });
    return false;
  }
  const { error } = await supabase.from('pause_sessions').insert({
    user_id: r.userId,
    kind: 'sleep',
    started_at: r.startedAt.toISOString(),
    ended_at: r.endedAt.toISOString(),
    duration_seconds: duration,
    wake_count: r.wakeCount,
    awake_seconds: Math.max(0, Math.round(r.awakeSeconds)),
    intention: null,
    is_shared: false,
    with_pod: false,
    completed: true,
  });
  if (error) {
    console.log('[sleep] insert error:', JSON.stringify(error));
    return false;
  }
  track('sleep_completed', { duration_seconds: duration, wake_count: r.wakeCount });
  return true;
}
