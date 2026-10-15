-- Kretsens chatt — kör i Supabase SQL-editorn.
-- Samma konvention som supabase/circles.sql och supabase/wishlist.sql:
-- schemat bor här, inte i ett migrationsverktyg, och filen är idempotent
-- hela vägen.
--
-- **Kör supabase/circles.sql först.** Den här filen bygger på `circles` och
-- `circle_members` därifrån, och lägger en kolumn på den senare.
--
-- ── Vad det här är, och vad det medvetet inte är ────────────────────────────
--
-- Ett rum för de 2–10 personerna i en krets. En rad per meddelande, och
-- ingenting mer: inga trådar, inga reaktioner, inga bilder, inga läskvitton
-- mot andra.
--
-- **Chatten skickar inga notiser, och det är ett beslut och inte en lucka.**
-- Appen skickar inga notiser alls längre — se CLAUDE.md och
-- supabase/notifications-teardown.sql. En chatt är den bullrigaste tänkbara
-- källan i en app som handlar om att lägga ifrån sig telefonen, så den är
-- den sista som borde få den första notisen tillbaka. Vill man ha den krävs
-- en trigger här, en edge-funktion, en push-token att skicka till och ett
-- eget stycke i CLAUDE.md om strypning och nattfönster — inte bara en rad
-- kod. Olästa meddelanden bärs i stället av pricken på chattikonen i
-- kretsfliken.
--
-- **Hela historiken är synlig för varje medlem, också den som just gått
-- med.** En chatt som börjar tom för nykomlingen läser som en bugg ("vart
-- tog samtalet vägen?"), och kretsen är en liten grupp vänner snarare än ett
-- forum. Priset är att det som sagts innan man kom är läsbart efteråt, och
-- det priset är valt. Olästräknaren utgår däremot från `joined_at` för den
-- som aldrig läst (se `mark_circle_chat_read`), så ingen möts av en badge
-- med tvåhundra i.

-- ── Tabellen ────────────────────────────────────────────────────────────────

-- `user_id` är `on delete set null`, precis som `circle_activity.actor_id`:
-- ett raderat konto ska inte radera halva samtalet för de som är kvar. Den
-- raden renderas som "Someone" i klienten.
create table if not exists circle_messages (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references circles(id) on delete cascade,
  user_id uuid references profiles(id) on delete set null,
  body text not null check (length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists circle_messages_circle_idx on circle_messages(circle_id, created_at desc);
create index if not exists circle_messages_user_idx on circle_messages(user_id);

-- Var någon läste senast. Bor på medlemsraden och inte i en egen tabell:
-- det finns exakt ett tal per person och krets — samma par som
-- medlemsraden — så en egen tabell hade bara varit samma rad en gång till.
-- `null` betyder "har aldrig öppnat chatten" och tolkas som `joined_at`.
alter table circle_members add column if not exists chat_read_at timestamptz;

-- ── Grants & RLS ────────────────────────────────────────────────────────────
-- SELECT only, samma uppdelning som resten av kretsarnas tabeller: läsningen
-- går direkt (klienten behöver kunna paginera och prenumerera på realtime),
-- skrivningen genom RPC:erna längst ner.

grant select on circle_messages to authenticated;

alter table circle_messages enable row level security;

drop policy if exists "members can read the chat" on circle_messages;
create policy "members can read the chat" on circle_messages
  for select using (
    circle_id in (select circle_id from circle_members where user_id = (select auth.uid()))
  );

-- ── Realtime ────────────────────────────────────────────────────────────────
-- Chatten är den enda ytan i appen där en sekunds fördröjning märks, så
-- `circle_messages` ska ligga i publikationen `supabase_realtime` (av som
-- förval per tabell). Till skillnad från `profiles` — som medvetet står
-- utanför, eftersom RLS är av där och realtime därmed hade skickat ut
-- `push_token` till varje klient — är RLS PÅ här, så en prenumerant får bara
-- rader ur sin egen krets.
--
-- Klienten pollar ändå var fjärde sekund som skyddsnät (samma mönster som
-- kretsfliken), så en databas där raden nedan inte körts blir långsam men
-- inte trasig.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'circle_messages'
  ) then
    execute 'alter publication supabase_realtime add table circle_messages';
  end if;
exception
  -- Två sätt det här kan misslyckas på, och inget av dem får sänka filen:
  -- publikationen finns inte (helt nytt projekt, realtime aldrig påslaget),
  -- eller så äger inte rollen den. Pollningen bär chatten ensam så länge —
  -- långsammare, men inte trasigt. Slå i så fall på realtime för
  -- `circle_messages` i dashboarden i stället.
  when undefined_object or insufficient_privilege then null;
end;
$$;

-- ── RPC:er ──────────────────────────────────────────────────────────────────
-- Samma droppmönster som circles.sql: varje överlagring tas bort först, så
-- att en tidigare signatur inte blir kvar som ett andra alternativ PostgREST
-- inte kan välja mellan ("Could not choose the best candidate function...").
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'send_circle_message', 'delete_circle_message', 'mark_circle_chat_read'
      )
  loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end;
$$;

-- Skickar ett meddelande till en krets man är med i. `p_circle_id` pekar ut
-- vilken (man kan vara med i upp till tre); `null` är den man gick med i
-- först, för äldre klienter — se `resolve_my_circle` i circles.sql.
--
-- Trimningen och längdtaket sitter här och inte bara i TextInput:ens
-- `maxLength` — ett fält i en klient är en bekvämlighet, inte en regel.
--
-- Loggar med flit INGENTING i `circle_activity`. Flödet är till för det som
-- hänt (pauser, mål, nivåer); ett samtal som dubbleras rad för rad där hade
-- begravt milstolparna det finns för att visa.
create or replace function send_circle_message(p_body text, p_circle_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_circle_id uuid;
  v_body text := nullif(trim(p_body), '');
  v_id uuid;
begin
  if v_body is null then
    raise exception 'Nothing to send.';
  end if;

  if length(v_body) > 500 then
    v_body := left(v_body, 500);
  end if;

  v_circle_id := resolve_my_circle(p_circle_id);
  if v_circle_id is null then
    raise exception 'You are not in that circle.';
  end if;

  insert into circle_messages (circle_id, user_id, body)
  values (v_circle_id, auth.uid(), v_body)
  returning id into v_id;

  -- Den som skriver har per definition läst allt som står ovanför.
  update circle_members set chat_read_at = now()
   where circle_id = v_circle_id and user_id = auth.uid();

  return v_id;
end;
$$;

-- Tar bort ett eget meddelande. Bara sitt eget, också för ägaren: att kunna
-- radera någon annans ord ur ett rum med fyra personer är en helt annan sak
-- än att ta bort en medlem, och den makten hör inte till rollen.
create or replace function delete_circle_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from circle_messages
   where id = p_message_id and user_id = auth.uid();
end;
$$;

-- Flyttar fram läsmärket. Anropas när chatten öppnas och när ett nytt
-- meddelande kommer in medan den är öppen — inte var gång man scrollar.
-- Bara den krets chatten gäller: att läsa i en ska inte släcka pricken i en
-- annan.
create or replace function mark_circle_chat_read(p_circle_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update circle_members set chat_read_at = now()
   where circle_id = resolve_my_circle(p_circle_id) and user_id = auth.uid();
end;
$$;
