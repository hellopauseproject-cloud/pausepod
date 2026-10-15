-- Frågor att klistra in i Supabase SQL-editorn, en i taget.
--
-- Kräver att analytics.sql och app_events.sql är körda. Till skillnad från
-- dem skapar den här filen ingenting — den läser bara, och går att köra om
-- hur många gånger som helst.
--
-- Vyerna ligger i schemat `analytics` och har inga grants: SQL-editorn kör
-- som postgres och kommer åt dem, en klient med anon-nyckel gör det inte.
-- Det är avsiktligt, se CLAUDE.md.
--
-- ─── Vad som har data NU ──────────────────────────────────────────────────
-- Avsnitt 1–6 läser pause_sessions och de andra tabellerna som redan fanns.
-- De svarar direkt, bakåt i tiden, hela historiken.
--
-- Avsnitten är numrerade i läsordning, men filen är inte ett flöde — ta det
-- avsnitt du behöver.
--
-- Har du testkonton i databasen: ta avsnitt 10 FÖRST. Alla siffror i 2–7
-- räknar dem annars som riktiga användare, och med en handfull konton totalt
-- är det skillnaden mellan en kurva och ett brus.
--
-- Avsnitt 7 läser app_events och är TOM tills en app med lib/analytics.ts
-- körts. Startar du dev-klienten själv börjar raderna komma för ditt eget
-- konto inom en halv minut — kön skickar var 20:e sekund eller när 25
-- händelser samlats.


-- ══ 1. Står allt rätt? ════════════════════════════════════════════════════
-- Sju vyer ska listas. Saknas någon föll just den vyn när filen kördes
-- (oftast en kolumn som inte finns i den här databasen) — resten påverkas
-- inte.
select table_name
  from information_schema.views
 where table_schema = 'analytics'
 order by table_name;


-- ══ 2. Helheten på en rad ═════════════════════════════════════════════════
-- Den första siffran att titta på: hur många som faktiskt pausat, inte hur
-- många konton som finns.
select
  count(*)                                             as anvandare,
  count(*) filter (where pauses > 0)                   as har_pausat,
  count(*) filter (where daily_target_seconds is not null) as har_dagsmal,
  count(*) filter (where days_since_last_pause <= 7)   as aktiva_senaste_veckan,
  sum(pauses)                                          as pauser_totalt,
  round(sum(total_seconds) / 3600.0, 1)                as timmar_totalt,
  round(avg(nullif(avg_seconds, 0)) / 60.0, 1)         as snittlangd_min
from analytics.user_overview;


-- ══ 3. Per användare, de mest aktiva först ════════════════════════════════
-- `aktiva_dagar` betyder mer än `pauser`: tio pauser på en dag är en annan
-- användare än tio pauser på tio dagar, och bara den andra har en vana.
-- `dagar_sedan_senast` är det närmaste ett churn-mått som finns — hög siffra
-- betyder att personen inte pausat, inte nödvändigtvis att hen är borta.
select
  username,
  pauses                                 as pauser,
  active_days                            as aktiva_dagar,
  pauses_per_active_day                  as pauser_per_aktiv_dag,
  round(total_seconds / 3600.0, 1)       as timmar,
  round(avg_seconds / 60.0, 1)           as snitt_min,
  -- Casten är inte prydnad: median_seconds kommer ur percentile_cont, som
  -- ger double precision, och round(double precision, int) finns inte i
  -- Postgres — bara round(numeric, int). Uttrycket funkar både mot den
  -- gamla vyn och mot den som castar själv.
  round((median_seconds / 60.0)::numeric, 1) as median_min,
  round(longest_seconds / 60.0, 1)       as langsta_min,
  abandoned_pauses                       as avbrutna,
  shared_pauses                          as delade,
  signed_up_at::date                     as registrerad,
  last_pause_at::date                    as senaste_paus,
  days_since_last_pause                  as dagar_sedan_senast
from analytics.user_overview
order by pauses desc nulls last;


-- ══ 4. Dag för dag, senaste 30 ════════════════════════════════════════════
-- Dagen är UTC för alla, samma gräns som kretsarnas måndag.
select
  day                              as dag,
  active_users                     as anvandare,
  pauses                           as pauser,
  round(total_seconds / 60.0)      as minuter,
  round(avg_seconds / 60.0, 1)     as snitt_min,
  abandoned_pauses                 as avbrutna
from analytics.daily_pauses
where day > current_date - 30
order by dag desc;


-- ══ 5. Vad folk pausar till ═══════════════════════════════════════════════
-- `users` är kolumnen som betyder något: en kategori med tusen pauser från
-- en person är inte en populär kategori.
select
  category                          as kategori,
  pauses                            as pauser,
  users                             as anvandare,
  round(total_seconds / 3600.0, 1)  as timmar,
  round(avg_seconds / 60.0, 1)      as snitt_min
from analytics.category_mix
order by pauser desc;


-- ══ 6. Funktionsanvändning ════════════════════════════════════════════════
-- OBS: varje tal är en rad någon LÄMNADE EFTER SIG, inte ett besök. Den som
-- öppnade stödflödet och backade ut, och den som läste kretsens chatt utan
-- att skriva, syns inte här alls. För "hur ofta tittar de på X" krävs
-- avsnitt 7.
select
  username,
  friends                   as vanner,
  shared_pauses             as delade_pauser,
  in_circle > 0             as i_krets,
  circle_messages           as chattmeddelanden,
  support_stories_created   as stod_efterfragat,
  support_responses_sent    as stod_skickat,
  support_voice             as varav_rost,
  support_video             as varav_video,
  support_text              as varav_text,
  wishlist_items            as listpunkter,
  wishlist_done             as avklarade,
  box_pauses                as ladpauser,
  has_daily_goal            as har_mal
from analytics.feature_usage
order by vanner desc, stod_skickat desc;

-- Samma sak sammanfattat: hur många har använt varje funktion över huvud
-- taget? Det är den här raden som säger vad som är dött och vad som lever.
select
  count(*)                                              as anvandare,
  count(*) filter (where friends > 0)                    as har_vanner,
  count(*) filter (where in_circle > 0)                  as i_krets,
  count(*) filter (where circle_messages > 0)            as har_chattat,
  count(*) filter (where support_stories_created > 0)    as har_bett_om_stod,
  count(*) filter (where support_responses_sent > 0)     as har_gett_stod,
  count(*) filter (where shared_pauses > 0)              as har_delat_paus,
  count(*) filter (where wishlist_items > 0)             as har_listpunkter,
  count(*) filter (where box_pauses > 0)                 as har_anvant_lada,
  count(*) filter (where has_daily_goal)                 as har_dagsmal
from analytics.feature_usage;


-- ══ 7. Kvarhållning per registreringsvecka ════════════════════════════════
-- "Aktiv" betyder pausade — det enda som finns bakåt i tiden. En kohort där
-- w1 är en bråkdel av w0 tappar folk första veckan.
select
  cohort_week  as registreringsvecka,
  cohort_size  as antal,
  w0, w1, w2, w3, w4,
  case when w0 = 0 then null
       else round(100.0 * w1 / w0) end as kvar_v1_procent
from analytics.weekly_retention
order by registreringsvecka desc;


-- ══ 8. Händelseloggen — tom tills en ny app är ute ════════════════════════
-- Kolla att den lever. Noll rader är rätt svar innan en build med
-- lib/analytics.ts körts; det är inte ett fel i uppsättningen.
select count(*) as rader, min(occurred_at) as forsta, max(occurred_at) as senaste
  from public.app_events;

-- När raderna börjar komma:

-- Vad händer alls, och hur spritt är det?
select * from analytics.event_counts;

-- Vilka skärmar öppnas, och hur ofta per användare?
select * from analytics.screen_views;

-- Riktig DAU — den som öppnar appen utan att pausa räknas här men inte i
-- avsnitt 4.
select * from analytics.daily_active_users order by day desc limit 30;

-- Var i pausflödet folk faller ifrån, vecka för vecka. Lådstegen
-- (nadde_lada, la_ner_telefon, stangde_lock) står på noll så länge
-- POD_COMING_SOON är true i app/pause.tsx.
select * from analytics.pause_funnel;

-- Var i introduktionen folk hoppar av. Stegen i ordning: welcome, profile,
-- box, goal, done.
select * from analytics.intro_funnel;

-- Lådans anslutningar: hittas hårdvaran alls?
select * from analytics.box_connections;

-- Hur ofta en enskild användare använder en enskild funktion.
select * from analytics.user_event_counts
 where username = 'SÄTT_NAMN_HÄR'
 order by events desc;


-- ══ 10. Testkonton ════════════════════════════════════════════════════════
-- `analytics.excluded_users` är listan över konton som inte ska räknas.
-- Alla vyer läser genom den (`counted_profiles`, `counted_sessions`,
-- `counted_events`), så en rad här tystar kontot överallt på en gång.
--
-- Det är en uteslutning och inte en radering, med flit: tar du bort raden
-- kommer kontot tillbaka i statistiken direkt. Ett misstag går att ångra.

-- 10a. Vilka konton finns? Kör den här först och plocka ut testkontona för
--      hand. E-posten ligger i auth.users och syns bara här i SQL-editorn.
select
  p.id,
  p.username,
  u.email,
  p.created_at::date                   as registrerad,
  u.last_sign_in_at::date              as senast_inloggad,
  (select count(*) from public.pause_sessions s where s.user_id = p.id) as pauser,
  exists (select 1 from analytics.excluded_users x where x.user_id = p.id) as utesluten
from public.profiles p
left join auth.users u on u.id = p.id
order by p.created_at;

-- 10b. Uteslut på användarnamn. Skriv in namnen exakt som de står i 10a.
insert into analytics.excluded_users (user_id, note)
select id, 'testkonto'
  from public.profiles
 where username in ('SKRIV', 'NAMNEN', 'HÄR')
on conflict (user_id) do nothing;

-- 10c. Eller på e-postmönster, om testkontona har en igenkännlig adress.
--      Kolla alltid med en select först — en för bred `like` utesluter
--      riktiga användare, och då ser statistiken bara tom ut.
-- select id, email from auth.users where email like '%+test%';
insert into analytics.excluded_users (user_id, note)
select id, 'testkonto (e-post)'
  from auth.users
 where email like '%+test%'
on conflict (user_id) do nothing;

-- 10d. Vad är uteslutet just nu?
select x.user_id, p.username, u.email, x.note, x.added_at
  from analytics.excluded_users x
  left join public.profiles p on p.id = x.user_id
  left join auth.users u on u.id = x.user_id
 order by x.added_at;

-- 10e. Ångra. Kontot räknas igen från nästa fråga.
-- delete from analytics.excluded_users
--  where user_id in (select id from public.profiles where username = 'NAMN');

-- 10f. Kontroll: att siffrorna faktiskt ändrades. Raderna i `public` är allt,
--      raderna i `counted_*` är det som räknas, och skillnaden ska vara just
--      testkontona.
select
  (select count(*) from public.profiles)             as profiler_totalt,
  (select count(*) from analytics.counted_profiles)  as profiler_raknade,
  (select count(*) from public.pause_sessions)       as pauser_totalt,
  (select count(*) from analytics.counted_sessions)  as pauser_raknade;


-- ══ 11. Radera ett testkonto på riktigt ═══════════════════════════════════
-- Behövs normalt INTE — avsnitt 10 löser statistiken utan att röra data.
-- Gör det bara om kontot ska bort på allvar (det ligger i en krets det inte
-- hör hemma i, eller du vill frigöra dess användarnamn).
--
-- Det går inte att ångra, och det kaskaderar: `circle_members`,
-- `circle_invites`, `wishlist_items` och `friendships` har
-- `on delete cascade` mot profiles, så ett testkonto som varit med i en
-- riktig krets tar sin medlemsrad och sina listpunkter med sig.
-- `circle_messages.user_id` och `circle_activity.actor_id` är
-- `on delete set null` och blir "Someone" i stället. `pause_sessions` och
-- `profiles` skapades i dashboarden och inte i den här mappen, så deras
-- regler står inte i någon fil här — kolla dem med frågan nedan FÖRE du
-- raderar.

-- 11a. Vad händer vid en radering? Visar varje främmande nyckel som pekar på
--      profiles/auth.users och vad den gör när raden försvinner.
select
  tc.table_name                as tabell,
  kcu.column_name              as kolumn,
  ccu.table_name               as pekar_pa,
  rc.delete_rule               as vid_radering
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on kcu.constraint_name = tc.constraint_name
join information_schema.referential_constraints rc
  on rc.constraint_name = tc.constraint_name
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
where tc.constraint_type = 'FOREIGN KEY'
  and ccu.table_name in ('users', 'profiles')
order by tabell;

-- 11b. Raderingen. Avkommentera en rad i taget, ett konto i taget, och läs
--      11a först. Behåll raden i analytics.excluded_users efteråt:
--      app_events.user_id nollas av raderingen i stället för att försvinna,
--      och tabellen har ingen främmande nyckel just för att uteslutningen
--      ska överleva kontot.
-- delete from auth.users where email = 'test@example.com';


-- ══ 12. Städning, när tabellen blivit stor ════════════════════════════════
-- Raderar händelser äldre än N dagar och returnerar antalet. Körs för hand —
-- det finns ingen cron i projektet. Aggregaten du vill behålla längre än
-- råraderna måste materialiseras först.
-- select analytics.prune_app_events(180);
