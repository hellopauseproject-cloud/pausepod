import { track } from './analytics';
import { supabase } from './supabase';

/**
 * Kretsens chatt. Schemat och skälen bor i supabase/circle_chat.sql — här
 * ligger bara vägen dit.
 *
 * **Läsning går direkt mot tabellen, skrivning genom RPC.** Samma uppdelning
 * som resten av kretsarnas tabeller: RLS avgör vilka rader man ser, och
 * `circle_messages` har inga insert-rättigheter alls, så ingen kan skriva i
 * någon annans namn eller i en krets hen inte är med i.
 *
 * **Chatten skickar inga notiser.** Se stycket i circle_chat.sql och
 * notisavsnittet i CLAUDE.md: appen skickar exakt två, och en tredje är ett
 * eget beslut med egen strypning — inte en rad som smygs in här.
 */

/** Hur många meddelanden en sida är. Chatten hämtar en sida vid öppning och
 *  en till varje gång man trycker på *Load earlier*. */
export const CHAT_PAGE_SIZE = 40;

/** En rad ur chatten, med avsändarens namn och avatar redan påhängda. */
export type ChatMessage = {
  id: string;
  user_id: string | null;
  body: string;
  created_at: string;
  /** 'Someone' när kontot är raderat — raden blir anonym, inte borta. */
  authorName: string;
  authorAvatar: string | null;
};

type Row = {
  id: string;
  user_id: string | null;
  body: string;
  created_at: string;
  author: { username: string | null; avatar_url: string | null } | null;
};

function toMessage(r: any): ChatMessage {
  return {
    id: r.id,
    user_id: r.user_id,
    body: r.body,
    created_at: r.created_at,
    authorName: r.author?.username ?? 'Someone',
    authorAvatar: r.author?.avatar_url ?? null,
  };
}

/**
 * En sida meddelanden, äldst först — alltså i den ordning de ska renderas.
 *
 * Frågan ställs tvärtom (`created_at desc`) och vänds här: det är de SENASTE
 * som ska hämtas, och utan `desc` hade `limit` gett de allra första
 * meddelandena i kretsens historia i stället.
 *
 * `before` är en ISO-tid att hämta äldre än — det är så *Load earlier*
 * bläddrar bakåt. Ett tidsstämpel-ankare och inte ett offset: kommer ett nytt
 * meddelande in mellan två sidhämtningar skulle offseten förskjutas och en
 * rad hoppas över.
 */
export async function fetchCircleMessages(
  circleId: string,
  before?: string,
): Promise<ChatMessage[]> {
  let q = supabase
    .from('circle_messages')
    .select('id, user_id, body, created_at, author:profiles!user_id(username, avatar_url)')
    .eq('circle_id', circleId)
    .order('created_at', { ascending: false })
    .limit(CHAT_PAGE_SIZE);

  if (before) q = q.lt('created_at', before);

  const { data, error } = await q;
  if (error) {
    console.log('[circleChat] fetch error:', error.message);
    return [];
  }
  return ((data ?? []) as unknown as Row[]).map(toMessage).reverse();
}

/** Kastar vidare serverns text — skärmen visar den, så tystnad vore värre. */
export async function sendCircleMessage(circleId: string, body: string): Promise<void> {
  const { error } = await supabase.rpc('send_circle_message', { p_body: body, p_circle_id: circleId });
  if (error) throw new Error(error.message);
  // Bara längden, aldrig texten. Händelseloggen är ett mått på användning
  // och inte en andra kopia av samtalet — `circle_messages` äger orden, och
  // att de också låg i app_events hade gjort en raderad rad till en rad som
  // finns kvar någon annanstans.
  track('circle_message_sent', { length: body.trim().length });
}

/** Bara sina egna. Servern kontrollerar det igen — se RPC:n. */
export async function deleteCircleMessage(messageId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_circle_message', { p_message_id: messageId });
  if (error) throw new Error(error.message);
}

/**
 * Flyttar fram läsmärket på den egna medlemsraden i just den kretsen — att
 * läsa i en ska inte släcka pricken i en annan.
 *
 * Tyst vid fel: läsmärket styr en prick, och en prick som blir kvar en stund
 * till är inte värd en dialogruta.
 */
export async function markCircleChatRead(circleId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_circle_chat_read', { p_circle_id: circleId });
  if (error) console.log('[circleChat] markRead error:', error.message);
}

/**
 * Antal olästa för pricken i kretsfliken.
 *
 * `since` är `circle_members.chat_read_at`, eller `joined_at` för den som
 * aldrig öppnat chatten — annars hade en nykomling mötts av hela historiken
 * som olästa. Egna meddelanden räknas inte: `send_circle_message` flyttar
 * fram läsmärket, men en rad som hunnit in före den uppdateringen skulle
 * annars göra en prick av ens eget inlägg.
 */
export async function countUnreadCircleMessages(
  circleId: string,
  since: string,
  meId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('circle_messages')
    .select('id', { count: 'exact', head: true })
    .eq('circle_id', circleId)
    .gt('created_at', since)
    .neq('user_id', meId);

  if (error) {
    console.log('[circleChat] unread error:', error.message);
    return 0;
  }
  return count ?? 0;
}
