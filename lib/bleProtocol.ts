// Tunt lager mellan BLE-strängar och typade meddelanden. All kunskap om
// exakt textformat bor här — om firmware landar på ett annat format är det
// den här filen som ändras, inget annat.

import type { SessionPhase, Side } from './sessionMachine';

export type BoxMessage =
  | { type: 'hello'; boxId: string }
  | { type: 'state'; phase: SessionPhase; elapsedMs: number; seq: string }
  | { type: 'touch_begin'; side: Side }
  | { type: 'touch_end'; side: Side }
  | { type: 'checkin_complete' }
  | { type: 'phone_down' }
  | { type: 'lid_closed' }
  | { type: 'lid_opened' }
  | { type: 'session_started'; seq: string }
  | { type: 'session_ended'; seq: string; durationMs: number; completed: boolean }
  | { type: 'battery'; percent: number };

const RESTORABLE_PHASES: SessionPhase[] = [
  'idle', 'checking_in', 'checked_in', 'awaiting_lid', 'active', 'respite',
];

function isRestorablePhase(value: string): value is SessionPhase {
  return (RESTORABLE_PHASES as string[]).includes(value);
}

function isSide(value: string): value is Side {
  return value === 'left' || value === 'right';
}

export function parseBoxMessage(raw: string): BoxMessage | null {
  const [head, ...rest] = raw.split(':');

  switch (head) {
    case 'hello': {
      const boxId = rest.join(':');
      return boxId ? { type: 'hello', boxId } : null;
    }
    case 'state': {
      const [phase, elapsedMsRaw, seq] = rest;
      if (!phase || !isRestorablePhase(phase) || !seq) return null;
      const elapsedMs = Number(elapsedMsRaw);
      if (!Number.isFinite(elapsedMs)) return null;
      return { type: 'state', phase, elapsedMs, seq };
    }
    case 'touch_begin':
    case 'touch_end': {
      const side = rest[0];
      if (!side || !isSide(side)) return null;
      return { type: head, side };
    }
    case 'checkin_complete':
      return { type: 'checkin_complete' };
    case 'phone_down':
      return { type: 'phone_down' };
    case 'lid_closed':
      return { type: 'lid_closed' };
    case 'lid_opened':
      return { type: 'lid_opened' };
    case 'session_started': {
      const seq = rest[0];
      if (!seq) return null;
      return { type: 'session_started', seq };
    }
    case 'session_ended': {
      const [seq, durationMsRaw, completedRaw] = rest;
      if (!seq) return null;
      const durationMs = Number(durationMsRaw);
      if (!Number.isFinite(durationMs)) return null;
      return { type: 'session_ended', seq, durationMs, completed: completedRaw === '1' };
    }
    case 'battery': {
      const percent = Number(rest[0]);
      if (!Number.isFinite(percent)) return null;
      return { type: 'battery', percent };
    }
    default:
      return null;
  }
}

export function encodeSessionAck(seq: string): string {
  return `session_ack:${seq}`;
}

export function encodeTimeSync(nowMs: number): string {
  return `time_sync:${nowMs}`;
}

export function encodeSetMode(mode: string): string {
  return `set_mode:${mode}`;
}

// Rent informativ — lådan ignorerar den idag. Skickas som en lokal, kosmetisk
// signal från placeinbox-skärmens accelerometer-detektion, påverkar aldrig
// sessionReducer (det är fortfarande box:ens egen phone_down/lid_closed som
// äger den övergången).
export function encodePhoneDown(): string {
  return 'phone_down';
}
