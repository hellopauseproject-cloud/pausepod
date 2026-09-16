import { FontAwesome, FontAwesome5 } from '@expo/vector-icons';
import { decode } from 'base64-arraybuffer';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { saveProfile } from './userProfile';

const FILES_PATH = FileSystem.documentDirectory + 'selectedFiles.json';

type SelfText = { id: string; text_content: string; created_at: string };

export default function ProfileScreen() {
  const { signOut, user } = useAuth();
  const navigation = useNavigation();
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [voiceFile, setVoiceFile] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [selfTexts, setSelfTexts] = useState<SelfText[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [newTextInput, setNewTextInput] = useState('');
  const [showAddText, setShowAddText] = useState(false);
  const [mediaPickerModal, setMediaPickerModal] = useState<'voice' | 'video' | null>(null);
  const [unsavedAction, setUnsavedAction] = useState<any>(null);

  const originalName = useRef('');
  const originalPhoto = useRef<string | null>(null);

  // Primär källa: Supabase — re-fetchar när user.id ändras (logout/login som annan)
  useEffect(() => {
    if (!user?.id) {
      setName('');
      setPhoto(null);
      setShowStats(false);
      originalName.current = '';
      originalPhoto.current = null;
      return;
    }

    const fetchProfile = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('username, avatar_url, show_stats')
        .eq('id', user.id)
        .maybeSingle();

      console.log('Fetched profile for user:', user.id, data);

      if (data) {
        const n = data.username ?? '';
        // Acceptera bara HTTPS-URLer — lokala sökvägar är enhetsspecifika och delas inte
        const p = data.avatar_url?.startsWith('https://') ? data.avatar_url : null;
        setName(n);
        setPhoto(p);
        setShowStats(data.show_stats ?? false);
        originalName.current = n;
        originalPhoto.current = p;
      }
    };

    fetchProfile();
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) { setSelfTexts([]); return; }
    supabase
      .from('user_self_texts')
      .select('id, text_content, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setSelfTexts(data as SelfText[]); });
  }, [user?.id]);

  // Röst/video-filer laddas om varje gång skärmen får fokus (t.ex. efter inspelning)
  useFocusEffect(useCallback(() => {
    const loadFiles = async () => {
      try {
        const savedFiles = await FileSystem.readAsStringAsync(FILES_PATH);
        const { voice, video } = JSON.parse(savedFiles);
        if (voice) setVoiceFile(voice);
        if (video) setVideoFile(video);
      } catch (e) {}
    };
    loadFiles();
  }, []));

  const toggleShowStats = async (value: boolean) => {
    setShowStats(value);
    if (!user) return;
    await supabase.from('profiles').update({ show_stats: value }).eq('id', user.id);
  };

  const uploadAvatar = async (localUri: string): Promise<string | null> => {
    try {
      const base64 = await FileSystem.readAsStringAsync(localUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const path = `${user!.id}/avatar.jpg`;
      const { error } = await supabase.storage
        .from('avatars')
        .upload(path, decode(base64), { contentType: 'image/jpeg', upsert: true });
      if (error) { console.log('Avatar upload error:', error.message); return null; }
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      return data.publicUrl + '?t=' + Date.now();
    } catch (e) {
      console.log('Avatar upload failed:', e);
      return null;
    }
  };

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      const dest = FileSystem.documentDirectory + 'profilePhoto.jpg';
      await FileSystem.copyAsync({ from: uri, to: dest });
      setPhoto(dest);
      setHasChanges(true);
    }
  };

  const saveFiles = async (voice: string | null, video: string | null) => {
    await FileSystem.writeAsStringAsync(FILES_PATH, JSON.stringify({ voice, video }));
  };

  const pickVoiceFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      const dest = FileSystem.documentDirectory + 'voiceMessage.m4a';
      await FileSystem.copyAsync({ from: uri, to: dest });
      setVoiceFile(dest);
      await saveFiles(dest, videoFile);
      setHasChanges(true);
    }
  };

  const pickVideoFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: 'video/*', copyToCacheDirectory: true });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      const dest = FileSystem.documentDirectory + 'videoMessage.mp4';
      await FileSystem.copyAsync({ from: uri, to: dest });
      setVideoFile(dest);
      await saveFiles(voiceFile, dest);
      setHasChanges(true);
    }
  };

  const handleSave = async () => {
    if (!user?.id) return;
    setUploading(true);

    let avatarUrl: string | null = photo;

    // Om foto är en lokal fil — ladda upp till Supabase Storage och få publik URL
    if (photo && !photo.startsWith('https://')) {
      const uploaded = await uploadAvatar(photo);
      if (uploaded) {
        avatarUrl = uploaded;
        setPhoto(uploaded);
      } else {
        // Upload misslyckades — spara inte lokal sökväg, behåll ev. befintlig URL
        avatarUrl = originalPhoto.current?.startsWith('https://') ? originalPhoto.current : null;
      }
    }

    await supabase
      .from('profiles')
      .update({ username: name.trim() || 'Okänd', avatar_url: avatarUrl })
      .eq('id', user.id);

    // Lokal kopia för call/voice-skärmar (bakåtkompatibilitet)
    await saveProfile(name.trim() || 'Dig själv', photo);

    originalName.current = name;
    originalPhoto.current = avatarUrl;
    setUploading(false);
    setHasChanges(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const reloadSelfTexts = async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('user_self_texts')
      .select('id, text_content, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (data) setSelfTexts(data as SelfText[]);
  };

  const handleAddText = async () => {
    if (!newTextInput.trim() || !user?.id) return;
    const { error } = await supabase
      .from('user_self_texts')
      .insert({ user_id: user.id, text_content: newTextInput.trim() });
    if (error) {
      Alert.alert('Kunde inte spara', 'Kontrollera anslutningen och försök igen.');
      return;
    }
    await reloadSelfTexts();
    setNewTextInput('');
    setShowAddText(false);
  };

  const handleUpdateText = async (id: string) => {
    if (!editValue.trim()) return;
    const { error } = await supabase
      .from('user_self_texts')
      .update({ text_content: editValue.trim() })
      .eq('id', id);
    if (!error) {
      setSelfTexts(prev => prev.map(t => t.id === id ? { ...t, text_content: editValue.trim() } : t));
      setEditingId(null);
    }
  };

  const handleDeleteText = (id: string) => {
    Alert.alert('Ta bort text', 'Vill du ta bort det här meddelandet?', [
      { text: 'Avbryt', style: 'cancel' },
      {
        text: 'Ta bort', style: 'destructive',
        onPress: async () => {
          await supabase.from('user_self_texts').delete().eq('id', id);
          setSelfTexts(prev => prev.filter(t => t.id !== id));
        },
      },
    ]);
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      if (!hasChanges) return;
      e.preventDefault();
      setUnsavedAction(e.data.action);
    });
    return unsubscribe;
  }, [hasChanges, navigation]);

  const handleBack = () => {
    if (hasChanges) setUnsavedAction('back');
    else router.back();
  };

  const handleUnsavedDiscard = () => {
    const action = unsavedAction;
    setUnsavedAction(null);
    if (action === 'back') router.back();
    else navigation.dispatch(action);
  };

  const handleUnsavedSave = async () => {
    const action = unsavedAction;
    setUnsavedAction(null);
    await handleSave();
    if (action === 'back') router.back();
    else navigation.dispatch(action);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#1a1a2e' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">

      {/* Topbar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <FontAwesome name="chevron-left" size={16} color="#2e86de" />
          <Text style={styles.backText}>Tillbaka</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.pageTitle}>Min profil</Text>

      {/* Profilbild */}
      <View style={styles.avatarSection}>
        <TouchableOpacity onPress={pickPhoto} style={styles.avatarWrapper}>
          {photo ? (
            <Image source={{ uri: photo }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <FontAwesome5 name="user" size={40} color="#2e86de" />
            </View>
          )}
          <View style={styles.cameraIcon}>
            <FontAwesome5 name="camera" size={14} color="white" />
          </View>
        </TouchableOpacity>

        <TextInput
          style={styles.nameInput}
          placeholder="Ditt namn"
          placeholderTextColor="#555"
          value={name}
          onChangeText={t => { setName(t); setHasChanges(true); }}
          autoCapitalize="words"
        />
      </View>

      {/* Meddelanden */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Mina meddelanden</Text>
        <Text style={styles.sectionSubtitle}>
          Spelas upp när du tar emot ett samtal från dig själv. 
        </Text>

        <TouchableOpacity style={styles.fileRow} onPress={() => setMediaPickerModal('voice')}>
          <View style={styles.fileLeft}>
            <View style={[styles.fileIcon, voiceFile && styles.fileIconDone]}>
              <FontAwesome5 name="microphone" size={18} color={voiceFile ? '#27ae60' : '#2e86de'} />
            </View>
            <View>
              <Text style={styles.fileLabel}>Röstmeddelande</Text>
              <Text style={styles.fileStatus}>{voiceFile ? 'Uppladdad' : 'Ingen fil vald'}</Text>
            </View>
          </View>
          <FontAwesome5 name="chevron-right" size={14} color="#555" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.fileRow} onPress={() => setMediaPickerModal('video')}>
          <View style={styles.fileLeft}>
            <View style={[styles.fileIcon, videoFile && styles.fileIconDone]}>
              <FontAwesome5 name="video" size={18} color={videoFile ? '#27ae60' : '#2e86de'} />
            </View>
            <View>
              <Text style={styles.fileLabel}>Videomeddelande</Text>
              <Text style={styles.fileStatus}>{videoFile ? 'Uppladdad' : 'Ingen fil vald'}</Text>
            </View>
          </View>
          <FontAwesome5 name="chevron-right" size={14} color="#555" />
        </TouchableOpacity>

        <Text style={styles.subsectionTitle}>Textmeddelanden</Text>
        <Text style={styles.sectionSubtitle}>
          Bara du vet vad du behöver höra.
        </Text>

        {selfTexts.map(t =>
          editingId === t.id ? (
            <View key={t.id} style={styles.textEditCard}>
              <TextInput
                style={styles.textEditInput}
                value={editValue}
                onChangeText={v => v.length <= 280 && setEditValue(v)}
                multiline
                autoFocus
                placeholderTextColor="#555"
              />
              <Text style={styles.textCharCount}>{editValue.length}/280</Text>
              <View style={styles.textEditActions}>
                <TouchableOpacity onPress={() => setEditingId(null)} style={styles.textCancelBtn}>
                  <Text style={styles.textCancelText}>Avbryt</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleUpdateText(t.id)} style={styles.textSaveBtn}>
                  <Text style={styles.textSaveText}>Spara</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View key={t.id} style={styles.textRow}>
              <TouchableOpacity
                style={styles.textRowContent}
                onPress={() => { setEditingId(t.id); setEditValue(t.text_content); }}
                activeOpacity={0.75}
              >
                <Text style={styles.textRowBody} numberOfLines={2}>{t.text_content}</Text>
                <Text style={styles.textRowDate}>
                  {new Date(t.created_at).toLocaleDateString('sv-SE')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleDeleteText(t.id)}
                style={styles.textDeleteBtn}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <FontAwesome5 name="trash-alt" size={14} color="#555" />
              </TouchableOpacity>
            </View>
          )
        )}

        {showAddText ? (
          <View style={styles.textEditCard}>
            <TextInput
              style={styles.textEditInput}
              placeholder="Skriv en hälsning..."
              placeholderTextColor="#444"
              value={newTextInput}
              onChangeText={v => v.length <= 280 && setNewTextInput(v)}
              multiline
              autoFocus
            />
            <Text style={styles.textCharCount}>{newTextInput.length}/280</Text>
            <View style={styles.textEditActions}>
              <TouchableOpacity
                onPress={() => { setShowAddText(false); setNewTextInput(''); }}
                style={styles.textCancelBtn}
              >
                <Text style={styles.textCancelText}>Avbryt</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleAddText} style={styles.textSaveBtn}>
                <Text style={styles.textSaveText}>Spara</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity style={styles.addTextBtn} onPress={() => setShowAddText(true)} activeOpacity={0.8}>
            <FontAwesome5 name="plus" size={13} color="#2e86de" />
            <Text style={styles.addTextBtnText}>Lägg till ny text</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Visa statistik för vänner */}
      <View style={styles.section}>
        <View style={styles.statsToggleRow}>
          <View style={styles.statsToggleText}>
            <Text style={styles.sectionTitle}>Visa min statistik</Text>
            <Text style={styles.sectionSubtitle}>
              Låter vänner se din veckosammanfattning.
            </Text>
          </View>
          <Switch
            value={showStats}
            onValueChange={toggleShowStats}
            trackColor={{ false: '#2a2a3e', true: '#2e86de' }}
            thumbColor="#ffffff"
          />
        </View>
      </View>

      <TouchableOpacity
        style={[styles.saveButton, saved && styles.saveButtonDone]}
        onPress={handleSave}
        disabled={uploading}
      >
        <Text style={styles.saveText}>
          {uploading ? 'Laddar upp…' : saved ? 'Sparat!' : 'Spara'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.signOutButton}
        onPress={() =>
          Alert.alert('Logga ut', 'Är du säker?', [
            { text: 'Avbryt', style: 'cancel' },
            { text: 'Logga ut', style: 'destructive', onPress: signOut },
          ])
        }
      >
        <FontAwesome name="sign-out" size={15} color="#555" />
        <Text style={styles.signOutText}>Logga ut</Text>
      </TouchableOpacity>

    </ScrollView>

      {/* Action sheet: Spela in eller Ladda upp */}
      <Modal
        visible={mediaPickerModal !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setMediaPickerModal(null)}
      >
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setMediaPickerModal(null)}>
          <View style={styles.actionSheet}>
            <Text style={styles.actionSheetTitle}>
              {mediaPickerModal === 'voice' ? 'Röstmeddelande' : 'Videomeddelande'}
            </Text>
            <TouchableOpacity
              style={styles.actionSheetBtn}
              onPress={() => {
                const type = mediaPickerModal;
                setMediaPickerModal(null);
                router.push(`/record-message?format=${type}`);
              }}
            >
              <FontAwesome5 name={mediaPickerModal === 'voice' ? 'microphone' : 'video'} size={18} color="#2e86de" />
              <Text style={styles.actionSheetBtnText}>Spela in</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionSheetBtn}
              onPress={() => {
                const type = mediaPickerModal;
                setMediaPickerModal(null);
                if (type === 'voice') pickVoiceFile();
                else pickVideoFile();
              }}
            >
              <FontAwesome5 name="upload" size={18} color="#2e86de" />
              <Text style={styles.actionSheetBtnText}>Ladda upp</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionSheetCancelBtn} onPress={() => setMediaPickerModal(null)}>
              <Text style={styles.actionSheetCancelText}>Avbryt</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>


      {/* Unsaved changes modal */}
      <Modal visible={!!unsavedAction} transparent animationType="fade" onRequestClose={() => setUnsavedAction(null)}>
        <View style={styles.unsavedOverlay}>
          <View style={styles.unsavedSheet}>
            <Text style={styles.unsavedTitle}>Osparade ändringar</Text>
            <Text style={styles.unsavedBody}>Vill du spara dina ändringar innan du lämnar?</Text>
            <TouchableOpacity style={styles.unsavedBtnSave} onPress={handleUnsavedSave}>
              <Text style={styles.unsavedBtnSaveText}>Spara</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.unsavedBtnDiscard} onPress={handleUnsavedDiscard}>
              <Text style={styles.unsavedBtnDiscardText}>Lämna utan att spara</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.unsavedBtnCancel} onPress={() => setUnsavedAction(null)}>
              <Text style={styles.unsavedBtnCancelText}>Avbryt</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#1a1a2e',
    padding: 24,
    paddingTop: 0,
    paddingBottom: 60,
  },
  topBar: {
    paddingTop: 40,
    marginBottom: 16,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingRight: 16,
  },
  backText: {
    color: '#2e86de',
    fontSize: 16,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 32,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 40,
  },
  avatarWrapper: {
    position: 'relative',
    marginBottom: 16,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: '#2e86de',
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#2a2a3e',
    borderWidth: 2,
    borderColor: '#2e86de',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraIcon: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#2e86de',
    borderRadius: 12,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameInput: {
    backgroundColor: '#2a2a3e',
    borderRadius: 16,
    padding: 14,
    fontSize: 18,
    color: 'white',
    borderWidth: 2,
    borderColor: '#2e86de',
    textAlign: 'center',
    width: '80%',
  },
  nameHint: {
    fontSize: 12,
    color: '#555',
    marginTop: 8,
    fontStyle: 'italic',
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 6,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#aaa',
    marginBottom: 16,
    lineHeight: 22,
  },
  fileRow: {
    backgroundColor: '#2a2a3e',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  fileLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  fileIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1a1a2e',
    borderWidth: 1.5,
    borderColor: '#2e86de',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileIconDone: {
    borderColor: '#27ae60',
  },
  fileLabel: {
    fontSize: 16,
    color: 'white',
    fontWeight: 'bold',
  },
  fileStatus: {
    fontSize: 13,
    color: '#777',
    marginTop: 2,
  },
  saveButton: {
    backgroundColor: '#2e86de',
    paddingVertical: 16,
    borderRadius: 32,
    alignItems: 'center',
    marginBottom: 40,
  },
  saveButtonDone: {
    backgroundColor: '#27ae60',
  },
  saveText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    marginBottom: 20,
  },
  signOutText: {
    color: '#555',
    fontSize: 14,
  },
  statsToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  statsToggleText: {
    flex: 1,
  },
  textRow: {
    backgroundColor: '#2a2a3e',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  textRowContent: {
    flex: 1,
    gap: 4,
  },
  textRowBody: {
    fontSize: 14,
    color: '#ddd',
    lineHeight: 20,
  },
  textRowDate: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
  textDeleteBtn: {
    paddingLeft: 14,
    paddingVertical: 4,
  },
  textEditCard: {
    backgroundColor: '#2a2a3e',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 8,
    borderWidth: 1.5,
    borderColor: '#2e86de',
  },
  textEditInput: {
    color: 'white',
    fontSize: 14,
    lineHeight: 22,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  textCharCount: {
    color: '#555',
    fontSize: 11,
    textAlign: 'right',
  },
  textEditActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 14,
  },
  textCancelBtn: {
    padding: 6,
  },
  textCancelText: {
    color: '#666',
    fontSize: 14,
  },
  textSaveBtn: {
    backgroundColor: '#2e86de',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 18,
  },
  textSaveText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  addTextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#2e86de',
    justifyContent: 'center',
  },
  addTextBtnText: {
    color: '#2e86de',
    fontSize: 14,
  },
  subsectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginTop: 12,
    marginBottom: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  actionSheet: {
    backgroundColor: '#1e1e30',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    gap: 12,
  },
  actionSheetTitle: {
    color: 'white',
    fontSize: 17,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  actionSheetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#2a2a3e',
    borderRadius: 16,
    padding: 18,
  },
  actionSheetBtnText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
  },
  actionSheetCancelBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 4,
  },
  actionSheetCancelText: {
    color: '#888',
    fontSize: 15,
  },
  unsavedOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  unsavedSheet: {
    backgroundColor: '#1e1e30',
    borderRadius: 24,
    padding: 28,
    width: '100%',
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  unsavedTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 2,
  },
  unsavedBody: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 8,
  },
  unsavedBtnSave: {
    backgroundColor: '#2e86de',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  unsavedBtnSaveText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  unsavedBtnDiscard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  unsavedBtnDiscardText: {
    color: 'rgba(255,80,80,0.85)',
    fontSize: 15,
    fontWeight: '500',
  },
  unsavedBtnCancel: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  unsavedBtnCancelText: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 14,
  },
});
