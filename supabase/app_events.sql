-- Händelselogg för funktionsanvändning, plus analysvyerna över den.
-- Körs för hand i Supabase SQL-editorn efter analytics.sql (samma konvention
-- som circles.sql — det finns inget migrationsverktyg i projektet). Allt är
-- idempotent.
--
-- Den här tabellen är den enda delen av statistiken som INTE är retroaktiv:
-- pause_sessions har funnits hela tiden, men ingen har någonsin skrivit en
-- rad om vilka skärmar folk öppnar. Talen börjar alltså på noll den dag en
-- version med lib/analytics.ts är ute hos användarna, och säger ingenting om
-- tiden före den.

-- Schemat skapas i analytics.sql; raden här finns för att filen ska gå att
-- köra ensam om någon bara vill ha händelseloggen.
create schema if not exists analytics;
revoke all on schema analytics from anon, authenticated;

-- ─── Tabellen ─────────────────────────────────────────────────────────────
create table if not exists public.app_events (
  id            bigint generated always as identity primary key,
  -- on delete set null, av samma skäl som circle_activity.actor_id: ett
  -- raderat konto ska inte riva hål i kurvorna för alla andra.
  user_id       uuid references auth.users(id) on delete set null,
  name          text not null,
  props         jsonb not null default '{}'::jsonb,
  -- Klientens tid för när händelsen hände. Kön i lib/analytics.ts överlever
  -- både flygplansläge och appomstart, så en rad kan landa långt efter sin
  -- händelse — samma skillnad som lådans ageMs finns för.
  occurred_at   timestamptz not null,
  -- När raden landade här. Skillnaden mot occurred_at är kölängden, och en
  -- stor skillnad på många rader betyder att folk är offline, inte att de
  -- slutat använda appen.
  received_at   timestamptz not null default now(),
  platform      text,
  app_version   text,
  -- En per appstart. Gör att en sekvens går att följa (öppnade appen →
  -- valde paus → hoppade av) utan att något måste sparas mellan starter.
  app_session_id uuid
);

-- Medvetet INGA check-constraints på occurred_at eller på name. Klienten
-- skickar i batch, och en enda avvisad rad hade fällt hela inserten — kön
-- hade då försökt om med samma trasiga rad i all evighet och blockerat
-- allt bakom den. En felställd klocka ger hellre en skev rad att filtrera
-- bort vid läsning än en kö som står still.

create index if not exists app_events_name_time_idx
  on public.app_events (name, occurred_at desc);
create index if not exists app_events_user_time_idx
  on public.app_events (user_id, occurred_at desc);
-- props frågas på nyckel (props->>'screen', props->>'step'), inte på hela
-- dokumentet: jsonb_path_ops är mindre än den förvalda klassen och räcker
-- för @> som vyerna nedan använder.
create index if not exists app_events_props_idx
  on public.app_events using gin (props jsonb_path_ops);

-- ─── Rättigheter: skriv-bara för klienten ─────────────────────────────────
-- Klienten får lägga till sina egna rader och ingenting annat. Inget select:
-- händelseloggen är allas rader i en tabell, och appen har ingen skärm som
-- läser den. Ingen update och ingen delete: en logg man kan skriva om är
-- ingen logg.
alter table public.app_events enable row level security;

drop policy if exists app_events_insert_self on public.app_events;
create policy app_events_insert_self
  on public.app_events for insert to authenticated
  with check (user_id = auth.uid());

revoke all on public.app_events from anon, authenticated;
grant insert on public.app_events to authenticated;

-- ─── Städning ─────────────────────────────────────────────────────────────
-- Händelser växer snabbare än allt annat i databasen — en aktiv användare
-- lägger lätt hundra rader om dagen bara i skärmvisningar. Det finns ingen
-- cron i projektet (se Circles i CLAUDE.md), så den här körs för hand när
-- tabellen blivit stor. Aggregaten du faktiskt tittar på bör materialiseras
-- först om du vill behålla historiken längre än råraderna.
create or replace function analytics.prune_app_events(p_days int default 180)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  removed bigint;
begin
  delete from public.app_events
   where occurred_at < now() - make_interval(days => p_days);
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- `from public` och inte `from anon, authenticated`: Postgres ger execute på
-- nya funktioner till PUBLIC, så en revoke mot de två rollerna hade lämnat
-- arvet kvar och funktionen anropbar för vem som helst med en nyckel. Den är
-- `security definer` och raderar rader — den ska bara gå att köra som
-- postgres.
revoke all on function analytics.prune_app_events(int) from public;

-- ─── Vyer ─────────────────────────────────────────────────────────────────
-- Alla i schemat analytics och utan grants, av samma skäl som vyerna i
-- analytics.sql: de aggregerar tvärs över RLS och är bara till för
-- SQL-editorn.
--
-- Och av samma skäl som där droppas de före sitt create: `create or replace
-- view` får bara lägga till kolumner sist, och vägrar både byta datatyp och
-- skjuta in en kolumn i mitten. Grinden `counted_events` droppas inte — de
-- andra hänger på den. Se stycket i analytics.sql.

-- Grinden, samma som counted_profiles/counted_sessions i analytics.sql: en
-- rad i analytics.excluded_users ska tysta testkontot i ALLA vyer, inte i de
-- fem som råkade få ett filter.
--
-- `user_id is null` räknas med och inte bort. Två olika rader blir null:
-- händelser som köades innan sessionen avgjorts (de hör till en riktig
-- användare som vi inte kan peka ut), och händelser vars konto raderats
-- (on delete set null). Att kasta dem hade dolt aktivitet som faktiskt
-- skett; de syns i count(*) men aldrig i count(distinct user_id), vilket är
-- det rätta svaret på "hur många personer".
create or replace view analytics.counted_events as
select e.*
  from public.app_events e
 where not exists (select 1 from analytics.excluded_users x where x.user_id = e.user_id);

-- Vad som händer alls, och hur spritt det är. users-kolumnen är den som
-- betyder något: tusen rader från en person är inte en använd funktion.
drop view if exists analytics.event_counts;
create or replace view analytics.event_counts as
select
  name,
  count(*)                    as events,
  count(distinct user_id)     as users,
  round(count(*)::numeric / greatest(count(distinct user_id), 1), 1)
                              as events_per_user,
  min(occurred_at)            as first_seen,
  max(occurred_at)            as last_seen
from analytics.counted_events
group by name
order by events desc;

-- Skärmvisningar per rutt. Kommer från ett enda ställe — rutt-lyssnaren i
-- app/_layout.tsx — så en ny skärm hamnar här utan att någon lägger till ett
-- anrop i den.
drop view if exists analytics.screen_views;
create or replace view analytics.screen_views as
select
  props->>'screen'                          as screen,
  count(*)                                  as views,
  count(distinct user_id)                   as users,
  count(distinct app_session_id)            as app_sessions,
  round(count(*)::numeric
        / greatest(count(distinct user_id), 1), 1)
                                            as views_per_user
from analytics.counted_events
where name = 'screen_view'
group by 1
order by views desc;

-- "Hur ofta använder användare X funktion Y." Lång form, inte en pivot: nya
-- händelsenamn ska dyka upp här av sig själva utan att vyn skrivs om.
drop view if exists analytics.user_event_counts;
create or replace view analytics.user_event_counts as
select
  e.user_id,
  p.username,
  e.name,
  count(*)                                   as events,
  count(distinct date_trunc('day', e.occurred_at)) as active_days,
  min(e.occurred_at)                         as first_at,
  max(e.occurred_at)                         as last_at
from analytics.counted_events e
left join public.profiles p on p.id = e.user_id
group by e.user_id, p.username, e.name
order by e.user_id, events desc;

-- Riktig DAU, till skillnad från den pausbaserade i analytics.daily_pauses:
-- den som öppnar appen varje dag utan att pausa är kvar men syns inte där.
drop view if exists analytics.daily_active_users;
create or replace view analytics.daily_active_users as
select
  date_trunc('day', occurred_at)::date  as day,
  count(distinct user_id)               as active_users,
  count(distinct app_session_id)        as app_opens,
  count(*)                              as events
from analytics.counted_events
group by 1
order by 1 desc;

-- Pausflödets tratt. Varje steg räknas i app_sessions och inte i rader:
-- samma person kan göra om försöket flera gånger inom en appstart, och det
-- är hur många FÖRSÖK som når fram som är frågan.
drop view if exists analytics.pause_funnel;
create or replace view analytics.pause_funnel as
select
  date_trunc('week', occurred_at)::date as week,
  count(distinct app_session_id) filter (where name = 'pause_mode_selected')  as valde_paus,
  count(distinct app_session_id) filter (where name = 'placeinbox_shown')     as nadde_lada,
  count(distinct app_session_id) filter (where name = 'phone_placed_down')    as la_ner_telefon,
  count(distinct app_session_id) filter (where name = 'box_lid_closed')       as stangde_lock,
  count(distinct app_session_id) filter (where name = 'pause_started')        as startade,
  count(distinct app_session_id) filter (where name = 'pause_completed')      as slutforde,
  count(distinct app_session_id) filter (where name = 'pause_abandoned')      as avbrots
from analytics.counted_events
group by 1
order by 1 desc;

-- Introduktionens tratt, per steg. props->>'step' är stegets filnamn ur
-- components/intro/, så ett nytt steg syns utan att vyn ändras.
drop view if exists analytics.intro_funnel;
create or replace view analytics.intro_funnel as
select
  props->>'step'                            as step,
  count(distinct user_id)                   as users_reached,
  count(*)                                  as views,
  min(occurred_at)                          as first_seen
from analytics.counted_events
where name = 'intro_step_shown'
group by 1
order by first_seen;

-- Lådans anslutningar. En hög andel failed mot connected är en hårdvaru-
-- eller behörighetsfråga, och den syns inte i pause_sessions alls: en paus
-- som aldrig kom igång lämnar ingen rad där.
drop view if exists analytics.box_connections;
create or replace view analytics.box_connections as
select
  date_trunc('day', occurred_at)::date as day,
  count(*) filter (where name = 'box_scan_started')     as scans,
  count(*) filter (where name = 'box_connected')        as connected,
  count(*) filter (where name = 'box_connect_failed')   as failed,
  count(*) filter (where name = 'box_disconnected')     as disconnected,
  count(distinct user_id)                               as users
from analytics.counted_events
where name like 'box_%'
group by 1
order by 1 desc;

revoke all on all tables in schema analytics from anon, authenticated;
