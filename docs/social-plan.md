# Social-plan — Stories, On my list & Delad progress

Fas 0 kartlagd och godkänd. **Väg B** gäller: specen mappas om mot det som
finns i repot. Tokens och synlighetsinställningar utgår ur v1.

## Fattade beslut

1. **Väg B.** Repot är facit. `pause-social-spec.md` finns inte och ska inte
   letas efter — den skrevs i chatt innan något av detta fanns i kod.
2. **Inga tokens, ingen synlighetsmodell i v1.** `earn_token` och
   `visibility_settings` byggs inte. `complete_wishlist_item` ger därför
   ingen token, och `wishlist_completed` loggas utan synlighetskategori.
3. **SQL-konventionen behålls.** Idempotenta filer i `supabase/`, körda för
   hand i SQL-editorn. Inget migrationsverktyg införs.
4. **Aktivitetsflödet flyttar inte.** Det stannar längst ner i Kretsen-fliken.
   Dessutom: tryck på **Done together** öppnar en modal med vem som gjort
   vad. Community-fliken får ingen kopia av flödet — där trycker man i
   stället på en vän och ser *deras* "on my list" och vad de klarat senaste
   veckan. Ingen duplicerad flödeslogik.
5. **Privat punkt som story är alltid tillåtet.** `private` styr bara om
   andra får skicka utmaningar mot punkten, aldrig om du själv får dela den.
6. **Lat utvärdering för stories.** `story_expires_at > now()` filtreras vid
   läsning, ingen städning, inget schemalagt jobb — samma princip som
   veckoskiftet i kretsarna.

## Namnbyte (beslut fattat under Fas 1)

`circle_weekly_goals` heter nu **`wishlist_items`**. Skälet: tabellen var
redan felnamngiven — inget i den är veckovis, den nollställs aldrig, och den
är inte längre mål utan punkter på en lista. Specens hela vokabulär säger
`wishlist_items`, så namnbytet gör att spec och kod menar samma sak i stället
för att behöva översättas vid varje referens. Bytet är idempotent guardat.

Samtidigt föll `circle_id` bort: en punkt tillhör en **person**, inte en
krets. Vem som får se den avgörs vid läsning av delat kretsmedlemskap, vilket
är precis vad specens `active_stories`-vy beskriver. Utan det skulle någons
lista tömmas när de lämnar en krets.

---

## Huvudslutsats

**Specen är skriven mot en annan version av appen än den som ligger i repot.**
Av alla tabeller, kolumner, RPC:er och skärmar den bygger vidare på finns
**ingen enda** här. Det gäller inte bara namnen — själva begreppen saknas
(tokens, synlighetsinställningar, bevis-moment, skattkista).

`docs/pause-social-spec.md`, som specen ber mig läsa först för kontext om
`wishlist_items`, `activity_events`, tokens och synlighet, finns inte heller —
det fanns ingen `docs/`-katalog alls innan den här filen skapades.

Därför går Fas 1 inte att utföra som skriven: "utöka `wishlist_items` (skapa
migration, ändra inte destruktivt)" förutsätter en tabell som inte existerar,
och `earn_token` / `visibility_settings` / `support_messages` som specen säger
att jag ska återanvända finns inte att återanvända.

Innan något byggs behöver vi bestämma vilken av två vägar som gäller. Se
**Beslut som krävs** längst ner.

---

## Fas 1 — byggt

`supabase/wishlist.sql` (ny fil, körs **efter** `circles.sql` — den använder
`circle_week_start()` och `circle_members`):

- `circle_weekly_goals` → **`wishlist_items`**, guardat namnbyte.
- Nya kolumner: `done_at`, `tone`, `story_expires_at`, `private`,
  `open_for_challenges`. De två sista är inerta i v1.
- Treplatsarvet borttaget: `unique(user_id, position)` och
  `check(position between 0 and 2)` droppas, `position` blir nullable.
  Utan det gick det inte att lägga till en fjärde punkt.
- `circle_id` behålls med sitt data men tappar sin främmande nyckel. Den var
  `on delete cascade` — en raderad krets hade tagit medlemmarnas listor med
  sig. Kolumnen skrivs inte längre och läses ingenstans.
- RLS: egna rader plus kretskamraternas, via definer-funktionen
  `shares_circle_with()` (samma mönster som `is_circle_member`).
- Vyn `active_stories` med `security_invoker = true` (kräver PG15+), så att
  tabellens policy gäller den som frågar.
- RPC:er: `activate_story(item_id, tone)`, `complete_wishlist_item(item_id)`,
  `circle_weekly_completions(circle_id)`.

Klienten är ompekad så att appen fungerar mellan faserna: Kretsens
Plans-sektion läser `wishlist_items` (ej avklarade) och redigerar de tre
första raderna efter ordning i stället för platsnummer. Typerna
`WishlistItem`, `ActiveStory` och `CircleCompletion` finns i `types/database.ts`,
och `wishlist_completed` renderas i flödet av `formatActivity()`.

**Avvikelser från specen, med skäl:**

- `complete_wishlist_item` tar inget `proof_moment_id` — bevis-moment finns
  inte i schemat. Parametern hade pekat på ingenting.
- Ingen token delas ut (beslut 2).
- `wishlist_completed` loggas utan synlighetskategori (beslut 2).
- Anropet är idempotent: en redan avklarad punkt rörs inte, annars hade
  `done_at` kunnat flyttas till en ny vecka och räknats två gånger i potten.

## Fas 2 — byggt

**On my list** på Hem, i nedre tredjedelen under paus-knappen
(`app/(tabs)/index.tsx`). Visar de tre senaste ej avklarade punkterna,
"+" lägger till, tryck på en rad ger *Mark as done* (RPC:n
`complete_wishlist_item`) eller *Remove*. Tomt tillstånd i stället för tom
yta. Listan laddas om via `useFocusEffect`, samma mönster som
inkorgsräknarna redan använder.

`bottomRow` på Hem ligger `position: absolute; bottom: 80`, så sektionen
har `marginBottom: 96` för att hålla sig ovanför de flytande knapparna.

**Två saker specen antog fanns men som inte gör det:**

- *"Markera klar → öppnar samma 'lägg till bevis'-flöde som en avslutad
  paus"* — det flödet finns inte. En avslutad paus går till
  `pausesummary.tsx`, som inte samlar in bild eller text. "Mark as done"
  anropar därför RPC:n direkt. Bevis är uppskjutet, inte byggt och gömt.
- *"Behåll den fullständiga listan på Profil-skärmen som idag"* — den finns
  inte där idag. `app/profile.tsx` hanterar användarnamn, avatar och
  `show_stats`. Hem visar bara tre punkter, så någonstans måste hela listan
  bo. Inte byggt ännu; se öppen fråga nedan.

## Fas 3 — påbörjad

**Bryggan valdes.** `activate_story` skapar numera även en rad i
`support_stories` som pekar tillbaka på punkten (`wishlist_item_id`). Därmed
fungerar story-raden, helskärmsläsaren, svarsknapparna, `support_responses`
och Hems inkorgs-badge utan en enda ändring — de kände redan
`support_stories`. Ett eget spår hade krävt ändringar i alla fem.

Två saker som bryggan tvingade fram, båda upptäckta i koden:

- **`expires_at` på `support_stories`.** Ingenting stängde en story efter 24 h
  — vanliga stöd-stories stängs för hand. Kolumnen är null för dem och satt
  för de bryggade; `fetchStories` filtrerar `is.null OR gt.now`. Ingen
  städning, samma lata utvärdering som resten.
- **En aktiv story per person.** `fetchStories` plockar ut den egna med
  `.find()` på `user_id`, så två aktiva rader hade gjort det godtyckligt
  vilken som visas. `activate_story` stänger därför tidigare aktiva först.

**Byggt i klienten:** tvåstegslakanet bakom "+" — vad, sedan vilken sorts
stöd. Allt som inte redan står på listan blir en punkt först (med
`private: true`), eftersom en story måste peka på något och en sak man vill
göra hör hemma på listan oavsett var den skrevs.

**De två flödena slogs ihop.** Först fanns ett separat "tone"-begrepp med
fyra egna id:n (`tillsagelse`, `varme`, `peptal`) — men exakt samma begrepp
fanns redan i `SUPPORT_TYPES` med andra id:n (`tillsägelse`, `värme`,
`motivationstal`). Samma kolumn, `support_stories.support_type`, bar alltså
två vokabulär för samma sak, och det var därför de två ingångarna kändes som
en funktion som låtsades vara två. Nu finns **ett** vokabulär, det gamla:

- Steg 1 tar ämnet från tre källor — punkt ur listan, aktivitetskategori
  (från gamla skärmen) eller fritext. Att välja i en nollställer de andra.
- Steg 2 visar tre genvägar ur samma 24 (`QUICK_TONE_IDS`), med
  "Something else…" som fäller ut hela listan. Flerval, som förr.
- Check-constrainten på `wishlist_items.tone` är borttagen: den var en andra,
  sämre kopia av en vokabulär som bor i klienten och kan växa.

`/support-story-create` är pensionerad — dess `Stack.Screen` är borttagen ur
`app/_layout.tsx` och ingenting leder dit. Filen ligger kvar på disk och kan
raderas när du vill.

**Återstår i Fas 3:** ringfärg efter ton i story-raden, tonstyrda snabbsvar
(väntar på copy), och Community-vyn där man trycker på en vän och ser deras
lista + veckans avklarade (beslut 4).

## Två krockar att lösa innan Fas 3

**1. Story-raden finns redan.** Community-fliken har redan exakt det
Instagram-mönster specen beskriver: `StoryBubble`-cirklar i en horisontell
rad, din egen först med "+" när du saknar aktiv story, nedtonad när du svarat,
som öppnar en helskärmsmodal med svarsknappar för text/röst/video
(`app/(tabs)/friends.tsx:545`). Den drivs av `support_stories`.

Att bygga en andra rad för wishlist-stories i samma flik vore nästan
identiskt UI två gånger. Förslag: **en rad, två källor** — låt tonen styra
ringfärgen så att "jag ber om stöd" och "jag delar en punkt" går att skilja
åt. Alternativet är två staplade rader, vilket blir rörigt.

**2. Svaren har ingen plats att peka på.** `support_responses` är kopplad via
`story_id` → `support_stories.id`. En wishlist-story är en `wishlist_items`-rad
och har inget sådant id. Antingen får `support_responses` en nullable
`item_id`, eller så skapas en `support_stories`-rad som brygga när en punkt
aktiveras. Jag förordar det första — en brygga hade betytt två rader som kan
komma isär.

## Vad specen antar vs vad som finns

| Specen säger | Finns i repot | Kommentar |
|---|---|---|
| `docs/pause-social-spec.md` | ✗ | Ingen `docs/`-katalog fanns |
| `wishlist_items` | ✗ | Närmaste släkting: `circle_weekly_goals` |
| `done_at` ("redan i schemat") | ✗ | Finns ingenstans |
| `open_for_challenges`, `private` | ✗ | Finns ingenstans |
| `tone`, `story_expires_at` | ✗ | Följer av att tabellen saknas |
| `activity_events` | ✗ | Motsvarighet: `circle_activity` |
| `earn_token`, tokens | ✗ | "token" i repot = `push_token` och auth-tokens |
| `visibility_settings`, kategori `challenges` | ✗ | Ingen synlighetsmodell alls |
| `support_messages` (`pause_id`, `ref_id`, `deliver_after`) | ✗ | Finns: `support_responses`, `pause_messages` |
| `pauses` | ✗ | Heter `pause_sessions` |
| `proof_moment` / bevis-flöde efter paus | ✗ | Finns inte |
| Challenges-tabell att "låta ligga orörd" | ✗ | Diskuterades, byggdes aldrig |
| Skattkistan på Hem | ✗ | Hem har ingen sådan yta |
| Fliken "Kretsen" | ✓ | `app/(tabs)/circle.tsx`, titel **Circle** |
| Fliken "Community" *(ny)* | ✓ **finns redan** | `app/(tabs)/friends.tsx` har titel **Community** |
| Fliken "Stöd" | ✗ | Finns inte — det går inte att lägga något "mellan Kretsen och Stöd" |

### Tabeller som faktiskt finns

`profiles`, `friendships`, `pause_sessions`, `pause_messages`,
`support_stories`, `support_responses`, `circles`, `circle_members`,
`circle_invites`, `circle_weekly_goals`, `circle_activity`,
`circle_pause_ledger`, `circle_goal_achievements`, `circle_level_ups`.

---

## Kartläggning av de fyra punkterna i Fas 0

**1. `wishlist_items` och var den används** — finns inte. Funktionellt
närmast är `circle_weekly_goals`: max tre fritextrader per person
(`position` 0–2, `unique(user_id, position)`), synliga för kretsen, renderade
som horisontella kort under rubriken **Plans** i Kretsen-fliken. De har
varken `done_at`, `private` eller `open_for_challenges`, och trots namnet
nollställs de aldrig — ingen veckokolumn, ingen återställning. Profil-skärmen
(`app/profile.tsx`) visar dem inte; den hanterar användarnamn, avatar och
`show_stats`.

**2. `activity_events` och hur flödet renderas** — heter `circle_activity`
och har en annan form: bara `type` + `metadata jsonb`, aldrig färdig text.
Texten byggs klientsidan av `formatActivity()` i `lib/circles.ts`. Flödet
renderas längst ner i Kretsen-fliken som en panel med avdelade rader; rader
utan aktör (`actor_id is null`, alltså kretsens egna milstolpar) får en
ikon i stället för avatar. Inga synlighetsregler finns — alla medlemmar ser
alla rader.

**3. Navigationsstrukturen** — tre flikar i `app/(tabs)/_layout.tsx`:

| Fil | Titel i tabbaren |
|---|---|
| `index.tsx` | **Pause** |
| `circle.tsx` | **Circle** |
| `friends.tsx` | **Community** |

Alltså: en Community-flik finns redan, och den innehåller vänner,
support-stories och stories-svar. Ingen Stöd-flik existerar. Specens
story-rad hör troligen hemma i just den fliken, inte i en ny.

**4. Tema och komponenter** — `constants/appTheme.ts` exporterar `Palette`,
`Radius`, `Spacing`, `eyebrow`, `cardShadow`. Det finns **inget
komponentbibliotek**: varje skärm bygger sin egen `StyleSheet`. `components/`
innehåller kvarlevor från Expo-mallen (`themed-text`, `parallax-scroll-view`
m.fl.) plus `haptic-tab`. Progress-barer och kort finns bara som lokala
komponenter i Kretsen-fliken (`Bar`, `Ring`, och `panel`-stilen). "Använd
samma kortkomponent som skattkistans innehåll" går alltså inte att följa —
varken komponenten eller skattkistan finns.

**Hem-skärmen** (`app/(tabs)/index.tsx`, 341 rader) är medvetet tom: topprad
med logga och tre ikonknappar (statistik, profil, inställningar), centrerad
hälsning med en stor PAUSE-knapp, och nederst två inkorgsknappar med badge
för olevererade röst/video- respektive textmeddelanden. Det finns alltså
**redan ett inkorgsmönster med badge på Hem** som story-svar rimligen borde
återanvända i stället för att få ett tredje.

---

## Vad som skulle läggas till, flyttas och pausas

**Pausas** — challenges-flödet. Inget att pausa: det diskuterades men
byggdes aldrig, och ingen tabell finns att lämna orörd.

**Flyttas** — inget föreslås flyttat förrän frågan om aktivitetsflödet är
besvarad (se beslut 4).

**Läggs till** — beror helt på vilken väg som väljs nedan.

---

## Beslut som krävs innan Fas 1

**1. Vilken väg?**

- **A — Bygg grunden först.** Skapa `wishlist_items`, `done_at`, `private`,
  `open_for_challenges`, tokens med `earn_token`, `visibility_settings` med
  kategorin `challenges`, `support_messages` med `deliver_after`, samt
  bevis-moment. Det är inte "utöka en befintlig tabell" utan ett eget
  projekt, större än Fas 1–4 tillsammans.
- **B — Mappa om specen till det som finns.** `circle_weekly_goals` blir
  to-do-listan och får `done_at`, `tone`, `story_expires_at`; `circle_activity`
  är flödet; `support_responses` bär story-svaren; `pause_sessions` är pauser.
  Tokens, synlighetsinställningar och bevis-moment utgår ur v1 eller byggs
  medvetet som nytt, inte som "befintligt".

Jag förordar **B**, med tillägget att tokens och synlighet lyfts ur v1 helt:
specen lutar sig mot dem på tre ställen (token vid avklarad punkt, kategori
`challenges` i synlighet), och alla tre går att skjuta upp utan att
story-flödet eller den delade potten tappar mening.

**2. Finns `pause-social-spec.md` någon annanstans?** Om tabellerna existerar
i ett annat projekt eller en annan Supabase-instans är den här kartläggningen
missvisande och jag behöver rätt källa.

**3. Migrationsformatet.** Specen säger "skapa migration". Det finns inget
migrationsverktyg här — `supabase/circles.sql` och `supabase/box_sessions.sql`
körs för hand i SQL-editorn, och filerna är idempotenta så de kan köras om.
Jag följer den konventionen om inget annat sägs.

**4. Aktivitetsflödet — två ställen eller flyttas det?** Specen ber mig fråga.
Eftersom Community-fliken redan finns och redan är den sociala ytan, är
alternativen: (a) flödet stannar i Kretsen och Community får story-raden
ovanpå sitt nuvarande innehåll, (b) flödet flyttar till Community och Kretsen
fokuserar på potten och stegen. Jag lutar åt **(b)** — Kretsen blir då "hur
går det för oss", Community blir "vad händer" — men det är din kallelse.

**5. Privat punkt som story.** Din bedömning i Fas 5 är att `private` bara
styr om andra får skicka challenges mot punkten, inte om du själv får göra en
story av den. Den håller jag med om: det är du som väljer att dela, och i
stunden. Värt att notera att `private` inte finns ännu, så regeln skrivs från
grunden snarare än bekräftas.

**6. Stories 24 h — ingen cron.** Det finns inget schemalagt jobb i projektet;
veckoskiftet i kretsarna löses med lat utvärdering vid läsning. Stories bör
lösas likadant: `story_expires_at > now()` filtreras i vyn, raden städas
aldrig. Det stämmer med specens "punkten och ev. svar finns kvar i datan".
