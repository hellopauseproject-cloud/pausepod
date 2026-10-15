// Enda platsen som matar sessionReducer. Lådflödet matas härifrån via
// BLEContexts meddelandeprenumeration; det lådlösa flödet dispatchar
// manuellt från pausing.tsx. Reducern själv vet inte vem som skickade
// händelsen.

import React, { createContext, useContext, useEffect, useReducer, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { enqueueSession, flushOutbox } from '../lib/sessionOutbox';
import { initialSessionState, SessionEvent, sessionReducer, SessionState } from '../lib/sessionMachine';
import { useBLE, useBLEControl } from './BLEContext';

const SessionContext = createContext<{
  state: SessionState;
  dispatch: (event: SessionEvent) => void;
  batteryPercent: number | null;
} | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);
  const [batteryPercent, setBatteryPercent] = useState<number | null>(null);
  const { user } = useAuth();
  const { subscribeToBoxMessages, sendSessionAck } = useBLE();
  const { boxId, isPairedBoxRef } = useBLEControl();

  // Handlern registreras en gång och lever hela appens livstid, så allt den
  // behöver läsas ur refar — en closure hade frusit tillståndet så som det
  // såg ut vid registreringen.
  const stateRef = useRef(state);
  stateRef.current = state;
  const userIdRef = useRef(user?.id);
  userIdRef.current = user?.id;
  const boxIdRef = useRef(boxId);
  boxIdRef.current = boxId;
  const sendSessionAckRef = useRef(sendSessionAck);
  sendSessionAckRef.current = sendSessionAck;

  useEffect(() => subscribeToBoxMessages((boxMessage) => {
    const state = stateRef.current;

    (async () => {
      switch (boxMessage.type) {
        case 'state':
          // Bara den lådan den här telefonen senast parades med får hoppa
          // rakt in i en skärm — en främmande låda (demo, kompis, butik) ska
          // aldrig kunna kapa gränssnittet med sitt eget tillstånd.
          //
          // Läser reffen, inte isPairedBox-state — state hinner inte alltid
          // uppdateras innan det här state-meddelandet redan processats
          // (hello och state kommer i snabb följd vid varje ny anslutning),
          // vilket annars tyst kastar RESTORE. Se BLEContext.tsx.
          if (isPairedBoxRef.current) {
            console.log('BLE: RESTORE →', boxMessage.phase, boxMessage.seq);
            dispatch({
              type: 'RESTORE',
              phase: boxMessage.phase,
              elapsedMs: boxMessage.elapsedMs,
              seq: boxMessage.seq,
              withPod: true,
            });
          } else {
            console.log('BLE: state mottaget men låda ej parad, ignorerar:', boxMessage.phase);
          }
          break;

        case 'touch_begin':
          console.log('BLE: touch_begin', boxMessage.side);
          break;

        case 'touch_end':
          console.log('BLE: touch_end', boxMessage.side);
          break;

        case 'checkin_complete':
          console.log('BLE: checkin_complete, fas innan:', state.phase);
          dispatch({ type: 'CHECKIN_COMPLETE' });
          break;

        case 'phone_down':
          dispatch({ type: 'PHONE_DOWN' });
          break;

        case 'lid_closed':
          console.log('BLE: lid_closed, fas innan:', state.phase);
          dispatch({ type: 'LID_CLOSED' });
          break;

        case 'lid_opened':
          console.log('BLE: lid_opened, fas innan:', state.phase, 'withPod:', state.withPod);
          dispatch({ type: 'LID_OPENED' });
          break;

        case 'session_started':
          console.log('BLE: session_started', boxMessage.seq, 'fas innan:', state.phase);
          dispatch({
            type: 'SESSION_STARTED',
            seq: boxMessage.seq,
            withPod: true,
            pauseType: 'session',
          });
          break;

        case 'session_ended': {
          // Skriv lokalt INNAN vi ackar. Lådan får bara rensa sin kö när vi
          // vet att sessionen är bevarad hos oss — oavsett om nätet är uppe.
          // enqueueSession är idempotent och returnerar alltid ok, så en
          // omskickad seq (t.ex. efter en kraschad app) fastnar aldrig utan
          // ack.
          const userId = userIdRef.current;
          const currentBoxId = boxIdRef.current;
          if (userId && currentBoxId) {
            await enqueueSession({
              boxId: currentBoxId,
              seq: boxMessage.seq,
              userId,
              durationMs: boxMessage.durationMs,
              completed: boxMessage.completed,
              withPod: true,
              category: state.category,
              // ageMs > 0 betyder köad/omskickad session — räkna sluttiden
              // baklänges istället för att anta att den precis hände nu.
              recordedAt: new Date(Date.now() - boxMessage.ageMs).toISOString(),
            });
            flushOutbox().catch(() => {});
            await sendSessionAckRef.current(boxMessage.seq);
          } else {
            // Ingen ack när vi inte kunnat lagra. Ackade vi ändå skulle lådan
            // rensa posten ur sin kö och sessionen vore borta ur båda ändar —
            // precis det som gjorde att pauser aldrig dök upp i statistiken.
            // Utan ack ligger den kvar i lådans kö (max 50) och skickas om var
            // 3:e sekund tills vi vet vilken låda den kom från. Fasen drivs
            // ändå vidare så användaren inte fastnar på pausskärmen; outboxens
            // dedupe på (boxId, seq) gör omleveransen ofarlig.
            console.log(
              'BLE: session_ended kunde inte lagras (userId:', userId, 'boxId:', currentBoxId,
              ') — ackar INTE, lådan får skicka om'
            );
          }
          dispatch({
            type: 'SESSION_ENDED',
            seq: boxMessage.seq,
            durationMs: boxMessage.durationMs,
            completed: boxMessage.completed,
          });
          break;
        }

        case 'battery':
          setBatteryPercent(boxMessage.percent);
          // TODO: varna i UI när percent < 15 under en aktiv paus — en död
          // låda mitt i en lång paus är värsta scenariot. Inte löst än.
          break;
      }
    })();
  }), [subscribeToBoxMessages]);

  return (
    <SessionContext.Provider value={{ state, dispatch, batteryPercent }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession måste användas inom SessionProvider');
  return ctx;
}
