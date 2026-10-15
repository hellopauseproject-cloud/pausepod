import { FontAwesome5 } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppPalette, Radius, Spacing, alpha } from '../../constants/appTheme';
import { formatDuration } from '../../lib/circles';
import { IntroStep, useIntroStyles } from './intro-chrome';

/**
 * Kvittot: vad som faktiskt sparades, och vad som inte gjorde det.
 *
 * **Raderna är knappar, inte en lista.** Förut var det en statisk tabell med
 * `Not set` i grått, vilket gav användaren ett problem utan en lösning — enda
 * vägen tillbaka var bakåtknappen, en gång per steg. Nu leder varje rad till
 * sitt eget steg, så det som fattas går att fylla i på ett tryck och man
 * landar här igen.
 *
 * **Ofullständigt är inte fel.** Namn och foto behövs för att vännerna ska
 * veta vem du är; dagsmålet går utmärkt att sätta senare, direkt på ringen på
 * Hem. Därför två sorters saknad: en röd varning för det som verkligen bör
 * fyllas i, och en dämpad triangel för det som bara är valfritt. En röd rad
 * bredvid en likgiltig hade fått allt att se lika illa ut, och då säger
 * färgen ingenting.
 *
 * **Aktivitetsraden är borta med sitt steg.** Kvittot listar det som just
 * skickades, och introduktionen frågar inte längre om aktiviteter — se
 * kommentaren i [app/intro.tsx](../../app/intro.tsx) för vart de tog vägen.
 * En rad här för något som sätts på pausskärmen hade pekat på ett steg som
 * inte finns.
 *
 * Temavalet står inte här. Det sparas per enhet av ThemeContext och ingår
 * inte i skrivningen — ett kvitto ska lista det som just skickades, inte allt
 * användaren råkat röra vid.
 *
 * Grönt som bekräftelse är annars lådans färg i det här projektet (se
 * CLAUDE.md). Bockarna här är ett medvetet undantag på uttrycklig begäran.
 */
type Status = 'done' | 'missing' | 'optional';

export function StepDone({
  name, hasPhoto, goal, saving, error, onFinish, onBack, onEdit,
}: {
  name: string;
  hasPhoto: boolean;
  goal: number | null;
  saving: boolean;
  error: string | null;
  onFinish: () => void;
  onBack: () => void;
  /** Hoppar till steget som äger raden. Index räknas i app/intro.tsx. */
  onEdit: (step: number) => void;
}) {
  const { Palette } = useIntroStyles();

  const rows: { icon: string; label: string; value: string; status: Status; step: number }[] = [
    {
      icon: 'user',
      label: 'Name',
      value: name.trim() || 'Add your name',
      status: name.trim() ? 'done' : 'missing',
      step: 1,
    },
    {
      icon: 'camera',
      label: 'Photo',
      value: hasPhoto ? 'Added' : 'Add a photo',
      status: hasPhoto ? 'done' : 'missing',
      step: 1,
    },
    {
      icon: 'bullseye',
      label: 'Daily goal',
      value: goal ? formatDuration(goal) : 'Not set',
      status: goal ? 'done' : 'optional',
      step: 3,
    },
  ];

  const missing = rows.filter(r => r.status === 'missing').length;

  return (
    <IntroStep
      scroll
      title={missing > 0 ? 'Almost there' : "You're all set"}
      titleSmall
      subtitle={
        missing > 0
          ? 'Tap anything you want to fill in.'
          : 'Everything is ready. Your first pause is one tap away.'
      }
      primaryLabel={saving ? 'Saving…' : 'Start pausing'}
      onPrimary={onFinish}
      primaryDisabled={saving}
      onBack={saving ? undefined : onBack}
    >
      <View style={local.list}>
        {rows.map((r, i) => (
          <Row
            key={r.label}
            index={i}
            icon={r.icon}
            label={r.label}
            value={r.value}
            status={r.status}
            Palette={Palette}
            onPress={saving ? undefined : () => onEdit(r.step)}
          />
        ))}
      </View>

      {saving && <ActivityIndicator color={Palette.accent} />}
      {!!error && <Text style={[local.error, { color: Palette.danger }]}>{error}</Text>}
    </IntroStep>
  );
}

function Row({
  index, icon, label, value, status, Palette, onPress,
}: {
  index: number;
  icon: string;
  label: string;
  value: string;
  status: Status;
  Palette: AppPalette;
  onPress?: () => void;
}) {
  // Raderna trillar in en efter en. Fördröjningen per rad är liten med flit:
  // det ska läsa som att listan fylls i, inte som en animation man väntar på.
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 320,
      delay: index * 70,
      useNativeDriver: true,
    }).start();
  }, []);

  const mark = {
    done: { name: 'check', tint: Palette.success },
    missing: { name: 'times', tint: Palette.danger },
    optional: { name: 'exclamation-triangle', tint: Palette.warning },
  }[status];

  return (
    <Animated.View
      style={{
        opacity: enter,
        transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
      }}
    >
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        style={({ pressed }) => [
          local.row,
          { backgroundColor: Palette.surface },
          status === 'missing' && { backgroundColor: alpha(Palette.danger, 0.08) },
          pressed && { opacity: 0.7 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
      >
        <View style={[local.badge, { backgroundColor: alpha(mark.tint, 0.15) }]}>
          <FontAwesome5 name={mark.name as any} size={12} color={mark.tint} solid />
        </View>

        <View style={local.rowBody}>
          <Text style={[local.rowLabel, { color: Palette.textTertiary }]}>{label.toUpperCase()}</Text>
          <Text
            style={[
              local.rowValue,
              { color: status === 'done' ? Palette.textPrimary : Palette.textSecondary },
            ]}
            numberOfLines={1}
          >
            {value}
          </Text>
        </View>

        <FontAwesome5 name={icon as any} size={13} color={Palette.ink20} solid />
      </Pressable>
    </Animated.View>
  );
}

const local = StyleSheet.create({
  list: {
    width: '100%',
    gap: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
    borderRadius: Radius.md,
    paddingVertical: 12,
    paddingHorizontal: Spacing.lg,
  },
  badge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    gap: 1,
  },
  rowLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  rowValue: {
    fontSize: 15,
    fontWeight: '700',
  },
  error: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
});
