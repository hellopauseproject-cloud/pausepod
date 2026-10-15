import AsyncStorage from '@react-native-async-storage/async-storage';
import { setDailyGoal } from './circles';

/**
 * Det introduktionen vet men ännu inte hunnit spara.
 *
 * Skälet till att den parkerar alls är inte längre att talet saknar hemvist.
 * Dagsmålet låg förr på `circle_members.daily_target_seconds` och
 * `set_daily_goal` kastade "You are not in a circle." för alla andra, så en ny
 * användare — som per definition inte är med i någon krets — hade ingenstans
 * att skriva siffran hen just valt. Numera bor talet på
 * `profiles.daily_target_seconds` (se supabase/dailygoal.sql) och RPC:n tar
 * emot det från vem som helst med ett konto.
 *
 * Kvar finns ett smalare skäl: introduktionen skriver allt lokalt först och
 * servern sist, så att en tappad uppkoppling mitt i inte kostar användaren de
 * val hen redan gjort. Målet följer samma väg som namnet och kategorierna, och
 * plockas upp av första skärmen som ser att det saknas — Hem eller kretsfliken.
 *
 * Nyckeln är per enhet, inte per användare, precis som temavalet i
 * ThemeContext: den lever bara mellan introduktionen och första hämtningen.
 */
const PENDING_GOAL_KEY = 'intro_pending_daily_goal_seconds';

export async function savePendingDailyGoal(seconds: number | null): Promise<void> {
  try {
    if (seconds === null) await AsyncStorage.removeItem(PENDING_GOAL_KEY);
    else await AsyncStorage.setItem(PENDING_GOAL_KEY, String(seconds));
  } catch {}
}

export async function getPendingDailyGoal(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_GOAL_KEY);
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Skriver det parkerade målet till profilen — men bara om användaren inte
 * redan satt ett.
 *
 * `currentGoalSeconds` skickas in av anroparen i stället för att läsas här:
 * både Hem och kretsfliken har redan talet i minnet från sin egen hämtning,
 * och ett extra RPC-anrop för det vore slöseri. Är det satt betyder det att
 * användaren valt om sedan introduktionen, och då ska en gammal parkerad
 * siffra inte köra över det valet — den kastas.
 *
 * Returnerar true bara när ett mål faktiskt skrevs, så anroparen vet om den
 * behöver läsa om.
 */
export async function applyPendingDailyGoal(currentGoalSeconds: number | null): Promise<boolean> {
  const pending = await getPendingDailyGoal();
  if (pending === null) return false;

  if (currentGoalSeconds) {
    await savePendingDailyGoal(null);
    return false;
  }

  try {
    await setDailyGoal(pending);
    await savePendingDailyGoal(null);
    return true;
  } catch {
    // Nätet är nere, eller sessionen har gått ut. Siffran ligger kvar och
    // nästa försök tar den — därför nollas nyckeln bara vid faktisk framgång.
    return false;
  }
}

/**
 * Kretsen vars välkomstsida ännu inte visats.
 *
 * Den som *skapar* en krets läser YOU / THE CIRCLE / TOGETHER i
 * [app/circle-create.tsx](../app/circle-create.tsx) innan kretsen finns. Den
 * som *bjuds in* tryckte förut på en bock och stod i kretsen utan ett ord —
 * och eftersom de flesta medlemmar kommer in den vägen nådde reglerna aldrig
 * dem. [app/circle-welcome.tsx](../app/circle-welcome.tsx) stänger den luckan.
 *
 * Flaggan sätts när inbjudan accepteras och rivs när sidan kvitteras, inte
 * tvärtom. Ordningen är hela poängen: stängs appen mitt i sidan ligger den
 * kvar, och kretsfliken visar den igen nästa gång den laddar. Hade den rivits
 * vid visning vore sidan borta för den som råkade svajpa bort appen.
 *
 * Följden av att flaggan bara *sätts* vid ett accepterande är att ingen
 * befintlig medlem plötsligt möts av sidan efter en uppdatering, och att den
 * som skapat kretsen aldrig ser den — hen har just läst samma text.
 *
 * Nyckeln är per enhet, som temavalet och det parkerade målet. Byter någon
 * telefon mellan bocken och nästa öppning är sidan förlorad; det är billigare
 * än en kolumn i databasen för en sida som visas en gång i livet.
 */
const PENDING_CIRCLE_WELCOME_KEY = 'pending_circle_welcome_id';

/**
 * Introduktionen som sköts upp.
 *
 * **Den här flaggan finns för att `profiles.onboarding_completed` inte får
 * ljuga.** Grinden i [app/_layout.tsx](../app/_layout.tsx) skickar den som inte
 * kört introduktionen till `/intro`, och den enda flaggan som fanns var
 * serverns. Ett skip som satte den till `true` hade sagt att introduktionen
 * körts — och eftersom det är samma flagga som kvittot skriver sist av allt,
 * hade användaren förlorat introduktionen för alltid i utbyte mot att slippa
 * den en gång. Serverflaggan betyder därför fortsatt exakt en sak: att
 * kvittots skrivning gått igenom. Den här bär det andra: att användaren bett
 * att få göra det senare.
 *
 * Grinden läser båda och släpper förbi på endera. Overlayen i samma fil måste
 * vänta på båda också — en gate som utvärderas innan den här hunnit läsas
 * skickar till `/intro` i en hundradel innan den ångrar sig, och blinket syns.
 *
 * Nyckeln är per enhet, som temat och det parkerade målet. Följden är att
 * samma konto på en ny telefon möts av introduktionen igen, och det är avsikten
 * snarare än priset: en ny enhet är en ny chans att faktiskt köra den. Det som
 * verkligen hör kontot till — namn, avatar, mål — ligger ändå kvar i profilen.
 *
 * Den rivs av introduktionens `finish()`, inte av att den visats: skulle någon
 * öppna introduktionen från Hem och hoppa av igen ska uppskjutandet stå kvar.
 */
const INTRO_DEFERRED_KEY = 'intro_deferred';

export async function deferIntro(): Promise<void> {
  try { await AsyncStorage.setItem(INTRO_DEFERRED_KEY, '1'); } catch {}
}

export async function isIntroDeferred(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(INTRO_DEFERRED_KEY)) === '1'; } catch { return false; }
}

export async function clearIntroDeferred(): Promise<void> {
  try { await AsyncStorage.removeItem(INTRO_DEFERRED_KEY); } catch {}
}

export async function setPendingCircleWelcome(circleId: string): Promise<void> {
  try { await AsyncStorage.setItem(PENDING_CIRCLE_WELCOME_KEY, circleId); } catch {}
}

export async function getPendingCircleWelcome(): Promise<string | null> {
  try { return await AsyncStorage.getItem(PENDING_CIRCLE_WELCOME_KEY); } catch { return null; }
}

export async function clearPendingCircleWelcome(): Promise<void> {
  try { await AsyncStorage.removeItem(PENDING_CIRCLE_WELCOME_KEY); } catch {}
}
