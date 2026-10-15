-- Kolumnerna som lådflödet skriver till i pause_sessions.
-- Körs för hand i Supabase SQL-editorn (samma konvention som circles.sql —
-- det finns inget migrationsverktyg i projektet).
--
-- Utan de här avvisar PostgREST hela inserten i lib/sessionOutbox.ts
-- (flushOutbox), posten blir kvar osynkad i den lokala outboxen och pausen
-- syns aldrig i statistiken. Allt är idempotent och ofarligt att köra om.

alter table public.pause_sessions
  add column if not exists completed boolean not null default true,
  add column if not exists box_id    text,
  add column if not exists box_seq   text;

-- Samma session får bara finnas en gång även om lådan skickar om den (den
-- gör det var 3:e sekund tills den fått sin ack, och kön överlever både
-- app-omstart och strömavbrott). flushOutbox tolkar krocken här — 23505 —
-- som "redan synkad" och ackar ändå, vilket är det som håller lådans kö
-- från att fastna.
create unique index if not exists pause_sessions_box_seq_unique
  on public.pause_sessions (box_id, box_seq)
  where box_id is not null;
