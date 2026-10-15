-- Pausinbjudningar — "jag pausar, häng med". Körs för hand i Supabase
-- SQL-editorn (samma konvention som resten av mappen), och FÖRE
-- supabase/social_notify.sql, vars pushtrigger sitter på tabellen nedan.
-- Idempotent rakt igenom.
--
-- ── Varför den gamla modellen revs ──────────────────────────────────────────
--
-- Förr väntade inbjudaren på ett ja innan pausen fick börja
-- (app/pause-invite-waiting.tsx, raderad). Det bad användaren stirra på
-- telefonen i en app vars hela löfte är att lägga ifrån sig den, ett nej blev
-- en skärm att läsa ("Anna couldn't right now"), och en inbjudan som aldrig
-- besvarades hade inget slut — svarade någon tre timmar senare drogs
-- inbjudaren in i en paus mitt i vad hen än gjorde.
--
-- Nu börjar pausen direkt, och inbjudan är en öppen dörr: vännerna kan hänga
-- på medan den pågår. Ingen väntar, och att inte hänga på syns inte för
-- någon — det finns inget nej att visa.
--
-- ── Inbjudan är inte en paus ────────────────────────────────────────────────
--
-- Den gamla modellen skrev inbjudningar som rader i `pause_sessions`
-- (`invite_status = 'pending'/'sent'`), alltså pauser utan längd som varje
-- läsare av tabellen fick filtrera bort. Här bor inbjudan i en egen tabell,
-- och `pause_sessions` får bara färdiga pauser: värden och var och en som
-- hängde på skriver sin rad när de slutar, som en vanlig paus, med
-- `shared_session_id = shared_id` och `is_shared = true`.
--
-- Kolumnerna `invite_status` på `pause_sessions` och RPC:erna
-- `create_shared_pause_invite` / `accept_shared_pause` /
-- `decline_shared_pause` / `cancel_shared_pause` (skapade utanför repot)
-- används inte längre av appen. De står kvar — kolumner droppas inte i den
-- här mappen, och funktionerna finns inte i repot att jämföra mot.
--
-- ── När en inbjudan går ut ──────────────────────────────────────────────────
--
-- Man kan hänga på **så länge värden pausar, och aldrig senare än 30 minuter
-- efter att pausen började.** Två spärrar, och de täcker var sitt fall:
--
--   * `closed_at` — värden avslutade. Sätts av `close_pause_invites` från
--     pausskärmen, och av krasch-återställningen i app/_layout.tsx.
--   * `expires_at` — den hårda gränsen. En paus har ingen bestämd längd, så
--     något annat måste stänga dörren när värdens app dör utan att hinna
--     säga till (iOS dödar gärna en app i bakgrunden). Ett hjärtslag hade
--     inte gått: telefonen ligger nedåt och appen sover.
--
-- Spärren sitter i `join_pause_invite`, inte i klienten. Klienten gömmer
-- utgångna inbjudningar också, men det är städning, inte regeln.

create table if not exists pause_invites (
  id            uuid primary key default gen_random_uuid(),
  -- Pausens gemensamma id. Samma värde hamnar i `pause_sessions.shared_session_id`
  -- på värdens och gästernas rader när de slutar.
  shared_id     uuid not null,
  host_id       uuid not null references profiles(id) on delete cascade,
  invitee_id    uuid not null references profiles(id) on delete cascade,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  -- Värden avslutade pausen, och hur länge hen pausade.
  closed_at     timestamptz,
  host_seconds  int,
  -- Gästen hängde på, och slutade.
  joined_at     timestamptz,
  finished_at   timestamptz,
  guest_seconds int,
  -- Gästen tog bort kortet ur Friends. Värden får aldrig veta det.
  dismissed_at  timestamptz,
  unique (shared_id, invitee_id)
);

create index if not exists pause_invites_invitee_idx on pause_invites (invitee_id, created_at desc);
create index if not exists pause_invites_shared_idx  on pause_invites (shared_id);
create index if not exists pause_invites_host_idx    on pause_invites (host_id);

-- Läsning direkt mot tabellen (Friends-listan och flikens bricka), skrivning
-- bara genom RPC:erna nedan — samma uppdelning som kretsarnas tabeller.
alter table pause_invites enable row level security;
revoke all on pause_invites from anon, authenticated;
grant select on pause_invites to authenticated;

drop policy if exists pause_invites_select on pause_invites;
create policy pause_invites_select on pause_invites
  for select to authenticated
  using (host_id = (select auth.uid()) or invitee_id = (select auth.uid()));

-- Hur länge man kan hänga på. Ett tal på ett ställe: klienten läser det inte,
-- den läser `expires_at`.
create or replace function pause_invite_window()
returns interval
language sql
immutable
as $$ select interval '30 minutes' $$;


-- ── Skicka ──────────────────────────────────────────────────────────────────
--
-- Anropas från Hem i samma stund som pausen startar. Bara accepterade vänner
-- kan bjudas in; andra id:n hoppas över tyst, så att en vänskap som hunnit
-- rivas inte fäller pausen. Taket på åtta är kretsens: en pausinbjudan är ett
-- handplockat sällskap, inte ett utskick.
create or replace function send_pause_invites(p_shared_id uuid, p_invitee_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  if auth.uid() is null then
    raise exception 'You are not signed in.';
  end if;
  if p_shared_id is null or p_invitee_ids is null then
    return 0;
  end if;
  if cardinality(p_invitee_ids) > 8 then
    raise exception 'You can invite at most 8 friends to a pause.';
  end if;
  -- Ett shared_id tillhör den som först använde det.
  if exists (select 1 from pause_invites where shared_id = p_shared_id and host_id <> auth.uid()) then
    raise exception 'That pause belongs to someone else.';
  end if;

  insert into pause_invites (shared_id, host_id, invitee_id, expires_at)
  select p_shared_id, auth.uid(), f.friend_id, now() + pause_invite_window()
    from (
      select distinct case when requester_id = auth.uid() then receiver_id else requester_id end as friend_id
        from friendships
       where status = 'accepted'
         and (requester_id = auth.uid() or receiver_id = auth.uid())
    ) f
   where f.friend_id = any (p_invitee_ids)
     and f.friend_id <> auth.uid()
  on conflict (shared_id, invitee_id) do nothing;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

grant execute on function send_pause_invites(uuid, uuid[]) to authenticated;


-- ── Värden slutar ───────────────────────────────────────────────────────────
--
-- Stänger dörren och lämnar värdens längd åt gästernas sammanfattning. Tål
-- att anropas flera gånger: bara rader som fortfarande är öppna rörs, så en
-- sen krasch-återställning skriver inte över längden från pausskärmen.
-- `p_seconds` null betyder "övergiven" (bakåtknappen): dörren stängs men
-- ingen längd påstås.
create or replace function close_pause_invites(p_shared_id uuid, p_seconds int default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update pause_invites
     set closed_at = now(),
         host_seconds = case when p_seconds is null then null else greatest(0, p_seconds) end
   where shared_id = p_shared_id
     and host_id = auth.uid()
     and closed_at is null;
end;
$$;

grant execute on function close_pause_invites(uuid, int) to authenticated;


-- ── Gästen hänger på ────────────────────────────────────────────────────────
--
-- Returnerar pausens id och värdens namn, så att klienten kan starta pausen
-- utan en andra fråga. Att hänga på två gånger är inget fel (två tryck, eller
-- en notis och ett kort): svaret blir detsamma.
create or replace function join_pause_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv  pause_invites%rowtype;
  v_name text;
begin
  select * into v_inv
    from pause_invites
   where id = p_invite_id and invitee_id = auth.uid()
   for update;

  if v_inv.id is null then
    raise exception 'This invite is no longer available.';
  end if;

  select username into v_name from profiles where id = v_inv.host_id;

  if v_inv.joined_at is not null and v_inv.finished_at is null then
    return jsonb_build_object('shared_id', v_inv.shared_id, 'host_name', v_name);
  end if;

  if v_inv.closed_at is not null or v_inv.expires_at <= now() or v_inv.finished_at is not null then
    raise exception '% has finished pausing.', coalesce(v_name, 'Your friend');
  end if;

  update pause_invites set joined_at = now(), dismissed_at = null where id = p_invite_id;

  return jsonb_build_object('shared_id', v_inv.shared_id, 'host_name', v_name);
end;
$$;

grant execute on function join_pause_invite(uuid) to authenticated;


-- Gästen tar bort kortet. Tyst åt båda håll: ingen push, ingen rad hos värden.
create or replace function dismiss_pause_invite(p_invite_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update pause_invites
     set dismissed_at = now()
   where id = p_invite_id
     and invitee_id = auth.uid()
     and joined_at is null;
$$;

grant execute on function dismiss_pause_invite(uuid) to authenticated;


-- Gästen slutar. Samma idempotens som värdens: bara en öppen rad rörs, och
-- `p_seconds` null betyder att gästen gav upp pausen. (`greatest` hoppar över
-- null i Postgres, därav `case` — `greatest(0, null)` är 0, inte null.)
create or replace function finish_pause_invite(p_shared_id uuid, p_seconds int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update pause_invites
     set finished_at = now(),
         guest_seconds = case when p_seconds is null then null else greatest(0, p_seconds) end
   where shared_id = p_shared_id
     and invitee_id = auth.uid()
     and joined_at is not null
     and finished_at is null;
end;
$$;

grant execute on function finish_pause_invite(uuid, int) to authenticated;


-- ── Sammanfattningen ────────────────────────────────────────────────────────
--
-- Alla ANDRA i pausen: för värden gästerna som hängde på, för en gäst värden
-- plus de andra gästerna. Den som aldrig hängde på syns inte — att inte
-- hänga på ska inte gå att läsa ut någonstans.
--
-- `security definer` därför att en gäst inte kan läsa de andra gästernas
-- inbjudningsrader (policyn släpper bara igenom egna), och den raden är det
-- enda som vet om de fortfarande pausar.
--
-- `joined_after_seconds` är hur länge efter starten gästen kom in — värdens
-- egen rad har 0.
create or replace function get_shared_pause_people(p_shared_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_started timestamptz;
begin
  if v_me is null then
    return '[]'::jsonb;
  end if;

  -- Bara den som var med: värden, eller en gäst som hängde på.
  if not exists (
    select 1 from pause_invites
     where shared_id = p_shared_id
       and (host_id = v_me or (invitee_id = v_me and joined_at is not null))
  ) then
    return '[]'::jsonb;
  end if;

  select min(created_at) into v_started from pause_invites where shared_id = p_shared_id;

  return coalesce((
    select jsonb_agg(row_to_json(t) order by t.is_host desc, t.joined_after_seconds)
      from (
        -- Värden, för en gäst.
        select distinct on (i.host_id)
               i.host_id as user_id,
               p.username,
               p.avatar_url,
               true as is_host,
               (i.closed_at is null) as still_pausing,
               i.host_seconds as seconds,
               0 as joined_after_seconds
          from pause_invites i
          join profiles p on p.id = i.host_id
         where i.shared_id = p_shared_id
           and i.host_id <> v_me
        union all
        -- Gästerna som hängde på, utom en själv.
        select i.invitee_id,
               p.username,
               p.avatar_url,
               false,
               (i.finished_at is null),
               i.guest_seconds,
               greatest(0, extract(epoch from (i.joined_at - v_started)))::int
          from pause_invites i
          join profiles p on p.id = i.invitee_id
         where i.shared_id = p_shared_id
           and i.joined_at is not null
           and i.invitee_id <> v_me
      ) t
  ), '[]'::jsonb);
end;
$$;

grant execute on function get_shared_pause_people(uuid) to authenticated;


-- ── Kontroll ────────────────────────────────────────────────────────────────
--
-- Öppna inbjudningar just nu:
--   select shared_id, host_id, invitee_id, created_at, expires_at, joined_at
--     from pause_invites
--    where closed_at is null and expires_at > now()
--    order by created_at desc;
--
-- Den gamla modellens obesvarade inbjudningar ligger kvar i `pause_sessions`
-- som rader utan längd. De läses inte längre av appen. Vill man städa bort
-- dem (det är inga pauser, bara frågor som aldrig besvarades):
--   delete from pause_sessions
--    where invite_status in ('pending', 'sent', 'declined')
--      and ended_at is null;
