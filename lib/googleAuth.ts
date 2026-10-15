import { makeRedirectUri } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabase';

// Krävs för att stänga webbläsarfliken korrekt vid omdirigering
WebBrowser.maybeCompleteAuthSession();

export async function signInWithGoogle(): Promise<{ error: string | null }> {
  const redirectTo = makeRedirectUri({ scheme: 'pauseapp', path: 'auth/callback' });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });

  if (error || !data.url) {
    return { error: error?.message ?? 'Could not start Google sign-in.' };
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  if (result.type !== 'success' || !result.url) {
    // Avbrutet av användaren — inget felmeddelande behövs
    return { error: null };
  }

  const url = new URL(result.url);

  // PKCE-flöde: kod i query-parametrar
  const code = url.searchParams.get('code');
  if (code) {
    const { error: sessionError } = await supabase.auth.exchangeCodeForSession(code);
    return { error: sessionError?.message ?? null };
  }

  // Implicit flöde: tokens i hash-fragmentet
  const params = new URLSearchParams(url.hash.slice(1));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken) {
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    return { error: sessionError?.message ?? null };
  }

  return { error: 'Could not complete Google sign-in.' };
}
