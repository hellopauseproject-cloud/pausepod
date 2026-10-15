-- Fotosvar i stödflödet: en bild med text ovanpå.
-- Körs för hand i Supabase SQL-editorn (samma konvention som circles.sql och
-- resten av mappen — det finns inget migrationsverktyg i projektet). Allt är
-- idempotent.
--
-- `support_responses` skapades utanför det här repot (ingen DDL finns här),
-- precis som `support_stories`. Nedan läggs därför bara till — inget rörs som
-- redan finns, samma linje som bryggan längst ner i wishlist.sql.

-- ─── Texten brinner inte in i bilden ──────────────────────────────────────
-- Ett fotosvar är två saker som skickas ihop: `content_url` (bilden i
-- bucketen `support-media`, samma som röst och video redan ligger i) och
-- `text_content` (bildtexten, samma kolumn som textsvaret redan använder).
-- De slås ihop först när bilden visas.
--
-- Det är inte en genväg utan den enda vägen: att platta ihop text och bild
-- till en ny JPEG kräver react-native-view-shot, alltså en native-modul och
-- därmed en ny dev-build — samma skäl som progress-ring.tsx och
-- circle-level-badge.tsx ritas för hand i stället för med react-native-svg.
-- Följden är dessutom bättre än alternativet: texten är sökbar, skalar med
-- mottagarens skärm och kan aldrig bli en suddig inbränd rad.
--
-- Priset är den här kolumnen. Bildtexten dras upp och ner över bilden när den
-- skrivs, och var den hamnade är en del av meddelandet — en rad som ska ligga
-- över en hand eller under en himmel betyder inte samma sak i mitten.
-- Talet är en andel (0–1) av bildytans höjd och inte en pixel: ytan är hela
-- skärmen hos både avsändaren och mottagaren, och de två skärmarna är sällan
-- lika höga.
alter table public.support_responses
  add column if not exists caption_y real;

alter table public.support_responses
  drop constraint if exists support_responses_caption_y_range;
alter table public.support_responses
  add constraint support_responses_caption_y_range
  check (caption_y is null or (caption_y >= 0 and caption_y <= 1))
  not valid;

comment on column public.support_responses.caption_y is
  'Bildtextens lodräta läge för response_type = ''photo'': andel (0-1) av bildytans höjd, mätt till bandets mitt. Null när svaret inte är ett foto eller fotot skickades utan text.';

-- ─── response_type får ett fjärde värde ───────────────────────────────────
-- Vilken check-constraint som sitter på kolumnen (eller om det finns någon
-- alls) står ingenstans i repot, eftersom tabellen skapades utanför det. Den
-- letas därför upp i stället för att gissas: varje check på
-- `support_responses` som nämner `response_type` och ännu inte känner till
-- 'photo' byts mot en som gör det. Finns ingen sådan constraint gör blocket
-- ingenting — kolumnen är då fri text och fotot fungerar ändå.
--
-- `not valid` på den nya: befintliga rader är redan text/voice/video och
-- behöver inte läsas igenom på nytt, och en validering som fäller på en rad
-- ingen känner till hade stoppat hela körningen. Nya rader kontrolleras
-- fullt ut oavsett.
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'support_responses'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%response_type%'
      and pg_get_constraintdef(con.oid) not ilike '%photo%'
  loop
    execute format('alter table public.support_responses drop constraint %I', c.conname);
    execute format(
      'alter table public.support_responses add constraint %I '
      'check (response_type in (''text'', ''voice'', ''video'', ''photo'')) not valid',
      c.conname);
    raise notice 'support_responses: % utökad med photo', c.conname;
  end loop;
end;
$$;

-- ─── Vyn som räknar svaren per sort ───────────────────────────────────────
-- analytics.feature_usage har en kolumn per svarssort, och `support_photo`
-- är tillagd där i samma ändring som den här filen. **Kör om
-- supabase/analytics.sql** när den här är körd — tills dess saknas bara den
-- kolumnen, inget går sönder.
--
-- Ingen manuell drop behövs längre. En `create or replace view` som skjuter
-- in en kolumn i mitten avvisas av Postgres ("cannot change name of view
-- column X to Y"), så analytics.sql droppar numera var och en av sina fem
-- vyer före sitt eget create. Grindarna `counted_profiles`/`counted_sessions`
-- droppas inte, eftersom de fem hänger på dem — skälet står i filens huvud.
--
-- (`\i analytics.sql` är för övrigt ingen väg: det är ett psql-kommando och
-- fungerar inte i Supabase SQL-editorn. Klistra in filen.)

-- ─── Bucketen ─────────────────────────────────────────────────────────────
-- Ingen ny bucket och inga nya policys: fotot laddas upp till `support-media`
-- med samma `uploadSupportMedia()` (lib/supportMedia.ts) som röst och video
-- redan använder, under samma `<user_id>/<timestamp>`-prefix. Rättigheterna
-- som redan släpper igenom en video släpper igenom en JPEG.

-- ─── Sist: säg till PostgREST ─────────────────────────────────────────────
-- PostgREST svarar ur en cachad bild av schemat, och klienten ser bara de
-- kolumner som står i den. Utan en omladdning avvisas en insert med
-- `caption_y` som "Could not find the 'caption_y' column of
-- 'support_responses' in the schema cache" — ett fel som ser ut som en
-- stavfelsbugg i appen trots att kolumnen finns i tabellen.
--
-- Supabase laddar om av sig självt på DDL, men inte alltid direkt, och
-- raden är gratis att köra en gång till.
notify pgrst, 'reload schema';
