-- Kretsens belöning — kör i Supabase SQL-editorn.
-- Samma konvention som supabase/circles.sql och supabase/circle_chat.sql:
-- schemat bor här, inte i ett migrationsverktyg, och filen är idempotent
-- hela vägen. Den går också att köra ovanpå den första versionen (med
-- majoritetsgräns och `adopted`/`replaced`) — den flyttar över det som finns.
--
-- **Kör supabase/circles.sql först.** Den här filen läser `circles`,
-- `circle_members`, `circle_goal_achievements` och `circle_week_start()`
-- därifrån, sätter en trigger på `circle_goal_achievements` och skriver till
-- `circle_activity`.
--
-- ── Vad det här är ──────────────────────────────────────────────────────────
--
-- Kretsen har en belöning — det den gör ihop när veckans bedrift är låst (alla
-- nådde sina mål). Texten är gruppens egen: "AW på torsdag", "vi slutar en
-- timme tidigare på fredag", "fika". Appen kan inte kontrollera att den blir
-- av och försöker inte.
--
-- **Belöningen är förslaget med flest ja.** Ingen gräns att nå: det som leder
-- är belöningen, och vid lika vinner det som föreslogs först. Det räknas om
-- vid varje läsning, så belöningen kan byta medan veckan pågår — men i det
-- ögonblick veckan låses fryses den som ledde (`circle_reward_unlocks`, via
-- triggern längst ner). Den vunna veckans belöning kan alltså inte röstas
-- bort i efterhand.
--
-- **En röst per person, och inte på sitt eget.** Annars röstar alla på sitt
-- eget och allt blir lika — då avgör bara vem som var först, och rösterna
-- betyder ingenting. Ett nytt ja flyttar rösten från där den låg.
--
-- **Allt börjar om varje vecka.** Förslag och röster hör till en vecka
-- (`week_start`, samma måndag 00:00 UTC som potten), och fliken visar bara
-- den pågående. Annars kunde röster från för en månad sedan avgöra den här
-- veckans belöning, och datumen i modalens hörn hade ljugit. Gamla veckors
-- rader står kvar men läses inte.
--
-- **Ett förslag behöver minst ett ja från någon annan för att bli
-- belöningen.** Tillsammans med "ett förslag per person och vecka" och
-- veckans nollställning är det hela skyddet mot trams: ingen kan göra sin
-- egen text till kretsens belöning, ingen kan spamma, och det ingen ville ha
-- är borta på måndag. Ägaren har ingen
-- särskild makt — samma linje som att ägaren inte kan radera andras
-- chattmeddelanden.
--
-- **Varför det här inte är omröstningen som revs.** `circle_goal_proposals`
-- (i circles.sql) var en röstning om ett TAL som någon annan skulle leva upp
-- till, och den gamla fritexten `group_goal` var något ingenting läste och
-- vem som helst kunde skriva över. En belöning är inget krav på någon, den
-- hänger på `circle_goal_achievements`, och den byts bara genom röster.
--
-- **Ingen notis.** Antalet förslag och röster beror på hur aktiva andra är —
-- se notisavsnittet i CLAUDE.md.
--
-- **Belöningen är valfri per krets** (`circles.rewards_enabled`, av som
-- förval, ägarens val — se *Kretsens inställningar* i circles.sql). Är den av
-- tar `propose_circle_reward` inte emot förslag, triggern låser ingenting,
-- och `get_circle_reward` svarar med `enabled: false`. Historiken står kvar
-- och slås den på igen fortsätter den där den var.

-- ── Tabellerna ──────────────────────────────────────────────────────────────

-- En rad per förslag. `status`, `adopted_at` och `replaced_at` är kvar från
-- den första versionen och skrivs inte längre — alla rader är `open`.
-- (Kolumner droppas inte i den här mappen.)
--
-- `proposer_id` är `on delete set null`, samma linje som `circle_messages`.
create table if not exists circle_rewards (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references circles(id) on delete cascade,
  proposer_id uuid references profiles(id) on delete set null,
  body text not null check (length(body) between 1 and 80),
  status text not null default 'open' check (status in ('open', 'adopted', 'replaced')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  adopted_at timestamptz,
  replaced_at timestamptz
);

create index if not exists circle_rewards_circle_idx on circle_rewards(circle_id, created_at);
create index if not exists circle_rewards_proposer_idx on circle_rewards(proposer_id);

-- Från första versionen: den antagna belöningen blir ett vanligt förslag, och
-- de ersatta försvinner. Indexet för "en antagen per krets" behövs inte mer.
drop index if exists circle_rewards_one_adopted;
delete from circle_rewards where status = 'replaced';
update circle_rewards set status = 'open', adopted_at = null where status = 'adopted';

-- Veckan förslaget hör till. Befintliga rader får veckan de skrevs.
-- `expires_at` (sju dagar utan röster) är kvar från andra versionen och
-- läses inte längre — veckan har tagit dess plats.
alter table circle_rewards add column if not exists week_start date;
update circle_rewards set week_start = circle_week_start(created_at) where week_start is null;
alter table circle_rewards alter column week_start set default circle_week_start();
alter table circle_rewards alter column week_start set not null;

-- Ett förslag per person och vecka. Taket är ett index, inte en regel ovanpå.
drop index if exists circle_rewards_one_open_each;
create unique index if not exists circle_rewards_one_each_week
  on circle_rewards(circle_id, week_start, proposer_id) where status = 'open';
create index if not exists circle_rewards_week_idx on circle_rewards(circle_id, week_start);

create table if not exists circle_reward_votes (
  reward_id uuid not null references circle_rewards(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (reward_id, user_id)
);
create index if not exists circle_reward_votes_user_idx on circle_reward_votes(user_id);

-- En röst per person och krets. `circle_id` ligger på rösten (och inte bara
-- på förslaget) för att taket ska kunna vara ett unikt index.
alter table circle_reward_votes add column if not exists circle_id uuid references circles(id) on delete cascade;
update circle_reward_votes v set circle_id = r.circle_id
  from circle_rewards r where r.id = v.reward_id and v.circle_id is null;
-- Från första versionen: förslagsställarens automatiska ja på sitt eget
-- tas bort, och den som sagt ja till flera behåller bara sitt senaste.
delete from circle_reward_votes v using circle_rewards r
 where r.id = v.reward_id and r.proposer_id = v.user_id;
delete from circle_reward_votes v
 where exists (select 1 from circle_reward_votes v2
                where v2.circle_id = v.circle_id and v2.user_id = v.user_id
                  and (v2.created_at, v2.reward_id) > (v.created_at, v.reward_id));
alter table circle_reward_votes alter column circle_id set not null;

-- En röst per person, krets och vecka — veckan ligger på rösten av samma skäl
-- som `circle_id`: för att taket ska kunna vara ett index.
alter table circle_reward_votes add column if not exists week_start date;
update circle_reward_votes v set week_start = r.week_start
  from circle_rewards r where r.id = v.reward_id and v.week_start is null;
alter table circle_reward_votes alter column week_start set not null;
drop index if exists circle_reward_votes_one_each;
create unique index if not exists circle_reward_votes_one_each_week
  on circle_reward_votes(circle_id, week_start, user_id);

-- Veckans upplåsta belöning, frusen när veckan låstes. En rad per krets och
-- vecka, samma nyckel som `circle_goal_achievements`.
create table if not exists circle_reward_unlocks (
  circle_id uuid not null references circles(id) on delete cascade,
  week_start date not null,
  body text not null,
  proposer_id uuid references profiles(id) on delete set null,
  unlocked_at timestamptz not null default now(),
  primary key (circle_id, week_start)
);
create index if not exists circle_reward_unlocks_proposer_idx on circle_reward_unlocks(proposer_id);

-- ── Grants & RLS ────────────────────────────────────────────────────────────
-- SELECT only, samma uppdelning som resten av kretsarnas tabeller. Allt
-- klienten visar kommer ändå ur `get_circle_reward()`.

grant select on circle_rewards, circle_reward_votes, circle_reward_unlocks to authenticated;

alter table circle_rewards enable row level security;
alter table circle_reward_votes enable row level security;
alter table circle_reward_unlocks enable row level security;

drop policy if exists "members can view rewards" on circle_rewards;
create policy "members can view rewards" on circle_rewards
  for select using ( is_circle_member(circle_id) );

drop policy if exists "members can view reward votes" on circle_reward_votes;
create policy "members can view reward votes" on circle_reward_votes
  for select using ( is_circle_member(circle_id) );

drop policy if exists "members can view reward unlocks" on circle_reward_unlocks;
create policy "members can view reward unlocks" on circle_reward_unlocks
  for select using ( is_circle_member(circle_id) );

-- ── Ledaren ─────────────────────────────────────────────────────────────────
-- Förslaget med flest ja från nuvarande medlemmar under en vecka, minst ett.
-- Vid lika vinner det äldsta. Det är hela regeln, och den finns på ett enda
-- ställe så att skärmen och triggern aldrig kan räkna olika.
--
-- Veckan är en parameter (och inte alltid den pågående) för triggerns skull:
-- den låser veckan som just vanns, och skickar med den.
drop function if exists circle_reward_leader(uuid);
create or replace function circle_reward_leader(p_circle_id uuid, p_week date default circle_week_start())
returns table (id uuid, body text, proposer_id uuid, votes bigint)
language sql
security definer
set search_path = public
stable
as $$
  select r.id, r.body, r.proposer_id, count(*) as votes
    from circle_rewards r
    join circle_reward_votes v on v.reward_id = r.id
    join circle_members m on m.circle_id = r.circle_id and m.user_id = v.user_id
   where r.circle_id = p_circle_id and r.week_start = p_week and r.status = 'open'
   group by r.id
   order by count(*) desc, r.created_at asc
   limit 1;
$$;

revoke execute on function circle_reward_leader(uuid, date) from public, anon, authenticated;

-- Städningen, körd före varje läsning och förslag: den som lämnat kretsen tar
-- med sig sitt förslag och sin röst. (Sjudagarsgränsen för förslag utan röster
-- som bodde här är borta — veckans nollställning gör samma jobb.)
--
-- Funktionen hette `settle_circle_rewards` i första versionen och antog då
-- förslag. Nu finns inget att anta — ledaren räknas fram vid läsning.
create or replace function settle_circle_rewards(p_circle_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from circle_reward_votes v
   where v.circle_id = p_circle_id
     and not exists (select 1 from circle_members m
                      where m.circle_id = p_circle_id and m.user_id = v.user_id);

  delete from circle_rewards r
   where r.circle_id = p_circle_id
     and (
       r.proposer_id is null
       or not exists (select 1 from circle_members m
                       where m.circle_id = p_circle_id and m.user_id = r.proposer_id)
     );
end;
$$;

revoke execute on function settle_circle_rewards(uuid) from public, anon, authenticated;

-- ── Låsningen ───────────────────────────────────────────────────────────────
-- När veckan låses fryses ledaren. Trigger och inte en rad i
-- `evaluate_circle_goals()`, så att circles.sql inte behöver röras; den sitter
-- på samma insert som redan är veckans engångshändelse (UNIQUE på
-- `(circle_id, week_start)`), så den kan bara fyra en gång per vecka.
--
-- Flödet får en rad bara här — inte när ledaren byter under veckan, för den
-- kan byta fram och tillbaka och varje byte vore brus.
--
-- `exception when others`: en belöning som inte gick att låsa får aldrig fälla
-- veckans bedrift, samma linje som triggers i social_notify.sql.
create or replace function lock_circle_reward()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_leader record;
begin
  begin
    select * into v_leader from circle_reward_leader(new.circle_id, new.week_start);
    if v_leader.id is not null
       and (select rewards_enabled from circles where id = new.circle_id) then
      insert into circle_reward_unlocks (circle_id, week_start, body, proposer_id)
      values (new.circle_id, new.week_start, v_leader.body, v_leader.proposer_id)
      on conflict (circle_id, week_start) do nothing;
      if found then
        insert into circle_activity (circle_id, actor_id, type, metadata)
        values (new.circle_id, null, 'reward_unlocked', jsonb_build_object('text', v_leader.body));
      end if;
    end if;
  exception when others then
    raise warning 'lock_circle_reward failed: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists circle_goal_lock_reward on circle_goal_achievements;
create trigger circle_goal_lock_reward
  after insert on circle_goal_achievements
  for each row execute function lock_circle_reward();

-- ── RPC:erna ────────────────────────────────────────────────────────────────
-- Kretsen pekas ut med `p_circle_id` sedan man kan vara med i upp till tre;
-- `null` är den man gick med i först (`resolve_my_circle` i circles.sql).
-- En ny parameter skapar en överlagring i stället för att ersätta, så de
-- gamla signaturerna droppas först — samma mönster som circles.sql.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('propose_circle_reward', 'get_circle_reward', 'get_circle_reward_history')
  loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end;
$$;

-- Ett nytt förslag ersätter ens eget för veckan (och dess ja — det är en ny fråga).
create or replace function propose_circle_reward(p_text text, p_circle_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_circle_id uuid;
  v_text text := btrim(coalesce(p_text, ''));
  v_id uuid;
begin
  v_circle_id := resolve_my_circle(p_circle_id);
  if v_circle_id is null then
    raise exception 'You are not in that circle.';
  end if;
  if not (select rewards_enabled from circles where id = v_circle_id) then
    raise exception 'Rewards are turned off in this circle.';
  end if;
  if length(v_text) = 0 then
    raise exception 'Write a reward first.';
  end if;
  if length(v_text) > 80 then
    raise exception 'Keep it under 80 characters.';
  end if;

  perform settle_circle_rewards(v_circle_id);

  delete from circle_rewards
   where circle_id = v_circle_id and week_start = circle_week_start()
     and proposer_id = auth.uid() and status = 'open';

  insert into circle_rewards (circle_id, proposer_id, body, week_start)
  values (v_circle_id, auth.uid(), v_text, circle_week_start())
  returning id into v_id;

  return v_id;
end;
$$;

-- Ett ja flyttar rösten hit från där den låg; ett ja där den redan ligger tar
-- tillbaka den. Svarar med om man står med efteråt.
create or replace function toggle_circle_reward_vote(p_reward_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_circle_id uuid;
  v_reward circle_rewards%rowtype;
begin
  -- Förslaget bär sin krets, så ingen parameter behövs här — bara kollen att
  -- man är med i just den.
  select * into v_reward from circle_rewards
   where id = p_reward_id and status = 'open'
     and week_start = circle_week_start();
  if v_reward.id is null then
    raise exception 'That suggestion is no longer there.';
  end if;

  v_circle_id := resolve_my_circle(v_reward.circle_id);
  if v_circle_id is null then
    raise exception 'You are not in that circle.';
  end if;
  if v_reward.proposer_id = auth.uid() then
    raise exception 'You can''t vote for your own suggestion.';
  end if;

  delete from circle_reward_votes where reward_id = p_reward_id and user_id = auth.uid();
  if found then
    return false;
  end if;

  delete from circle_reward_votes
   where circle_id = v_circle_id and week_start = v_reward.week_start and user_id = auth.uid();
  insert into circle_reward_votes (reward_id, user_id, circle_id, week_start)
  values (p_reward_id, auth.uid(), v_circle_id, v_reward.week_start);
  return true;
end;
$$;

-- Bara ens eget. Rösterna på det försvinner med det, och de som röstat kan
-- lägga sin röst någon annanstans.
create or replace function withdraw_circle_reward(p_reward_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from circle_rewards
   where id = p_reward_id and proposer_id = auth.uid() and status = 'open';
end;
$$;

-- Allt fliken behöver i ett svar, för den pågående veckan (`week_start`
-- skickas med för datumen i modalens hörn). Förslagen kommer i den ordning de står i
-- tävlingen — flest ja först, äldst först vid lika — så att översta raden
-- alltid är den som är belöningen.
create or replace function get_circle_reward(p_circle_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_circle_id uuid;
  v_leader record;
  v_unlocked text;
  v_proposals jsonb;
  v_week date := circle_week_start();
begin
  v_circle_id := resolve_my_circle(p_circle_id);
  if v_circle_id is null then
    return null;
  end if;

  perform settle_circle_rewards(v_circle_id);

  select * into v_leader from circle_reward_leader(v_circle_id, v_week);

  select body into v_unlocked from circle_reward_unlocks
   where circle_id = v_circle_id and week_start = v_week;

  select coalesce(jsonb_agg(x order by votes desc, created_at asc), '[]'::jsonb) into v_proposals
    from (
      select r.created_at,
             count(m.user_id) as votes,
             jsonb_build_object(
               'id', r.id,
               'text', r.body,
               'proposer_id', r.proposer_id,
               'proposer_name', coalesce(p.username, 'Someone'),
               'created_at', r.created_at,
               'votes', count(m.user_id),
               'i_voted', bool_or(v.user_id = auth.uid()) is true
             ) as x
        from circle_rewards r
        left join profiles p on p.id = r.proposer_id
        left join circle_reward_votes v on v.reward_id = r.id
        left join circle_members m on m.circle_id = r.circle_id and m.user_id = v.user_id
       where r.circle_id = v_circle_id and r.week_start = v_week and r.status = 'open'
       group by r.id, p.username
    ) s;

  return jsonb_build_object(
    'enabled', (select rewards_enabled from circles where id = v_circle_id),
    'week_start', v_week,
    'leader_id', v_leader.id,
    'current', case when v_leader.id is null then null
                    else jsonb_build_object('id', v_leader.id, 'text', v_leader.body) end,
    'week_reached', exists (select 1 from circle_goal_achievements
                             where circle_id = v_circle_id and week_start = v_week),
    'unlocked_text', v_unlocked,
    'proposals', v_proposals
  );
end;
$$;

-- Historiken: de vunna veckorna, senaste först, högst 52. Bara de vunna —
-- det här är ett ställe att fira, inte ett protokoll. En första version
-- visade varje vecka sedan kretsen skapades, med tomma stjärnor för de
-- missade; de missade syns redan i potten och i veckans wrapped.
--
-- `reward` är den upplåsta belöningen. En vecka som vanns innan belöningen
-- fanns (eller utan något förslag med ett ja) har ingen.
create or replace function get_circle_reward_history(p_circle_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_circle_id uuid;
  v_result jsonb;
begin
  v_circle_id := resolve_my_circle(p_circle_id);
  if v_circle_id is null then
    return '[]'::jsonb;
  end if;

  -- Den pågående veckan står inte här, vunnen eller inte: den står överst i
  -- modalen.
  select coalesce(jsonb_agg(jsonb_build_object('week_start', w.week_start, 'reward', w.body)
                            order by w.week_start desc), '[]'::jsonb)
    into v_result
    from (
      select a.week_start, u.body
        from circle_goal_achievements a
        left join circle_reward_unlocks u on u.circle_id = a.circle_id and u.week_start = a.week_start
       where a.circle_id = v_circle_id and a.week_start < circle_week_start()
       order by a.week_start desc
       limit 52
    ) w;

  return v_result;
end;
$$;

grant execute on function get_circle_reward_history(uuid) to authenticated;
grant execute on function propose_circle_reward(text, uuid) to authenticated;
grant execute on function toggle_circle_reward_vote(uuid) to authenticated;
grant execute on function withdraw_circle_reward(uuid) to authenticated;
grant execute on function get_circle_reward(uuid) to authenticated;
