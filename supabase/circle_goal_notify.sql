-- Dagsmålsnotisen i kretsen: "Anna hit today's goal".
--
-- Körs för hand i Supabase SQL-editorn, EFTER circles.sql och dailygoal.sql
-- (samma konvention som resten av mappen — det finns inget migrationsverktyg
-- i projektet). Allt är idempotent rakt igenom.
--
-- ─── Vad det här är, och vad det inte är ──────────────────────────────────
--
-- Appen hade en push-kedja och den revs (se notisavsnittet i CLAUDE.md och
-- notifications-teardown.sql). Det här är inte den återuppbyggd. Den gamla
-- fyrade på `profiles.is_pausing` false → true — alltså på VARJE paus av
-- VARJE vän, N × M om dagen — och behövde därför ett tak, en strypning på 6
-- timmar och en bokning under rådgivande lås för att inte peppra.
--
-- Den här har inget av det, och behöver inte ha det:
--
--   * Mottagarna är **kretsarna**, inte vänlistan. En krets är högst 10
--     personer och man är med i högst tre (`circle_max_per_user()`).
--   * Händelsen kan inträffa **en gång per person och dygn** — primärnyckeln
--     på `daily_goal_achievements` är själva mekanismen, inte en kontroll
--     ovanpå den.
--
-- Taket är alltså 3 × 9 = 27 notiser per dygn i absolut värsta fall (varje
-- mottagare får högst en per person, också den som delar två kretsar med
-- avsändaren), och det är strukturellt. Det finns ingen `friend_pause_pings`-motsvarighet här, och
-- det är inte en glömska: det som gjorde den tabellen nödvändig är borta.
--
-- Nattfönstret 08–21 står kvar som idé från den gamla kedjan, för det skälet
-- är inte borta: en medlem i en annan tidszon ska inte kunna knacka klockan
-- tre. Det är enda stället `profiles.tz_offset_minutes` används — kolumnen
-- har stått oläst sedan rivningen, och appen börjar skriva den igen för
-- precis det här (se registerPushToken() i lib/notifications.ts).
--
-- ─── Krav ────────────────────────────────────────────────────────────────
--
-- `pg_net` måste finnas. Teardown-filen droppade den medvetet INTE
-- (extensionen är delad), så den ligger sannolikt kvar — kontrollen längst
-- ner i filen svarar på det. Saknas den:
--
--   create extension if not exists pg_net;


-- ══ 1. Var utskicket går, och med vilken nyckel ═══════════════════════════
--
-- Två rader som måste fyllas i för hand. De ligger i en tabell och inte som
-- literaler i den här filen, eftersom filen ligger i git och hemligheten inte
-- ska göra det.
--
-- **Ingen service-nyckel behövs någonstans.** Edge-funktionen pratar bara med
-- Expo, aldrig med databasen — mottagarlistan och texten räknas fram här och
-- skickas med i anropet. Hemligheten nedan är därför inte en Supabase-nyckel
-- utan en egen sträng vars enda makt är att få just den funktionen att skicka
-- en push. Generera den med t.ex. `openssl rand -hex 32`.

create table if not exists notify_config (
  key text primary key,
  value text not null
);

alter table notify_config enable row level security;
-- Inga policies och inga grants: bara `security definer`-funktionen nedan
-- läser den, och den kör som ägare. En klient med anon- eller
-- authenticated-nyckel ser ingenting, ens om RLS skulle slås av av misstag.
revoke all on notify_config from anon, authenticated;

-- Fyll i de två raderna. `on conflict do update` gör att du kan köra om
-- filen med nya värden utan att först radera.
--
-- Url:en nedan pekar redan på det här projektet (`iwyumzgewiwvcbuqzjnk`, samma
-- ref som i `.env`). Bara hemligheten är kvar att fylla i, och den ska vara
-- exakt samma sträng som `PAUSE_NOTIFY_SECRET` i edge-funktionens miljö.
--
--   insert into notify_config (key, value) values
--     ('goal_notify_url',    'https://iwyumzgewiwvcbuqzjnk.supabase.co/functions/v1/notify-circle-goal-reached'),
--     ('goal_notify_secret', 'KLISTRA_IN_HEMLIGHETEN_HÄR')
--   on conflict (key) do update set value = excluded.value;


-- ══ 2. Raden som säger att det hänt ═══════════════════════════════════════
--
-- Utan den här notifierar varje paus EFTER att strecket passerats om och om
-- igen — en person som når sitt mål och sedan pausar tre gånger till hade
-- gett fyra notiser. Primärnyckeln `(user_id, day)` är spärren.
--
-- `day` är **bedriftens egen dag**, räknad i den som nådde målets lokala tid.
-- Det är en avvikelse från hur dagen annars hanteras i kretsen, och den är
-- avsiktlig. CLAUDE.md säger vid dagsidan i kretsfliken att "skulle en
-- dagsbedrift någon gång behövas måste dygnsgränsen först bli delad" — och
-- det kravet gällde ett delat TAL: potten summerar medlemmar mot varandra, och
-- då måste alla mena samma sak med "idag". Den här bedriften jämför ingen med
-- någon. Den säger att Anna nådde SITT mål under SIN dag, och bara Annas egen
-- telefon avgör det. Ingen annan behöver vara överens om när hennes dygn
-- började, och därför behövs ingen delad gräns.
--
-- Den läses aldrig av klienten: inga grants, precis som
-- `circle_pause_ledger`. Allt som ska visas av dagens siffror kommer redan
-- aggregerat ur `get_circle_progress()`.
create table if not exists daily_goal_achievements (
  user_id        uuid not null references profiles(id) on delete cascade,
  day            date not null,
  seconds        int  not null check (seconds >= 0),
  target_seconds int  not null check (target_seconds > 0),
  -- Kretsen bedriften räknades i. Lämnar man kretsen står raden kvar, men
  -- `on delete set null` gör att en raderad krets inte tar historiken med
  -- sig — samma linje som `circle_pause_ledger.session_id`.
  circle_id      uuid references circles(id) on delete set null,
  achieved_at    timestamptz not null default now(),
  primary key (user_id, day)
);

alter table daily_goal_achievements enable row level security;
revoke all on daily_goal_achievements from anon, authenticated;


-- ══ 3. Utskicket ══════════════════════════════════════════════════════════
--
-- Bygger mottagarlistan och postar till edge-funktionen. Anropas bara från
-- `record_daily_goal_reached` nedan, och har därför inga grants.
--
-- Tre filter på mottagarna, och vart och ett utesluter en konkret olägenhet:
--
--   1. `m.user_id <> p_actor_id` — man notifieras inte om sin egen bedrift.
--   2. `p.push_token is not null` — den som inte gett behörighet har ingen
--      token, och ska inte ligga i listan som ett tomt hål.
--   3. Nattfönstret 08–21 i MOTTAGARENS tid. Saknas `tz_offset_minutes`
--      antas 0, alltså UTC — det är ett medvetet val framför att hoppa över
--      mottagaren helt: en notis i möjligen fel timme är bättre än ingen alls,
--      och kolumnen fylls vid nästa appstart.
--
-- Den som filtreras bort av nattfönstret får ingenting senare. Det finns
-- ingen kö, och det är med flit: "Anna nådde sitt mål" är inte sant imorgon
-- bitti på ett sätt som är värt en notis.
--
-- **Ett utskick per krets, och varje mottagare bara en gång.** Avsändaren
-- kan vara med i upp till tre kretsar, och ett tryck ska landa i chatten i
-- just den krets man delar — därför bär varje utskick sin egen `circle_id`.
-- Delar någon två kretsar med avsändaren får hen notisen från den krets
-- avsändaren gick med i först (`v_sent` bär dem som redan fått den).
drop function if exists notify_circle_goal_reached(uuid, uuid);
create or replace function notify_circle_goal_reached(p_actor_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name      text;
  v_url       text;
  v_secret    text;
  v_circle_id uuid;
  v_tokens    jsonb;
  v_ids       uuid[];
  v_sent      uuid[] := array[p_actor_id];
  v_count     int := 0;
begin
  select value into v_url    from notify_config where key = 'goal_notify_url';
  select value into v_secret from notify_config where key = 'goal_notify_secret';
  -- Ofyllt konfig: tyst no-op. En databas där filen körts men raderna inte
  -- fyllts i ska inte få varje paus att fela.
  if v_url is null or v_secret is null then
    return 0;
  end if;

  select username into v_name from profiles where id = p_actor_id;
  if v_name is null then
    return 0;
  end if;

  for v_circle_id in
    select circle_id from circle_members where user_id = p_actor_id order by joined_at
  loop
    select jsonb_agg(p.push_token), array_agg(p.id)
      into v_tokens, v_ids
      from circle_members m
      join profiles p on p.id = m.user_id
     where m.circle_id = v_circle_id
       and not (m.user_id = any(v_sent))
       and p.push_token is not null
       and extract(hour from (
             (now() at time zone 'utc') - make_interval(mins => coalesce(p.tz_offset_minutes, 0))
           )) between 8 and 20;

    continue when v_tokens is null;
    v_sent  := v_sent || v_ids;
    v_count := v_count + cardinality(v_ids);

  -- Texten byggs här och inte i edge-funktionen. Skälet är detsamma som att
  -- `circle_activity` sparar `type` + `metadata` och låter `formatActivity()`
  -- bygga meningen: ju färre ställen som äger formuleringar, desto färre
  -- ställen glider isär. Skillnaden är att den här meningen måste finnas
  -- färdig när den lämnar databasen — en notis har ingen klient som renderar
  -- den — så den närmaste platsen är den som känner namnet.
  --
  -- **Inget pronomen, och det är inte en stilfråga.** Appen lagrar inte
  -- någons pronomen och ska inte gissa det ur ett användarnamn, så varken
  -- "her" eller "his" går att skriva här. `their` hade fungerat men läser
  -- trögt i en rubrik; `today's` säger dessutom något rubriken behöver —
  -- vilken dag det gäller. Samma regel gäller varje framtida notistext.
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Content-Type',    'application/json',
        'x-pause-secret',  v_secret
      ),
      body    := jsonb_build_object(
        'tokens', v_tokens,
        'title',  v_name || ' hit today''s goal',
        'body',   'Celebrate in the chat.',
        'data',   jsonb_build_object('type', 'circle_goal_reached', 'circle_id', v_circle_id)
      )
    );
  end loop;

  return v_count;
end;
$$;

revoke all on function notify_circle_goal_reached(uuid) from anon, authenticated;


-- ══ 4. Grinden klienten anropar ═══════════════════════════════════════════
--
-- Anropas efter varje avslutad paus, direkt efter `record_circle_pause` —
-- från `recordPauseInCircle()` i lib/circles.ts, som är enda stället båda
-- pausflödena (app/pausing.tsx och lib/sessionOutbox.ts) går genom.
--
-- **Varför en egen funktion och inte en gren i `record_circle_pause`.** Det
-- hade varit den naturligare platsen, men att lägga till en parameter där
-- kräver ett `drop function` först (en ny parameter skapar en överlagring,
-- den ersätter inte), och då måste hela kroppen kopieras in i den här filen.
-- Två kopior av den funktionen hade glidit isär vid nästa ändring i
-- circles.sql. Priset är ett extra RPC-anrop per paus.
--
-- **Klienten får inte påstå något.** Den skickar bara sin tidszon; summan,
-- målet och jämförelsen läses här. Samma princip som `record_circle_pause`,
-- som bara tar emot ett `session_id` och läser längden själv — ingen ska
-- kunna skicka in en bedrift som inte finns i den egna loggen.
--
-- **Summan kommer ur de egna `pause_sessions`**, med samma villkor som
-- `get_daily_goal_progress()` — alltså samma tal som ringen på Hem. Den kom
-- förr ur `circle_pause_ledger`, men med upp till tre kretsar finns samma
-- paus på upp till tre ledgerrader, och "dagens summa" hade blivit en fråga
-- om vilken krets man menar. Ringen på Hem läser numera också
-- `get_daily_goal_progress()`, så notisen kan aldrig påstå något som Hem
-- motsäger.
--
-- Returnerar antalet mottagare notisen gick till, `0` när ingenting hände.
-- Klienten läser inte talet; det finns för att gå att felsöka från
-- SQL-editorn.
create or replace function record_daily_goal_reached(p_tz_offset_minutes int default 0)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_circle_id uuid;
  v_target    int;
  v_day_start timestamptz;
  v_day       date;
  v_today     bigint;
  v_rows      int;
begin
  if v_uid is null then
    return 0;
  end if;

  -- Notisen är kretsens. Den som pausar ensam skriver ingen rad alls — det
  -- håller tabellen vid de som den faktiskt handlar om, och gör funktionen
  -- en tyst no-op för alla andra, precis som `record_circle_pause`.
  -- `circle_id` på raden nedan är den krets man gick med i först. Den är
  -- bara en upplysning; notisen går till alla ens kretsar.
  v_circle_id := resolve_my_circle(null);
  if v_circle_id is null then
    return 0;
  end if;

  select daily_target_seconds into v_target from profiles where id = v_uid;
  -- `null` är inget mål, och noll vore ett mål på ingenting. Varken det ena
  -- eller det andra går att nå.
  if v_target is null or v_target <= 0 then
    return 0;
  end if;

  -- Ord för ord samma uttryck som `v_day_start` i `get_circle_progress` och
  -- `get_daily_goal_progress`. Avviker det här kan notisen och ringen svara
  -- olika på vad "idag" betyder, vilket är precis den sortens skillnad ingen
  -- hittar.
  v_day_start := date_trunc('day', now() - make_interval(mins => p_tz_offset_minutes))
                 + make_interval(mins => p_tz_offset_minutes);
  v_day       := (now() - make_interval(mins => p_tz_offset_minutes))::date;

  select coalesce(sum(duration_seconds), 0) into v_today
    from pause_sessions
   where user_id = v_uid
     and kind = 'pause'
     and ended_at is not null
     and ended_at >= v_day_start;

  if v_today < v_target then
    return 0;
  end if;

  insert into daily_goal_achievements (user_id, day, seconds, target_seconds, circle_id)
  values (v_uid, v_day, v_today, v_target, v_circle_id)
  on conflict (user_id, day) do nothing;

  get diagnostics v_rows = row_count;
  -- Redan notifierad idag. Den här grenen är hela skälet tabellen finns.
  if v_rows = 0 then
    return 0;
  end if;

  return notify_circle_goal_reached(v_uid);
end;
$$;

grant execute on function record_daily_goal_reached(int) to authenticated;


-- ══ 5. Kontroll ═══════════════════════════════════════════════════════════
--
-- Kör de här efter filen. Alla fem ska svara som kommentaren säger.

-- Finns pg_net? Ska ge en rad.
--   select extname from pg_extension where extname = 'pg_net';

-- Är konfigen ifylld? Ska ge två rader, och url:en ska peka på ditt projekt.
--   select key, left(value, 48) || '…' as value from notify_config order by key;

-- Har någon en token? Står den på 0 har ingen klient registrerat sig än —
-- notisen går då aldrig ut, och det är inte ett fel i den här filen.
--   select count(*) as med_token, count(tz_offset_minutes) as med_tidszon
--     from profiles where push_token is not null;

-- Vad har skrivits? Tomt är rätt svar innan någon nått sitt mål.
--   select a.day, p.username, a.seconds, a.target_seconds, a.achieved_at
--     from daily_goal_achievements a join profiles p on p.id = a.user_id
--    order by a.achieved_at desc limit 20;

-- Gick utskicken fram? pg_net loggar svaren själv.
--   select id, status_code, left(content, 200) as svar, created
--     from net._http_response order by created desc limit 10;


-- ══ 6. Att stänga av den ══════════════════════════════════════════════════
--
-- Till skillnad från den gamla kedjan går den här att tysta utan att röra
-- klienten: ingen trigger fyrar av sig själv, allt hänger på ett anrop från
-- appen och på konfigraderna.
--
--   delete from notify_config where key in ('goal_notify_url', 'goal_notify_secret');
--
-- Då blir `notify_circle_goal_reached` en no-op och raderna i
-- `daily_goal_achievements` fortsätter skrivas utan att något skickas. Ska
-- också raderna bort:
--
--   drop function if exists record_daily_goal_reached(int);
--   drop function if exists notify_circle_goal_reached(uuid);
--   drop table if exists daily_goal_achievements;
--   drop table if exists notify_config;
--
-- `push_token` och `tz_offset_minutes` nollas i så fall med samma rad som i
-- notifications-teardown.sql.
