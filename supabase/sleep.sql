-- Sömnläget — kör den här i Supabase SQL-editorn, och kör sedan om
-- supabase/dailygoal.sql, supabase/circles.sql och supabase/analytics.sql
-- (alla tre är idempotenta). De tre läser `pause_sessions.kind`, som skapas
-- här, och faller annars på en kolumn som inte finns.
--
-- Samma konvention som resten av mappen: schemat bor här, appliceras för
-- hand, och varje sats tål att köras om.
--
-- ── Varför ──────────────────────────────────────────────────────────────────
--
-- Användare lade telefonen nedåt över natten med en vanlig paus igång. Åtta
-- timmar räknades då som en paus, och eftersom dagen räknas på `ended_at`
-- landade de på MORGONEN: dagsringen var full klockan sju, kretsens pott och
-- stege steg åtta timmar på en natt, och kretsens dagsmålsnotis gick ut —
-- "Anna hit today's goal" — för en natts sömn.
--
-- En natt är en annan sak än en paus, och det enda som skiljer dem i datat är
-- vad användaren sa när hen startade: SLEEP eller PAUSE. Därför en kolumn och
-- ingen gissning (en lång paus efter klockan 22 är inte nödvändigtvis sömn).
--
-- ── Sömnen är privat, hela vägen ────────────────────────────────────────────
--
-- - Den räknas inte i dagsmålet (`get_daily_goal_progress` filtrerar).
-- - Den kommer aldrig in i kretsen: `record_circle_pause` vägrar en
--   sömnrad, och därmed når den varken potten, stegen, veckomålet eller
--   dagsmålsnotisen — alla fyra räknas ur `circle_pause_ledger`.
-- - **Vänner kan inte läsa den.** SELECT-policyn nedan släpper bara igenom
--   vänners rader med `kind = 'pause'`. Det är policyn och inte ett filter
--   i klienten som bär regeln: vänkortet, vänners vecka och friend-wrapped
--   läser `pause_sessions` rakt från klienten, och ett filter där hade bara
--   varit en artighet mot den som inte frågar själv.
-- - `profiles.is_pausing` sätts inte under en natt (app/pausing.tsx), så
--   ingen ser "pausing now" under någons namn hela natten.

-- ── Kolumnerna ──────────────────────────────────────────────────────────────

-- Förvalet `'pause'` gör att varje befintlig rad och varje befintlig
-- skrivare (lådflödets kö, krasch-återställningen, delade pauser) fortsätter
-- skriva pauser utan att röras. Bara sömnflödet sätter `'sleep'`.
alter table public.pause_sessions
  add column if not exists kind text not null default 'pause';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pause_sessions_kind_check') then
    alter table public.pause_sessions
      add constraint pause_sessions_kind_check check (kind in ('pause', 'sleep'));
  end if;
end;
$$;

-- Hur många gånger telefonen lyftes under natten och lades ner igen, och hur
-- länge den var uppe sammanlagt. Bara sömnrader har dem; för en paus är de
-- null. Lyftet som avslutar natten räknas inte — det är morgonen, inte ett
-- uppvaknande.
alter table public.pause_sessions add column if not exists wake_count int;
alter table public.pause_sessions add column if not exists awake_seconds int;

-- För en sömnrad betyder kolumnerna:
--   started_at       första gången telefonen lades ner — läggdags
--   ended_at         lyftet som avslutade natten — uppvaknandet
--   duration_seconds tiden telefonen låg ner, alltså utan awake_seconds

create index if not exists pause_sessions_user_kind_started_idx
  on public.pause_sessions (user_id, kind, started_at desc);

-- ── Inget nattmål ───────────────────────────────────────────────────────────
--
-- Det fanns ett (`profiles.nightly_target_seconds`, `set_night_goal`) och det
-- är borttaget. Ett mål på sömn mäter fel sak: appen kan inte få någon att
-- sova längre, bara påverka telefonen — när den läggs ner och om den tas upp.
-- Timmarna är mest hur länge någon sov, och ett missat nattmål läses som ett
-- omdöme om natten. Natten SPÅRAS i stället: läggdags, längd, uppvaknanden.
--
-- Kolumnen står kvar oläst och oskriven (kolumner droppas inte i den här
-- mappen, samma linje som `circle_members.daily_target_seconds`). Funktionen
-- droppas, så att ingen klient kan fortsätta skriva ett tal som inget läser.
drop function if exists set_night_goal(int);

-- ── Vänner ser bara pauser ──────────────────────────────────────────────────
--
-- Policyn skapades utanför repot. Den skrivs om här ord för ord, med ett
-- villkor till i vängrenen. Egna rader syns som förut, sömn eller inte.
drop policy if exists pause_sessions_select on public.pause_sessions;
create policy pause_sessions_select on public.pause_sessions
  for select to authenticated
  using (
    user_id = auth.uid()
    or (
      kind = 'pause'
      and exists (
        select 1 from friendships
         where friendships.status = 'accepted'
           and (
             (friendships.requester_id = auth.uid() and friendships.receiver_id = pause_sessions.user_id)
             or (friendships.receiver_id = auth.uid() and friendships.requester_id = pause_sessions.user_id)
           )
      )
    )
  );

-- ── Vilken natt en rad hör till ─────────────────────────────────────────────
--
-- **En natt hör till kvällen den började.** Gränsen går vid lokal middag: en
-- sömn som börjar 01:00 tisdag är måndagsnatten, och från tolv på tisdagen
-- gäller tisdagsnatten. Det ger Hem rätt beteende av sig självt — på
-- morgonen visar nattringen natten som just tog slut, på eftermiddagen en tom
-- ring för natten som kommer.
--
-- `p_tz_offset_minutes` är `Date.getTimezoneOffset()`, samma tal och samma
-- tecken som i `get_daily_goal_progress`.
create or replace function sleep_night_of(p_at timestamptz, p_tz_offset_minutes int)
returns date
language sql
immutable
as $$
  select ((p_at at time zone 'UTC') - make_interval(mins => p_tz_offset_minutes) - interval '12 hours')::date;
$$;

-- ── Läsningarna ─────────────────────────────────────────────────────────────
--
-- Inte `security definer`, av samma skäl som `get_daily_goal_progress`: de
-- läser bara anroparens egna rader, och det släpper RLS redan igenom.

-- Nätterna, nyaste först, en rad per natt. Statistiken ritar listan; Hem tar
-- den första och jämför `night_of` med `current_night`.
create or replace function get_sleep_nights(p_tz_offset_minutes int default 0, p_limit int default 30)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(n order by n.night_of desc), '[]'::jsonb)
    from (
      select sleep_night_of(started_at, p_tz_offset_minutes) as night_of,
             sum(duration_seconds)::int                     as sleep_seconds,
             coalesce(sum(wake_count), 0)::int              as wake_count,
             coalesce(sum(awake_seconds), 0)::int           as awake_seconds,
             min(started_at)                                as bedtime,
             max(ended_at)                                  as woke_at
        from pause_sessions
       where user_id = auth.uid()
         and kind = 'sleep'
         and ended_at is not null
       group by 1
       order by 1 desc
       limit greatest(1, least(p_limit, 365))
    ) n;
$$;

grant execute on function get_sleep_nights(int, int) to authenticated;

-- Det Hem behöver i nattläget: natten som gäller just nu. `sleep_seconds` är
-- 0 och resten null när natten inte har någon rad än.
create or replace function get_night_progress(p_tz_offset_minutes int default 0)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_night date := sleep_night_of(now(), p_tz_offset_minutes);
  v_row record;
begin
  if auth.uid() is null then
    return null;
  end if;

  select coalesce(sum(duration_seconds), 0)::int as sleep_seconds,
         coalesce(sum(wake_count), 0)::int       as wake_count,
         coalesce(sum(awake_seconds), 0)::int    as awake_seconds,
         min(started_at)                         as bedtime,
         max(ended_at)                           as woke_at
    into v_row
    from pause_sessions
   where user_id = auth.uid()
     and kind = 'sleep'
     and ended_at is not null
     and sleep_night_of(started_at, p_tz_offset_minutes) = v_night;

  return jsonb_build_object(
    'night_of', v_night,
    'sleep_seconds', v_row.sleep_seconds,
    'wake_count', v_row.wake_count,
    'awake_seconds', v_row.awake_seconds,
    'bedtime', v_row.bedtime,
    'woke_at', v_row.woke_at
  );
end;
$$;

grant execute on function get_night_progress(int) to authenticated;
