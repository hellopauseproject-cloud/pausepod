import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  Animated, Dimensions,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CircleSettingsDraft, CircleSettingsForm } from '../components/circle-settings-form';
import { IntroPart, IntroStep, useIntroStyles } from '../components/intro/intro-chrome';
import { AppPalette, Radius, Spacing } from '../constants/appTheme';
import { RoomProvider, usePalette } from '../contexts/ThemeContext';
import { roomShell, ScreenBackground } from '../components/screen-background';
import { track } from '../lib/analytics';
import { DEFAULT_CIRCLE_SETTINGS, requestCircleSelection, setCircleSettings } from '../lib/circles';
import { enablePushNotifications } from '../lib/notifications';
import { supabase } from '../lib/supabase';

const { width } = Dimensions.get('window');

/** Måste stämma med `steps` längre ner — `goTo` behöver taket innan listan finns. */
const TOTAL_STEPS = 3;

/**
 * Att skapa en krets: en sida som säger vad det är, och en som namnger den.
 *
 * Förut var hela skapandet en modal med ett textfält — man skrev ett namn och
 * stod i en tom krets utan att veta vad den var för något.
 *
 * **Två sidor, inte tre.** Ett första utkast hade en sida till, med
 * mekaniken: att potten kan stå på 94% och veckan ändå vara ovunnen, att
 * stegen inte skrivs om när någon lämnar, att en medlem utan mål blockerar
 * hela veckan. Allt tre är sant, och allt tre är kretsflikens kunskap — de
 * beskriver siffror som står på skärmen där, och läses här som villkor för
 * något som ännu inte finns. Den som behöver dem har dem framför sig när de
 * väl gäller.
 *
 * Kvar står det som inte går att gissa sig till och som ingen skärm säger
 * rakt ut: att målet är ditt eget, och att veckan ändå vinns tillsammans
 * (`goals_set_count = member_count` i `evaluate_circle_goals()`). Sidan är
 * därför delad i YOU / THE CIRCLE / TOGETHER i stället för i numrerade
 * regler — vem som gör vad är lättare att ta in än tre punkter som alla
 * låter som villkor.
 *
 * **Båda stegen i en fil, till skillnad från introduktionen.** Stegen under
 * components/intro/ har var sin fil för att var och en bär riktig logik
 * (kamera, temabyte, lådans illustration). De här två är text och ett
 * textfält, och delar dessutom det enda tillstånd som finns — namnet. Ramen
 * (`IntroStep`) är ändå densamma, så de ser ut som resten av appens guidade
 * steg utan att skelettet kopieras hit.
 *
 * **Ett tredje steg för ägarens två val** (belöning på/av och räknefönstret,
 * se *Kretsens inställningar* i supabase/circles.sql). Det är inte mekanik
 * utan val, och de görs här för att en arbetsplats annars hade räknat helgen
 * redan första veckan. Båda går att ändra i medlemslistan efteråt.
 *
 * Sista steget lämnar över till [app/circle-invite.tsx](./circle-invite.tsx)
 * med `replace`, inte `push`: en nyss skapad krets är tom, och att kunna backa
 * tillbaka in i namnfältet för en krets som redan finns leder bara till
 * "You are already in a circle." Att bjuda in är nästa handling, inte en
 * valfri avstickare.
 *
 * Hör till **circle-rummet** — rummet följer ärendet och inte filträdet,
 * se ROOMS i [constants/appTheme.ts](../constants/appTheme.ts). Skalet nedan
 * är identiskt med de andra rummens: en komponent kan inte läsa sin egen
 * provider, och en bakgrund i skalet täcker varje gren skärmen returnerar.
 */
export default function CircleCreateRoom() {
  return (
    <RoomProvider room="circle">
      <View style={roomShell}>
        <ScreenBackground room="circle" />
        <CircleCreateScreen />
      </View>
    </RoomProvider>
  );
}

function CircleCreateScreen() {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [settings, setSettings] = useState<CircleSettingsDraft>({
    rewards_enabled: DEFAULT_CIRCLE_SETTINGS.rewards_enabled,
    count_from: DEFAULT_CIRCLE_SETTINGS.count_from,
    count_to: DEFAULT_CIRCLE_SETTINGS.count_to,
    count_workdays: DEFAULT_CIRCLE_SETTINGS.count_workdays,
  });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slide = useRef(new Animated.Value(0)).current;
  /** Spärr mot dubbeltryck: animationen tar 260 ms och hinner annars dubbla steget. */
  const animating = useRef(false);

  const goTo = (target: number) => {
    if (animating.current || target === step) return;
    if (target < 0 || target >= TOTAL_STEPS) return;
    animating.current = true;
    const out = target > step ? -width : width;
    Animated.timing(slide, { toValue: out, duration: 260, useNativeDriver: true }).start(() => {
      setStep(target);
      slide.setValue(-out);
      Animated.timing(slide, { toValue: 0, duration: 260, useNativeDriver: true }).start(() => {
        animating.current = false;
      });
    });
  };

  const next = () => goTo(step + 1);
  const back = () => goTo(step - 1);
  /** Bakåt från första steget lämnar flödet helt. */
  const leave = () => router.back();

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc('create_circle', { p_name: trimmed });

    if (rpcError) {
      setError(rpcError.message);
      setCreating(false);
      return;
    }

    track('circle_created', {
      rewards: settings.rewards_enabled,
      window: settings.count_from !== null || settings.count_workdays,
    });

    // Kretsen finns, alltså finns det nu personer vars dagsmål en notis kan
    // handla om — se `enablePushNotifications` i lib/notifications.ts för
    // varför frågan hör till just det här ögonblicket. Väntas inte in:
    // nästa rad navigerar vidare till inbjudningarna, och en systemdialog
    // ska inte hålla emot den.
    enablePushNotifications().catch(() => {});

    // RPC:n returnerar kretsens id. Skulle det utebli är kretsen ändå skapad —
    // då lämnar vi bara tillbaka till fliken, som hittar den i sin `load()`.
    const circleId = typeof data === 'string' ? data : null;
    if (circleId) {
      // Valen sparas efter skapandet, så att create_circle får stå orörd.
      // Faller det här är kretsen ändå skapad, med förvalen (ingen belöning,
      // dygnet runt) — och ägaren kan ändra dem i medlemslistan.
      try {
        await setCircleSettings(circleId, settings);
      } catch (e: any) {
        console.log('[circle-create] settings error:', e?.message);
      }
      // Man kan vara med i flera: den nya kretsen är den fliken visar sen.
      requestCircleSelection(circleId);
      router.replace({
        pathname: '/circle-invite',
        params: { circleId, from: 'create' },
      } as never);
    } else {
      router.back();
    }
  };

  const steps = [
    <StepWhat key="what" onNext={next} onBack={leave} />,
    <StepName
      key="name"
      name={name}
      setName={setName}
      onNext={next}
      onBack={back}
    />,
    <StepSettings
      key="settings"
      value={settings}
      onChange={setSettings}
      creating={creating}
      error={error}
      onCreate={handleCreate}
      onBack={back}
    />,
  ];

  return (
    // Ingen `KeyboardAvoidingView` längre. Den gjorde ingenting på Android
    // (`behavior` var `undefined`, och med `edgeToEdgeEnabled` resizar
    // fönstret inte heller), så `Create circle` låg under tangentbordet på
    // namnsteget. Lyftet sitter numera i `IntroStep`s fot bakom `footLift`,
    // mätt ur `Keyboard`-händelserna — och den och en KAV som faktiskt
    // lyfter får inte finnas samtidigt, då räknas tangentbordet två gånger.
    <View style={[styles.container, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      <View style={styles.dots}>
        {steps.map((_, i) => (
          <View key={i} style={[styles.dot, i <= step && styles.dotOn]} />
        ))}
      </View>

      <Animated.View style={[styles.stage, { transform: [{ translateX: slide }] }]}>
        {steps[step]}
      </Animated.View>
    </View>
  );
}

/**
 * Vad en krets är, delad i vem som gör vad.
 *
 * De tre styckena är valda för att de inte går att gissa: att dagsmålet är
 * ditt eget och inte något kretsen delar ut, och att veckan ändå kräver
 * allas. Resten — nivåerna, potten, vad som händer när någon lämnar — står
 * på kretsfliken bredvid siffrorna de handlar om, och hör inte hemma före en
 * krets som ännu inte finns.
 */
function StepWhat({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { styles } = useIntroStyles();
  return (
    <IntroStep
      scroll
      title={'A few friends,\npausing together'}
      subtitle="Here's how one works."
      primaryLabel="Next →"
      onPrimary={onNext}
      onBack={onBack}
    >
      <View style={styles.panel}>
        <IntroPart
          title="You"
          // Hårt mellanslag mellan de två sista orden. Utan det bröt raden
          // mellan "That's" och "it." och lämnade ett ensamt "it." längst
          // ner i blocket. Nu flyttar de två orden sig som ett: ryms de på
          // raden står de där, annars går hela "That's it." ner tillsammans.
          text={"Pick a daily goal. Take your pauses. That's\u00A0it."}
        />
        <IntroPart
          title="The circle"
          text="Up to ten friends, each with their own goal."
        />
        <IntroPart
          title="Together"
          text="Climb the ladder and win the week when everyone has reached their goal."
        />
      </View>
    </IntroStep>
  );
}

/** Namnet. */
function StepName({
  name, setName, onNext, onBack,
}: {
  name: string;
  setName: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const { Palette } = useIntroStyles();
  return (
    <IntroStep
      scroll
      title="Name your circle"
      titleGap
      subtitle="Everyone you invite will see it."
      primaryLabel="Next →"
      onPrimary={onNext}
      primaryDisabled={!name.trim()}
      onBack={onBack}
      footLift
    >
      <TextInput
        style={[local.input, {
          backgroundColor: Palette.surface,
          borderColor: Palette.surfaceBorder,
          color: Palette.textPrimary,
        }]}
        value={name}
        onChangeText={setName}
        placeholder="e.g. The Pause Crew"
        placeholderTextColor={Palette.textTertiary}
        maxLength={40}
        autoFocus
        returnKeyType="next"
        onSubmitEditing={() => { if (name.trim()) onNext(); }}
      />
    </IntroStep>
  );
}

/** Ägarens två val. Skapar kretsen. */
function StepSettings({
  value, onChange, creating, error, onCreate, onBack,
}: {
  value: CircleSettingsDraft;
  onChange: (v: CircleSettingsDraft) => void;
  creating: boolean;
  error: string | null;
  onCreate: () => void;
  onBack: () => void;
}) {
  const { Palette } = useIntroStyles();
  return (
    <IntroStep
      scroll
      title="How it works for you"
      titleGap
      subtitle="You can change this later."
      primaryLabel={creating ? 'Creating…' : 'Create circle'}
      onPrimary={onCreate}
      primaryDisabled={creating}
      onBack={creating ? undefined : onBack}
    >
      <CircleSettingsForm value={value} onChange={onChange} width={width - Spacing.xxl * 2} disabled={creating} />
      {!!error && <Text style={[local.error, { color: Palette.danger }]}>{error}</Text>}
    </IntroStep>
  );
}

const local = StyleSheet.create({
  input: {
    width: '100%',
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingVertical: 14,
    paddingHorizontal: Spacing.lg,
    fontSize: 16,
  },
  error: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
});

const makeStyles = (Palette: AppPalette) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 16,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Palette.ink12,
  },
  dotOn: {
    width: 20,
    backgroundColor: Palette.accent,
  },
  stage: {
    flex: 1,
    width: '100%',
  },
});
