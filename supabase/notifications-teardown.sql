-- Notiser — rivning. Kör den här i Supabase SQL-editorn.
-- Samma konvention som resten av mappen (se kommentaren högst upp i
-- supabase/circles.sql): schemat appliceras för hand, inte via ett
-- migrationsverktyg. Idempotent rakt igenom — varje sats tål att köras om.
--
-- ── Vad den här filen river ─────────────────────────────────────────────────
--
-- Appen skickar inga notiser längre — varken push eller lokala. Det som togs
-- bort på klientsidan var `lib/notifications.ts`, notissektionen i Settings
-- och wiringen i `app/_layout.tsx`; det som togs bort härifrån var
-- `supabase/notifications.sql` och edge-funktionen `notify-friends-pausing`.
--
-- **Triggern är den som måste bort först.** Klientkoden slutade skriva
-- `push_token`, men tokens som redan ligger kvar på profilraderna hade
-- fortsatt att få push så länge `profiles_notify_friends_pausing` fanns:
-- triggern fyrar på `is_pausing` false → true, och den skrivningen görs
-- fortfarande av pausskärmen (`lib/pausingFlag.ts` — flaggan bär också
-- "pausing now" under en väns namn i Community, så den stannar).
-- Att bara radera appkoden hade alltså inte tystat något.

-- ── Triggern och utskicket ──────────────────────────────────────────────────

drop trigger if exists profiles_notify_friends_pausing on profiles;
drop function if exists notify_friends_pausing();

-- pg_net droppas INTE. Extensionen är delad och kan ha andra användare; en
-- `drop extension` här hade rivit deras vägar också.

-- ── Mottagarlistan och strypningen ──────────────────────────────────────────

drop function if exists claim_friend_pause_recipients(uuid, int, int);
drop function if exists release_friend_pause_ping(uuid, uuid);
drop function if exists prune_friend_pause_pings();

-- Hette så i ett tidigare skede av filen som nu är borta. Droppas för att en
-- databas som aldrig hann uppdateras inte ska lämna den kvar.
drop function if exists friends_to_notify_of_pause(uuid, int);

-- Strypventilen. Hade inga grants och lästes bara av funktionerna ovan, så
-- ingenting kan läsa den längre.
drop table if exists friend_pause_pings;

-- ── Tokens som redan ligger kvar ────────────────────────────────────────────
--
-- Kolumnerna droppas inte (samma linje som `circle_members.daily_target_seconds`
-- i supabase/dailygoal.sql: kolumner droppas inte i den här mappen), men
-- *innehållet* i `push_token` ska inte ligga kvar. Det är den enda av de tre
-- som är känslig, och ingenting läser den längre — varken klient eller server.
update profiles set push_token = null where push_token is not null;

-- `notify_friend_pausing` och `tz_offset_minutes` lämnas som de är. Den första
-- är en boolean med default true som ingenting läser; den andra en offset i
-- minuter. Båda står oläsna och oskrivna.
--
-- Sätts notiser någon gång tillbaka är det inte den här filen som ska ångras:
-- taket, strypningen och nattfönstret i den gamla `notifications.sql` var
-- resultatet av avvägningar som bör göras om från början, inte återställas.

-- ── Kontroll ────────────────────────────────────────────────────────────────
--
-- Efter körningen ska den här ge noll rader:
--
--   select tgname from pg_trigger where tgname = 'profiles_notify_friends_pausing';
--   select proname from pg_proc where proname in (
--     'notify_friends_pausing', 'claim_friend_pause_recipients',
--     'release_friend_pause_ping', 'prune_friend_pause_pings');
--   select count(*) from profiles where push_token is not null;
