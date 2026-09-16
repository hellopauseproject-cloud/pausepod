// Ren tillståndsmaskin för en pausession. Inga React- eller BLE-beroenden.
// Både lådflödet och det lådlösa flödet matar samma reducer — skillnaden är
// bara vem som producerar händelserna (BLEContext vs en manuell trigger).

export type SessionPhase =
  | 'idle'
  | 'checking_in'   // väntar på att båda tummarna ska hållas i 1,5s
  | 'checked_in'    // klart, väntar på att telefonen läggs ner
  | 'awaiting_lid'   // telefonen ligger ner, väntar på att locket stängs
  | 'active'        // pausen räknar (uppåt för låda, upp eller ner utan låda)
  | 'respite'        // locket öppnades mitt i en aktiv paus — tiden fryser
  | 'ended';         // klar, redo att visas i pausesummary

export type Side = 'left' | 'right';

export type PauseType = 'session' | 'regulate';

export interface SessionEndedInfo {
  seq: string;
  durationMs: number;
  completed: boolean;
}

export interface SessionState {
  phase: SessionPhase;
  withPod: boolean;
  seq: string | null;
  pauseType: PauseType;
  targetSeconds?: number;      // bara relevant för lådlös 'regulate'
  category?: string;
  sharedSessionId?: string;
  /** epoch ms – ankare för hur mycket tid som har gått i aktuell fas */
  startedAt: number | null;
  /** epoch ms – när respiten började, så att elapsed kan frysas korrekt */
  respiteStartedAt: number | null;
  /** ackumulerad tid som ska dras bort från "nu - startedAt" (t.ex. vid RESTORE) */
  elapsedBaselineMs: number;
  /** total tid tillbringad i respite hittills — dras av så att elapsed hoppar inte fram när pausen återupptas */
  pausedMs: number;
  touches: { left: boolean; right: boolean };
  lastEnded: SessionEndedInfo | null;
}

export const initialSessionState: SessionState = {
  phase: 'idle',
  withPod: false,
  seq: null,
  pauseType: 'session',
  targetSeconds: undefined,
  category: undefined,
  sharedSessionId: undefined,
  startedAt: null,
  respiteStartedAt: null,
  elapsedBaselineMs: 0,
  pausedMs: 0,
  touches: { left: false, right: false },
  lastEnded: null,
};

export type SessionEvent =
  | { type: 'ENTER_CHECKIN'; category?: string; sharedSessionId?: string }
  | { type: 'TOUCH_BEGIN'; side: Side }
  | { type: 'TOUCH_END'; side: Side }
  | { type: 'CHECKIN_COMPLETE' }
  | { type: 'PHONE_DOWN' }
  | { type: 'LID_CLOSED' }
  | { type: 'LID_OPENED' }
  | {
      // För lådflödet skickar box_message bara `seq` — kategori/delad-session
      // sattes redan av ENTER_CHECKIN och behålls. Det lådlösa flödet anger
      // allt explicit eftersom det inte går via ENTER_CHECKIN.
      type: 'SESSION_STARTED';
      seq: string;
      withPod: boolean;
      pauseType?: PauseType;
      targetSeconds?: number;
      category?: string;
      sharedSessionId?: string;
    }
  | { type: 'SESSION_ENDED'; seq: string; durationMs: number; completed: boolean }
  /** Box skickar sitt aktuella tillstånd direkt efter anslutning — hoppar rakt in, förbi normala övergångar. */
  | { type: 'RESTORE'; phase: SessionPhase; elapsedMs: number; seq: string; withPod: boolean }
  | { type: 'RESET' };

export function sessionReducer(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case 'ENTER_CHECKIN':
      if (state.phase !== 'idle') return state;
      return {
        ...initialSessionState,
        phase: 'checking_in',
        withPod: true,
        category: event.category,
        sharedSessionId: event.sharedSessionId,
      };

    case 'TOUCH_BEGIN':
      if (state.phase !== 'checking_in') return state;
      return { ...state, touches: { ...state.touches, [event.side]: true } };

    case 'TOUCH_END':
      if (state.phase !== 'checking_in') return state;
      return { ...state, touches: { ...state.touches, [event.side]: false } };

    case 'CHECKIN_COMPLETE':
      if (state.phase !== 'checking_in') return state;
      return { ...state, phase: 'checked_in' };

    case 'PHONE_DOWN':
      if (state.phase !== 'checked_in') return state;
      return { ...state, phase: 'awaiting_lid' };

    case 'LID_CLOSED':
      // Informationsbärande i awaiting_lid/respite — den auktoritativa övergången
      // till 'active' sker på SESSION_STARTED, inte här. I respite tar vi oss
      // ändå tillbaka till 'active' direkt eftersom lådan redan räknat vidare.
      // withPod-kontrollen skyddar en lådlös session mot en låda som råkar
      // vara ansluten samtidigt och skickar egna lock-händelser.
      if (state.phase === 'respite' && state.withPod) {
        const justPausedMs = state.respiteStartedAt ? Date.now() - state.respiteStartedAt : 0;
        return {
          ...state,
          phase: 'active',
          respiteStartedAt: null,
          pausedMs: state.pausedMs + justPausedMs,
        };
      }
      return state;

    case 'LID_OPENED':
      if (state.phase !== 'active' || !state.withPod) return state;
      return { ...state, phase: 'respite', respiteStartedAt: Date.now() };

    case 'SESSION_STARTED':
      return {
        ...state,
        phase: 'active',
        withPod: event.withPod,
        seq: event.seq,
        pauseType: event.pauseType ?? state.pauseType,
        targetSeconds: event.targetSeconds ?? state.targetSeconds,
        category: event.category ?? state.category,
        sharedSessionId: event.sharedSessionId ?? state.sharedSessionId,
        startedAt: Date.now(),
        elapsedBaselineMs: 0,
        pausedMs: 0,
        respiteStartedAt: null,
        lastEnded: null,
      };

    case 'SESSION_ENDED':
      // En sen/duplicerad session_ended för en annan seq än den vi tror pågår
      // ignoreras för fasövergången men rapporteras ändå upp (outboxen är källan
      // till sanning för lagring, inte reducerns fas).
      if (state.seq !== null && state.seq !== event.seq) {
        return state;
      }
      return {
        ...state,
        phase: 'ended',
        lastEnded: { seq: event.seq, durationMs: event.durationMs, completed: event.completed },
      };

    case 'RESTORE':
      return {
        ...initialSessionState,
        phase: event.phase,
        withPod: event.withPod,
        seq: event.seq,
        startedAt: Date.now(),
        elapsedBaselineMs: event.elapsedMs,
      };

    case 'RESET':
      return initialSessionState;

    default:
      return state;
  }
}
