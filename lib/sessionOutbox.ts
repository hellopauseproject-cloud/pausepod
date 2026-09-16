// Beständig lokal kö för avslutade låd-sessioner. En session_ended-post skrivs
// hit INNAN vi skickar session_ack till lådan — annars kan en lyckad BLE-ack
// följas av en misslyckad Supabase-insert (t.ex. ingen nätanslutning) och
// sessionen är borta ur båda ändar. Lådan får aldrig rensa något som bara
// legat i RAM i appen.
//
// enqueueSession är idempotent: om posten redan finns (lådan skickar om samma
// seq efter en kraschad app, eller vid ett dubbelt BLE-meddelande) skrivs
// inget nytt, men anropet räknas ändå som lyckat — annars fastnar lådan på
// samma session för evigt eftersom den aldrig får sin ack.

import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';

const OUTBOX_PATH = FileSystem.documentDirectory + 'sessionOutbox.json';

export interface OutboxRecord {
  boxId: string;
  seq: string;
  userId: string;
  durationMs: number;
  completed: boolean;
  withPod: boolean;
  category?: string;
  /** ISO — när appen tog emot session_ended (används som ended_at vid synk) */
  recordedAt: string;
  syncedAt?: string;
}

async function readOutbox(): Promise<OutboxRecord[]> {
  try {
    const raw = await FileSystem.readAsStringAsync(OUTBOX_PATH);
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeOutbox(records: OutboxRecord[]): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(OUTBOX_PATH, JSON.stringify(records));
  } catch {}
}

export async function enqueueSession(
  record: Omit<OutboxRecord, 'recordedAt'>
): Promise<{ ok: true }> {
  const records = await readOutbox();
  const exists = records.some(r => r.boxId === record.boxId && r.seq === record.seq);
  if (!exists) {
    records.push({ ...record, recordedAt: new Date().toISOString() });
    await writeOutbox(records);
  }
  return { ok: true };
}

/** Unikt-index-krock (23505) räknas som redan synkad, t.ex. om krash-återställningen redan skrev raden. */
function isDuplicateKeyError(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

export async function flushOutbox(): Promise<void> {
  const records = await readOutbox();
  const pending = records.filter(r => !r.syncedAt);
  if (pending.length === 0) return;

  let changed = false;
  for (const rec of pending) {
    const endedAt = new Date(rec.recordedAt);
    const { error } = await supabase.from('pause_sessions').insert({
      user_id: rec.userId,
      started_at: new Date(endedAt.getTime() - rec.durationMs).toISOString(),
      ended_at: endedAt.toISOString(),
      duration_seconds: Math.round(rec.durationMs / 1000),
      intention: rec.category ?? null,
      is_shared: false,
      with_pod: rec.withPod,
      completed: rec.completed,
      box_id: rec.boxId,
      box_seq: rec.seq,
    });

    if (!error || isDuplicateKeyError(error)) {
      rec.syncedAt = new Date().toISOString();
      changed = true;
    } else {
      console.log('sessionOutbox: insert misslyckades, försöker igen senare:', JSON.stringify(error));
    }
  }

  if (changed) await writeOutbox(records);
}

/** Städa bort gamla, redan synkade poster så filen inte växer i evighet. */
export async function pruneSyncedOlderThan(days: number): Promise<void> {
  const records = await readOutbox();
  const cutoff = Date.now() - days * 86_400_000;
  const kept = records.filter(r => !r.syncedAt || new Date(r.syncedAt).getTime() > cutoff);
  if (kept.length !== records.length) await writeOutbox(kept);
}
