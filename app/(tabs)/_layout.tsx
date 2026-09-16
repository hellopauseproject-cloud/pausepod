import { FontAwesome, FontAwesome5 } from '@expo/vector-icons';
import { Tabs, usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const pathname = usePathname();
  const [requestCount, setRequestCount] = useState(0);
  const [inviteCount, setInviteCount] = useState(0);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const fetchCount = () => {
    if (!user) { setRequestCount(0); return; }
    supabase
      .from('friendships')
      .select('id', { count: 'exact', head: true })
      .eq('receiver_id', user.id)
      .eq('status', 'pending')
      .then(({ count }) => setRequestCount(count ?? 0));
  };

  const fetchInviteCount = () => {
    if (!user) { setInviteCount(0); return; }
    supabase
      .from('pause_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('invite_status', 'pending')
      .is('ended_at', null)
      .then(({ count }) => setInviteCount(count ?? 0));
  };

  useEffect(() => {
    fetchCount();
    fetchInviteCount();
  }, [user, pathname]);

  // Polling som backup — garanterar snabb uppdatering även om realtime missar
  useEffect(() => {
    if (!user) return;
    const poll = setInterval(() => { fetchCount(); fetchInviteCount(); }, 2000);
    return () => clearInterval(poll);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    const channel = supabase
      .channel(`tab-friendships-${user.id}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, fetchCount)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pause_sessions' }, fetchInviteCount)
      .subscribe();
    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [user]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0f0f1a',
          borderTopColor: '#1a1a2e',
          borderTopWidth: 1,
          height: 56 + insets.bottom,
          paddingBottom: insets.bottom + 6,
          paddingTop: 6,
        },
        tabBarActiveTintColor: '#2e86de',
        tabBarInactiveTintColor: '#2a2a4a',
        tabBarLabelStyle: {
          fontSize: 10,
          letterSpacing: 1.5,
          fontWeight: '600',
          textTransform: 'uppercase',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Paus',
          tabBarIcon: ({ color }) => (
            <FontAwesome name="pause" size={18} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: 'Vänner',
          tabBarIcon: ({ color }) => (
            <FontAwesome5 name="user-friends" size={16} color={color} />
          ),
          tabBarBadge: (requestCount + inviteCount) > 0 ? '?' : undefined,
          tabBarBadgeStyle: {
            backgroundColor: '#2e86de',
            fontSize: 9,
            minWidth: 16,
            height: 16,
            lineHeight: 16,
          },
        }}
      />
    </Tabs>
  );
}
