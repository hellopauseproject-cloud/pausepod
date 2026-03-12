import { FontAwesome, FontAwesome5 } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { getProfile, saveProfile } from './userProfile';

const FILES_PATH = FileSystem.documentDirectory + 'selectedFiles.json';

export default function ProfileScreen() {
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [voiceFile, setVoiceFile] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const originalName = useRef('');
  const originalPhoto = useRef<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const profile = await getProfile();
      const loadedName = profile.name === 'Dig själv' ? '' : profile.name;
      setName(loadedName);
      setPhoto(profile.photoUri);
      originalName.current = loadedName;
      originalPhoto.current = profile.photoUri;

      try {
        const savedFiles = await FileSystem.readAsStringAsync(FILES_PATH);
        const { voice, video } = JSON.parse(savedFiles);
        if (voice) setVoiceFile(voice);
        if (video) setVideoFile(video);
      } catch (e) {}
    };
    load();
  }, []);

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
    await saveProfile(name.trim() || 'Dig själv', photo);
    originalName.current = name;
    originalPhoto.current = photo;
    setHasChanges(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleBack = () => {
    if (hasChanges) {
      Alert.alert(
        'Spara ändringar?',
        'Du har osparade ändringar.',
        [
          { text: 'Avbryt', style: 'cancel' },
          { text: 'Lämna utan att spara', style: 'destructive', onPress: () => router.back() },
          { text: 'Spara', onPress: async () => { await handleSave(); router.back(); } },
        ]
      );
    } else {
      router.back();
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>

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
        <Text style={styles.nameHint}>Visas när du ringer dig själv</Text>
      </View>

      {/* Meddelanden */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Mina meddelanden</Text>
        <Text style={styles.sectionSubtitle}>
          Spela in ett röst- eller videomeddelande till dig själv och ladda upp det här.
        </Text>

        <TouchableOpacity style={styles.fileRow} onPress={pickVoiceFile}>
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

        <TouchableOpacity style={styles.fileRow} onPress={pickVideoFile}>
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
      </View>

      <TouchableOpacity
        style={[styles.saveButton, saved && styles.saveButtonDone]}
        onPress={handleSave}
      >
        <Text style={styles.saveText}>{saved ? 'Sparat!' : 'Spara'}</Text>
      </TouchableOpacity>

    </ScrollView>
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
});
