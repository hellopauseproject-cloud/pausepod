import { FontAwesome5 } from '@expo/vector-icons';
import { router } from 'expo-router';
import DismissKeyboardView from './components/DismissKeyboardView';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types/database';

/*
  Supabase RPC-funktion som behövs i databasen:

  CREATE OR REPLACE FUNCTION search_profiles(search_query TEXT)
  RETURNS TABLE(id UUID, username TEXT, avatar_url TEXT)
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$
    SELECT id, username, avatar_url
    FROM profiles
    WHERE username ILIKE '%' || search_query || '%'
      AND length(trim(search_query)) >= 2
    ORDER BY username
    LIMIT 10;
  $$;
*/

type SearchResult = Pick<Profile, 'id' | 'username' | 'avatar_url'>;

function Avatar({ username, avatarUrl, size = 42 }: { username: string; avatarUrl?: string | null; size?: number }) {
  if (avatarUrl) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }
  return (
    <View style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarLetter, { fontSize: size * 0.38 }]}>
        {username[0]?.toUpperCase() ?? '?'}
      </Text>
    </View>
  );
}

export default function AddFriendScreen() {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [existingRelationIds, setExistingRelationIds] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ladda befintliga relationer för filtrering
  useEffect(() => {
    if (!user) return;
    supabase
      .from('friendships')
      .select('requester_id, receiver_id')
      .or(`requester_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .then(({ data }) => {
        const ids = new Set<string>();
        for (const rel of data ?? []) {
          ids.add(rel.requester_id);
          ids.add(rel.receiver_id);
        }
        ids.delete(user.id); // ta inte bort sig själv här, hanteras separat
        setExistingRelationIds(ids);
      });
  }, [user]);

  const search = useCallback(
    async (text: string) => {
      if (!user || text.trim().length < 2) {
        setResults([]);
        return;
      }
      setSearching(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, avatar_url')
        .ilike('username', `%${text.trim()}%`)
        .neq('id', user.id)
        .limit(10);
      setSearching(false);

      const filtered = (data ?? []).filter(
        (p: SearchResult) => !existingRelationIds.has(p.id)
      );
      setResults(filtered);
    },
    [user, existingRelationIds]
  );

  const handleChangeText = (text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(text), 350);
  };

  const sendRequest = async (targetId: string) => {
    if (!user) return;
    setSentIds(prev => new Set(prev).add(targetId));
    await supabase.from('friendships').insert({
      requester_id: user.id,
      receiver_id: targetId,
      status: 'pending',
    });
    // Lägg till i existing så resultatet filtreras bort vid ny sökning
    setExistingRelationIds(prev => new Set(prev).add(targetId));
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <DismissKeyboardView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <FontAwesome5 name="arrow-left" size={16} color="#5a7fa8" />
        </TouchableOpacity>
        <Text style={styles.title}>Lägg till vän.</Text>
        <Text style={styles.subtitle}>Sök på användarnamn.</Text>
      </View>

      {/* Sökfält */}
      <View style={styles.searchRow}>
        <FontAwesome5 name="search" size={14} color="#3a3a6a" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Sök användarnamn..."
          placeholderTextColor="#3a3a6a"
          value={query}
          onChangeText={handleChangeText}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          returnKeyType="search"
        />
        {searching && (
          <ActivityIndicator size="small" color="#2e86de" style={{ marginRight: 12 }} />
        )}
      </View>

      {/* Resultat */}
      <View style={styles.results}>
        {query.trim().length >= 2 && !searching && results.length === 0 && (
          <Text style={styles.noResults}>Ingen hittades med det användarnamnet.</Text>
        )}

        {results.map(profile => {
          const sent = sentIds.has(profile.id);
          return (
            <View key={profile.id} style={styles.resultRow}>
              <Avatar username={profile.username} avatarUrl={profile.avatar_url} />
              <Text style={styles.resultUsername}>{profile.username}</Text>
              <TouchableOpacity
                style={[styles.sendBtn, sent && styles.sendBtnSent]}
                onPress={() => !sent && sendRequest(profile.id)}
                disabled={sent}
                activeOpacity={0.8}
              >
                <Text style={[styles.sendBtnText, sent && styles.sendBtnTextSent]}>
                  {sent ? 'Skickad' : 'Lägg till'}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
      </DismissKeyboardView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
    paddingHorizontal: 28,
    paddingTop: 70,
  },

  // Header
  header: {
    gap: 8,
    marginBottom: 28,
  },
  backBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 4,
  },
  title: {
    fontSize: 36,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.2,
    lineHeight: 44,
  },
  subtitle: {
    fontSize: 15,
    color: '#5a7fa8',
    letterSpacing: 0.2,
  },

  // Search
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e2a3a',
    marginBottom: 20,
  },
  searchIcon: {
    paddingLeft: 16,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 15,
    paddingHorizontal: 12,
    fontSize: 16,
    color: '#ffffff',
  },

  // Results
  results: {
    gap: 8,
  },
  noResults: {
    color: '#3a3a5a',
    fontSize: 14,
    textAlign: 'center',
    paddingTop: 24,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e2a3a',
  },
  resultUsername: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#e8e8f0',
    letterSpacing: 0.2,
  },
  sendBtn: {
    backgroundColor: '#2e86de',
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  sendBtnSent: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#2a2a4a',
  },
  sendBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  sendBtnTextSent: {
    color: '#3a3a6a',
  },

  // Avatar
  avatarFallback: {
    backgroundColor: '#2a2a3e',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2e2e5a',
  },
  avatarLetter: {
    color: '#7a9aba',
    fontWeight: '700',
  },
});
