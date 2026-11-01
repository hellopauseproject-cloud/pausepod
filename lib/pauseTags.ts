import { supabase } from './supabase';

/**
 * Att tagga en paus i efterhand — "What did you do instead?".
 *
 * Det finns exakt EN skrivning här: `pause_sessions.intention` på en rad som
 * redan finns och är ens egen. Kolumnen är nullbar text och skrivs med
 * samma värde som pausskärmen skriver när intentionen valdes före pausen —
 * kategorins *etikett* (`FOCUS`), se `findCategoryById` i app/pausing.tsx —
 * så att statistiken och wrapped läser en taggad och en förvald paus likadant.
 *
 * RLS släpper igenom det: `pause_sessions_update` tillåter `user_id =
 * auth.uid()`. Uppdateringen filtrerar ändå själv på `user_id`, eftersom
 * policyn också släpper igenom en delad paus partnerrad — och en tagg ska
 * aldrig hamna på någon annans paus.
 *
 * Kretsens flöde (`circle_activity`) får INTE taggen: den raden skrevs när
 * pausen sparades. Att uppdatera den kräver en ny RPC och är ett eget förslag.
 */

/**
 * Överlämningen från sammanfattningen till Hem.
 *
 * En ensam paus slutar numera på Hem och inte på en egen skärm: strecken
 * stiger med det man just vunnit tillbaka, och taggkortet glider upp där.
 * Rutten till sammanfattningen sätts i app/_layout.tsx, som inte rörs, så
 * sammanfattningen lämnar en lapp här och byter sig själv mot Hem. Hem läser
 * lappen när den får fokus och river den. Lappen bor i minnet och inte på
 * disk: dör appen mellan de två stegen är den inte värd att visa ändå.
 *
 * En **delad** paus stannar på sammanfattningen (den visar vem man pausade
 * med), men frågan ställs ändå på Hem: lappen lämnas när man trycker *Back to
 * start*. Frågan står alltså på ett och samma ställe efter varje paus. Där
 * har klockan redan ringt på sammanfattningen, så `bell` är `false`.
 */
export type PendingPauseTag = {
  durationSeconds: number;
  /** Pausen hade redan en intention (vald före pausen) — då frågas inget. */
  alreadyTagged: boolean;
  /** Ska Hem ringa? Nej om sammanfattningen redan gjort det. */
  bell: boolean;
  at: number;
};

// Äldre än så här och lappen gäller inte längre — appen har legat i bakgrunden.
const PENDING_MAX_AGE_MS = 10 * 60 * 1000;
let pending: PendingPauseTag | null = null;

export function setPendingPauseTag(durationSeconds: number, alreadyTagged: boolean, bell = true) {
  pending = { durationSeconds, alreadyTagged, bell, at: Date.now() };
}

/** Lappen, en gång. Nästa anrop svarar `null`. */
export function takePendingPauseTag(): PendingPauseTag | null {
  const p = pending;
  pending = null;
  if (!p || Date.now() - p.at > PENDING_MAX_AGE_MS) return null;
  return p;
}

/**
 * Raden för en paus som just tagit slut.
 *
 * Sammanfattningen får inget id — pausens rad skrivs av pausskärmen i samma
 * stund som rutten byts, och ingen av de två filerna ska röras för det här.
 * Den letas därför upp: ens senaste paus med samma längd (±2 s) som slutade
 * inom `RECENT_MS`. Hinner raden inte landa görs ett nytt försök efter
 * `RETRY_MS`. Hittas ingen svarar den `null`, och då sparas ingenting.
 */
const RECENT_MS = 15 * 60 * 1000;
const RETRY_MS = 1200;

async function findOnce(userId: string, durationSeconds: number): Promise<string | null> {
  // En dagpaus som blev en natt vid midnatt sparas med sluttid 23:59:59
  // (app/pausing.tsx) och taggas först på morgonen — fönstret räcker därför
  // alltid tillbaka till strax före senaste midnatt. Raden är ändå den
  // senaste pausen: natten är en sömnrad och filtreras bort nedan.
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const since = new Date(Math.min(Date.now() - RECENT_MS, midnight.getTime() - 60_000)).toISOString();
  const { data, error } = await supabase
    .from('pause_sessions')
    .select('id, duration_seconds')
    .eq('user_id', userId)
    .eq('kind', 'pause')
    .gte('ended_at', since)
    .order('ended_at', { ascending: false })
    .limit(5);
  if (error || !data) return null;
  const hit = data.find(r => Math.abs((r.duration_seconds ?? -99) - durationSeconds) <= 2);
  return hit?.id ?? null;
}

export async function findJustEndedSessionId(userId: string, durationSeconds: number): Promise<string | null> {
  const first = await findOnce(userId, durationSeconds);
  if (first) return first;
  await new Promise(r => setTimeout(r, RETRY_MS));
  return findOnce(userId, durationSeconds);
}

/**
 * Sätter (eller, med `null`, tar bort) taggen på en egen paus.
 *
 * Svaret räknar raderna som faktiskt ändrades. En uppdatering som RLS
 * stoppar ger inget fel i PostgREST, bara noll rader — utan `.select()` hade
 * en nekad tagg sett ut som en sparad.
 */
export async function setPauseIntention(
  sessionId: string,
  userId: string,
  label: string | null,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('pause_sessions')
    .update({ intention: label })
    .eq('id', sessionId)
    .eq('user_id', userId)
    .select('id');
  if (error) console.log('[pauseTags] update failed:', error.message);
  return !error && (data?.length ?? 0) > 0;
}
