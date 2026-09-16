import { FontAwesome } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import RecordScreen from './components/RecordScreen';

const FILES_PATH = FileSystem.documentDirectory + 'selectedFiles.json';

export default function RecordMessageScreen() {
  const { format } = useLocalSearchParams<{ format: string }>();

  if (format !== 'voice' && format !== 'video') {
    router.back();
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <FontAwesome name="chevron-left" size={16} color="#2e86de" />
          <Text style={styles.backText}>Tillbaka</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.title}>
        {format === 'voice' ? 'Röstmeddelande' : 'Videomeddelande'}
      </Text>
      <RecordScreen
        format={format}
        onComplete={async (savedUri) => {
          try {
            let current = { voice: null as string | null, video: null as string | null };
            try {
              const raw = await FileSystem.readAsStringAsync(FILES_PATH);
              current = JSON.parse(raw);
            } catch {}
            if (format === 'voice') current.voice = savedUri;
            else current.video = savedUri;
            await FileSystem.writeAsStringAsync(FILES_PATH, JSON.stringify(current));
          } catch {}
          router.back();
        }}
        onBack={() => router.back()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  topBar: {
    paddingTop: 56,
    paddingHorizontal: 24,
    marginBottom: 4,
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
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
    paddingHorizontal: 24,
    marginBottom: 8,
  },
});
