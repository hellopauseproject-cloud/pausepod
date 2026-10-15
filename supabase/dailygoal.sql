-- Dagsmålet — kör den här i Supabase SQL-editorn FÖRE supabase/circles.sql.
-- Samma konvention som resten av mappen (se kommentaren högst upp i
-- supabase/circles.sql): schemat bor här, inte i ett migrationsverktyg, och
-- appliceras för hand. Idempotent rakt igenom — varje sats tål att köras om.
--
-- ── Varför talet flyttade hit ───────────────────────────────────────────────
--
-- Dagsmålet låg på `circle_members.daily_target_seconds`, alltså på
-- medlemsraden i en krets. Det gjorde målet till något man bara kunde ha
-- tillsammans med andra: `set_daily_goal` kastade "You are not in a circle."
-- för alla andra, introduktionen kunde inte spara siffran den just frågat om
-- (den parkerades lokalt, se lib/introPrefs.ts), och ringen på Hem — appens
-- mest sedda yta — stod tom för den som pausar ensam.
--
-- Målet är personligt. Det står uttryckligen i circles.sql: kretsens pott är
-- SUMMAN av personliga mål, ingen röstar om någons siffra. Att en personlig
-- sak bara existerade inne i en grupp var platsen som var fel, inte regeln.
--
-- Därför: `profiles.daily_target_seconds` är hela appens ENDA källa till
-- sanning för talet. Kretsen läser det därifrån (`evaluate_circle_goals`,
-- `get_circle_progress`, `get_circle_wrapped` joinar profiles) i stället för
-- att ha en egen kopia. Två kolumner med samma tal hade krävt synkronisering
-- vid varje skrivning och vid varje inträde i en krets, och den sortens
-- spegling glider tyst isär — kretsfliken hade visat en siffra och Hem en
-- annan, utan att något felar.
--
-- Följden att hålla i huvudet: går man med i en krets tar man sitt mål med
-- sig. Det är avsiktligt och löser samtidigt "en medlem utan mål blockerar
-- veckans bedrift för hela kretsen" för alla som satt ett i introduktionen.

-- ── Kolumnen ────────────────────────────────────────────────────────────────

alter table profiles add column if not exists daily_target_seconds int;

-- Engångsflytt av det som redan ligger på medlemsraderna. `is null`-villkoret
-- gör den ofarlig att köra om: har någon satt ett mål efter flytten skrivs det
-- inte över av en gammal kopia.
--
-- `circle_members.daily_target_seconds` droppas INTE — kolumner droppas inte i
-- den här mappen, och en kvarlämnad kolumn som ingenting läser är ofarlig.
-- Skriven blir den däremot aldrig mer; letar du efter målet är det profiles
-- som gäller.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'circle_members'
               and column_name = 'daily_target_seconds') then
    update profiles p
       set daily_target_seconds = m.daily_target_seconds
      from circle_members m
     where m.user_id = p.id
       and m.daily_target_seconds is not null
       and p.daily_target_seconds is null;
  end if;
end;
$$;

-- ── Läsningen för den som pausar ensam ──────────────────────────────────────
--
-- Ringen på Hem behöver två tal: dagens summa och dagens mål. För en
-- kretsmedlem kommer de ur `get_circle_progress()`, som räknar dagen ur
-- `circle_pause_ledger` — alltså bara det som hänt medan man varit med i
-- kretsen. Utan krets finns ingen ledger, och då räknas dagen direkt ur den
-- egna `pause_sessions`.
--
-- **Inte `security definer`, med flit.** Funktionen läser bara anroparens egna
-- rader, och det släpper RLS redan igenom (app/stats.tsx gör samma läsning
-- rakt från klienten). Definer används i den här mappen just för de anrop som
-- MÅSTE korsa RLS — `get_circle_progress` läser andra medlemmars sessioner,
-- `username_available` frågas av en som inte har konto. Att lägga på det här
-- vore att ge bort spärren gratis.
--
-- Den finns ändå som funktion i stället för två selects i klienten, för att
-- dygnsgränsen ska räknas på ett enda ställe. `p_tz_offset_minutes` är
-- `Date.getTimezoneOffset()` från klienten, och uttrycket är ord för ord
-- detsamma som `v_day_start` i `get_circle_progress` — annars kan Hem och
-- kretsfliken svara olika på vad "idag" betyder, vilket är precis den sortens
-- skillnad ingen hittar.
--
-- Returnerar `daily_target_seconds: null` för den som inte satt något mål.
-- Klienten skiljer på det och noll: noll vore ett mål på ingenting.
create or replace function get_daily_goal_progress(p_tz_offset_minutes int default 0)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_day_start timestamptz := date_trunc('day', now() - make_interval(mins => p_tz_offset_minutes))
                             + make_interval(mins => p_tz_offset_minutes);
  v_target int;
  v_today bigint;
begin
  if auth.uid() is null then
    return null;
  end if;

  select daily_target_seconds into v_target from profiles where id = auth.uid();

  -- Bara avslutade sessioner. En pågående paus har `ended_at is null` och
  -- ingen längd att räkna — ringen ska inte ticka medan telefonen ligger i
  -- lådan, den ska stämma när man tar upp den.
  -- Bara pauser. En natt med telefonen nedåt (`kind = 'sleep'`, se
  -- supabase/sleep.sql) hade annars fyllt MORGONENS ring, eftersom dagen
  -- räknas på `ended_at`. Kolumnen skapas i sleep.sql — kör den först.
  select coalesce(sum(duration_seconds), 0) into v_today
    from pause_sessions
   where user_id = auth.uid()
     and kind = 'pause'
     and ended_at is not null
     and ended_at >= v_day_start;

  return jsonb_build_object(
    'today_seconds', v_today,
    'daily_target_seconds', v_target
  );
end;
$$;

grant execute on function get_daily_goal_progress(int) to authenticated;
