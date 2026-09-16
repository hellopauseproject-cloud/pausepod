import { FontAwesome5 } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, BackHandler, Image, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useInvite } from '../contexts/InviteContext';

export default function PauseInviteWaitingScreen() {
  const { friendName, friendAvatarUrl } = useLocalSearchParams<{
    friendName: string;
    sharedSessionId: string;
    friendAvatarUrl: string;
  }>();
  const { inviteStatus, cancelInvite, clearInvite } = useInvite();

  const pulse1 = useRef(new Animated.Value(1)).current;
  const pulse2 = useRef(new Animated.Value(1)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeIn, { toValue: 1, duration: 700, useNativeDriver: true }).start();
  }, []);

  // Mjuk andningspuls — ingen nedräkning, ingen press
  useEffect(() => {
    const breathe = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1.5, duration: 2000, useNativeDriver: true }),
          Animated.timing(val, { toValue: 1, duration: 2000, useNativeDriver: true }),
        ])
      ).start();

    breathe(pulse1, 0);
    breathe(pulse2, 700);
  }, []);

  const handleMinimize = () => {
    if (Platform.OS === 'android') {
      BackHandler.exitApp();
    } else {
      router.replace('/(tabs)' as never);
    }
  };

  const handleCancel = async () => {
    await cancelInvite();
    router.replace('/(tabs)/friends' as never);
  };

  const handleBack = async () => {
    clearInvite();
    router.replace('/(tabs)/friends' as never);
  };

  const handlePauseAnyway = () => {
    clearInvite();
    router.replace('/pause' as never);
  };

  // ── Avböjd ────────────────────────────────────────────────────────────────

  if (inviteStatus === 'declined') {
    return (
      <Animated.View style={[styles.container, { opacity: fadeIn }]}>
        <View style={styles.declinedContent}>
          {friendAvatarUrl ? (
            <Image source={{ uri: friendAvatarUrl }} style={styles.friendAvatar} />
          ) : (
            <View style={styles.friendAvatarFallback}>
              <Text style={styles.friendAvatarInitial}>
                {(friendName ?? '?')[0].toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={styles.declinedTitle}>
            {friendName} kunde inte just nu.
          </Text>
          <Text style={styles.declinedSubtitle}>
            En annan gång — det är helt okej.
          </Text>
        </View>
        <TouchableOpacity style={styles.pauseAnywayBtn} onPress={handlePauseAnyway} activeOpacity={0.85}>
          <Text style={styles.pauseAnywayText}>Pausa ändå</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleBack} activeOpacity={0.6} style={styles.backLink}>
          <Text style={styles.backLinkText}>Tillbaka</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  }

  // ── Väntar ────────────────────────────────────────────────────────────────

  return (
    <Animated.View style={[styles.container, { opacity: fadeIn }]}>

      {/* Andningspuls */}
      <View style={styles.pulseArea}>
        <Animated.View style={[styles.ring, styles.ringOuter, { transform: [{ scale: pulse2 }] }]} />
        <Animated.View style={[styles.ring, styles.ringInner, { transform: [{ scale: pulse1 }] }]} />
        <View style={styles.ringCenter}>
          <FontAwesome5 name="user-clock" size={22} color="#2e86de" />
        </View>
      </View>

      {/* Text */}
      <View style={styles.textBlock}>
        <Text style={styles.waitingTitle}>Väntar på {friendName}…</Text>
        <Text style={styles.waitingSubtitle}>
          Du får en notis i telefonen när{'\n'}
          {friendName} svarar.
        </Text>
      </View>

      {/* Minimera-knapp — huvudalternativet */}
      <TouchableOpacity style={styles.minimizeBtn} onPress={handleMinimize} activeOpacity={0.85}>
        <FontAwesome5 name="compress-alt" size={13} color="#ffffff" />
        <Text style={styles.minimizeBtnText}>Minimera</Text>
      </TouchableOpacity>

      {/* Avbryt — diskret länk */}
      <TouchableOpacity onPress={handleCancel} activeOpacity={0.6} style={styles.cancelLink}>
        <Text style={styles.cancelLinkText}>Avbryt inbjudan</Text>
      </TouchableOpacity>

    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    gap: 36,
  },

  // Puls
  pulseArea: {
    width: 180,
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderRadius: 100,
  },
  ringOuter: {
    width: 130,
    height: 130,
    borderWidth: 1,
    borderColor: 'rgba(46,134,222,0.12)',
  },
  ringInner: {
    width: 100,
    height: 100,
    borderWidth: 1.5,
    borderColor: 'rgba(46,134,222,0.28)',
  },
  ringCenter: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(46,134,222,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(46,134,222,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Text
  textBlock: {
    alignItems: 'center',
    gap: 12,
  },
  waitingTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  waitingSubtitle: {
    fontSize: 15,
    color: '#5a7fa8',
    textAlign: 'center',
    lineHeight: 24,
  },

  // Minimera (primär)
  minimizeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#2e86de',
    paddingVertical: 14,
    paddingHorizontal: 36,
    borderRadius: 28,
  },
  minimizeBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },

  // Avbryt (sekundär, diskret)
  cancelLink: {
    paddingVertical: 8,
  },
  cancelLinkText: {
    color: '#3a3a6a',
    fontSize: 13,
  },

  // Avböjd-vy
  declinedContent: {
    alignItems: 'center',
    gap: 16,
  },
  friendAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: 8,
  },
  friendAvatarFallback: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(46,134,222,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(46,134,222,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  friendAvatarInitial: {
    fontSize: 32,
    fontWeight: '700',
    color: '#7ab8f5',
  },
  declinedTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
    letterSpacing: 0.1,
  },
  declinedSubtitle: {
    fontSize: 15,
    color: '#5a7fa8',
    textAlign: 'center',
    lineHeight: 22,
  },
  pauseAnywayBtn: {
    backgroundColor: '#2e86de',
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 28,
  },
  pauseAnywayText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  backLink: {
    paddingVertical: 8,
  },
  backLinkText: {
    color: '#3a3a6a',
    fontSize: 13,
  },
});
