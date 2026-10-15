-- Ett hjärta efter en delad paus.
-- Körs för hand i Supabase SQL-editorn, efter pause_invites.sql och sleep.sql
-- (samma konvention som resten av mappen). Allt är idempotent.
--
-- ─── Vad det ersätter ─────────────────────────────────────────────────────
-- Sammanfattningen efter en delad paus bad förr om en hälsning: ett textfält
-- på 200 tecken, en Send-knapp och ett "Not this time". Det var för mycket
-- att be om i ögonblicket efter en paus — man ville säga *bra jobbat*, inte
-- skriva något. Nu är det ett hjärta man trycker på.
--
-- **En egen tabell och inte en ny `message_type` i `pause_messages`.** Den
-- tabellen skapades utanför repot och dess check på `message_type` står
-- ingenstans här. Ett hjärta är dessutom inte ett meddelande: det har inget
-- innehåll, inget lästillstånd, och det kan bara finnas ett per person och
-- paus — vilket primärnyckeln säger utan att någon regel behöver hålla det.
-- Gamla hälsningar ligger kvar i `pause_messages` och visas som förut.
--
-- **Ingen notis.** Hjärtat syns på mottagarens paus i statistiken nästa gång
-- hen tittar. En knackning per hjärta vore en notis vars antal beror på hur
-- aktiva andra är — precis den sortens notis CLAUDE.md säger nej till.

create table if not exists public.pause_cheers (
  -- Mottagarens paus, inte den delade pausens id: det är på den egna raden
  -- hjärtat visas, och en raderad paus tar sina hjärtan med sig.
  session_id  uuid not null references public.pause_sessions(id) on delete cascade,
  sender_id   uuid not null references public.profiles(id) on delete cascade,
  -- Pausens ägare, dubblerad hit så att mottagarens läsning och policyn inte
  -- behöver gå via pause_sessions. `can_cheer` ser till att den stämmer.
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (session_id, sender_id)
);

create index if not exists pause_cheers_receiver_idx
  on public.pause_cheers (receiver_id, session_id);

-- Får jag hjärta den här pausen? Bara om den är en annan persons paus, är en
-- riktig paus (inte en natt), och hör till en delad paus som jag själv var med
-- i. `security definer` för att kunna läsa den andras rad oavsett vad
-- SELECT-policyn på pause_sessions släpper igenom.
create or replace function public.can_cheer(p_session_id uuid, p_receiver_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from pause_sessions theirs
      join pause_sessions mine
        on mine.shared_session_id = theirs.shared_session_id
     where theirs.id = p_session_id
       and theirs.user_id = p_receiver_id
       and theirs.user_id <> auth.uid()
       and theirs.kind = 'pause'
       and theirs.shared_session_id is not null
       and mine.user_id = auth.uid()
  );
$$;

revoke all on function public.can_cheer(uuid, uuid) from anon;
grant execute on function public.can_cheer(uuid, uuid) to authenticated;

alter table public.pause_cheers enable row level security;

revoke all on public.pause_cheers from anon, authenticated;
grant select, insert, delete on public.pause_cheers to authenticated;

-- Avsändaren och mottagaren ser raden. Ingen annan — vänner till någon av dem
-- har inget med vem som hjärtade vem att göra.
drop policy if exists pause_cheers_select on public.pause_cheers;
create policy pause_cheers_select on public.pause_cheers
  for select to authenticated
  using (sender_id = auth.uid() or receiver_id = auth.uid());

drop policy if exists pause_cheers_insert on public.pause_cheers;
create policy pause_cheers_insert on public.pause_cheers
  for insert to authenticated
  with check (sender_id = auth.uid() and public.can_cheer(session_id, receiver_id));

-- Ett tryck till tömmer hjärtat igen. Bara ens eget.
drop policy if exists pause_cheers_delete on public.pause_cheers;
create policy pause_cheers_delete on public.pause_cheers
  for delete to authenticated
  using (sender_id = auth.uid());
