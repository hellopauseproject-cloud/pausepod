import { supabase } from './supabase';

/**
 * Hjärtan efter en delad paus. Schemat och skälen står i
 * [supabase/pause_cheers.sql](../supabase/pause_cheers.sql).
 *
 * Ett hjärta hänger på mottagarens egen rad i `pause_sessions`, så den som
 * fortfarande pausar kan inte få ett än — raden finns inte förrän hen slutat.
 */

export type Cheerer = { userId: string; username: string; avatarUrl: string | null };

/** De andras rader i den delade pausen, för de personer som ska få hjärtat. */
async function targetRows(sharedSessionId: string, userIds: string[]) {
  if (userIds.length === 0) return [];
  const { data } = await supabase
    .from('pause_sessions')
    .select('id, user_id')
    .eq('shared_session_id', sharedSessionId)
    .in('user_id', userIds);
  return data ?? [];
}

/**
 * Hjärtar pausen för var och en i `userIds`. Returnerar vilka som faktiskt
 * fick det — en rad som inte gick att läsa eller skriva räknas inte.
 */
export async function sendCheers(
  senderId: string,
  sharedSessionId: string,
  userIds: string[],
): Promise<string[]> {
  const rows = await targetRows(sharedSessionId, userIds);
  if (rows.length === 0) return [];
  // `ignoreDuplicates`: ett andra tryck efter en tappad uppkoppling ska inte
  // fela på primärnyckeln.
  const { error } = await supabase.from('pause_cheers').upsert(
    rows.map(r => ({ session_id: r.id, sender_id: senderId, receiver_id: r.user_id })),
    { onConflict: 'session_id,sender_id', ignoreDuplicates: true },
  );
  return error ? [] : rows.map(r => r.user_id);
}

/** Tar tillbaka ens egna hjärtan i den delade pausen. */
export async function removeCheers(
  senderId: string,
  sharedSessionId: string,
  userIds: string[],
): Promise<boolean> {
  const rows = await targetRows(sharedSessionId, userIds);
  if (rows.length === 0) return true;
  const { error } = await supabase
    .from('pause_cheers')
    .delete()
    .eq('sender_id', senderId)
    .in('session_id', rows.map(r => r.id));
  return !error;
}

/** Vem som hjärtat mina pauser, per paus-id. */
export async function getCheersFor(
  receiverId: string,
  sessionIds: string[],
): Promise<Record<string, Cheerer[]>> {
  if (sessionIds.length === 0) return {};
  const { data: cheers } = await supabase
    .from('pause_cheers')
    .select('session_id, sender_id, created_at')
    .eq('receiver_id', receiverId)
    .in('session_id', sessionIds)
    .order('created_at', { ascending: true });
  if (!cheers || cheers.length === 0) return {};

  const senderIds = [...new Set(cheers.map(c => c.sender_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, avatar_url')
    .in('id', senderIds);
  const byId = new Map((profiles ?? []).map(p => [p.id, p]));

  const out: Record<string, Cheerer[]> = {};
  for (const c of cheers) {
    const p = byId.get(c.sender_id);
    (out[c.session_id] ??= []).push({
      userId: c.sender_id,
      username: p?.username ?? '?',
      avatarUrl: p?.avatar_url ?? null,
    });
  }
  return out;
}
