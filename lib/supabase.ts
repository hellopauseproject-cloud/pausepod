import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://iwyumzgewiwvcbuqzjnk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_cqX_cT1CBZ8oqOnNd1alfA_JZQDUqOQ';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
