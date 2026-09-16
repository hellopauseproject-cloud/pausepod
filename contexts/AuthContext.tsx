import { Session, User } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type AuthContextType = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  onboardingCompleted: boolean | null;
  signUp: (email: string, password: string, username: string) => Promise<{ error: string | null; needsConfirmation?: boolean }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);

  useEffect(() => {
    const initSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
          console.warn('Session refresh failed:', error.message);
          if (error.message?.includes('Refresh Token') || error.message?.includes('refresh_token')) {
            await supabase.auth.signOut().catch(() => {});
          }
          setSession(null);
          setUser(null);
          return;
        }
        setSession(session);
        setUser(session?.user ?? null);
      } catch (e) {
        console.warn('Auth init error:', e);
        setSession(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    initSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth state changed:', event, session?.user?.id ?? 'no user');
      if (event === 'SIGNED_OUT') {
        setSession(null);
        setUser(null);
        return;
      }
      // Täcker även TOKEN_REFRESHED och USER_UPDATED — ny session sätts som vanligt
      setSession(session);
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Hämta onboarding-status från Supabase när user ändras
  useEffect(() => {
    if (!user) {
      setOnboardingCompleted(null);
      return;
    }

    const fetchProfile = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('onboarding_completed')
        .eq('id', user.id)
        .maybeSingle();

      setOnboardingCompleted(data?.onboarding_completed ?? false);
    };

    fetchProfile();
  }, [user]);

  const signUp = async (email: string, password: string, username: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username } },
    });
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('already registered') || msg.includes('already exists')) {
        return { error: 'E-postadressen är redan registrerad.' };
      }
      if (msg.includes('unique') || msg.includes('username')) {
        return { error: 'Användarnamnet är redan taget.' };
      }
      return { error: error.message };
    }
    // Om e-postbekräftelse krävs i Supabase-inställningarna skapas inget session direkt
    if (!data.session) {
      return { error: null, needsConfirmation: true };
    }
    return { error: null };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  };

  const signOut = async () => {
    try {
      if (user) {
        await supabase.from('profiles').update({ push_token: null }).eq('id', user.id);
      }
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('Sign out error:', e);
    } finally {
      setSession(null);
      setUser(null);
    }
  };

  // DB-uppdateringen sker i onboarding-flow.tsx direkt med logging.
  // Den här funktionen uppdaterar bara lokal state.
  const completeOnboarding = async () => {
    setOnboardingCompleted(true);
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, onboardingCompleted, signUp, signIn, signOut, completeOnboarding }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth måste användas inom AuthProvider');
  return ctx;
}
