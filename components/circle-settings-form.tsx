import { FontAwesome5 } from '@expo/vector-icons';
import { useMemo } from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { alpha, AppPalette, Radius, Spacing } from '../constants/appTheme';
import { usePalette } from '../contexts/ThemeContext';
import type { CountWindow } from '../lib/circles';
import { RewardWreathIcon } from './reward-wreath-icon';
import { SegmentedPill } from './segmented-pill';

/**
 * Kretsens två inställningar som formulär: belöning på/av och räknefönstret.
 * Delas av app/circle-create.tsx (sista steget) och inställningarna i
 * medlemslistan, så att de två aldrig kan säga olika saker om samma val.
 *
 * Kontrollerad: värdet ägs av skärmen, som också sparar det.
 *
 * Varje val har en rad som säger vad det gör, för båda är val man gör innan
 * man sett dem verka. Fönstrets rad säger *the shared pot* och inget om Hem:
 * en andra mening om att alla pauser ändå räknas för en själv prövades och
 * förvirrade mer än den lugnade.
 */

export type CircleSettingsDraft = { rewards_enabled: boolean } & CountWindow;

type Props = {
  value: CircleSettingsDraft;
  onChange: (next: CircleSettingsDraft) => void;
  /** Formulärets bredd, för kapslarna. */
  width: number;
  disabled?: boolean;
};

// Förval när man väljer *Set hours*: en vanlig arbetsdag.
const DEFAULT_FROM = 8;
const DEFAULT_TO = 17;

const pad = (h: number) => `${String(h).padStart(2, '0')}:00`;

export function CircleSettingsForm({ value, onChange, width, disabled }: Props) {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  const hasHours = value.count_from !== null && value.count_to !== null;
  const from = value.count_from ?? DEFAULT_FROM;
  const to = value.count_to ?? DEFAULT_TO;

  const set = (patch: Partial<CircleSettingsDraft>) => onChange({ ...value, ...patch });

  return (
    <View style={styles.wrap}>
      <View style={styles.block}>
        <View style={styles.titleRow}>
          {/* Samma krans som belöningsknappen i kretsflikens rubrik, så att
              valet känns igen där det sedan syns. Fylld när den är på. */}
          <View style={styles.titleLead}>
            <RewardWreathIcon size={24} color={Palette.hue} filled={value.rewards_enabled} />
            <Text style={styles.title}>Shared reward</Text>
          </View>
          <Switch
            value={value.rewards_enabled}
            onValueChange={v => set({ rewards_enabled: v })}
            disabled={disabled}
            trackColor={{ false: Palette.ink18, true: Palette.accent }}
            thumbColor={Palette.onAccent}
            accessibilityLabel="Shared reward"
          />
        </View>
        <Text style={styles.info}>
          Something you do together when everyone reaches their goal for the week. You suggest and vote on it in the circle.
        </Text>
      </View>

      <View style={styles.block}>
        <View style={styles.titleLead}>
          <View style={styles.titleIcon}>
            <FontAwesome5 name="clock" size={18} color={Palette.hue} />
          </View>
          <Text style={styles.title}>When pauses count</Text>
        </View>
        <SegmentedPill
          options={[{ key: 'all', label: 'All day' }, { key: 'hours', label: 'Set hours' }]}
          value={hasHours ? 'hours' : 'all'}
          onChange={k => set(k === 'hours'
            ? { count_from: from, count_to: to }
            : { count_from: null, count_to: null })}
          width={width}
        />
        {hasHours && (
          <View style={styles.hoursRow}>
            <HourStepper
              label="From"
              value={from}
              onDown={() => set({ count_from: Math.max(0, from - 1) })}
              onUp={() => set({ count_from: Math.min(to - 1, from + 1) })}
              canDown={from > 0}
              canUp={from < to - 1}
              styles={styles}
              Palette={Palette}
            />
            <HourStepper
              label="To"
              value={to}
              onDown={() => set({ count_to: Math.max(from + 1, to - 1) })}
              onUp={() => set({ count_to: Math.min(24, to + 1) })}
              canDown={to > from + 1}
              canUp={to < 24}
              styles={styles}
              Palette={Palette}
            />
          </View>
        )}
        <SegmentedPill
          options={[{ key: 'every', label: 'Every day' }, { key: 'work', label: 'Mon–Fri' }]}
          value={value.count_workdays ? 'work' : 'every'}
          onChange={k => set({ count_workdays: k === 'work' })}
          width={width}
        />
        <Text style={styles.info}>
          Only pauses in this time window go into the shared pot.
        </Text>
      </View>
    </View>
  );
}

function HourStepper({
  label, value, onDown, onUp, canDown, canUp, styles, Palette,
}: {
  label: string;
  value: number;
  onDown: () => void;
  onUp: () => void;
  canDown: boolean;
  canUp: boolean;
  styles: ReturnType<typeof makeStyles>;
  Palette: AppPalette;
}) {
  return (
    <View style={styles.stepper} accessible accessibilityLabel={`${label} ${pad(value)}`}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperRow}>
        <TouchableOpacity
          onPress={onDown}
          disabled={!canDown}
          style={styles.stepBtn}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`${label} one hour earlier`}
        >
          <FontAwesome5 name="minus" size={11} color={canDown ? Palette.hue : Palette.textDisabled} />
        </TouchableOpacity>
        <Text style={styles.stepperValue}>{pad(value)}</Text>
        <TouchableOpacity
          onPress={onUp}
          disabled={!canUp}
          style={styles.stepBtn}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`${label} one hour later`}
        >
          <FontAwesome5 name="plus" size={11} color={canUp ? Palette.hue : Palette.textDisabled} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (Palette: AppPalette) => StyleSheet.create({
  wrap: { gap: Spacing.xl, width: '100%' },
  block: { gap: Spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  // Ikonen före rubriken, i rummets kulör. Klockan står i en ruta lika stor
  // som kransen, så att de två rubrikerna börjar på samma linje.
  titleLead: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  titleIcon: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '800', color: Palette.textPrimary },
  info: { fontSize: 13, lineHeight: 19, color: Palette.textTertiary },
  hoursRow: { flexDirection: 'row', gap: Spacing.md },
  stepper: {
    flex: 1, gap: 6, padding: Spacing.md,
    borderRadius: Radius.md, backgroundColor: Palette.surface,
  },
  stepperLabel: { fontSize: 12, fontWeight: '700', color: Palette.textTertiary, letterSpacing: 1 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepperValue: { fontSize: 20, fontWeight: '800', color: Palette.textPrimary, fontVariant: ['tabular-nums'] },
  stepBtn: {
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: alpha(Palette.hue, 0.35),
  },
});
