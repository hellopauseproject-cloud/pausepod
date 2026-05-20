import { FontAwesome, FontAwesome5 } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Notifications from 'expo-notifications';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getProfile } from '../userProfile';

Notifications.addNotificationResponseReceivedListener((response) => {
  const data = response.notification.request.content.data;
  if (data?.type === 'fake_call') {
    router.push('/call');
  }
});

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export default function HomeScreen() {
  const [tapCount, setTapCount] = useState(0);
  const [showDebug, setShowDebug] = useState(false);
  const [userName, setUserName] = useState('');

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;
  const greetingAnim = useRef(new Animated.Value(0)).current;
  const floatAnim = useRef(new Animated.Value(0)).current;

  // Ladda namn varje gång skärmen får fokus
  useFocusEffect(
    useCallback(() => {
      const loadProfile = async () => {
        const profile = await getProfile();
        if (profile.name && profile.name !== 'Dig själv') {
          setUserName(profile.name);
        } else {
          setUserName('');
        }
      };
      loadProfile();
    }, [])
  );

  useEffect(() => {
    const checkOnboarding = async () => {
      try {
        await FileSystem.readAsStringAsync(
          FileSystem.documentDirectory + 'onboardingDone.json'
        );
      } catch (e) {
        setTimeout(() => {
          router.replace('/onboarding-flow');
        }, 100);
      }
    };
    checkOnboarding();

    Notifications.requestPermissionsAsync();

    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 800, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
    ]).start(() => {
      Animated.timing(greetingAnim, { toValue: 1, duration: 600, useNativeDriver: true, easing: Easing.out(Easing.cubic) }).start();
    });

    Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, { toValue: -6, duration: 2200, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
        Animated.timing(floatAnim, { toValue: 0, duration: 2200, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
      ])
    ).start();
  }, []);

  const handleSecretTap = () => {
    if (showDebug) {
      const newCount = tapCount + 1;
      setTapCount(newCount);
      if (newCount >= 2) { setShowDebug(false); setTapCount(0); }
      return;
    }
    const newCount = tapCount + 1;
    setTapCount(newCount);
    if (newCount >= 10) { setShowDebug(true); setTapCount(0); }
  };

  const sendFakeCall = async () => {
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Ring ring! 📞', body: 'Samtal från dig själv', data: { type: 'fake_call' } },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
      },
    });
  };

  const checkScheduled = async () => {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    Alert.alert(
      'Schemalagda notiser',
      scheduled.length === 0
        ? 'Inga notiser schemalagda!'
        : `${scheduled.length} notiser schemalagda\n\n` +
          scheduled.slice(0, 5).map(n => {
            const trigger = n.trigger as any;
            const date = new Date(trigger.value ?? trigger.dateComponents ?? trigger.date);
            return `⏰ ${date.toLocaleDateString('sv-SE')} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
          }).join('\n') + (scheduled.length > 5 ? `\n...och ${scheduled.length - 5} till` : '')
    );
  };

  const resetOnboarding = async () => {
    try {
      await FileSystem.deleteAsync(FileSystem.documentDirectory + 'onboardingDone.json');
      Alert.alert('Klart!', 'Starta om appen för att se onboarding igen.');
    } catch (e) {}
  };

  return (
    <View style={styles.container}>

      <Animated.View style={[styles.topBar, { opacity: fadeAnim }]}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.push('/stats')}>
          <FontAwesome name="bar-chart" size={20} color="#2e86de" />
        </TouchableOpacity>
        <TouchableOpacity onPress={handleSecretTap} activeOpacity={1}>
          <View style={styles.logoRow}>
            <FontAwesome name="pause" size={16} color="#2e86de" />
            <Text style={styles.logoText}>PAUSE POD</Text>
          </View>
        </TouchableOpacity>

      <View style={styles.rightButtons}>
  <TouchableOpacity style={styles.iconButton} onPress={() => router.push('/profile')}>
    <FontAwesome5 name="user-circle" size={20} color="#2e86de" />
  </TouchableOpacity>
  <TouchableOpacity style={styles.iconButton} onPress={() => router.push('/onboarding')}>
    <FontAwesome name="sliders" size={20} color="#2e86de" />
  </TouchableOpacity>
</View>
      </Animated.View>

      <View style={styles.center}>
        <Animated.View style={{
          opacity: greetingAnim,
          transform: [{ translateY: Animated.multiply(greetingAnim, new Animated.Value(-1)).interpolate({ inputRange: [-1, 0], outputRange: [12, 0] }) }]
        }}>
          {userName ? (
            <Text style={styles.greeting}>Hej {userName},</Text>
          ) : null}
          <Text style={styles.greetingSub}>redo för en paus?</Text>
        </Animated.View>

        <Animated.View style={[styles.pauseButtonWrap, { transform: [{ translateY: floatAnim }] }]}>
          <TouchableOpacity
            style={styles.pauseButton}
            onPress={() => router.push('/pause')}
            activeOpacity={0.85}
          >
            <FontAwesome name="pause" size={28} color="white" />
            <Text style={styles.pauseButtonText}>TA EN PAUS</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>

      {showDebug && (
        <Animated.View style={[styles.debugContainer, { opacity: fadeAnim }]}>
          <TouchableOpacity style={styles.debugButton} onPress={sendFakeCall}>
            <Text style={styles.debugText}>📞 Simulera inkommande samtal</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.debugButton} onPress={checkScheduled}>
            <Text style={styles.debugText}>📋 Visa schemalagda notiser</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.debugButton} onPress={resetOnboarding}>
            <Text style={styles.debugText}>🔄 Återställ onboarding</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
    paddingTop: 60,
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginTop: 15,
    marginBottom: -50,
  },
  rightButtons: {
    flexDirection: 'column',
    gap: 8,
    alignItems: 'center',
  },
  iconButton: {
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e2a3a',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  logoText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#2e86de',
    letterSpacing: 4,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 48,
    marginBottom: 60,
  },
  greeting: {
    fontSize: 30,
    fontWeight: '700',
    color: 'white',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  greetingSub: {
    fontSize: 20,
    color: '#5a7fa8',
    textAlign: 'center',
    marginTop: 4,
    letterSpacing: 0.3,
  },
  pauseButtonWrap: {
    alignItems: 'center',
  },
  pauseButton: {
    backgroundColor: '#2e86de',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 15,
    paddingHorizontal: 36,
    borderRadius: 40,
    shadowColor: '#2e86de',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 12,
  },
  pauseButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 3,
  },
  debugContainer: {
    alignItems: 'center',
    gap: 10,
    paddingBottom: 10,
  },
  debugButton: {
    backgroundColor: '#1a1a2e',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 50,
    borderWidth: 1,
    borderColor: '#2e86de',
  },
  debugText: {
    color: 'white',
    fontSize: 13,
  },
});
