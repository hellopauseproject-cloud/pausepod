import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// Den riktiga databasen är förval. För att köra appen mot testprojektet
// (t.ex. för lådans taggregistrering) sätts båda i en .env.local:
//   EXPO_PUBLIC_SUPABASE_URL=https://xmbifegxahijdkvykjdb.supabase.co
//   EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_…
// och Expo startas om. Inloggningen gäller då bara testprojektets konton.
const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://iwyumzgewiwvcbuqzjnk.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_cqX_cT1CBZ8oqOnNd1alfA_JZQDUqOQ';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
