// Enda platsen som matar sessionReducer. Lådflödet matas härifrån via
// BLEContext (boxMessage); det lådlösa flödet dispatchar manuellt från
// pausing.tsx. Reducern själv vet inte vem som skickade händelsen.

import React, { createContext, useContext, useEffect, useReducer, useState } from 'react';
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
  const { boxMessage, resetMessage, sendSessionAck } = useBLE();
  const { boxId, isPairedBox } = useBLEControl();

  useEffect(() => {
    if (!boxMessage) return;

    (async () => {
      switch (boxMessage.type) {
        case 'state':
          // Bara den lådan den här telefonen senast parades med får hoppa
          // rakt in i en skärm — en främmande låda (demo, kompis, butik) ska
          // aldrig kunna kapa gränssnittet med sitt eget tillstånd.
          if (isPairedBox) {
            dispatch({
              type: 'RESTORE',
              phase: boxMessage.phase,
              elapsedMs: boxMessage.elapsedMs,
              seq: boxMessage.seq,
              withPod: true,
            });
          }
          break;

        case 'touch_begin':
          dispatch({ type: 'TOUCH_BEGIN', side: boxMessage.side });
          break;

        case 'touch_end':
          dispatch({ type: 'TOUCH_END', side: boxMessage.side });
          break;

        case 'checkin_complete':
          dispatch({ type: 'CHECKIN_COMPLETE' });
          break;

        case 'phone_down':
          dispatch({ type: 'PHONE_DOWN' });
          break;

        case 'lid_closed':
          dispatch({ type: 'LID_CLOSED' });
          break;

        case 'lid_opened':
          dispatch({ type: 'LID_OPENED' });
          break;

        case 'session_started':
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
          if (user?.id && boxId) {
            await enqueueSession({
              boxId,
              seq: boxMessage.seq,
              userId: user.id,
              durationMs: boxMessage.durationMs,
              completed: boxMessage.completed,
              withPod: true,
              category: state.category,
            });
            flushOutbox().catch(() => {});
          }
          await sendSessionAck(boxMessage.seq);
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
      resetMessage();
    })();
    // state.category läses vid enqueue men ska inte trigga om effekten på
    // nytt — den är redan aktuell när session_ended faktiskt kan inträffa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxMessage]);

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
