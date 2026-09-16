import { FontAwesome5 } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import DismissKeyboardView from './components/DismissKeyboardView';
import { useState } from 'react';
import {
  KeyboardAvoidingView, Platform, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

export default function SupportRespondTextScreen() {
  const { user } = useAuth();
  const { storyId, ownerName } = useLocalSearchParams<{ storyId: string; ownerName: string }>();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    if (!user || !text.trim() || sending || !storyId) return;
    setSending(true);
    const { error } = await supabase.from('support_responses').insert({
      story_id: storyId,
      sender_id: user.id,
      response_type: 'text',
      text_content: text.trim(),
    });
    if (!error) {
      setSent(true);
      setTimeout(() => router.back(), 900);
    } else {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <DismissKeyboardView style={s.root}>
      <View style={s.container}>
        <View style={s.handle} />

        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.closeBtn} activeOpacity={0.7}>
            <FontAwesome5 name="times" size={15} color="rgba(255,255,255,0.4)" />
          </TouchableOpacity>
          <Text style={s.title}>Svara {ownerName}</Text>
          <View style={{ width: 40 }} />
        </View>

        <Text style={s.subtitle}>Ditt textmeddelande levereras när {ownerName} öppnar appen.</Text>

        <TextInput
          style={s.input}
          value={text}
          onChangeText={t => { if (t.length <= 300) setText(t); }}
          placeholder={`Skriv ett pepp till ${ownerName}…`}
          placeholderTextColor="rgba(255,255,255,0.2)"
          multiline
          maxLength={300}
          autoFocus
          editable={!sent}
        />
        <Text style={s.charCount}>{300 - text.length}</Text>

        <TouchableOpacity
          style={[s.sendBtn, (!text.trim() || sending || sent) && s.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!text.trim() || sending || sent}
          activeOpacity={0.85}
        >
          <FontAwesome5 name={sent ? 'check' : 'paper-plane'} size={14} color="#fff" />
          <Text style={s.sendBtnText}>
            {sent ? 'Skickat!' : sending ? 'Skickar…' : 'Skicka'}
          </Text>
        </TouchableOpacity>
      </View>
      </DismissKeyboardView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  container: {
    backgroundColor: '#13131f', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: 48, gap: 16,
    borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)', alignSelf: 'center', marginBottom: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  closeBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'flex-start' },
  title: { fontSize: 17, fontWeight: '700', color: '#ffffff', letterSpacing: 0.2 },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.3)', lineHeight: 19 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    padding: 16, color: '#ffffff', fontSize: 15,
    minHeight: 120, textAlignVertical: 'top', lineHeight: 22,
  },
  charCount: { color: 'rgba(255,255,255,0.18)', fontSize: 11, textAlign: 'right' },
  sendBtn: {
    backgroundColor: '#a29bfe', paddingVertical: 14, borderRadius: 32,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  sendBtnDisabled: { backgroundColor: 'rgba(162,155,254,0.2)' },
  sendBtnText: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },
});
