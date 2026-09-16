import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

export type OutgoingInvite = { sharedSessionId: string; friendName: string; category?: string | null };
export type InviteStatus = 'waiting' | 'accepted' | 'declined' | null;

type InviteContextType = {
  outgoingInvite: OutgoingInvite | null;
  inviteStatus: InviteStatus;
  setOutgoingInvite: (invite: OutgoingInvite) => void;
  clearInvite: () => void;
  cancelInvite: () => Promise<void>;
};

const InviteContext = createContext<InviteContextType | null>(null);

export function InviteProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [outgoingInvite, setOutgoingInviteState] = useState<OutgoingInvite | null>(null);
  const [inviteStatus, setInviteStatus] = useState<InviteStatus>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const clearInvite = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    setOutgoingInviteState(null);
    setInviteStatus(null);
  }, []);

  const setOutgoingInvite = useCallback((invite: OutgoingInvite) => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    setOutgoingInviteState(invite);
    setInviteStatus('waiting');
  }, []);

  const cancelInvite = useCallback(async () => {
    if (!outgoingInvite) return;
    await supabase.rpc('cancel_shared_pause', {
      p_shared_id: outgoingInvite.sharedSessionId,
    });
    clearInvite();
  }, [outgoingInvite, clearInvite]);

  // Realtime-prenumeration — lever kvar oavsett aktiv skärm
  useEffect(() => {
    if (!outgoingInvite || !user) return;

    const { sharedSessionId, friendName } = outgoingInvite;

    const checkMySession = async () => {
      const { data } = await supabase
        .from('pause_sessions')
        .select('invite_status')
        .eq('shared_session_id', sharedSessionId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!data) { clearInvite(); return; }

      if (data.invite_status === 'accepted') {
        const cat = outgoingInvite.category;
        clearInvite();
        router.replace({
          pathname: '/pausing',
          params: { mode: 'session', sharedSessionId, sharedWithName: friendName, category: cat ?? '' },
        } as never);
      } else if (data.invite_status === 'declined') {
        setInviteStatus('declined');
      }
    };

    const channel = supabase
      .channel('invite-ctx-' + sharedSessionId)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pause_sessions' }, () => {
        checkMySession();
      })
      .subscribe();

    channelRef.current = channel;

    // Polling som backup ifall realtime-event missas
    const poll = setInterval(checkMySession, 3000);

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
      clearInterval(poll);
    };
  }, [outgoingInvite, user, clearInvite]);

  return (
    <InviteContext.Provider value={{ outgoingInvite, inviteStatus, setOutgoingInvite, clearInvite, cancelInvite }}>
      {children}
    </InviteContext.Provider>
  );
}

export function useInvite() {
  const ctx = useContext(InviteContext);
  if (!ctx) throw new Error('useInvite måste användas inom InviteProvider');
  return ctx;
}
