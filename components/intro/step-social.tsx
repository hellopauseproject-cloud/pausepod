import { FontAwesome5 } from '@expo/vector-icons';
import { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, View } from 'react-native';
import { AppPalette, Radius, Spacing, alpha, roomPalette } from '../../constants/appTheme';
import { IntroStep, useIntroStyles } from './intro-chrome';

/**
 * Det sociala i ett steg: vänner, stöd och kretsen.
 *
 * **Läsas, inte spelas.** En tidigare version hade tre flikar med en liten
 * attrapp i varje (lägg till en vän, skicka stöd, logga en paus åt en
 * kretsmedlem). Den var för pillig och svår att förstå — man fick lära sig
 * attrappen innan man lärde sig funktionen. Nu är det tre block som tonar in
 * efter varandra, och varje block säger två saker: *vad* det är, och *varför*
 * det finns. Det andra är det viktiga — avsikten är det man inte kan gissa
 * sig till av knapparna senare.
 *
 * Kulörerna är rummens: Friends terrakotta, stödets kakao (`community`),
 * Kretsens gröna — samma färg som ytan man sedan möter i appen.
 */
type Part = { key: 'friends' | 'support' | 'circle'; icon: string; title: string; what: string; why: string };

const PARTS: Part[] = [
  {
    key: 'friends',
    icon: 'user-friends',
    title: 'Friends',
    what: 'See when your friends are pausing.',
    why: 'It\'s easier to put the phone down when you\'re not the only one.',
  },
  {
    key: 'support',
    icon: 'hand-holding-heart',
    title: 'Support',
    what: 'Ask for support when things feel heavy.',
    why: 'Friends answer with a few words, their voice, a video or a photo. Something real instead of another scroll.',
  },
  {
    key: 'circle',
    icon: 'circle-notch',
    title: 'Circle',
    what: 'A small group of 2–10 friends.',
    why: 'Everyone sets their own goal, and the week counts when everyone reaches theirs. You lift each other.',
  },
];

/** Hur länge mellan blocken när de tonar in. */
const STAGGER_MS = 220;

export function StepSocial({
  saving, error, onFinish, onBack,
}: {
  saving: boolean;
  error: string | null;
  onFinish: () => void;
  onBack: () => void;
}) {
  const { Palette, styles } = useIntroStyles();
  const local = useMemo(() => makeStyles(Palette), [Palette]);

  const tint = {
    friends: roomPalette(Palette.mode, 'friends').hue,
    support: Palette.community,
    circle: roomPalette(Palette.mode, 'circle').hue,
  };

  const anims = useRef(PARTS.map(() => new Animated.Value(0))).current;
  useEffect(() => {
    Animated.stagger(
      STAGGER_MS,
      anims.map(v => Animated.timing(v, { toValue: 1, duration: 420, useNativeDriver: true })),
    ).start();
  }, [anims]);

  return (
    <IntroStep
      scroll
      title={'Better together'}
      titleSmall
      subtitle="Pausing is the main thing. Three ways to do it with others:"
      primaryLabel={saving ? 'Saving…' : 'Start pausing →'}
      onPrimary={onFinish}
      primaryDisabled={saving}
      onBack={onBack}
    >
      <View style={local.list}>
        {PARTS.map((p, i) => {
          const color = tint[p.key];
          return (
            <Animated.View
              key={p.key}
              style={[
                local.part,
                {
                  opacity: anims[i],
                  transform: [{ translateY: anims[i].interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
                },
              ]}
            >
              <View style={[local.icon, { backgroundColor: alpha(color, 0.16) }]}>
                <FontAwesome5 name={p.icon} size={18} color={color} solid />
              </View>
              <View style={local.body}>
                <Text style={[local.title, { color }]}>{p.title}</Text>
                <Text style={local.what}>{p.what}</Text>
                <Text style={local.why}>{p.why}</Text>
              </View>
            </Animated.View>
          );
        })}
      </View>

      {saving && <ActivityIndicator color={Palette.accent} />}
      {!!error && <Text style={[styles.hint, { color: Palette.danger }]}>{error}</Text>}
    </IntroStep>
  );
}

const makeStyles = (Palette: AppPalette) => StyleSheet.create({
  list: {
    width: '100%',
    gap: Spacing.xl,
    marginTop: Spacing.sm,
  },
  part: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.lg,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  what: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    color: Palette.textPrimary,
  },
  why: {
    fontSize: 14,
    lineHeight: 21,
    color: Palette.textSecondary,
  },
});
