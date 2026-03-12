import { FontAwesome } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getSelectedCategories } from './pauseLogger';
import { getProfile } from './userProfile';

export default function OnboardingCompleteScreen() {
  const [hasFiles, setHasFiles] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [hasCategories, setHasCategories] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const line1Anim = useRef(new Animated.Value(0)).current;
  const line2Anim = useRef(new Animated.Value(0)).current;
  const line3Anim = useRef(new Animated.Value(0)).current;
  const line4Anim = useRef(new Animated.Value(0)).current;
  const buttonAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const checkData = async () => {
      try {
        const saved = await FileSystem.readAsStringAsync(
          FileSystem.documentDirectory + 'selectedFiles.json'
        );
        const { voice, video } = JSON.parse(saved);
        if (voice || video) setHasFiles(true);
      } catch (e) {}

      try {
        const profile = await getProfile();
        if (profile.name && profile.name !== 'Dig själv' && profile.photoUri) {
          setHasProfile(true);
        }
      } catch (e) {}

      try {
        const cats = await getSelectedCategories();
        if (cats.length > 0) setHasCategories(true);
      } catch (e) {}
    };
    checkData();

    Animated.sequence([
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, friction: 6, useNativeDriver: true }),
      ]),
      Animated.timing(line1Anim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(line2Anim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(line3Anim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(line4Anim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(buttonAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  const allDone = hasFiles && hasProfile && hasCategories;

  return (
    <View style={styles.container}>
      <Animated.View style={{ opacity: fadeAnim, alignItems: 'center', position: 'absolute', top: 60 }}>
        <FontAwesome name="pause" size={32} color="#2e86de" />
        <Text style={styles.logoText}>PAUSE POD</Text>
      </Animated.View>

      <Animated.View style={{ opacity: fadeAnim, alignItems: 'center' }}>
        <Text style={styles.title}>{allDone ? 'Allt klart! ' : 'Nästan klart! '}</Text>
        <Text style={styles.subtitle}>
          {allDone
            ? 'Du är redo att börja din resa med Pause Pod.'
            : 'Några steg kvar innan du är helt redo.'}
        </Text>
      </Animated.View>

      <View style={styles.rows}>
        {/* Steg 1 - Profil */}
        <Animated.View style={{ opacity: line1Anim, width: '100%' }}>
          <TouchableOpacity
            style={[styles.row, !hasProfile && styles.rowWarning]}
            onPress={() => !hasProfile && router.push('/onboarding')}
            disabled={hasProfile}
          >
            <View style={[styles.rowDot, !hasProfile && styles.rowDotWarning]} />
            <Text style={styles.rowText}>
              {hasProfile ? 'Profil och namn uppdaterat' : 'Profilbild och namn saknas →'}
            </Text>
            <FontAwesome
              name={hasProfile ? 'check' : 'exclamation'}
              size={14}
              color={hasProfile ? '#27ae60' : '#f39c12'}
            />
          </TouchableOpacity>
        </Animated.View>

        {/* Steg 2 - Video/röst */}
        <Animated.View style={{ opacity: line2Anim, width: '100%' }}>
          <TouchableOpacity
            style={[styles.row, !hasFiles && styles.rowWarning]}
            onPress={() => !hasFiles && router.push('/onboarding')}
            disabled={hasFiles}
          >
            <View style={[styles.rowDot, !hasFiles && styles.rowDotWarning]} />
            <Text style={styles.rowText}>
              {hasFiles ? 'Ditt meddelande är uppladdat' : 'Ladda upp ditt meddelande →'}
            </Text>
            <FontAwesome
              name={hasFiles ? 'check' : 'exclamation'}
              size={14}
              color={hasFiles ? '#27ae60' : '#f39c12'}
            />
          </TouchableOpacity>
        </Animated.View>

        {/* Steg 3 - Påminnelser */}
        <Animated.View style={{ opacity: line3Anim, width: '100%' }}>
          <View style={styles.row}>
            <View style={styles.rowDot} />
            <Text style={styles.rowText}>Påminnelser är schemalagda</Text>
            <FontAwesome name="check" size={14} color="#27ae60" />
          </View>
        </Animated.View>

        {/* Steg 4 - Kategorier */}
        <Animated.View style={{ opacity: line4Anim, width: '100%' }}>
          <TouchableOpacity
            style={[styles.row, !hasCategories && styles.rowWarning]}
            onPress={() => !hasCategories && router.push('/onboarding')}
            disabled={hasCategories}
          >
            <View style={[styles.rowDot, !hasCategories && styles.rowDotWarning]} />
            <Text style={styles.rowText}>
              {hasCategories ? 'Pausaktiviteter valda' : 'Välj dina pausaktiviteter →'}
            </Text>
            <FontAwesome
              name={hasCategories ? 'check' : 'exclamation'}
              size={14}
              color={hasCategories ? '#27ae60' : '#f39c12'}
            />
          </TouchableOpacity>
        </Animated.View>
      </View>

      <Animated.Text style={[styles.quote, { opacity: buttonAnim }]}>
        "Varje paus är ett steg mot mer närvaro."
      </Animated.Text>

      <Animated.View style={[{ width: '100%' }, { opacity: buttonAnim }]}>
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.replace('/(tabs)')}
        >
          <Text style={styles.buttonText}>
            {allDone ? 'Börja din resa →' : 'Fortsätt ändå →'}
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    paddingTop: 40,
    gap: 24,
  },
  logoText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2e86de',
    letterSpacing: 4,
    marginTop: 4,
  },
  title: {
    fontSize: 40,
    fontWeight: 'bold',
    color: 'white',
    letterSpacing: 2,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#aaa',
    textAlign: 'center',
    lineHeight: 26,
  },
  rows: {
    width: '100%',
    gap: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#2a2a3e',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowWarning: {
    borderColor: '#f39c12',
  },
  rowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2e86de',
  },
  rowDotWarning: {
    backgroundColor: '#f39c12',
  },
  rowText: {
    color: 'white',
    fontSize: 15,
    flex: 1,
  },
  quote: {
    fontSize: 15,
    color: '#aaa',
    textAlign: 'center',
    fontStyle: 'italic',
    lineHeight: 24,
  },
  button: {
    backgroundColor: '#2e86de',
    paddingVertical: 18,
    borderRadius: 32,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
});
