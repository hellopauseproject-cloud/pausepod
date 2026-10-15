-- Analysvyer över det som redan ligger i databasen.
-- Körs för hand i Supabase SQL-editorn (samma konvention som circles.sql —
-- det finns inget migrationsverktyg i projektet). Allt är idempotent.
--
-- ─── Varför ett eget schema ───────────────────────────────────────────────
-- Vyerna aggregerar ALLA användares rader tvärs över RLS: en vy körs med
-- sin ägares rättigheter (security_invoker är av som förval), och Supabase
-- delar som förval ut select på nya objekt i public till anon och
-- authenticated. En vy som den här i public hade alltså varit en publik
-- dump av hela användarbasen.
--
-- Schemat analytics får därför inga grants alls och ligger inte i
-- PostgREST:s db-schemas. Enda vägen in är SQL-editorn (som kör som
-- postgres) eller en service_role-nyckel. Lägg inte vyerna i public, och
-- grant:a dem inte till authenticated "bara för en adminskärm" — en
-- adminskärm behöver en security definer-RPC som kontrollerar *vem* som
-- frågar, inte en öppen vy.
--
-- ─── Varför varje vy droppas före sitt create ─────────────────────────────
-- `create or replace view` får bara LÄGGA TILL kolumner sist. Den vägrar
-- byta datatyp ("cannot change data type of view column") och vägrar skjuta
-- in en kolumn i mitten ("cannot change name of view column X to Y" — ett
-- förvirrande fel som i själva verket betyder att kolumnerna hamnat i otakt
-- från den punkten och framåt). Båda är helt normala ändringar att vilja
-- göra i en analysvy, och båda hade gjort filen omöjlig att köra om.
--
-- Därför droppas de fem vyerna nedan först. En vy har ingen egen data, så
-- droppen kostar ingenting. Grindarna `counted_profiles`/`counted_sessions`
-- droppas INTE: de fem hänger på dem, och en drop utan CASCADE hade fallit
-- (och en med CASCADE hade rivit mer än den lagade). De kan därför bara
-- växa på slutet — vilket de gör av sig själva, eftersom de är `select *`.
--
-- Lägger du till en vy: ge den en drop, och lägg den efter grindarna.

create schema if not exists analytics;
revoke all on schema analytics from anon, authenticated;

-- ─── Testkonton räknas inte ───────────────────────────────────────────────
-- Listan bor här och inte som en kolumn på `profiles`, av tre skäl: appen
-- ska inte kunna läsa vilka konton som är testkonton, en kolumn i `public`
-- är en kolumn man måste förhålla sig till i all framtid (kolumner droppas
-- inte i den här mappen), och "räknas inte i statistiken" är ett påstående
-- om analysen snarare än om användaren.
--
-- Det är en uteslutning och inte en radering, med flit. Ett raderat konto
-- kaskaderar in i kretsar, vänskaper och listor och river historik för de
-- riktiga konton testkontot råkat röra; en rad här gör samma jobb för
-- siffrorna utan att röra någonting annat. Tas raden bort kommer kontot
-- tillbaka i statistiken direkt, och det är hela poängen — ett misstag här
-- går att ångra.
create table if not exists analytics.excluded_users (
  user_id  uuid primary key,
  note     text,
  added_at timestamptz not null default now()
);
-- Ingen foreign key till auth.users med flit: raderar man ett testkonto på
-- riktigt ska raden här stå kvar, så att dess kvarvarande spår (t.ex.
-- app_events-rader vars user_id nollats) fortsätter vara uteslutna.
revoke all on analytics.excluded_users from anon, authenticated;

-- De två grindarna. Varje vy nedan läser genom en av dem, så en ny rad i
-- excluded_users slår igenom överallt på en gång — ett filter per vy hade
-- glidit isär precis som två kopior av dagsmålet gjorde.
create or replace view analytics.counted_profiles as
select p.*
  from public.profiles p
 where not exists (select 1 from analytics.excluded_users x where x.user_id = p.id);

-- Bara pauser: en natt (`kind = 'sleep'`, supabase/sleep.sql) hade gjort
-- "hur länge pausar de" till "hur länge sover de". Kör sleep.sql först.
create or replace view analytics.counted_sessions as
select s.*
  from public.pause_sessions s
 where s.kind = 'pause'
   and not exists (select 1 from analytics.excluded_users x where x.user_id = s.user_id);

-- ─── 1. En rad per användare ──────────────────────────────────────────────
-- "Hur ofta pausar de och hur länge." active_days är viktigare än pauses:
-- tio pauser på en dag är en annan användare än tio pauser på tio dagar,
-- och bara den andra har en vana.
drop view if exists analytics.user_overview;
create or replace view analytics.user_overview as
with sessions as (
  select
    user_id,
    duration_seconds,
    coalesce(ended_at, started_at) as at,
    box_id is not null as via_box,
    completed,
    is_shared
  from analytics.counted_sessions
  where duration_seconds is not null
    and duration_seconds > 0
)
select
  p.id                                                as user_id,
  p.username,
  p.created_at                                        as signed_up_at,
  p.onboarding_completed,
  p.daily_target_seconds,
  count(s.*)                                          as pauses,
  count(distinct date_trunc('day', s.at))             as active_days,
  -- Pauser per aktiv dag: tätheten när de väl använder appen.
  round(count(s.*)::numeric
        / greatest(count(distinct date_trunc('day', s.at)), 1), 2)
                                                      as pauses_per_active_day,
  -- Pauser per vecka sedan registreringen: tätheten i kalendertid, alltså
  -- inklusive de veckor de inte öppnade appen.
  round(count(s.*)::numeric
        / greatest(extract(epoch from (now() - p.created_at)) / 604800, 1)::numeric, 2)
                                                      as pauses_per_week,
  coalesce(sum(s.duration_seconds), 0)                as total_seconds,
  round(coalesce(avg(s.duration_seconds), 0))         as avg_seconds,
  -- Casten står här och inte i varje fråga: percentile_cont ger double
  -- precision, och `round(double precision, 1)` finns inte i Postgres — bara
  -- round(numeric, int). En kolumn som faller på sin egen round() är en
  -- fälla för varje fråga som någonsin skrivs mot vyn.
  percentile_cont(0.5) within group (order by s.duration_seconds)::numeric
                                                      as median_seconds,
  max(s.duration_seconds)                             as longest_seconds,
  count(*) filter (where s.via_box)                   as box_pauses,
  count(*) filter (where not s.completed)             as abandoned_pauses,
  count(*) filter (where s.is_shared)                 as shared_pauses,
  min(s.at)                                           as first_pause_at,
  max(s.at)                                           as last_pause_at,
  -- Dagar sedan senaste pausen. Det enda churn-måttet som finns utan
  -- app-open-händelser: en användare som inte pausat på 30 dagar kan ha
  -- öppnat appen igår, och det syns ingenstans idag.
  case when max(s.at) is null then null
       else floor(extract(epoch from (now() - max(s.at))) / 86400) end
                                                      as days_since_last_pause
from analytics.counted_profiles p
left join sessions s on s.user_id = p.id
group by p.id, p.username, p.created_at, p.onboarding_completed, p.daily_target_seconds;

-- ─── 2. En rad per dag ────────────────────────────────────────────────────
-- Dagen är UTC, samma gräns för alla — som kretsarnas måndag. Inte
-- klientens midnatt: två användare i olika tidszoner ska inte kunna lägga
-- samma paus på olika dagar i en kurva som ska gå att jämföra över tid.
drop view if exists analytics.daily_pauses;
create or replace view analytics.daily_pauses as
select
  date_trunc('day', coalesce(ended_at, started_at))::date as day,
  count(*)                                                as pauses,
  count(distinct user_id)                                 as active_users,
  sum(duration_seconds)                                   as total_seconds,
  round(avg(duration_seconds))                            as avg_seconds,
  count(*) filter (where box_id is not null)              as box_pauses,
  count(*) filter (where not completed)                   as abandoned_pauses
from analytics.counted_sessions
where duration_seconds is not null
  and duration_seconds > 0
group by 1
order by 1 desc;

-- ─── 3. Kategorimixen ─────────────────────────────────────────────────────
-- intention är kategorins LABEL från det manuella flödet men dess ID från
-- lådflödet (lib/sessionOutbox.ts skickar rec.category rakt igenom medan
-- app/pausing.tsx slår upp etiketten först). Samma kategori kan alltså stå
-- som både FOCUS och focus — därför upper().
drop view if exists analytics.category_mix;
create or replace view analytics.category_mix as
select
  coalesce(upper(intention), '(ingen kategori)') as category,
  count(*)                                       as pauses,
  count(distinct user_id)                        as users,
  sum(duration_seconds)                          as total_seconds,
  round(avg(duration_seconds))                   as avg_seconds
from analytics.counted_sessions
where duration_seconds is not null
  and duration_seconds > 0
group by 1
order by pauses desc;

-- ─── 4. Funktionsanvändning, så långt skrivna rader räcker ────────────────
-- Det här är inte händelsespårning. Varje tal är en rad någon LÄMNADE
-- EFTER SIG, inte ett besök: den som öppnade stödflödet och backade ut, den
-- som läste kretsens chatt utan att skriva, och den som bläddrade i
-- statistiken syns inte här över huvud taget. Läs talen som "hur många har
-- använt funktionen på allvar", aldrig som "hur ofta de tittar på den".
drop view if exists analytics.feature_usage;
create or replace view analytics.feature_usage as
select
  p.id                                                              as user_id,
  p.username,
  (select count(*) from public.support_stories ss
     where ss.user_id = p.id)                                       as support_stories_created,
  (select count(*) from public.support_responses sr
     where sr.sender_id = p.id)                                     as support_responses_sent,
  (select count(*) from public.support_responses sr
     where sr.sender_id = p.id and sr.response_type = 'voice')      as support_voice,
  (select count(*) from public.support_responses sr
     where sr.sender_id = p.id and sr.response_type = 'video')      as support_video,
  (select count(*) from public.support_responses sr
     where sr.sender_id = p.id and sr.response_type = 'text')       as support_text,
  (select count(*) from public.support_responses sr
     where sr.sender_id = p.id and sr.response_type = 'photo')      as support_photo,
  (select count(*) from public.friendships f
     where (f.requester_id = p.id or f.receiver_id = p.id)
       and f.status = 'accepted')                                   as friends,
  (select count(*) from public.friendships f
     where f.requester_id = p.id)                                   as friend_requests_sent,
  (select count(*) from public.pause_sessions s
     where s.user_id = p.id and s.is_shared)                        as shared_pauses,
  (select count(*) from public.pause_sessions s
     where s.user_id = p.id and s.box_id is not null)               as box_pauses,
  (select count(distinct s.box_id) from public.pause_sessions s
     where s.user_id = p.id and s.box_id is not null)               as boxes_used,
  (select count(*) from public.circle_members cm
     where cm.user_id = p.id)                                       as in_circle,
  (select count(*) from public.circle_messages cm
     where cm.user_id = p.id)                                       as circle_messages,
  (select count(*) from public.wishlist_items wi
     where wi.user_id = p.id)                                       as wishlist_items,
  (select count(*) from public.wishlist_items wi
     where wi.user_id = p.id and wi.done_at is not null)            as wishlist_done,
  p.daily_target_seconds is not null                                as has_daily_goal,
  p.show_stats                                                      as stats_public
from analytics.counted_profiles p;

-- ─── 5. Kvarhållning per registreringsvecka ───────────────────────────────
-- Kohorten är veckan de registrerade sig, och "aktiv" betyder pausade —
-- det enda som finns. En kohort där w1 är en bråkdel av w0 tappar folk
-- första veckan, och det är den enda siffran som säger något om huruvida
-- appen fastnar.
drop view if exists analytics.weekly_retention;
create or replace view analytics.weekly_retention as
with cohort as (
  select id as user_id, date_trunc('week', created_at) as cohort_week
  from analytics.counted_profiles
),
activity as (
  select distinct
    s.user_id,
    date_trunc('week', coalesce(s.ended_at, s.started_at)) as active_week
  from analytics.counted_sessions s
  where s.duration_seconds is not null and s.duration_seconds > 0
)
select
  c.cohort_week::date                     as cohort_week,
  count(distinct c.user_id)               as cohort_size,
  count(distinct a.user_id) filter (
    where a.active_week = c.cohort_week)                            as w0,
  count(distinct a.user_id) filter (
    where a.active_week = c.cohort_week + interval '1 week')        as w1,
  count(distinct a.user_id) filter (
    where a.active_week = c.cohort_week + interval '2 week')        as w2,
  count(distinct a.user_id) filter (
    where a.active_week = c.cohort_week + interval '3 week')        as w3,
  count(distinct a.user_id) filter (
    where a.active_week = c.cohort_week + interval '4 week')        as w4
from cohort c
left join activity a on a.user_id = c.user_id
group by 1
order by 1 desc;

-- Indexen finns för vyerna ovan: var och en av dem sveper pause_sessions
-- per användare eller per sluttid.
create index if not exists pause_sessions_user_ended_idx
  on public.pause_sessions (user_id, ended_at desc);
create index if not exists pause_sessions_ended_idx
  on public.pause_sessions (ended_at desc);

-- Säkerställ att inget läckte ut via default privileges, om någon av
-- vyerna någon gång skapades i public och flyttades hit.
revoke all on all tables in schema analytics from anon, authenticated;
