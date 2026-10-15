import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { DeviceMotion } from 'expo-sensors';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useBLE } from '../context/BLEContext';
import { useSession } from '../context/SessionContext';
import { track } from '../lib/analytics';
import { setInboxActive } from '../lib/inboxGuard';
import { tiltDegrees } from '../lib/tilt';
import { AppPalette } from '../constants/appTheme';
import { RoomProvider, usePalette } from '../contexts/ThemeContext';
import { roomShell, ScreenBackground } from '../components/screen-background';

const KEEP_AWAKE_TAG = 'placeinbox';

// v6: incheckningen sker med locket stängt — telefonen ligger i lådan och
// ingen ser skärmen längre. Appens enda jobb här är att hjälpa fram till
// locket (standing ↔ phonedown) och boka notisen. Resten (ring, tummar,
// startceremoni) är lådans display, inte appens.
//
// Pilen går åt båda håll: instruktionen följer var telefonen faktiskt är, så
// en telefon som reses upp igen tar skärmen tillbaka till PUT PHONE IN BOX.
// Att stå kvar på CLOSE THE LID med telefonen i handen vore att be om något
// som inte går att göra.
//
// 'abandoned' är inte ett steg i ritualen utan dess enda väg ut bakåt: lådan
// ger upp tyst (se ABANDON-konstanterna nedan) och kan alltså inte tala om
// att ritualen är över. Utan den här fasen stod skärmen kvar på CLOSE THE LID
// i all evighet medan lådan sedan länge stod på loggan.
type Phase = 'standing' | 'phonedown' | 'abandoned';

/** Vilken av lådans tysta timeouts vi gav upp på — styr bara förklaringen. */
type AbandonReason = 'lid' | 'checkin';

// Mäter lutning mot tyngdkraften, inte rotation.beta/gamma — beta ensam
// missar en telefon som står på högkant (beta ~0 där också), och rotation-
// enheterna skiljer sig mellan plattformar. Vinkeln mot g är oberoende av
// riktning och av det. 8° är vad ett ojämnt bord ger; en hand darrar och
// hamnar sällan under 12°, så tröskeln skiljer "ligger" från "hålls".
const FLAT_MAX_TILT_DEG = 8; // sänk till 5 för ännu strängare
const MOTION_INTERVAL_MS = 200;
const FLAT_STABLE_MS = 800;

// Vägen tillbaka: telefonen restes upp igen, alltså ligger den inte i lådan
// och instruktionen ska vara PUT PHONE IN BOX igen. Tröskeln måste ligga
// långt från FLAT_MAX_TILT_DEG — mellan 8° och 45° tolkas ingenting alls, och
// utan det glappet hade en telefon på ett ojämnt bord kunnat vippa mellan de
// två vyerna av mätbrus allena. 45° är samma gräns som den globala
// lyft-detekteringen i _layout.tsx använder för att kalla en telefon upprest.
const UPRIGHT_MIN_TILT_DEG = 45;
const UPRIGHT_STABLE_MS = 500;

// ── Klient-timeouts som speglar lådans tysta återgångar till IDLE ──
// Lådan skickar ingenting när den ger upp (firmware-begränsning, se
// CLAUDE.md), så appen måste räkna själv — annars hänger den här skärmen
// kvar för evigt på en låda som redan slutat lyssna.
//
// Alla värden ligger med GRACE_MS marginal EFTER lådans egna gränser.
// Ordningen spelar roll: ger appen upp först kan den hinna lämna skärmen
// precis medan lådan faktiskt startar pausen. Lådan ska alltid falla först.
const GRACE_MS = 3000;
// Lådans AWAIT_LID_MAX_MS (90 s), räknad från det phone_down som satte
// phonePlaced. Ett phone_down som inte ändrar något startar inte om den
// (firmware: villkoret är `AWAITING_LID && !phonePlaced`) — se
// awaitLidSinceRef, det är ankaret och inte den här konstanten som bär
// skillnaden.
const ABANDON_AFTER_PHONE_DOWN_MS = 90000 + GRACE_MS;
// Innan phone_down ligger lådans PHONE_WAIT_MAX_MS (20 s) före AWAIT_LID_MAX_MS:
// den flippar till CLOSE BOX på egen hand och startar om de 90 sekunderna då.
const ABANDON_BEFORE_PHONE_DOWN_MS = 20000 + 90000 + GRACE_MS;
// Lådans CHECKIN_TIMEOUT_MS (30 s) räknat från lid_closed. Den pausas så fort
// en tumme rör en platta, så marginalen behöver bara täcka själva ifyllnaden.
const ABANDON_AFTER_LID_CLOSED_MS = 30000 + GRACE_MS;

/**
 * Hör till **pause-rummet**. Rummet följer ärendet och inte filträdet — se
 * ROOMS i [constants/appTheme.ts](../constants/appTheme.ts). Skalet är
 * identiskt med de andra rummens: en komponent kan inte läsa sin egen
 * provider, och en bakgrund i skalet täcker varje gren skärmen returnerar.
 */
export default function PlaceInBoxRoom() {
  return (
    <RoomProvider room="pause">
      <View style={roomShell}>
        <ScreenBackground room="pause" />
        <PlaceInBoxScreen />
      </View>
    </RoomProvider>
  );
}

function PlaceInBoxScreen() {
  const Palette = usePalette();
  const styles = useMemo(() => makeStyles(Palette), [Palette]);
  const { category, targetSeconds } = useLocalSearchParams<{ category: string; targetSeconds?: string }>();
  const { state, dispatch } = useSession();
  const { sendPhoneDown, sendPhoneUp, subscribeToBoxMessages } = useBLE();

  const [phase, setPhase] = useState<Phase>('standing');
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const [abandonReason, setAbandonReason] = useState<AbandonReason | null>(null);

  // sendPhoneDown/sendPhoneUp byter identitet varje render av BLEProvider
  // (inte memoiserade) — refs håller detektionseffekten fri från dem som deps.
  const sendPhoneDownRef = useRef(sendPhoneDown);
  sendPhoneDownRef.current = sendPhoneDown;
  const sendPhoneUpRef = useRef(sendPhoneUp);
  sendPhoneUpRef.current = sendPhoneUp;


  // ── Ankaret för lådans AWAIT_LID_MAX_MS ──
  // Nu när telefonen kan resas upp och läggas ner om och om igen duger det
  // inte att starta en ny timeout vid varje växling: lådan gör inte det.
  // Dess nedräkning startar om bara där firmware kör setPhase(AWAITING_LID),
  // dvs vid set_mode (= den här skärmens montering), vid FÖRSTA phone_down,
  // och när ett öppnat lock tar den tillbaka hit ur CHECKING_IN. Räknade
  // appen om vid varje vändning skulle den kunna stå kvar minuter efter att
  // lådan för länge sedan gått till loggan — samma hängande skärm som hela
  // abandoned-vyn finns för att undvika.
  const awaitLidSinceRef = useRef(Date.now());
  // Speglar lådans `phonePlaced`, och avgör därmed vilken av de två
  // gränserna som gäller: 90 s när lådan vet att telefonen ligger, annars
  // 20 s + 90 s eftersom den då först flippar till CLOSE BOX på egen hand.
  const boxSawPhoneDownRef = useRef(false);
  const prevSessionPhaseRef = useRef(state.phase);

  // De två spegelvända halvorna av lådans `phonePlaced` + `phaseStartMs`.
  // markPhoneDown no-opar när lådan redan vet att telefonen ligger, eftersom
  // firmware då inte heller kör setPhase och inte startar om sin nedräkning.
  const markPhoneDown = () => {
    if (boxSawPhoneDownRef.current) return;
    boxSawPhoneDownRef.current = true;
    awaitLidSinceRef.current = Date.now();
    // Bara FÖRSTA nedläggningen per försök, eftersom funktionen no-opar
    // efter den. Vändningarna därefter räknas som phone_raised_again, och
    // det är skillnaden mellan dem som säger om steget är svårt.
    track('phone_placed_down');
  };
  const markPhoneUp = () => {
    boxSawPhoneDownRef.current = false;
    awaitLidSinceRef.current = Date.now();
    track('phone_raised_again');
  };

  const breathe = useRef(new Animated.Value(1)).current;

  // ── Ge upp ritualen. Samma väg ut oavsett vilken av lådans timeouts som
  // gick ut: nollställ sessionen (annars blockerar ENTER_CHECKIN:s idle-krav
  // nästa försök). Här avbokades förr en lokal notis också; appen skickar
  // inga notiser längre. ──
  const abandon = (reason: AbandonReason) => {
    if (phaseRef.current === 'abandoned') return;
    console.log('PlaceInBox: lådan har gett upp (', reason, ') — lämnar ritualen');

    // Enda vägen bakåt ur ritualen, och den lämnar inget spår i
    // pause_sessions: lådan skickar ingenting vid sina tysta timeouts, så
    // utan den här raden är ett övergivet försök osynligt. 'checkin' betyder
    // att locket stängdes men ingen höll tummarna — alltså att grinden som
    // ingen vet finns är det som stoppar folk.
    track('pause_abandoned', { reason, box_saw_phone_down: boxSawPhoneDownRef.current });

    setInboxActive(false);
    dispatch({ type: 'RESET' });
    setAbandonReason(reason);
    setPhase('abandoned');
  };
  const abandonRef = useRef(abandon);
  abandonRef.current = abandon;

  // ── Gå in i väntan på att telefonen ställs i lådan. Bara om vi kommer
  // hit från idle — en RESTORE efter återanslutning kan redan ha satt oss
  // längre fram i ritualen. ──
  useEffect(() => {
    track('placeinbox_shown', { category: category || null });
    if (state.phase === 'idle') {
      dispatch({ type: 'ENTER_CHECKIN', category: category || undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Flagga aktiv medan vi är på den här skärmen (gate:ar t.ex. fejksamtal) ──
  useEffect(() => {
    setInboxActive(true, { mode: 'session', category: String(category ?? '') });
    return () => setInboxActive(false);
  }, []);

  // ── Skärmen får inte slockna under hela ritualen — DeviceMotion slutar
  // leverera avläsningar när skärmen släcks, och både nedläggningen här och
  // den globala lyft-detekteringen i _layout.tsx bygger på den. Låset
  // släpptes förr så fort telefonen låg ner; då hann skärmen somna medan
  // lådan väntade på incheckning (dess grace är 30 s), och sensorn var död
  // när telefonen sedan lyftes ur lådan. Skärmen lyser alltså vaken inne i
  // lådan, men den är stängd — ingen ser den. /pausing tar över låset med
  // useKeepAwake() när den här skärmen lämnas. ──
  useEffect(() => {
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => { deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {}); };
  }, []);

  // ── Andningsanimation (alltid aktiv i standing) ──
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1.15, duration: 3000, useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 1, duration: 3000, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  // ── Lutningsdetektion, båda riktningarna. Platt → phonedown (och
  // phone_down till lådan), upprest igen → tillbaka till standing: lyfter man
  // telefonen ur lådan står det PUT PHONE IN BOX igen, vilket är den enda
  // instruktion som stämmer med var telefonen faktiskt är.
  //
  // EN prenumeration för båda hållen, med riktningen läst ur phaseRef i
  // stället för ur deps. Ett vippande läge river då inte ner och bygger upp
  // DeviceMotion om och om igen — och det är just vid nedrivningen
  // stabilitetsräknarna nollställs, dvs precis det som gör en detektor trög
  // när den behöver vara pålitlig.
  //
  // Bara medan locket fortfarande är öppet (state.phase === 'awaiting_lid').
  // Är locket stängt ligger telefonen i en låda som kan lyftas och bäras, och
  // då säger lutningen ingenting om var telefonen är. ──
  useEffect(() => {
    if (state.phase !== 'awaiting_lid') return;
    let cancelled = false;
    let sub: { remove: () => void } | null = null;

    (async () => {
      await DeviceMotion.requestPermissionsAsync();
      if (cancelled) return;

      DeviceMotion.setUpdateInterval(MOTION_INTERVAL_MS);
      let flatSinceMs: number | null = null;
      let uprightSinceMs: number | null = null;

      sub = DeviceMotion.addListener(({ accelerationIncludingGravity: g }) => {
        if (!g) return;
        const tiltDeg = tiltDegrees(g);
        if (tiltDeg === null) return;
        if (phaseRef.current === 'abandoned') return;

        if (phaseRef.current === 'standing') {
          uprightSinceMs = null;
          if (tiltDeg > FLAT_MAX_TILT_DEG) { flatSinceMs = null; return; }
          if (flatSinceMs === null) { flatSinceMs = Date.now(); return; }
          if (Date.now() - flatSinceMs < FLAT_STABLE_MS) return;

          flatSinceMs = null;
          // Lådan startar om sin nedräkning bara på ett phone_down som
          // faktiskt ändrar phonePlaced (firmware: `AWAITING_LID &&
          // !phonePlaced`). Appens klocka ankras likadant — se markPhoneDown.
          markPhoneDown();
          sendPhoneDownRef.current().catch(() => {});
          setPhase('phonedown');
          return;
        }

        flatSinceMs = null;
        if (tiltDeg < UPRIGHT_MIN_TILT_DEG) { uprightSinceMs = null; return; }
        if (uprightSinceMs === null) { uprightSinceMs = Date.now(); return; }
        if (Date.now() - uprightSinceMs < UPRIGHT_STABLE_MS) return;

        uprightSinceMs = null;
        // Lådan nollar phonePlaced och börjar om på PHONE_WAIT_MAX_MS +
        // AWAIT_LID_MAX_MS, alltså exakt samma fönster som direkt efter
        // set_mode. markPhoneUp flyttar ankaret hit så att appens frist
        // följer med.
        markPhoneUp();
        sendPhoneUpRef.current().catch(() => {});
        setPhase('standing');
      });
    })();

    return () => { cancelled = true; sub?.remove(); };
  }, [state.phase]);

  // ── Väntan på locket. Armad så länge reducern fortfarande står i
  // awaiting_lid; lid_closed flyttar den till checking_in och river därmed
  // timern.
  //
  // Timern räknas alltid mot awaitLidSinceRef, inte från när effekten råkar
  // köra — den kör om vid varje vändning mellan standing och phonedown, och
  // en färsk setTimeout där hade förlängt fristen varje gång man lyfte
  // telefonen. Se ankaret ovan. ──
  useEffect(() => {
    const prevSessionPhase = prevSessionPhaseRef.current;
    prevSessionPhaseRef.current = state.phase;
    if (state.phase !== 'awaiting_lid' || phase === 'abandoned') return;

    // Locket öppnades ur checking_in: lådan körde setPhase(AWAITING_LID) och
    // började om på 90 s, med phonePlaced tvingad till true (locket har varit
    // stängt, alltså ligger telefonen i lådan).
    if (prevSessionPhase === 'checking_in') {
      awaitLidSinceRef.current = Date.now();
      boxSawPhoneDownRef.current = true;
    }

    const windowMs = boxSawPhoneDownRef.current
      ? ABANDON_AFTER_PHONE_DOWN_MS
      : ABANDON_BEFORE_PHONE_DOWN_MS;
    const remainingMs = Math.max(0, awaitLidSinceRef.current + windowMs - Date.now());
    const timer = setTimeout(() => abandonRef.current('lid'), remainingMs);
    return () => clearTimeout(timer);
  }, [state.phase, phase]);

  // ── Väntan på tummarna. Bara i checking_in: har vi väl nått checked_in
  // har lådan bevisligen startat sessionen (checkin_complete skickas i samma
  // andetag som startSession()), och då vore det fel att ge upp — _layout.tsx
  // fångar den sessionen globalt via session_ended.
  //
  // Öppnas locket rivs timern (reducern går tillbaka till awaiting_lid) och
  // armas från noll när locket stängs igen — lådans CHECKIN_TIMEOUT_MS
  // räknas likadant, från varje setPhase(CHECKING_IN). ──
  useEffect(() => {
    if (state.phase !== 'checking_in' || phase === 'abandoned') return;
    const timer = setTimeout(() => abandonRef.current('checkin'), ABANDON_AFTER_LID_CLOSED_MS);
    return () => clearTimeout(timer);
  }, [state.phase, phase]);

  // ── Locket stängs: box:en tar över ritualen helt härifrån.
  //
  // Öppnas locket igen innan incheckningen är klar avbryts INTE försöket:
  // lådan går tillbaka till CLOSE BOX och reducern följer med till
  // awaiting_lid, så den här skärmen står kvar på CLOSE THE LID och locket
  // kan bara stängas igen. Locket kan alltså stängas flera gånger under
  // samma försök.
  //
  // Här bokades förr en lokal notis per stängning (och avbokades vid nästa,
  // så att de inte lades på hög). Appen skickar inga notiser längre, så
  // lyssnaren står kvar tom med flit: den dokumenterar att ingenting ska
  // hända här, och lid_closed hanteras av reducern via SessionContext. ──
  useEffect(() => subscribeToBoxMessages((message) => {
    if (message.type !== 'lid_closed' || phaseRef.current !== 'phonedown') return;

    const seconds = parseInt(targetSeconds ?? '0', 10);
    if (!Number.isFinite(seconds) || seconds <= 0) return;

    // Här bokades förr en notis om när locket skulle öppnas. Appen skickar
    // inga notiser längre, så lådans nedräkning är helt lådans.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [subscribeToBoxMessages]);

  // ── Ritualens två milstolpar, för tratten i analytics.pause_funnel.
  // `checking_in` nås bara via lid_closed och `active` bara via en färdig
  // incheckning, så fasövergångarna är milstolparna — ingen av dem behöver
  // en egen lyssnare på BLE-meddelandena.
  //
  // Egen ref och inte prevSessionPhaseRef ovan: den skrivs inne i en effekt
  // som avbryter tidigt, och två läsare av samma ref hade hängt på vilken
  // effekt React råkar köra först. ──
  const trackedPhaseRef = useRef(state.phase);
  useEffect(() => {
    const prev = trackedPhaseRef.current;
    trackedPhaseRef.current = state.phase;
    if (prev === state.phase) return;
    if (state.phase === 'checking_in') track('box_lid_closed');
    if (state.phase === 'active') track('pause_started', { with_pod: true, category: category || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  // ── Lådan äger resten av ritualen (tummar, startceremoni). Så fort den
  // säger att pausen räknar, navigera vidare — appen gör inget mer här. ──
  useEffect(() => {
    if (state.phase === 'active') {
      router.replace({ pathname: '/pausing', params: { mode: 'session', withPod: 'true' } } as never);
    }
  }, [state.phase]);

  return (
    <View style={styles.container}>
      {phase === 'standing' && (
        <View style={styles.centerScreen}>
          <Animated.View style={[styles.circle, { transform: [{ scale: breathe }] }]} />
          <Text style={styles.title}>PUT PHONE{'\n'}IN BOX</Text>
        </View>
      )}

      {phase === 'phonedown' && (
        <View style={styles.centerScreen}>
          <View style={[styles.circle, styles.circleActive]} />
          <Text style={styles.title}>CLOSE{'\n'}THE LID</Text>
          {/* Sista steget måste stå här, medan skärmen fortfarande går att
              läsa — när locket väl är stängt ligger telefonen inne i lådan.
              Utan den här raden vet ingen att pausen kräver tummarna, och
              lådan faller tillbaka till loggan efter 30 s utan att någon
              paus räknats. */}
          <Text style={styles.nextStep}>THEN HOLD{'\n'}BOTH PADS</Text>
        </View>
      )}

      {phase === 'abandoned' && (
        <Pressable style={styles.centerScreen} onPress={() => router.replace('/pause')}>
          <View style={[styles.circle, styles.circleIdle]} />
          <Text style={styles.title}>PAUSE{'\n'}NOT STARTED</Text>
          <Text style={styles.explanation}>
            {abandonReason === 'checkin'
              ? 'The lid closed, but nobody held both pads on the box — so it let the pause go.'
              : 'The box stopped waiting for the lid and went back to sleep.'}
          </Text>
          <Text style={styles.nextStep}>TAP TO{'\n'}TRY AGAIN</Text>
        </Pressable>
      )}
    </View>
  );
}

const makeStyles = (Palette: AppPalette) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerScreen: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 40,
  },
  title: {
    fontSize: 26,
    fontWeight: '900',
    color: Palette.textPrimary,
    textAlign: 'center',
    letterSpacing: 1,
    lineHeight: 34,
  },
  // Samma versala displayröst som titeln, en nivå ner i ljusstyrka — ett
  // nästa steg, inte en andra rubrik.
  nextStep: {
    fontSize: 16,
    fontWeight: '900',
    color: Palette.textSecondary,
    textAlign: 'center',
    letterSpacing: 1,
    lineHeight: 22,
    marginTop: -20,
  },
  explanation: {
    fontSize: 14,
    color: Palette.textTertiary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 40,
    marginTop: -20,
  },
  circle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Palette.accent,
    opacity: 0.5,
  },
  circleActive: {
    opacity: 1,
  },
  circleIdle: {
    opacity: 0.15,
  },
});
